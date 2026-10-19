/**
 * dsh-tieba-scroll —— 主机半端
 * ============================================================================
 * 每天替用户刷几个吧：读帖 → 挑值得看的 → 写日报；可选签到、回帖。
 *
 * 三条红线：
 *   1. 默认只读。签到要开 `autoSign`，回帖要开 `autoReply` 且**必须**带 confirm。
 *   2. 回帖有硬上限：每天 N 条、两条之间至少 M 秒、同帖一天一次。
 *   3. 凭证只存本地 `$DSH_HOME/tieba-duty/cookie.txt`（600），不回显、不进日志。
 *
 * 配置：自己的 `config.json`（lib/config.mjs）+ 设置页控件 + `/api/tieba-duty/config`，
 * 不依赖宿主自动生成的表单 —— 有些版本上那个表单压根不渲染。
 */
import { defineTool as hostDefineTool } from './lib/toolkit.mjs'
import * as tieba from './lib/tieba.js'
import { readConfig, writeConfig, DEFAULTS } from './lib/config.mjs'
import { freshState, writeState, audit, pruneSeen, today } from './lib/state.mjs'
import { appendDiary, readDiary, diaryStats, diaryFile } from './lib/diary.mjs'
import { writeReport, readReport, listReports, reportsDir } from './lib/reports.mjs'
import { toneCheck } from './lib/tone.mjs'
import { runRound, readLog, logFile } from './lib/runner.mjs'
import { isValley, nextValley, peakLabel, currentWindow } from './lib/peak.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

export const name = 'tieba-scroll'
// ⚠️ webServer 不能写进 inject：headless profile 没有这个服务，写进去整个插件会 pending，工具全不可用。
// 这里只声明真正必需的，webServer 在 apply 里按需取。
export const inject = ['tools', 'settings']

let z
try { z = (await import('@deepseek-ai/schemastery')).default } catch { z = null }

/** 宿主表单（有就用，没有也能跑） */
export const Config = !z ? undefined : z.object({
  bars: z.array(z.string()).default(DEFAULTS.bars),
  autoSign: z.boolean().default(false),
  autoReply: z.boolean().default(false),
  replyPerDay: z.natural().default(3),
  replyGapSec: z.natural().default(30),
})

const log = (...a) => console.log('[tieba-duty]', ...a)

/** 最近一次错误（给设置页红点用）；只在内存里，重启即清 */
let lastError = null
const noteError = (where, e) => {
  lastError = { at: new Date().toISOString(), where, message: String((e && e.message) || e) }
  log(`出错（${where}）：${lastError.message}`)
}

/** curl 是网络层的命根子，启动就先看一眼 */
function checkCurl() {
  try {
    const out = execFileSync('curl', ['--version'], { encoding: 'utf8', timeout: 5000 })
    return { ok: true, version: String(out).split('\n')[0].trim() }
  } catch (e) {
    return { ok: false, error: '找不到 curl（网络层的请求都靠它）' }
  }
}

function checkDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, '.write-test')
    fs.writeFileSync(f, 'ok'); fs.unlinkSync(f)
    return true
  } catch { return false }
}

function checkHeadless(cfg) {
  let bin = cfg.dshBin || 'dsh'
  try {
    execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 })
  } catch (e) {
    return { ok: false, error: '找不到 dsh（定时一轮要用它）' }
  }
  return { ok: true, bin, profile: cfg.headlessProfile }
}

export function apply(ctx, config = {}) {
  // ⚠️ headless 子进程里**不许**再起调度器：否则子进程里的插件又会触发定时器，
  //    子子孙孙一直起（真机上真的发生了，日志里每 1~3 分钟一轮）。
  const NO_SCHEDULE = process.env.TIEBA_DUTY_NO_SCHEDULE === '1'

  const cfgOf = () => {
    const c = readConfig(config)
    tieba.setGap(c.requestGapMs)
    return c
  }

  const tool = (spec) => {
    const wrapped = {
      ...spec,
      execute: async (...a) => {
        try { return await spec.execute(...a) } catch (e) { noteError('工具 ' + spec.name, e); throw e }
      },
    }
    try { ctx.tools.register(hostDefineTool(wrapped)) } catch (e) {
      log(`工具 ${spec.name} 没注册上（不影响别的）：${e?.message ?? e}`)
    }
  }
  // 返回「对象」而不是 JSON 字符串：宿主的 output.schema 是 object，字符串会被判校验失败
  const json = (v) => v


  if (typeof ctx.settings?.register === 'function' && Config) {
    try { ctx.settings.register('tieba-duty', Config, { base: {}, applies: 'live' }) } catch (e) {
      log(`宿主设置项没挂上（不影响用）：${e?.message ?? e}`)
    }
  }

  tool({
    name: 'tieba_my_replies',
    description: '看自己最近回过哪些帖子（本地记录，不需要通知接口）。'
      + '想知道有没有人接着回复你，拿这些 tid 去 tieba_thread 回读；楼中楼的具体接口贴吧没公开。',
    parameters: { limit: { type: 'number', description: '最近几条（默认 20）' } },
    execute: async (args) => {
      const st = freshState()
      const rows = Object.entries(st.replied || {})
        .map(([tid, v]) => ({ tid, ...v }))
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, Math.max(1, Math.min(Number(args.limit) || 20, 100)))
      return json({ count: rows.length, rows })
    },
  })

  tool({
    name: 'tieba_report_write',
    description: '写今天的日报（会覆盖同一天的文件）。路径：$DSH_HOME/tieba-duty/reports/YYYY-MM-DD.md',
    parameters: {
      content: { type: 'string', description: '整份日报的 markdown' },
      date: { type: 'string', description: 'YYYY-MM-DD（默认今天）' },
    },
    execute: async (args) => json(writeReport(String(args.content || ''), { date: args.date })),
  })

  tool({
    name: 'tieba_report_read',
    description: '读日报。默认读今天的；latest:true 读最近一份；也可以指定 date。',
    parameters: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      latest: { type: 'boolean', description: '读最近一份' },
      lines: { type: 'number', description: '读最后多少行（默认 400）' },
    },
    execute: async (args) => json(readReport({ date: args.date, latest: args.latest === true, lines: Number(args.lines) || 400 })),
  })

  tool({
    name: 'tieba_reports',
    description: '列出已有的日报（日期 / 大小）。',
    parameters: {},
    execute: async () => json(listReports()),
  })

  // ── HTTP（设置页用）────────────────────────────────────────────────────────
  const sendJson = (res, code, obj) => {
    res.statusCode = code
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(obj))
  }
  const readBody = (req) => new Promise((resolve) => {
    let b = ''
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')) } catch { resolve({}) } })
  })

  // 可选依赖：没 inject webServer 时不能直接读属性（Cordis 会抛），
  // 先试 ctx.get（官方的「可选取服务」姿势），不行再兜一层属性访问。
  // ⚠️ 为什么用 ctx.inject 而不是在 apply 里直接取：
  //   · webServer 属于 dsh-web-app，可能在本插件 apply 之后才就绪；
  //     直接读 ctx.get('webServer') 会拿到 undefined，路由静默不挂 ⇒ 设置页全 404。
  //   · 又不能把 webServer 写进静态 inject：headless 没这个服务，整个插件会 pending。
  // ctx.inject 是「等服务就绪再执行」，两边都不挡。
  const mountRoutes = (webServer) => {
    try {
      ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/tieba-duty',
      handler: async (req, res) => {
        const sub = new URL(req.url, 'http://127.0.0.1').pathname.replace('/api/tieba-duty', '') || '/'
        try {
          if (sub === '/health') {
            const cfg = cfgOf()
            return sendJson(res, 200, {
              ok: true,
              curl: checkCurl(),
              cookie: { ok: tieba.hasCookie(), file: tieba.cookieFile() },
              bars: cfg.bars || [],
              dirs: { writable: checkDirWritable(tieba.homeDir()) },
              headless: checkHeadless(cfg),
              lastError,
            })
          }
          if (sub === '/ping') return sendJson(res, 200, { ok: true, pong: true, version: '0.1.4' })
          const cfg = cfgOf()
          if (sub === '/status' && req.method === 'GET') {
            const st = freshState()
            return sendJson(res, 200, {
              ok: true,
              hasCookie: tieba.hasCookie(),
              curl: checkCurl(),
              lastError,
              cookieFile: tieba.cookieFile(),
              today: today(),
              repliesToday: st.replies,
              signed: st.signed,
              valley: { now: peakLabel(), isValley: isValley(), next: nextValley()?.toISOString() || null },
              lastRunDate: st.lastRunDate || '',
              cfg,
            })
          }
          if (sub === '/run' && req.method === 'POST') {
            if (collecting || roundRunning) return sendJson(res, 409, { ok: false, error: '已经有一轮在跑了' })
            collecting = true
            // 只采集、不生成：把这一轮读到的原始内容落成 raw-YYYY-MM-DD.json，模型再据此写日报
            const st = freshState()
            const cutoff = Date.now() - cfg.dedupeDays * 86400_000
            const bars = []
            for (const kw of cfg.bars) {
              try {
                const list = await tieba.listBar(kw)
                const fresh = list.threads.filter((t) => !(Number(st.seen[`t:${t.id}`] || 0) > cutoff))
                const picked = fresh.slice(0, cfg.readPerRound)
                const threads = []
                for (const t of picked) {
                  try {
                    const th = await tieba.readThread(t.id)
                    threads.push({ id: t.id, title: th.title || t.title, reply: t.reply,
                      floors: th.floors.slice(0, 4), images: th.images })
                    st.seen[`t:${t.id}`] = Date.now()
                  } catch (e) { threads.push({ id: t.id, title: t.title, error: e.message }) }
                }
                writeState(st)
                bars.push({ kw, fid: list.fid, total: list.threads.length, fresh: fresh.length, threads })
              } catch (e) { bars.push({ kw, error: e.message }) }
            }
            const at = new Date().toISOString()
            const file = path.join(reportsDir(), `raw-${today()}.json`)
            fs.mkdirSync(reportsDir(), { recursive: true })
            fs.writeFileSync(file, JSON.stringify({ at, bars }, null, 1))
            collecting = false
            return sendJson(res, 200, {
              ok: true, at, file,
              bars: bars.map((b) => ({ kw: b.kw, fresh: b.fresh, read: (b.threads || []).length, error: b.error })),
            })
          }
          if (sub === '/run-headless' && req.method === 'POST') {
            if (roundRunning) return sendJson(res, 409, { ok: false, error: '已经有一轮在跑了' })
            roundRunning = true
            const logPath = logFile()
            runRound({ profile: cfg.headlessProfile, dshBin: cfg.dshBin })
              .then((r) => log(`一轮结束：ok=${r.ok} code=${r.code ?? '-'}`))
              .catch((e) => log(`一轮出错：${e?.message ?? e}`))
              .finally(() => { roundRunning = false })
            // 立刻返回：模型那一轮在后台跑，界面别挂着
            return sendJson(res, 200, {
              ok: true, started: true, log: logPath,
              hint: '模型那一轮在后台跑（几分钟），跑完点「看最近日报」，中途可以「看运行日志」',
            })
          }
          if (sub === '/run-status' && req.method === 'GET') {
            const st = freshState()
            return sendJson(res, 200, {
              ok: true,
              running: roundRunning,
              collecting,
              busy: roundRunning || collecting,
              lastRunDate: st.lastRunDate || '',
              repliesToday: st.replies,
              valley: { now: peakLabel(), isValley: isValley(), window: currentWindow(), next: nextValley()?.toISOString() || null },
              runs: st.runs || {},
              log: logFile(),
            })
          }
          if (sub === '/logs' && req.method === 'GET') {
            return sendJson(res, 200, readLog({ date: new URL(req.url, 'http://127.0.0.1').searchParams.get('date') || undefined }))
          }
          if (sub === '/report' && req.method === 'GET') {
            const u = new URL(req.url, 'http://127.0.0.1')
            const latest = u.searchParams.get('latest') === '1'
            return sendJson(res, 200, readReport({ latest, date: u.searchParams.get('date') || undefined }))
          }
          if (sub === '/config' && req.method === 'GET') return sendJson(res, 200, { ok: true, cfg })
          if (sub === '/persona' && req.method === 'GET') return sendJson(res, 200, { ok: true, ...resolvePersona(cfg) })
          if (sub === '/diary' && req.method === 'GET') {
            const scope = new URL(req.url, 'http://127.0.0.1').searchParams.get('scope') || 'public'
            return sendJson(res, 200, { ok: true, ...readDiary(scope), stats: diaryStats(), files: { public: diaryFile('public'), private: diaryFile('private') } })
          }
          if (sub === '/config' && req.method === 'POST') {
            const patch = await readBody(req)
            return sendJson(res, 200, { ok: true, cfg: writeConfig(patch) })
          }
          if (sub === '/cookie' && req.method === 'POST') {
            const b = await readBody(req)
            tieba.setCookie(String(b.cookie || ''))
            return sendJson(res, 200, { ok: true, ...(await tieba.whoami()) })
          }
          if (sub === '/test' && req.method === 'GET') return sendJson(res, 200, await tieba.whoami())
          if (sub === '/sign' && req.method === 'POST') {
            const out = []
            for (const kw of cfg.bars) {
              try {
          const r = await tieba.followAndSign(kw, { autoFollow: cfg.autoFollow })
          if (r.ok) { const st = freshState(); st.signed[kw] = today(); writeState(st) }
          out.push(r)
        } catch (e) { out.push({ ok: false, kw, error: e.message }) }
            }
            return sendJson(res, 200, { ok: true, results: out })
          }
          return sendJson(res, 404, { ok: false, error: `unknown ${req.method} ${sub}` })
        } catch (e) {
          collecting = false
          noteError('HTTP ' + sub, e)
          return sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
        }
      },
      }), 'tieba-duty: /api/tieba-duty 路由')
      log('HTTP 路由已挂载：/api/tieba-duty')
    } catch (e) {
      log(`HTTP 路由没挂上：${e?.message ?? e}`)
    }
  }

  // 三种取法，按可用性依次退：
  //   1. ctx.inject（有就用，最正统）
  //   2. 现在就取（webServer 已经就绪的话）
  //   3. 没有就每秒轮询 —— webServer 往往晚于本插件几秒才就绪（日志里 bili 也在等它），
  //      这一步是「不阻塞插件加载、又能等到服务」的唯一稳妥办法。
  let mounted = false
  const takeServer = () => {
    let srv
    try { srv = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined } catch { srv = undefined }
    if (!srv) { try { srv = ctx.webServer } catch { srv = undefined } }
    return srv
  }
  const tryMount = () => {
    if (mounted) return true
    const srv = takeServer()
    if (!srv) return false
    mountRoutes(srv)
    mounted = true
    return true
  }

  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['webServer'], (c) => { mounted = true; mountRoutes(c.webServer) }) } catch { /* 退到轮询 */ }
  }
  if (!tryMount() && !mounted) {
    const timer = setInterval(() => { try { if (tryMount()) clearInterval(timer) } catch { /* 继续等 */ } }, 1000)
    ctx.effect(() => () => clearInterval(timer), 'tieba-duty: 等 webServer 就绪')
  }


  tool({
    name: 'tieba_follow',
    description: '关注一个吧（走 app 端签名接口）。已经关注过则返回 already:true。',
    parameters: { kw: { type: 'string', description: '吧名' } },
    execute: async (args) => {
      const kw = String(args.kw)
      if (await tieba.isFollowing(kw)) return json({ ok: true, kw, already: true })
      return json(await tieba.follow(kw))
    },
  })

  tool({
    name: 'tieba_selfcheck',
    description: '一次跑完自检：curl / 凭证 / 吧名 / 目录可写 / headless 能不能用。出问题先跑它。',
    parameters: {},
    execute: async () => {
      const cfg = cfgOf()
      const cur = checkCurl()
      let cookie = { ok: false }
      try { const w = await tieba.whoami(); cookie = { ok: !!w.loggedIn } } catch (e) { cookie = { ok: false, error: e.message } }
      const bars = cfg.bars || []
      const barCheck = []
      for (const kw of bars.slice(0, 5)) {
        try { const r = await tieba.listBar(kw); barCheck.push({ kw, ok: !!r.fid, threads: r.threads.length, fid: r.fid }) }
        catch (e) { barCheck.push({ kw, ok: false, error: e.message }) }
      }
      return json({
        curl: cur,
        cookie,
        bars: { list: bars, empty: bars.length === 0, checks: barCheck },
        dirs: { writable: checkDirWritable(tieba.homeDir()) },
        headless: checkHeadless(cfg),
        lastError,
      })
    },
  })

  tool({
    name: 'tieba_settings',
    description: '看当前配置（吧列表 / 每轮读几条回几条 / 签到与回帖开关 / 每天上限）。动手前先看它，别猜。',
    parameters: {},
    execute: async () => json(cfgOf()),
  })

  tool({
    name: 'tieba_persona',
    description: '读当前的人设（设置页里写的，或指向的外部文件）。写日报/回帖前先读它，照着这个人设说话。',
    parameters: {},
    execute: async () => {
      const cfg = cfgOf()
      const p = resolvePersona(cfg)
      return json({ ...p, styleSamples: cfg.styleSamples || '' })
    },
  })

  tool({
    name: 'tieba_diary_write',
    description: '写日记。scope=public 是给主人看的日记；scope=private 是私人日记（只有主人手动翻开才看得到）。',
    parameters: {
      scope: { type: 'string', description: 'public 或 private' },
      content: { type: 'string', description: '日记正文' },
    },
    execute: async (args) => {
      const scope = String(args.scope)
      if (!['public', 'private'].includes(scope)) return json({ ok: false, error: 'scope 只能是 public / private' })
      const cfg = cfgOf()
      if (!cfg.diaryEnabled) return json({ ok: false, error: '写日记是关着的（设置页可以打开）' })
      if (scope === 'private' && !cfg.diaryPrivate) return json({ ok: false, error: '私人日记是关着的（设置页可以打开）' })
      return json(appendDiary(scope, String(args.content || '')))
    },
  })

  tool({
    name: 'tieba_diary_read',
    description: '读日记。默认只读给主人看的那份；读私人日记必须显式 confirm: true（那是主人的私人内容）。',
    parameters: {
      scope: { type: 'string', description: 'public（默认）/ private' },
      confirm: { type: 'boolean', description: '读 private 时必须传 true' },
      lines: { type: 'number', description: '读最后多少行（默认 200）' },
    },
    execute: async (args) => {
      const scope = String(args.scope || 'public')
      if (scope === 'private' && args.confirm !== true) {
        return json({ ok: false, error: '私人日记要主人点头：传 confirm: true 才能读' })
      }
      return json(readDiary(scope, { lines: Number(args.lines) || 200 }))
    },
  })


  tool({
    name: 'tieba_whoami',
    description: '贴吧登录态自检：BDUSS 有没有、还活着没。第一次用要先在「刷贴吧」设置页里贴 BDUSS。',
    parameters: {},
    execute: async () => json(await tieba.whoami()),
  })

  tool({
    name: 'tieba_list',
    description: '列某个吧的帖子（手机版页面解析）。返回帖子 id / 标题 / 回复数，拿去喂 tieba_thread。',
    parameters: {
      kw: { type: 'string', description: '吧名，例如 deepseek' },
      pages: { type: 'number', description: '抓几页（每页 50 条，默认 1）' },
      onlyFresh: { type: 'boolean', description: '只返回没读过的（默认 false）' },
    },
    execute: async (args) => {
      const cfg = cfgOf()
      const pages = Math.max(1, Math.min(Number(args.pages) || 1, 5))
      if (!args.kw && (!cfg.bars || cfg.bars.length === 0)) {
        return json({ ok: false, error: '还没设置要刷哪些吧：去设置页「① 账号」里填吧名（一行一个）' })
      }
      const kw = String(args.kw || cfg.bars[0])
      const all = []
      let fid = ''
      for (let i = 0; i < pages; i++) {
        const r = await tieba.listBar(kw, { pn: i * 50 })
        fid = fid || r.fid
        all.push(...r.threads)
      }
      // 标上「读过没」：读过的排后面，日报里别再推一遍
      const st = freshState()
      const cutoff = Date.now() - cfg.dedupeDays * 86400_000
      const marked = all.map((t) => {
        const seenAt = Number(st.seen[`t:${t.id}`] || 0)
        return { ...t, seen: seenAt > cutoff }
      })
      // 关键词：标题命中的排前面（keywords 以前是死配置，这里接上）
      const kws = (cfg.keywords || []).map((k) => String(k).trim()).filter(Boolean)
      const withHit = marked.map((t) => ({
        ...t,
        matched: kws.filter((k) => t.title.includes(k)),
      }))
      withHit.sort((a, b) => (b.matched.length - a.matched.length) || (a.seen - b.seen))
      const fresh = withHit.filter((t) => !t.seen)
      const threads = (args.onlyFresh === true ? fresh : withHit).slice(0, 120)
      return json({ kw, fid, count: all.length, fresh: fresh.length, threads })
    },
  })

  tool({
    name: 'tieba_thread',
    description: '读一个帖子的楼层正文。判断内容靠它，别看标题下结论。',
    parameters: {
      tid: { type: 'string', description: '帖子 id（数字）' },
      pn: { type: 'number', description: '第几页（默认 1）' },
    },
    execute: async (args) => {
      const tid = String(args.tid)
      const r = await tieba.readThread(tid, { pn: Number(args.pn) || 1 })
      try {
        const st = freshState()
        const seenBefore = Boolean(st.seen[`t:${tid}`])
        st.seen[`t:${tid}`] = Date.now()
        writeState(st)
        return json({ ...r, seenBefore })
      } catch { return json(r) }
    },
  })

  tool({
    name: 'tieba_sign',
    description: '签到。不给 kw 就签配置里的所有吧；一天一次，重复会返回「已签到」。',
    parameters: { kw: { type: 'string', description: '只签某一个吧（可省）' } },
    execute: async (args) => {
      const cfg = cfgOf()
      const bars = args.kw ? [String(args.kw)] : cfg.bars
      const out = []
      for (const kw of bars) {
        try {
          const r = await tieba.followAndSign(kw, { autoFollow: cfg.autoFollow })
          if (r.ok) { const st = freshState(); st.signed[kw] = today(); writeState(st) }
          out.push(r)
        } catch (e) { out.push({ ok: false, kw, error: e.message }) }
      }
      return json({ ok: true, results: out })
    },
  })

  tool({
    name: 'tieba_reply',
    description: '在一个帖子里回一条。⚠️ 公开内容、用用户的号 —— 必须 confirm: true；'
      + '受「每天 N 条 / 间隔 M 秒 / 同帖一天一次」三道闸限制，且默认配置里是关的。',
    parameters: {
      kw: { type: 'string', description: '吧名' },
      tid: { type: 'string', description: '帖子 id' },
      content: { type: 'string', description: '回复正文（4~400 字，别放链接）' },
      intent: { type: 'string', description: 'answer=解答疑问 / chat=接话 / share=分享看法 / joke=玩梗；默认 chat' },
      mention: { type: 'string', description: '要在回复里 @ 谁（贴吧昵称）；不传就用配置里的，空着就不 @' },
      confirm: { type: 'boolean', description: '必须显式传 true：表示用户已同意发出去' },
    },
    execute: async (args) => {
      if (args.confirm !== true) return json({ ok: false, error: '没确认：要发公开回复得传 confirm: true' })
      const cfg = cfgOf()
      if (!cfg.autoReply) return json({ ok: false, error: '回帖是关着的：去设置页打开「允许回帖」' })
      if (!tieba.hasCookie()) return json({ ok: false, error: '还没贴 BDUSS' })

      const st = freshState()
      if (st.replies >= cfg.replyPerDay) return json({ ok: false, error: `今天的额度用完了（${cfg.replyPerDay} 条）` })
      const gap = Date.now() - st.lastReplyAt
      if (gap < cfg.replyGapSec * 1000) {
        return json({ ok: false, error: `太快了，再等 ${Math.ceil((cfg.replyGapSec * 1000 - gap) / 1000)} 秒` })
      }
      if (st.seen[`reply:${args.tid}`]) return json({ ok: false, error: '这个帖子今天已经回过了' })

      if (cfg.toneGate) {
        const hit = toneCheck(args.content)
        if (hit.length) {
          return json({ ok: false, error: `这句太像客服了（命中：${hit.join('、')}）—— 改成人话再发，长一点短一点都行` })
        }
      }
      const intent = String(args.intent || 'chat')
      if (intent === 'answer' && !cfg.answerQuestions) {
        return json({ ok: false, error: '这条是解答疑问，但配置里关掉了 —— 换个接话/共鸣的角度，或去设置页打开' })
      }
      // @ 谁：参数优先，其次配置；配置里 mentionEvery 为真时才会自动带
      const who = String(args.mention || (cfg.mentionEvery ? cfg.mention : '') || '').trim()
      let body = String(args.content || '').trim()
      if (who && !body.includes('@' + who)) body = body + ' @' + who + ' '
      const r = await tieba.reply({ kw: String(args.kw), tid: String(args.tid), content: body })
      if (r.ok) {
        st.replies += 1
        st.lastReplyAt = Date.now()
        st.seen[`reply:${args.tid}`] = Date.now()
        st.replied = st.replied || {}
        st.replied[String(args.tid)] = { kw: String(args.kw), at: Date.now(), content: body.slice(0, 200) }
        writeState(st)
        audit({ kind: 'reply', kw: args.kw, tid: args.tid, intent, mention: who, content: body, result: r })
      }
      return json(r)
    },
  })

  // ── 每天自动跑一轮（默认关）──────────────────────────────────────────────
  let roundRunning = false
  let collecting = false
  const maybeAutoRun = async () => {
    const cfg = cfgOf()
    if ((!cfg.autoRun && !cfg.peakValley) || roundRunning || !tieba.hasCookie()) return
    if (!cfg.bars || cfg.bars.length === 0) { log('没设置要刷的吧，跳过这一轮'); return }
    const st = freshState()
    const COOLDOWN = 6 * 3600_000
    if (st.lastRunAt && Date.now() - st.lastRunAt < COOLDOWN) {
      return // 冷却中：兜底，防 runs 记录丢了导致连环触发
    }

    if (cfg.peakValley) {
      // 峰谷模式：落在哪个谷时窗口，就每个窗口跑一次（照刷B站：中午 / 晚上 各一个子开关）
      const win = currentWindow()
      if (!win) return
      if (win === 'noon' && !cfg.noon) return
      if (win === 'night' && !cfg.night) return
      st.runs = st.runs || {}
      if (st.runs[win] === today()) return
      st.runs[win] = today()   // 先标记，失败也不至于一分钟一跑
      st.lastRunAt = Date.now()
      writeState(st)
    } else {
      if (st.lastRunDate === today()) return
      if (new Date().getHours() < cfg.runHour) return
      if (cfg.valleyOnly && !isValley()) { log('现在是高峰，等谷时再跑'); return }
    }
    roundRunning = true
    try {
      const s0 = freshState(); s0.lastRunAt = Date.now(); writeState(s0)
      log(`自动跑一轮：profile=${cfg.headlessProfile}`)
      const r = await runRound({ profile: cfg.headlessProfile, dshBin: cfg.dshBin })
      if (r.ok) { const s2 = freshState(); s2.lastRunDate = today(); writeState(s2); log('一轮跑成功了') }
      log(`一轮结束：ok=${r.ok} code=${r.code ?? '-'} 日志=${r.log}`)
    } catch (e) {
      log(`跑一轮出错：${e?.message ?? e}`)
    } finally { roundRunning = false }
  }
  if (NO_SCHEDULE) {
    log('在 headless 子进程里：不启动调度器（防自我复制）')
  } else {
    const runTimer = setInterval(() => { maybeAutoRun().catch(() => {}) }, 60_000)
    ctx.effect(() => () => clearInterval(runTimer), 'tieba-duty: 每日一轮定时器')
  }

  // ── 每天自动签到 ──────────────────────────────────────────────────────────
  const timer = setInterval(() => {
    try {
      const cfg = cfgOf()
      if (!cfg.autoSign || !tieba.hasCookie()) return
      const st = freshState()
      if (new Date().getHours() < cfg.signHour) return
      for (const kw of cfg.bars) {
        if (st.signed[kw] === today()) continue
        tieba.sign(kw)
          .then((r) => { if (r.ok) { st.signed[kw] = today(); writeState(st) } })
          .catch((e) => log(`签到 ${kw} 失败：${e.message}`))
      }
      st.seen = pruneSeen(st.seen)
      writeState(st)
    } catch (e) { log(`定时器出错：${e?.message ?? e}`) }
  }, 60_000)
  ctx.effect(() => () => clearInterval(timer), 'tieba-duty: 签到定时器')

  const curl0 = checkCurl()
  if (!curl0.ok) log('⚠️ 找不到 curl —— 贴吧请求会全部失败，请先装 curl')
  else log(`curl ✓ ${curl0.version}`)

  const c0 = cfgOf()
  log(`已挂载（${c0.bars.join(' / ')}；签到=${c0.autoSign ? '开' : '关'}；回帖=${c0.autoReply ? `开(${c0.replyPerDay}/天)` : '关'}）`)
}

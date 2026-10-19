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
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'tieba-scroll'
export const inject = ['webServer', 'tools', 'settings']

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

export function apply(ctx, config = {}) {
  const cfgOf = () => readConfig(config)

  if (typeof ctx.settings?.register === 'function' && Config) {
    try { ctx.settings.register('tieba-duty', Config, { base: {}, applies: 'live' }) } catch (e) {
      log(`宿主设置项没挂上（不影响用）：${e?.message ?? e}`)
    }
  }

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

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/tieba-duty',
      handler: async (req, res) => {
        const sub = new URL(req.url, 'http://127.0.0.1').pathname.replace('/api/tieba-duty', '') || '/'
        try {
          if (sub === '/ping') return sendJson(res, 200, { ok: true, pong: true, version: '0.1.4' })
          const cfg = cfgOf()
          if (sub === '/status' && req.method === 'GET') {
            const st = freshState()
            return sendJson(res, 200, {
              ok: true,
              hasCookie: tieba.hasCookie(),
              cookieFile: tieba.cookieFile(),
              today: today(),
              repliesToday: st.replies,
              signed: st.signed,
              cfg,
            })
          }
          if (sub === '/run' && req.method === 'POST') {
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
            return sendJson(res, 200, {
              ok: true, at, file,
              bars: bars.map((b) => ({ kw: b.kw, fresh: b.fresh, read: (b.threads || []).length, error: b.error })),
            })
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
          return sendJson(res, 500, { ok: false, error: e?.message ?? String(e) })
        }
      },
    }), 'tieba-duty: /api/tieba-duty 路由')
    log('HTTP 路由已挂载：/api/tieba-duty')
  } catch (e) {
    log(`HTTP 路由没挂上：${e?.message ?? e}`)
  }

  const tool = (spec) => {
    try { ctx.tools.register(hostDefineTool(spec)) } catch (e) {
      log(`工具 ${spec.name} 没注册上（不影响别的）：${e?.message ?? e}`)
    }
  }
  const json = (v) => JSON.stringify(v, null, 1)

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
    name: 'tieba_settings',
    description: '看当前配置（吧列表 / 每轮读几条回几条 / 签到与回帖开关 / 每天上限）。动手前先看它，别猜。',
    parameters: {},
    execute: async () => json(cfgOf()),
  })

  tool({
    name: 'tieba_persona',
    description: '读当前的人设（设置页里写的，或指向的外部文件）。写日报/回帖前先读它，照着这个人设说话。',
    parameters: {},
    execute: async () => json(resolvePersona(cfgOf())),
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
      const fresh = marked.filter((t) => !t.seen)
      const threads = (args.onlyFresh === true ? fresh : marked).slice(0, 120)
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
      return json(out)
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
      const r = await tieba.reply({ kw: String(args.kw), tid: String(args.tid), content: String(args.content) })
      if (r.ok) {
        st.replies += 1
        st.lastReplyAt = Date.now()
        st.seen[`reply:${args.tid}`] = Date.now()
        writeState(st)
        audit({ kind: 'reply', kw: args.kw, tid: args.tid, intent, content: args.content, result: r })
      }
      return json(r)
    },
  })

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

  const c0 = cfgOf()
  log(`已挂载（${c0.bars.join(' / ')}；签到=${c0.autoSign ? '开' : '关'}；回帖=${c0.autoReply ? `开(${c0.replyPerDay}/天)` : '关'}）`)
}

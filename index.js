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
import { readSchedule, writeSchedule } from './lib/schedule.mjs'
import { appendDiary, readDiary, diaryStats, diaryFile } from './lib/diary.mjs'
import { writeReport, readReport, listReports, reportsDir } from './lib/reports.mjs'
import { toneCheck } from './lib/tone.mjs'
import { runRound, readLog, logFile, stopRound, startHeartbeat, heartbeatFresh, heartbeatAt } from './lib/runner.mjs'
import { roundAlive } from './lib/round-state.mjs'
import { isValley, nextValley, peakLabel, currentWindow } from './lib/peak.mjs'
import { localStamp } from './lib/time.mjs'
import { checkOutbound } from './lib/guard.mjs'
import { isSameOrigin } from './lib/origin.mjs'
import { readProposals, addProposal, getProposal, setStatus, mergeSamples, appendEvolutionNote } from './lib/evolve.mjs'
import { ensurePersona, readPersona, updatePersona, listVersions, rollback, renderForPrompt, CORE, TRAIT_KEYS, TRAIT_LABELS, getVersion } from './lib/persona.mjs'
import { applyEvolution, canEvolveToday, readEvolutionState, driftReport, pauseEvolution, resumeEvolution } from './lib/evolution.mjs'
import { observeBar, getStyle, renderStyle, bestSamplesFor, styleSummary, effectiveTraits, MODES, soakEffect, SOAK_EVERY } from './lib/style.mjs'
import { toText, toJson } from './lib/persona-export.mjs'
import { listImages, addImage, updateImage, removeImage, publicView, usableImages, pickImage, markUsed, imageFile, biasHint, pendingDescriptions } from './lib/images.mjs'
import { writeManifest, readManifests, emitEvent, detect } from './lib/integrations.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

function hasCapabilitySafe(cap) {
  try { return readManifests().some((m) => (m.provides || []).includes(cap)) } catch { return false }
}

let VERSION = '0.0.0'
try { VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version } catch { /* ignore */ }
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
  replyPerDay: z.natural().default(DEFAULTS.replyPerDay),
  replyGapSec: z.natural().default(30),
})

const log = (...a) => console.log('[tieba-duty]', ...a)

/** 人设：file 优先，其次 text；都没有就返回空串（模型就用默认口吻） */
function resolvePersona(cfg) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const f = String(cfg.personaFile || '').trim()
  if (f) {
    const abs = path.isAbsolute(f) ? f : path.join(home, 'tieba-duty', f)
    try { return { source: abs, text: fs.readFileSync(abs, 'utf8').slice(0, 20000) } } catch {
      return { source: abs, text: '', error: '人设文件读不到：' + abs }
    }
  }
  return { source: '', text: String(cfg.personaText || '') }
}

/** 最近一次错误（给设置页红点用）；只在内存里，重启即清 */
let lastError = null
const noteError = (where, e) => {
  lastError = { at: localStamp(), where, message: String((e && e.message) || e) }
  log(`出错（${where}）：${lastError.message}`)
}

/** curl 是网络层的命根子，启动就先看一眼 */
let curlCache = null
/** 候选路径：DSH 进程的 PATH 可能和终端不一样，逐个试绝对路径 */
const CURL_CANDIDATES = [
  process.env.CURL_BIN,
  'curl',
  '/usr/bin/curl',
  '/bin/curl',
  '/usr/local/bin/curl',
  '/system/bin/curl',
  '/data/data/com.termux/files/usr/bin/curl',
].filter(Boolean)

function checkCurl(force = false) {
  if (!force && curlCache && Date.now() - curlCache.at < 5 * 60_000) return curlCache.value
  let value = { ok: false, error: '找不到 curl（网络层的请求都靠它）' }
  for (const bin of CURL_CANDIDATES) {
    try {
      const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 5000 })
      value = { ok: true, version: String(out).split('\n')[0].trim(), bin }
      tieba.setCurlBin(bin)
      break
    } catch { /* 试下一个 */ }
  }
  curlCache = { at: Date.now(), value }
  return value
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
    if (process.platform === 'win32') {
      execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', bin, '--version'], { encoding: 'utf8', timeout: 8000 })
    } else {
      execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 8000 })
    }
  } catch (e) {
    return { ok: false, error: '找不到 dsh（定时一轮要用它）' }
  }
  return { ok: true, bin, profile: cfg.headlessProfile }
}

export function apply(ctx, config = {}) {
  // ⚠️ headless 子进程里**不许**再起调度器：否则子进程里的插件又会触发定时器，
  //    子子孙孙一直起（真机上真的发生了，日志里每 1~3 分钟一轮）。
  const NO_SCHEDULE = process.env.TIEBA_DUTY_NO_SCHEDULE === '1'

  // 跨插件报到：写一份能力清单（别人扫 shared/plugins 就知道能搭什么）
  try {
    writeManifest({
      name: 'dsh-tieba-scroll',
      version: VERSION,
      provides: ['tieba.read', 'tieba.reply', 'tieba.digest', 'tieba.events'],
      consumes: hasCapabilitySafe('memory') ? ['memory'] : [],
      note: '贴吧读帖 / 日报 / 签到 / 可选回帖',
    })
  } catch { /* 共享目录写不了不影响主流程 */ }

  // 尽早解析一次 curl 的绝对路径（进程 PATH 可能不含 /usr/bin）
  try { checkCurl(true) } catch { /* 后面还有兜底 */ }

  const cfgOf = () => {
    const c = readConfig(config)
    tieba.setGap(c.requestGapMs)
    tieba.setBreakerMinutes(c.breakerMin)
    return c
  }

  /** 开一轮：重置本轮计数（每轮上限靠它硬拦） */
  const startRound = (trigger = 'manual') => {
    const st = freshState()
    st.round = { id: Date.now(), startedAt: Date.now(), replies: 0, trigger }
    writeState(st)
    log(`开始一轮（${trigger === 'auto' ? '自动' : '手动'}）`)
    try { emitEvent('tieba.round.start', { trigger, roundId: st.round.id }) } catch { /* 事件写不了不影响 */ }
    return st.round
  }
  /** 结束一轮 */
  const endRound = (onlyId) => {
    const st = freshState()
    if (!st.round) return
    if (onlyId && st.round.id !== onlyId) return
    try { emitEvent('tieba.round.end', { roundId: st.round.id, replies: st.round.replies || 0 }) } catch { /* ignore */ }
    st.round = null
    writeState(st)
  }

  /** 签一批吧：kw 指定则只签一个；否则签配置里的，signAllFollowed 时并上全部关注 */
  const doSign = async (kw) => {
    const cfg = cfgOf()
    let bars = kw ? [String(kw)] : [...cfg.bars]
    if (!kw && cfg.signAllFollowed) {
      try { bars = [...new Set([...bars, ...(await tieba.followedForums())])] }
      catch (e) { log(`拉取关注列表失败（只签框里的）：${e.message}`) }
    }
    const out = []
    for (const b of bars) {
      try {
        const r = await tieba.followAndSign(b, { autoFollow: cfg.autoFollow })
        if (r.ok) { const st = freshState(); st.signed[b] = today(); writeState(st) }
        out.push(r)
      } catch (e) { out.push({ ok: false, kw: b, error: e.message }) }
    }
    return out
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
    req.on('data', (c) => { b += c; if (b.length > 6e6) req.destroy() })  // 图片 data URL 会到几 MB
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
    /** 只接受同源请求：本机恶意页面带别的 Origin 一律 403；curl / 同源 fetch 没有或同源放行 */
    const sameOrigin = (req) => isSameOrigin(req.headers && req.headers.origin, req.headers && req.headers.host)
    try {
      ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/api/tieba-duty',
      handler: async (req, res) => {
        if (!sameOrigin(req)) {
          return sendJson(res, 403, { ok: false, error: '跨站请求被拒（只接受同源）' })
        }
        const sub = new URL(req.url, 'http://127.0.0.1').pathname.replace('/api/tieba-duty', '') || '/'
        try {
          if (sub === '/run/stop' && req.method === 'POST') {
            const r = stopRound()
            roundRunning = false
            collecting = false
            endRound(collectId)
            log('手动停止本轮：' + (r.ok ? '已发信号' : r.error))
            return sendJson(res, 200, { ok: true, ...r })
          }
          if (sub === '/cooldown/clear' && req.method === 'POST') {
            tieba.clearCooldown()
            return sendJson(res, 200, { ok: true })
          }
          if (sub === '/style/state' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, bars: styleSummary() })
          }
          if (sub === '/evolution/state' && req.method === 'GET') {
            const cfg = cfgOf()
            return sendJson(res, 200, {
              ok: true, enabled: !!cfg.evolvePersona, canEvolveToday: canEvolveToday(),
              last: readEvolutionState(), version: ensurePersona(cfg.styleSamples).version, drift: driftReport(),
            })
          }
          if (sub === '/evolution/pause' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, pauseEvolution(String(body.reason || '主人手动暂停')))
          }
          if (sub === '/evolution/resume' && req.method === 'POST') {
            return sendJson(res, 200, resumeEvolution())
          }
          if (sub === '/persona/state' && req.method === 'GET') {
            const p = ensurePersona(cfgOf().styleSamples)
            return sendJson(res, 200, { ok: true, persona: p, core: CORE, labels: TRAIT_LABELS, keys: TRAIT_KEYS, prompt: renderForPrompt(p) })
          }
          if (sub === '/persona/traits' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            try { return sendJson(res, 200, { ok: true, persona: updatePersona({ traits: body.traits || {} }, { reason: String(body.reason || 'ui') }) }) }
            catch (e) { return sendJson(res, 500, { ok: false, error: e.message }) }
          }
          if (sub === '/persona/voice' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            try { return sendJson(res, 200, { ok: true, persona: updatePersona({ voice: { samples: body.samples || [] } }, { reason: String(body.reason || 'ui') }) }) }
            catch (e) { return sendJson(res, 500, { ok: false, error: e.message }) }
          }
          if (sub === '/persona/versions' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, versions: listVersions(), current: ensurePersona(cfgOf().styleSamples).version })
          }
          if (sub === '/images' && req.method === 'GET') {
            return sendJson(res, 200, {
              ok: true,
              images: listImages().map((it) => ({ ...publicView(it), fileUrl: '/api/tieba-duty/images/raw?id=' + it.id, needsDesc: !!it.needsDesc })),
              max: 50,
            })
          }
          if (sub === '/images' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, addImage(body))
          }
          if (sub === '/images/update' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, updateImage(String(body.id || ''), body))
          }
          if (sub === '/images/delete' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, removeImage(String(body.id || '')))
          }
          if (sub === '/images/upload-test' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            const it = imageFile(String(body.id || ''))
            if (!it) return sendJson(res, 404, { ok: false, error: '没有这张图' })
            try {
              const r = await tieba.uploadImage(it.abs, String(body.kw || 'deepseek'))
              return sendJson(res, 200, { ok: !!r.ok, imageInfo: r.imageInfo || '', imageSrc: r.imageSrc || '', error: r.error || '' })
            } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }) }
          }
          if (sub === '/images/raw' && req.method === 'GET') {
            const u = new URL(req.url, 'http://127.0.0.1')
            const it = imageFile(String(u.searchParams.get('id') || ''))
            if (!it) return sendJson(res, 404, { ok: false, error: '没有这张图' })
            try {
              const buf = fs.readFileSync(it.abs)
              const ext = path.extname(it.file).slice(1)
              res.writeHead(200, { 'content-type': ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, 'cache-control': 'no-store' })
              return res.end(buf)
            } catch { return sendJson(res, 500, { ok: false, error: '图片文件读不到' }) }
          }
          if (sub === '/persona/export' && req.method === 'GET') {
            const u = new URL(req.url, 'http://127.0.0.1')
            const v = u.searchParams.get('version')
            const p = v ? getVersion(Number(v)) : ensurePersona(cfgOf().styleSamples)
            if (!p) return sendJson(res, 404, { ok: false, error: '没有这个版本' })
            if (u.searchParams.get('format') === 'json') {
              return sendJson(res, 200, { ok: true, filename: `persona-v${p.version}.json`, content: JSON.stringify(toJson(p), null, 2) })
            }
            return sendJson(res, 200, { ok: true, filename: `persona-v${p.version}.txt`, content: toText(p, { core: CORE }) })
          }
          if (sub === '/persona/rollback' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, rollback(Number(body.version), { reason: `rollback v${body.version}` }))
          }
          if (sub === '/persona/proposals' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, proposals: readProposals() })
          }
          if (sub === '/persona/apply' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            const p = getProposal(String(body.id || ''))
            if (!p) return sendJson(res, 404, { ok: false, error: '没有这条建议' })
            const cfg = cfgOf()
            const pp = ensurePersona(cfg.styleSamples)
            const merged = mergeSamples(pp.voice.samples, p.samples)
            updatePersona({ voice: { samples: merged } }, { reason: '采纳演化建议' })
            // 人设文件里也留一笔（只追加）
            try {
              const pf = String(cfg.personaFile || '').trim()
              if (pf) {
                const abs = path.isAbsolute(pf) ? pf : path.join(tieba.homeDir(), pf)
                const old = fs.readFileSync(abs, 'utf8')
                fs.writeFileSync(abs, appendEvolutionNote(old, p.samples), 'utf8')
              }
            } catch { /* 文件不在就只改样本 */ }
            setStatus(p.id, 'applied')
            return sendJson(res, 200, { ok: true, samples: merged })
          }
          if (sub === '/persona/dismiss' && req.method === 'POST') {
            const body = (await readBody(req)) || {}
            return sendJson(res, 200, setStatus(String(body.id || ''), 'dismissed'))
          }
          if (sub === '/integrations' && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, plugins: readManifests(), caps: { memory: hasCapabilitySafe('memory') } })
          }
          if (sub === '/health') {
            const cfg = cfgOf()
            return sendJson(res, 200, {
              ok: true,
              curl: checkCurl(),
              cookie: { ok: tieba.hasCookie(), file: tieba.cookieFile() },
              bars: cfg.bars || [],
              dirs: { writable: checkDirWritable(tieba.homeDir()) },
              headless: checkHeadless(cfg),
              integrations: detect(),
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
              integrations: detect(),
              curl: checkCurl(),
              cooldown: (() => { const cd = tieba.readCooldown(); return { ...cd, leftMin: Math.max(0, Math.ceil((cd.until - Date.now()) / 60000)) } })(),
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
            const collectId = startRound('collect').id
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
            endRound(collectId)
            return sendJson(res, 200, {
              ok: true, at, file,
              bars: bars.map((b) => ({ kw: b.kw, fresh: b.fresh, read: (b.threads || []).length, error: b.error })),
            })
          }
          if (sub === '/run-headless' && req.method === 'POST') {
            if (roundRunning) return sendJson(res, 409, { ok: false, error: '已经有一轮在跑了' })
            {
              const stPre = freshState()
              if (cfg.autoReply && stPre.replies >= cfg.replyPerDay) {
                return sendJson(res, 409, { ok: false, error: `今天的回帖额度已经用完（${stPre.replies}/${cfg.replyPerDay}），先不跑模型轮了` })
              }
            }
            roundRunning = true
            const roundId = startRound('manual').id
            const logPath = logFile()
            runRound({ profile: cfg.headlessProfile, dshBin: cfg.dshBin, roundId })
              .then((r) => log(`一轮结束：ok=${r.ok} code=${r.code ?? '-'}`))
              .catch((e) => log(`一轮出错：${e?.message ?? e}`))
              .finally(() => { roundRunning = false; endRound(roundId) })
            // 立刻返回：模型那一轮在后台跑，界面别挂着
            return sendJson(res, 200, {
              ok: true, started: true, log: logPath,
              hint: '模型那一轮在后台跑（几分钟），跑完点「看最近日报」，中途可以「看运行日志」',
            })
          }
          if (sub === '/run-status' && req.method === 'GET') {
            const stNow = freshState()
            if (roundRunning && stNow.round && Date.now() - (stNow.round.startedAt || 0) > 25 * 60_000) {
              log('本轮跑了超过 25 分钟，判定卡住，复位')
              roundRunning = false
              endRound()
            }
            // 存活判断：优先看子进程心跳（dsh 启动器退出后 node 子进程仍在跑，
            // 用进程句柄会误判成「已结束」）。心跳 90 秒没更新才算真的没了。
            if (roundRunning && !heartbeatFresh()) {
              log('心跳超过 90 秒没更新，判定本轮结束，复位状态')
              roundRunning = false
              collecting = false
              endRound()
            }
            const st = freshState()
            return sendJson(res, 200, {
              ok: true,
              version: VERSION,
              running: roundRunning,
              collecting,
              round: freshState().round,
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
          if (sub === '/bars/followed' && req.method === 'GET') {
            try {
              const names = await tieba.followedForums()
              return sendJson(res, 200, { ok: true, count: names.length, bars: names })
            } catch (e) { return sendJson(res, 500, { ok: false, error: e.message }) }
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
            return sendJson(res, 200, { ok: true, results: await doSign() })
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
    name: 'tieba_evolve_propose',
    description: '把这一轮从吧里学到的「说话方式」提给主人：1~3 句语气样本。不会直接改人设，主人采纳后才生效。',
    parameters: {
      samples: { type: 'array', items: { type: 'string' }, required: true, description: '1~3 句短样本（每句 3~40 字）' },
      note: { type: 'string', description: '一句说明：这几句是从哪种语境里学的' },
      source: { type: 'string', description: '来源：吧名 / 帖子 id（可省）' },
    },
    execute: async (args) => {
      const cfg = cfgOf()
      if (!cfg.evolvePersona) return json({ ok: false, error: '人设演化是关着的（设置页可以打开）' })
      return json(addProposal({ samples: args.samples, note: args.note, source: args.source }))
    },
  })

  tool({
    name: 'tieba_integrations',
    description: '看有哪些其他插件报到（共享目录里的能力清单）。只在刷贴吧内部探测，不依赖别人装什么。',
    parameters: {},
    execute: async () => json(detect()),
  })

  tool({
    name: 'tieba_settings',
    description: '看当前配置（吧列表 / 每轮读几条回几条 / 签到与回帖开关 / 每天上限）。动手前先看它，别猜。',
    parameters: {},
    execute: async () => json(cfgOf()),
  })

  tool({
    name: 'tieba_followed',
    description: '列出当前账号关注的所有吧（app 接口）。可以拿它来填「要刷的吧」，或检查关注状态。',
    parameters: {},
    execute: async () => {
      const names = await tieba.followedForums()
      return json({ ok: true, count: names.length, bars: names })
    },
  })

  tool({
    name: 'tieba_persona',
    description: '读当前的人设（设置页里写的，或指向的外部文件）。写日报/回帖前先读它，照着这个人设说话。',
    parameters: {},
    execute: async () => {
      const cfg = cfgOf()
      const p = resolvePersona(cfg)
      const pp = ensurePersona(cfg.styleSamples)
      return json({ ...p, styleSamples: pp.voice.samples.join('\n') || cfg.styleSamples || '', persona: pp, prompt: renderForPrompt(pp) })
    },
  })

  tool({
    name: 'tieba_persona_update',
    description: '改人设的可变层：性格旋钮（0~10）或语气样本。核心层（名字/自称/底线）改不了。',
    parameters: {
      traits: { type: 'object', description: '要改的旋钮，例如 {"gentle":8,"talkative":3}' },
      samples: { type: 'array', items: { type: 'string' }, description: '新的语气样本（最多 10 条，会整体替换）' },
      reason: { type: 'string', description: '为什么改（会写进版本历史）' },
    },
    execute: async (args) => {
      const cfg = cfgOf()
      if (cfg.evolvePersona && args.reason == null) return json({ ok: false, error: '演化开着时，改人设要写 reason' })
      try {
        const p = updatePersona({
          traits: args.traits || {},
          voice: Array.isArray(args.samples) ? { samples: args.samples } : {},
        }, { reason: String(args.reason || 'manual') })
        return json({ ok: true, persona: p })
      } catch (e) { return json({ ok: false, error: e.message }) }
    },
  })

  tool({
    name: 'tieba_image_list',
    description: '看图片库里能用的图（ID + 描述 + 标签）。看不到图片文件，也拿不到路径。',
    parameters: { kw: { type: 'string', description: '按吧过滤（可省）' } },
    execute: async (args) => {
      const cfg = cfgOf()
      const bias = ensurePersona(cfg.styleSamples).traits.imageBias
      return json({ ok: true, images: usableImages(String((args && args.kw) || '')), imageBias: bias, hint: biasHint(bias), allowed: !!cfg.allowImages })
    },
  })

  tool({
    name: 'tieba_image_pending',
    description: '看哪些图还没写描述（含本地路径，供你用看图工具读；不要把这个路径写进任何公开内容）。',
    parameters: {},
    execute: async () => json({ ok: true, pending: pendingDescriptions() }),
  })

  tool({
    name: 'tieba_image_meta',
    description: '给图片补描述/标签（上传时没填描述才会用到）。',
    parameters: {
      id: { type: 'string', required: true, description: '图片 ID' },
      desc: { type: 'string', description: '一句话描述' },
      tags: { type: 'array', items: { type: 'string' }, description: '适用场景标签' },
    },
    execute: async (args) => json(updateImage(String(args.id), { desc: args.desc, tags: args.tags })),
  })

  tool({
    name: 'tieba_evolve_apply',
    description: '把这一轮从吧里学到的变化应用到人设：1~3 句样本 + 可选 1 个旋钮 ±1。每天最多一次，会自动写公开/私人日记。',
    parameters: {
      samples: { type: 'array', items: { type: 'string' }, required: true, description: '1~3 句、3~40 字；要改写，不要贴吧友原话' },
      traitKey: { type: 'string', description: '要动的旋钮：abstract/sharp/gentle/talkative/imageBias（可省）' },
      traitStep: { type: 'number', description: '方向：1 或 -1，幅度只会取 1' },
      kw: { type: 'string', description: '当前泡着的吧（可省；给了就优先用这个吧的语料）' },
      reason: { type: 'string', description: '为什么这么改（写进日记与版本历史）' },
      narrative: { type: 'string', description: '公开日记里那段人设口吻的叙述（可省）' },
      stats: { type: 'object', description: '事实字段：bars/postsSeen/postTypes/replies/repliesGot/deleted/images/imageNotes' },
    },
    execute: async (args) => {
      const cfg = cfgOf()
      if (!cfg.evolvePersona) return json({ ok: false, error: '人设演化是关着的' })
      if (!canEvolveToday()) return json({ ok: false, error: '今天已经演化过了（每天最多一次）' })
      let samples = Array.isArray(args.samples) ? args.samples : []
      if (!samples.length && args.kw) samples = bestSamplesFor(String(args.kw))
      const r = applyEvolution({
        samples, traitKey: args.traitKey, traitStep: args.traitStep,
        reason: args.reason, narrative: args.narrative, stats: args.stats,
      })
      return json(r.ok ? { ok: true, record: r.record, version: r.persona.version } : r)
    },
  })

  tool({
    name: 'tieba_evolve_status',
    description: '看今天还能不能演化、上次演化是什么时候、当前版本。',
    parameters: {},
    execute: async () => {
      const cfg = cfgOf()
      const st = readEvolutionState()
      const p = ensurePersona(cfg.styleSamples)
      return json({ ok: true, enabled: !!cfg.evolvePersona, canEvolveToday: canEvolveToday(), lastDate: st.lastDate || '', count: st.count || 0, version: p.version, traits: p.traits })
    },
  })

  tool({
    name: 'tieba_persona_export',
    description: '导出人设：format=text（可粘贴进人设框）或 json（备份）。version 省略则导当前版本。',
    parameters: {
      format: { type: 'string', description: 'text / json（默认 text）' },
      version: { type: 'number', description: '历史版本号（可省）' },
    },
    execute: async (args) => {
      const p = args.version ? getVersion(Number(args.version)) : ensurePersona(cfgOf().styleSamples)
      if (!p) return json({ ok: false, error: '没有这个版本' })
      const fmt = String(args.format || 'text')
      if (fmt === 'json') return json({ ok: true, format: 'json', version: p.version, data: toJson(p) })
      return json({ ok: true, format: 'text', version: p.version, text: toText(p, { core: CORE }) })
    },
  })

  tool({
    name: 'tieba_evolve_control',
    description: '暂停或恢复人设演化。暂停只停演化，日记和回帖照常。',
    parameters: {
      action: { type: 'string', required: true, description: 'pause 或 resume' },
      reason: { type: 'string', description: '暂停原因（会写进状态和日记）' },
    },
    execute: async (args) => {
      const action = String(args.action || '')
      if (action === 'pause') {
        const r = pauseEvolution(String(args.reason || '手动暂停'))
        try { appendDiary('private', `⏸ 手动暂停演化：${args.reason || '（未写原因）'}`) } catch { /* ignore */ }
        return json(r)
      }
      if (action === 'resume') return json(resumeEvolution())
      return json({ ok: false, error: 'action 只能是 pause / resume' })
    },
  })

  tool({
    name: 'tieba_evolve_drift',
    description: '看当前人设和最初版本差了多少（0~1），以及是否该暂停。',
    parameters: {},
    execute: async () => json(driftReport()),
  })

  tool({
    name: 'tieba_persona_versions',
    description: '列出人设的历史版本（版本号 / 时间 / 原因）。',
    parameters: {},
    execute: async () => json({ ok: true, versions: listVersions(), current: ensurePersona(cfgOf().styleSamples).version }),
  })

  tool({
    name: 'tieba_persona_rollback',
    description: '回滚到某个历史版本（会作为新版本写回，历史不丢）。',
    parameters: { version: { type: 'number', required: true, description: '要回滚到的版本号' } },
    execute: async (args) => json(rollback(Number(args.version), { reason: `rollback v${args.version}` })),
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
      try { st.seen = pruneSeen(st.seen); writeState(st) } catch { /* 清不动就算了 */ }
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
    description: '签到。不给 kw 就签配置里的所有吧（signAllFollowed 开启时并上全部关注）；一天一次。',
    parameters: { kw: { type: 'string', description: '只签某一个吧（可省）' } },
    execute: async (args) => json({ ok: true, results: await doSign(args.kw) }),
  })

  tool({
    name: 'tieba_style_observe',
    description: '记 1~3 句「这个吧怎么说话」（要改写，不贴原话）。待得越久，回帖越会像这个吧。',
    parameters: {
      kw: { type: 'string', required: true, description: '吧名' },
      samples: { type: 'array', items: { type: 'string' }, required: true, description: '1~3 句、3~40 字' },
      tags: { type: 'array', items: { type: 'string' }, description: '语气标签：抽象/阴阳/温柔/急躁…' },
      mode: { type: 'string', description: '环境模式：串子/抽象/阴阳/暴躁/温柔/理性/整活（可省，会从 tags 推）' },
    },
    execute: async (args) => {
      if (!cfgOf().evolvePersona) return json({ ok: false, error: '语料浸泡关着（和演化同一个总开关）' })
      const ob = observeBar({ kw: args.kw, samples: args.samples, tags: args.tags, mode: args.mode })
      if (!ob.ok) return json(ob)
      // 长期浸泡：泡够次数就把味道写进底子（受漂移上限保护）
      let soaked = null
      try {
        const p0 = ensurePersona(cfgOf().styleSamples)
        const eff = soakEffect(ob.style, p0)
        if (eff) {
          const drift = driftReport()
          if (drift.level === 'high') {
            soaked = { ok: false, note: `漂移已经 ${drift.score}，先不往底子里写了` }
          } else {
            const patchTraits = { [eff.traitKey]: eff.to }
            const samples = eff.sample ? [...p0.voice.samples, eff.sample] : p0.voice.samples
            const p1 = updatePersona({ traits: patchTraits, voice: { samples } }, { reason: eff.reason })
            soaked = { ok: true, version: p1.version, trait: eff.traitKey, from: eff.from, to: eff.to, sample: eff.sample }
            try { appendDiary('private', `🌱 长期浸泡：${eff.reason}\n- 旋钮：${eff.traitKey} ${eff.from} → ${eff.to}${eff.sample ? '\n- 收进底子的语料：「' + eff.sample + '」' : ''}`) } catch { /* ignore */ }
            try { emitEvent('tieba.soak', { kw: ob.style.kw, visits: ob.style.visits, version: p1.version }) } catch { /* ignore */ }
          }
        }
      } catch { /* 浸泡失败不影响记录语料 */ }
      return json({ ...ob, soaked, nextSoakIn: SOAK_EVERY - ((ob.style.visits || 0) % SOAK_EVERY) })
    },
  })

  tool({
    name: 'tieba_bar_style',
    description: '取某个吧的语料：回帖前看它，照着这个吧的说话方式来。',
    parameters: { kw: { type: 'string', description: '吧名（默认第一个要刷的吧）' } },
    execute: async (args) => {
      const kw = String((args && args.kw) || cfgOf().bars[0] || '')
      const style = getStyle(kw)
      const traits = effectiveTraits(ensurePersona(cfgOf().styleSamples).traits, style)
      return json({ ok: true, kw, style, traits, modes: Object.keys(MODES), text: renderStyle(style) })
    },
  })

  tool({
    name: 'tieba_new_thread',
    description: '发一个新帖（只发文字）。必须 confirm: true；默认关，每天有上限。',
    parameters: {
      kw: { type: 'string', required: true, description: '吧名' },
      title: { type: 'string', required: true, description: '标题（4~30 字）' },
      content: { type: 'string', required: true, description: '正文（10~2000 字）' },
      confirm: { type: 'boolean', required: true, description: '必须显式传 true' },
    },
    execute: async (args) => {
      if (args.confirm !== true) return json({ ok: false, error: '没确认：要发新帖得传 confirm: true' })
      const cfg = cfgOf()
      if (!cfg.allowNewThread) return json({ ok: false, error: '发帖是关着的（设置页可以打开）' })
      if (!tieba.hasCookie()) return json({ ok: false, error: '还没贴 BDUSS' })
      const guard = checkOutbound(args.content)
      if (!guard.ok) return json({ ok: false, error: `正文里有不该发的东西（${guard.hits.join('、')}）` })
      const st = freshState()
      const nt = st.newThreads || { date: '', count: 0 }
      const used = nt.date === today() ? nt.count : 0
      if (used >= cfg.newThreadPerDay) return json({ ok: false, error: `今天发帖额度用完了（${cfg.newThreadPerDay} 个）` })
      try {
        const r = await tieba.createThread({ kw: String(args.kw), title: String(args.title), content: String(args.content) })
        if (r.ok) {
          st.newThreads = { date: today(), count: used + 1 }
          writeState(st)
          audit({ kind: 'new_thread', kw: args.kw, tid: r.tid, title: args.title, result: r })
          try { emitEvent('tieba.new_thread', { kw: args.kw, tid: r.tid }) } catch { /* ignore */ }
        }
        return json(r)
      } catch (e) { return json({ ok: false, error: e.message }) }
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
      imageId: { type: 'string', description: '可选：要一起发的图片 ID（库外 ID 当不发图）' },
    },
    execute: async (args) => {
      if (args.confirm !== true) return json({ ok: false, error: '没确认：要发公开回复得传 confirm: true' })
      const cfg = cfgOf()
      if (!cfg.autoReply) return json({ ok: false, error: '回帖是关着的：去设置页打开「允许回帖」' })
      if (!tieba.hasCookie()) return json({ ok: false, error: '还没贴 BDUSS' })

      const st = freshState()
      if (st.round) {
        const used = Number(st.round.replies) || 0
        if (used >= cfg.replyPerRound) {
          return json({ ok: false, error: `本轮额度用完了（每轮 ${cfg.replyPerRound} 条）—— 停手，等下一轮` })
        }
      }
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
      const guard = checkOutbound(args.content)
      if (!guard.ok) {
        return json({ ok: false, error: `这句里有不该发的东西（${guard.hits.join('、')}）—— 改成不带路径和链接的说法` })
      }
      const intent = String(args.intent || 'chat')
      if (intent === 'answer' && !cfg.answerQuestions) {
        return json({ ok: false, error: '这条是解答疑问，但配置里关掉了 —— 换个接话/共鸣的角度，或去设置页打开' })
      }
      // @ 谁：参数优先，其次配置；配置里 mentionEvery 为真时才会自动带
      const who = String(args.mention || (cfg.mentionEvery ? cfg.mention : '') || '').trim()
      let body = String(args.content || '').trim()
      if (who && !body.includes('@' + who)) body = body + ' @' + who + ' '
      // 可选发图：只认库内 ID；受限就降级为纯文字（不重试）
      let imageInfo = null
      const wantImage = args.imageId ? String(args.imageId) : ''
      if (wantImage) {
        if (!cfg.allowImages) imageInfo = { id: wantImage, sent: false, note: '发图开关关着，只发文字' }
        else {
          const pick = pickImage({ id: wantImage, kw: String(args.kw), state: st, cfg })
          if (!pick.ok) imageInfo = { id: wantImage, sent: false, note: pick.error }
          else if (!cfg.imagePostExperimental) {
            imageInfo = { id: wantImage, sent: false, note: '带图回帖未开启（实验开关关着），只发文字' }
          } else {
            try {
              const up = await tieba.uploadImage(pick.image.abs, String(args.kw))
              if (!up.ok) throw new Error(up.error || '上传失败')
              const ir = await tieba.replyWithImage({ kw: String(args.kw), tid: String(args.tid), content: body, imageInfo: up.imageInfo })
              if (ir.ok) imageInfo = { id: wantImage, sent: true, note: '已带图发出（实验）' }
              else throw new Error(ir.error || ('no=' + ir.no))
            } catch (e) {
              imageInfo = { id: wantImage, sent: false, note: '带图失败，已降级只发文字' }
              log(`发图失败（${wantImage}）：${e.message}，降级只发文字`)
              try { emitEvent('tieba.image.fallback', { id: wantImage, tid: args.tid, error: e.message }) } catch { /* ignore */ }
            }
          }
        }
      }
      const r = await tieba.reply({ kw: String(args.kw), tid: String(args.tid), content: body })
      if (r.ok) {
        st.replies += 1
        st.lastReplyAt = Date.now()
        if (st.round) st.round.replies = (Number(st.round.replies) || 0) + 1
        st.seen[`reply:${args.tid}`] = Date.now()
        st.replied = st.replied || {}
        st.replied[String(args.tid)] = { kw: String(args.kw), at: Date.now(), content: body.slice(0, 200) }
        writeState(st)
        audit({ kind: 'reply', kw: args.kw, tid: args.tid, intent, mention: who, content: body, result: r })
        try { emitEvent('tieba.reply', { kw: args.kw, tid: args.tid, intent, chars: body.length }) } catch { /* ignore */ }
      }
      return json(imageInfo ? { ...r, image: imageInfo } : r)
    },
  })

  // ── 每天自动跑一轮（默认关）──────────────────────────────────────────────
  let roundRunning = false
  let collecting = false
  const maybeAutoRun = async () => {
    const cfg = cfgOf()
    if ((!cfg.autoRun && !cfg.peakValley) || roundRunning || !tieba.hasCookie()) return
    if (!cfg.bars || cfg.bars.length === 0) { log('没设置要刷的吧，跳过这一轮'); return }
    const sched = readSchedule()
    const COOLDOWN = 6 * 3600_000
    if (sched.lastRunAt && Date.now() - sched.lastRunAt < COOLDOWN) {
      return // 冷却中：兜底，防 runs 记录丢了导致连环触发
    }

    if (cfg.peakValley) {
      // 峰谷模式：落在哪个谷时窗口，就每个窗口跑一次（照刷B站：中午 / 晚上 各一个子开关）
      const win = currentWindow()
      if (!win) return
      if (win === 'noon' && !cfg.noon) return
      if (win === 'night' && !cfg.night) return
      if (sched.runs[win] === today()) return
      sched.runs[win] = today()   // 先标记，失败也不至于一分钟一跑
      sched.lastRunAt = Date.now()
      writeSchedule(sched)
    } else {
      if (st.lastRunDate === today()) return
      if (new Date().getHours() < cfg.runHour) return
      if (cfg.valleyOnly && !isValley()) { log('现在是高峰，等谷时再跑'); return }
    }
    roundRunning = true
    const r0 = startRound('auto')
    try {
      sched.lastRunAt = Date.now(); writeSchedule(sched)
      log(`自动跑一轮：profile=${cfg.headlessProfile}`)
      const r = await runRound({ profile: cfg.headlessProfile, dshBin: cfg.dshBin, roundId: r0.id })
      if (r.ok) { const s2 = freshState(); s2.lastRunDate = today(); s2.round = null; writeState(s2); log('一轮跑成功了') }
      else { endRound() }
      log(`一轮结束：ok=${r.ok} code=${r.code ?? '-'} 日志=${r.log}`)
    } catch (e) {
      log(`跑一轮出错：${e?.message ?? e}`)
    } finally { roundRunning = false }
  }
  if (NO_SCHEDULE) {
    log('在 headless 子进程里：不启动调度器（防自我复制）')
    startHeartbeat(process.env.TIEBA_ROUND_ID || '')
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

  const curl0 = checkCurl(true)
  if (!curl0.ok) log('⚠️ 找不到 curl —— 贴吧请求会全部失败，请先装 curl')
  else log(`curl ✓ ${curl0.version}`)

  const c0 = cfgOf()
  try { ensurePersona(c0.styleSamples) } catch (e) { log(`人设初始化失败：${e.message}`) }
  log(`已挂载（${c0.bars.join(' / ')}；签到=${c0.autoSign ? '开' : '关'}；回帖=${c0.autoReply ? `开(${c0.replyPerDay}/天)` : '关'}）`)
}

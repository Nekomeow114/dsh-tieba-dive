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
          if (sub === '/config' && req.method === 'GET') return sendJson(res, 200, { ok: true, cfg })
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
              try { out.push(await tieba.sign(kw)) } catch (e) { out.push({ ok: false, kw, error: e.message }) }
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
      return json({ kw, fid, count: all.length, threads: all.slice(0, 120) })
    },
  })

  tool({
    name: 'tieba_thread',
    description: '读一个帖子的楼层正文。判断内容靠它，别看标题下结论。',
    parameters: {
      tid: { type: 'string', description: '帖子 id（数字）' },
      pn: { type: 'number', description: '第几页（默认 1）' },
    },
    execute: async (args) => json(await tieba.readThread(String(args.tid), { pn: Number(args.pn) || 1 })),
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
        try { out.push(await tieba.sign(kw)) } catch (e) { out.push({ ok: false, kw, error: e.message }) }
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

      const r = await tieba.reply({ kw: String(args.kw), tid: String(args.tid), content: String(args.content) })
      if (r.ok) {
        st.replies += 1
        st.lastReplyAt = Date.now()
        st.seen[`reply:${args.tid}`] = Date.now()
        writeState(st)
        audit({ kind: 'reply', kw: args.kw, tid: args.tid, content: args.content, result: r })
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

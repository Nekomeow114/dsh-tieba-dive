#!/usr/bin/env node
/**
 * dsh-tieba-scroll 的 MCP server（stdio，零依赖，只读）
 *
 * 给 Codex / Claude Desktop / AstrBot 等 MCP 客户端用：
 *   node mcp-server.mjs
 * 环境变量：DSH_HOME（默认 ~/.dsh），读 $DSH_HOME/tieba-duty/config.json 与 cookie.txt。
 *
 * 只读：列帖、读帖、楼中楼、风格参考、日报、自检；不包含回帖/发帖/签到。
 */
import readline from 'node:readline'
import { readConfig } from './lib/config.mjs'
import * as tieba from './lib/tieba.js'
import { retrieve } from './lib/stylelib.mjs'
import { readReport } from './lib/reports.mjs'

const VERSION = '1.29.0'
const cfg = (() => { try { return readConfig() } catch { return {} } })()
try { tieba.setGap(cfg.requestGapMs || 1200) } catch { /* ignore */ }
try { tieba.setBreakerMinutes(cfg.breakerMin ?? 30) } catch { /* ignore */ }

const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 1) }] })
const fail = (msg) => ({ content: [{ type: 'text', text: String(msg) }], isError: true })

const tools = [
  {
    name: 'tieba_settings', description: '读取贴吧插件配置（不含 cookie）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const c = readConfig()
      delete c.cookie
      return ok({ ok: true, config: c, loggedIn: tieba.hasCookie() })
    },
  },
  {
    name: 'tieba_list', description: '列出某个吧的帖子（id / 标题 / 回复数）',
    inputSchema: { type: 'object', properties: { kw: { type: 'string' }, pages: { type: 'number' }, onlyFresh: { type: 'boolean' } }, required: ['kw'], additionalProperties: false },
    run: async (a) => ok(await tieba.listBar(String(a.kw), { pn: 0 })),
  },
  {
    name: 'tieba_thread', description: '读帖子楼层正文；附带 floorIds（楼层号→pid）与高赞楼层',
    inputSchema: { type: 'object', properties: { tid: { type: 'string' }, pn: { type: 'number' } }, required: ['tid'], additionalProperties: false },
    run: async (a) => {
      const r = await tieba.readThread(String(a.tid), { pn: Number(a.pn) || 1 })
      try {
        const hot = await tieba.hotReplies(String(a.tid), { rn: 30 })
        r.hotFloors = hot.slice(0, 6).map((p) => ({ floor: p.floor, id: p.id, likes: p.likes, replies: p.replies, text: p.text }))
        r.floorIds = Object.fromEntries(hot.map((p) => [p.floor, p.id]))
        r.likesKnown = true
      } catch (e) { r.likesKnown = false; r.hotError = e.message }
      return ok(r)
    },
  },
  {
    name: 'tieba_sub_replies', description: '读某层楼下的楼中楼（只读）；pid 是楼层 id，只有楼层号就传 floor',
    inputSchema: { type: 'object', properties: { tid: { type: 'string' }, pid: { type: 'string' }, floor: { type: 'number' }, pn: { type: 'number' } }, required: ['tid'], additionalProperties: false },
    run: async (a) => {
      const tid = String(a.tid)
      let pid = String(a.pid || '').trim()
      const floorNo = Number(a.floor) || (/^\d{1,4}$/.test(pid) ? Number(pid) : 0)
      if (floorNo && (!pid || /^\d{1,4}$/.test(pid))) {
        const posts = await tieba.hotReplies(tid, { rn: 100 })
        const hit = posts.find((p) => p.floor === floorNo)
        if (!hit) return fail(`没找到第 ${floorNo} 楼`)
        pid = String(hit.id)
      }
      if (!pid) return fail('要给 pid（楼层 id）或 floor（楼层号）')
      const subs = await tieba.getSubReplies(tid, pid, { pn: Number(a.pn) || 1 })
      return ok({ ok: true, tid, pid, count: subs.length, subs })
    },
  },
  {
    name: 'tieba_style_refs', description: '从风格库检索某个吧的高赞回复当参考（只读，few-shot）',
    inputSchema: { type: 'object', properties: { kw: { type: 'string' }, topic: { type: 'string' } }, required: ['kw'], additionalProperties: false },
    run: async (a) => ok(retrieve(String(a.kw), String(a.topic || ''), 4)),
  },
  {
    name: 'tieba_report_read', description: '读日报（默认最新一份）',
    inputSchema: { type: 'object', properties: { latest: { type: 'boolean' }, date: { type: 'string' }, lines: { type: 'number' } }, additionalProperties: false },
    run: async (a) => ok(readReport({ latest: a.latest !== false, date: a.date, lines: Number(a.lines) || 400 })),
  },
  {
    name: 'tieba_whoami', description: '检查贴吧登录态（只读）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => ok(await tieba.whoami()),
  },
]

const toolMap = new Map(tools.map((t) => [t.name, t]))
const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'dsh-tieba-scroll', version: VERSION },
      } })
    }
    if (method === 'notifications/initialized') return
    if (method === 'tools/list') {
      return send({ jsonrpc: '2.0', id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } })
    }
    if (method === 'tools/call') {
      const name = params && params.name
      const t = toolMap.get(name)
      if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool: ${name}` } })
      try {
        const r = await t.run((params && params.arguments) || {})
        return send({ jsonrpc: '2.0', id, result: r })
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: fail(e.message) })
      }
    }
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  } catch (e) {
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } })
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => { if (line.trim()) { try { handle(JSON.parse(line)) } catch (e) { process.stderr.write(`bad message: ${e.message}\n`) } } })
process.stderr.write(`dsh-tieba-scroll MCP (read-only) ready · ${tools.length} tools\n`)

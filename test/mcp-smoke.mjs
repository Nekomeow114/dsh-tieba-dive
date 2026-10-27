/**
 * MCP stdio 冒烟测试：不需要 Codex / Inspector。
 * 启动 mcp-server.mjs，走 initialize → tools/list → tools/call(tieba_settings)。
 */
import { spawn } from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = spawn(process.execPath, [path.join(here, '..', 'mcp-server.mjs')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env },
})
const rl = readline.createInterface({ input: server.stdout })
const pending = new Map()
let seq = 1
const call = (method, params) => new Promise((resolve, reject) => {
  const id = seq++
  pending.set(id, { resolve, reject })
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`${method} 超时`)) } }, 15000)
})
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.error) p.reject(new Error(msg.error.message))
  else p.resolve(msg.result)
})

const t = (cond, name) => { if (!cond) { console.error('FAIL ', name); process.exitCode = 1 } else console.log('PASS ', name) }

try {
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } })
  t(init.serverInfo && init.serverInfo.name === 'dsh-tieba-scroll', 'initialize：serverInfo')
  const list = await call('tools/list', {})
  const names = list.tools.map((x) => x.name)
  t(names.includes('tieba_settings') && names.includes('tieba_thread') && names.includes('tieba_sub_replies'), 'tools/list：只读工具齐全')
  t(!names.some((n) => n.includes('reply')), 'tools/list：不包含回帖工具')
  const r = await call('tools/call', { name: 'tieba_settings', arguments: {} })
  const text = r.content && r.content[0] && r.content[0].text
  const parsed = JSON.parse(text)
  t(parsed.ok === true && parsed.config && !('cookie' in parsed.config), 'tools/call：tieba_settings 可读且不含 cookie')
} catch (e) {
  console.error('FAIL ', e.message)
  process.exitCode = 1
} finally {
  server.kill('SIGTERM')
  setTimeout(() => process.exit(process.exitCode || 0), 100)
}

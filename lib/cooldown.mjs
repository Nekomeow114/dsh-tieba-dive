/**
 * lib/cooldown.mjs —— 风控熔断
 *
 * 撞到一次「百度安全验证」就歇一会儿，期间**一个请求都不发**。
 * 为什么要落盘：重启之后还在熔断期内，也不该立刻又去撞。
 *
 * 文件：$DSH_HOME/tieba-duty/cooldown.json（600）
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = () => {
  const h = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(h, 'tieba-duty')
}
export const cooldownFile = () => path.join(dir(), 'cooldown.json')
export const DEFAULT_MINUTES = 30

export function readCooldown() {
  try {
    const j = JSON.parse(fs.readFileSync(cooldownFile(), 'utf8'))
    const until = Number(j.until) || 0
    return { until, reason: j.reason || '', active: until > Date.now() }
  } catch { return { until: 0, reason: '', active: false } }
}

export function remainingMs() {
  const c = readCooldown()
  return Math.max(0, c.until - Date.now())
}

export function trip(minutes = DEFAULT_MINUTES, reason = '百度安全验证') {
  const ms = Math.max(0, Number(minutes) || 0) * 60_000
  if (!ms) return { active: false }
  const until = Date.now() + ms
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(cooldownFile(), JSON.stringify({ until, reason, at: new Date().toISOString() }, null, 1) + '\n', { mode: 0o600 })
  try { fs.chmodSync(cooldownFile(), 0o600) } catch { /* ignore */ }
  return { active: true, until, reason }
}

export function clearCooldown() {
  try { fs.unlinkSync(cooldownFile()) } catch { /* 本来就没有 */ }
  return { active: false }
}

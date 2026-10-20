/**
 * lib/schedule.mjs —— 调度账本（和 state.json 分开存）
 *
 * 为什么单独一个文件：state.json 会被多个进程读-改-写（子进程写 round/回帖数），
 * 调度器写的 runs / lastRunAt 经常被覆盖，导致「同一窗口反复触发」。
 * 调度账本只由调度器写，冲突面小得多。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const file = () => {
  const h = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(h, 'tieba-duty', 'schedule.json')
}

export function readSchedule() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return { runs: j.runs || {}, lastRunAt: Number(j.lastRunAt) || 0 }
  } catch { return { runs: {}, lastRunAt: 0 } }
}

export function writeSchedule(s) {
  const f = file()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ runs: s.runs || {}, lastRunAt: s.lastRunAt || 0, at: new Date().toISOString() }, null, 1) + '\n', { mode: 0o600 })
}

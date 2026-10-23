/**
 * lib/timeline.mjs —— 演化时间轴（浸泡 / 演化 / 回滚都写一行）
 * 文件：$DSH_HOME/tieba-duty/timeline.jsonl
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { localStamp } from './time.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const file = () => path.join(dir(), 'timeline.jsonl')

export function appendTimeline(entry = {}) {
  fs.mkdirSync(dir(), { recursive: true })
  const row = { at: localStamp(), ...entry }
  fs.appendFileSync(file(), JSON.stringify(row) + '\n', { mode: 0o600 })
  return row
}

export function readTimeline(limit = 20) {
  try {
    return fs.readFileSync(file(), 'utf8').split('\n').filter(Boolean).slice(-Math.max(1, limit)).reverse()
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

/**
 * lib/state.mjs —— 运行状态（已读去重 / 今天回了几条 / 今天签到了没）
 * 放在 $DSH_HOME/tieba-duty/state.json，不进插件包、卸载不删。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

export const stateFile = () => path.join(homeDir(), 'state.json')
export const auditFile = () => path.join(homeDir(), 'audit.jsonl')
import { localToday } from './time.mjs'
export const today = () => localToday()

export function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return {
      date: s.date || '',
      replies: Number(s.replies) || 0,
      lastReplyAt: Number(s.lastReplyAt) || 0,
      signed: s.signed || {},   // { 吧名: 'YYYY-MM-DD' }
      seen: s.seen || {},       // { 帖子id: 时间戳 }
      replied: s.replied || {}, // { 帖子id: { kw, at, content } } —— 自己回过的，方便回读楼中楼
      round: s.round || null,   // { id, startedAt, replies } —— 当前这一轮的计数
      subReplies: s.subReplies || {}, // { 帖子id: [pid...] } —— 这帖回过哪几条楼中楼
    }
  } catch {
    return { date: today(), replies: 0, lastReplyAt: 0, signed: {}, seen: {}, replied: {}, round: null, subReplies: {} }
  }
}

export function writeState(s) {
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1))
}

/** 每天零点（按日期字符串）自动把当日计数清零 */
export function freshState() {
  const s = readState()
  if (s.date !== today()) {
    s.date = today()
    s.replies = 0
    s.lastReplyAt = 0
    s.round = null
    try { writeState(s) } catch { /* 盘写不了也不能影响读 */ }
  }
  return s
}

export function audit(entry) {
  try {
    fs.mkdirSync(homeDir(), { recursive: true })
    fs.appendFileSync(auditFile(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
  } catch { /* 审计写不进去不能影响主流程 */ }
}

export function pruneSeen(seen, days = 14) {
  const cut = Date.now() - days * 86400_000
  for (const [k, v] of Object.entries(seen)) if (Number(v) < cut) delete seen[k]
  return seen
}

/**
 * lib/diary.mjs —— 日记本（公开 / 私人）
 *
 *   public.md   —— 「给主人看的日记」：日常、今天看了什么、心情
 *   private.md  —— 「自己私人日记」：只有主人手动点进去才显示（设置页有按钮，默认不渲染）
 *
 * 都是追加写，按日期分段；卸载插件不删。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'
import { localStamp } from './time.mjs'

export const diaryDir = () => path.join(homeDir(), 'diary')
export const diaryFile = (scope) =>
  path.join(diaryDir(), scope === 'private' ? 'private.md' : 'public.md')

export const SCOPES = ['public', 'private']

export function appendDiary(scope, text) {
  const s = scope === 'private' ? 'private' : 'public'
  const body = String(text || '').trim()
  if (!body) throw new Error('日记内容空着')
  if (body.length > 4000) throw new Error('一条日记最多 4000 字')
  fs.mkdirSync(diaryDir(), { recursive: true })
  const stamp = localStamp()
  fs.appendFileSync(diaryFile(s), `\n## ${stamp}\n\n${body}\n`)
  return { ok: true, scope: s, file: diaryFile(s) }
}

export function readDiary(scope, { lines = 200 } = {}) {
  const s = scope === 'private' ? 'private' : 'public'
  let raw = ''
  try { raw = fs.readFileSync(diaryFile(s), 'utf8') } catch { raw = '' }
  const all = raw.split('\n')
  const tail = all.slice(-Math.max(20, lines)).join('\n').trim()
  return { scope: s, file: diaryFile(s), exists: Boolean(raw), text: tail }
}

export function diaryStats() {
  const out = {}
  for (const s of SCOPES) {
    try { out[s] = fs.statSync(diaryFile(s)).size } catch { out[s] = 0 }
  }
  return out
}

/**
 * lib/stylelib.mjs —— 按吧风格库（检索式，而不是改人设）
 *
 * 存：$DSH_HOME/tieba-duty/style-lib.json
 * 每个吧：高赞回复（文本 + 赞数 + 楼层）+ 统计画像
 *
 * 用法：回帖前 tieba_style_refs 检索 3~5 条相似的，当 few-shot；**不许照抄**。
 * 长期漂移暂不改（偏移逻辑保持原样）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const file = () => path.join(dir(), 'style-lib.json')
export const MAX_SAMPLES = 40

const WATER = /^(?:\+?3|6|哈+|啊+|dd|cy|顶|好|赞|草|乐|典|难绷|插眼|mark|留名)[。！？!?~～]*$/i
const AD = /(加群|广告|代练|私信|链接|https?:\/\/|微信|qq群|扫码|淘宝|拼多多)/i

function readAll() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {} } catch { return {} } }
function writeAll(all) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(all, null, 1) + '\n', { mode: 0o600 })
}

export function statsOf(samples = []) {
  const list = samples.map((s) => String(s.text || s)).filter(Boolean)
  if (!list.length) return { count: 0, avgLen: 0, punc: { 句号: 0, 问号: 0, 感叹: 0, 省略: 0 }, emojiRate: 0, top: [] }
  const joined = list.join('\n')
  const lens = list.map((x) => x.length)
  const count = (re) => (joined.match(re) || []).length
  const emoji = list.filter((x) => /\[[^\]]{1,8}\]|[\u{1F300}-\u{1FAFF}]/u.test(x)).length
  const freq = new Map()
  for (const s of list) {
    const chars = s.replace(/[\s，。！？、,.!?“”"'「」（）()\[\]]/g, '')
    for (let n = 2; n <= 3; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const g = chars.slice(i, i + n)
        freq.set(g, (freq.get(g) || 0) + 1)
      }
    }
  }
  return {
    count: list.length,
    avgLen: Math.round(lens.reduce((a, b) => a + b, 0) / lens.length),
    punc: { 句号: count(/。/g), 问号: count(/[？?]/g), 感叹: count(/[！!]/g), 省略: count(/…|\.{3,}/g) },
    emojiRate: Number((emoji / list.length).toFixed(2)),
    top: [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g),
  }
}

function normalize(s) { return String(s || '').replace(/\s+/g, ' ').trim() }

/** 把一批高赞回复并进风格库 */
export function ingest(kw, posts = []) {
  const key = String(kw || '').trim()
  if (!key) return { ok: false, error: '没有吧名' }
  const all = readAll()
  const cur = all[key] || { kw: key, samples: [], updatedAt: '' }
  const seen = new Set(cur.samples.map((s) => s.text))
  let added = 0
  for (const p of posts) {
    const text = normalize(p.text)
    if (text.length < 4 || text.length > 120) continue
    if (WATER.test(text) || AD.test(text)) continue
    if (seen.has(text)) continue
    seen.add(text)
    cur.samples.push({ text, likes: Number(p.likes) || 0, floor: Number(p.floor) || 0 })
    added++
  }
  cur.samples = cur.samples.sort((a, b) => b.likes - a.likes).slice(0, MAX_SAMPLES)
  cur.stats = statsOf(cur.samples)
  cur.updatedAt = new Date().toISOString()
  all[key] = cur
  writeAll(all)
  return { ok: true, kw: key, added, total: cur.samples.length, stats: cur.stats }
}

function bigrams(s) {
  const chars = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= chars.length; i++) out.add(chars.slice(i, i + 2))
  return out
}

/** 按话题检索这个吧的参考回复（不是人设） */
export function retrieve(kw, topic = '', n = 4) {
  const lib = readAll()[String(kw)] || { samples: [], stats: statsOf() }
  if (!lib.samples.length) return { ok: true, kw, refs: [], stats: lib.stats, empty: true }
  const tb = bigrams(topic)
  const avg = lib.stats.avgLen || 20
  const scored = lib.samples.map((s) => {
    const sb = bigrams(s.text)
    let overlap = 0
    for (const g of tb) if (sb.has(g)) overlap++
    const lenScore = 1 - Math.min(1, Math.abs(s.text.length - avg) / Math.max(avg, 1))
    const score = overlap * 2 + lenScore + Math.log10((s.likes || 0) + 1)
    return { ...s, score: Number(score.toFixed(2)) }
  }).sort((a, b) => b.score - a.score)
  return { ok: true, kw, refs: scored.slice(0, n), stats: lib.stats }
}

/** 概览：每个吧风格库多少条 */
export function librarySummary() {
  const all = readAll()
  return Object.values(all).map((v) => ({
    kw: v.kw, count: (v.samples || []).length, avgLen: v.stats.avgLen || 0, updatedAt: v.updatedAt,
    sampleList: (v.samples || []).slice(0, 2).map((x) => ({ text: x.text, likes: x.likes || 0 })),
  }))
    .sort((a, b) => b.count - a.count)
}

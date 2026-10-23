/**
 * lib/style.mjs —— 按吧的「语料浸泡」
 *
 * 每个吧一份自己的语料库：进吧读帖时收 1~3 句改写过的「这个吧怎么说话」；
 * 待得越久（visits 越多），这吧的语料在回帖时权重越高。
 *
 * 回帖时由模型自己调 tieba_bar_style 取这个吧的语料，而不是靠人设滑条硬调。
 * 文件：$DSH_HOME/tieba-duty/bar-styles.json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { validateSamples } from './evolve.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const file = () => path.join(dir(), 'bar-styles.json')
export const MAX_PER_BAR = 8

/** 环境模式：这个吧会把鱼变成什么样（行为规则，不是标签墙） */
export const MODES = {
  串子: {
    traits: { sharp: +2, abstract: +2, gentle: -1 },
    rules: '装傻、接梗、故意说反话；别人急了你别急着正面回答，先顺着他串一下。'
      + '被损的时候**不生气**，笑眯眯地反杀一句，让对方自己噎住。'
      + '**不骂人、不挂人、不带真人节奏**。',
    examples: [
      '对方：我在设置里给你智商调低了 → 你：怪不得我现在看你都觉得顺眼了',
      '对方：你是不是傻 → 你：嗯，跟你聊久了',
      '对方：就这？ → 你：对，就这，你还看完了',
    ],
  },
  抽象: {
    traits: { abstract: +3, talkative: -1 },
    rules: '用烂梗和跳跃联想，句子短、逻辑可以断；不解释梗，不写小作文。',
  },
  阴阳: {
    traits: { sharp: +2, gentle: -1 },
    rules: '不直接骂，用反问和复读；点到为止，不追打、不连楼。',
  },
  暴躁: {
    traits: { sharp: +3, talkative: -1 },
    rules: '语气冲、句子短；但**只冲话题不冲人**，不人身攻击。',
  },
  温柔: {
    traits: { gentle: +2, sharp: -1 },
    rules: '先接情绪再说话；短、软，不急着给建议。',
  },
  理性: {
    traits: { abstract: -1, talkative: -1, gentle: +1 },
    rules: '先给结论，再给一句理由；不抖机灵，不绕。',
  },
  无厘头: {
    traits: { abstract: +3, sharp: +1, talkative: +1 },
    rules: '一本正经地讲歪理：先给一个像模像样的前提，再拐到一个离谱的结论；不解释、不拆穿，也不嘲笑提问的人。',
    examples: [
      '半途而废也算一种坚持，只要一直半途而废',
      '这问题问得，答案都不好意思了',
      '你说得对，但你先别对',
    ],
  },
  整活: {
    traits: { abstract: +2, talkative: +1 },
    rules: '顺着楼整活、接龙、玩梗；不拆台、不扫兴。',
  },
  日常: { traits: {}, rules: '正常说话，像吧友。' },
}

export function deriveMode(tags = []) {
  const hit = Object.keys(MODES).find((m) => m !== '日常' && tags.some((t) => String(t).includes(m)))
  return hit || '日常'
}

/** 环境对这个吧里说话的影响（临时偏移，不改人设底子） */
export function effectiveTraits(base = {}, style = {}) {
  const mode = style.mode && MODES[style.mode] ? style.mode : deriveMode(style.tags || [])
  const delta = MODES[mode].traits || {}
  const out = { ...base }
  for (const [k, v] of Object.entries(delta)) out[k] = Math.max(0, Math.min(10, (Number(out[k]) || 0) + v))
  return out
}
export const MAX_BARS = 20

export function readStyles() {
  try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); return j && typeof j === 'object' ? j : {} } catch { return {} }
}

function writeStyles(all) {
  fs.mkdirSync(dir(), { recursive: true })
  const keys = Object.keys(all).sort((a, b) => (all[b].visits || 0) - (all[a].visits || 0)).slice(0, MAX_BARS)
  const out = {}
  for (const k of keys) out[k] = all[k]
  fs.writeFileSync(file(), JSON.stringify(out, null, 1) + '\n', { mode: 0o600 })
}

export function getStyle(kw) {
  const s = readStyles()[String(kw)] || { kw: String(kw), visits: 0, samples: [], tags: [], updatedAt: '' }
  return { ...s, mode: s.mode || deriveMode(s.tags || []) }
}

/**
 * 记一次「在这个吧泡着」：收语料、累积次数
 * @param {{kw:string, samples:string[], tags?:string[]}} p
 */
export function observeBar({ kw, samples = [], tags = [], mode = '' } = {}) {
  const k = String(kw || '').trim()
  if (!k) return { ok: false, error: '没有吧名' }
  const clean = validateSamples(samples).slice(0, 3)
  if (!clean.length) return { ok: false, error: '没有可用的语料（3~40 字，不含路径/链接）' }
  const all = readStyles()
  const cur = all[k] || { kw: k, visits: 0, samples: [], tags: [], updatedAt: '' }
  const merged = [...cur.samples]
  for (const s of clean) if (!merged.includes(s)) merged.push(s)
  const nextTags = [...new Set([...(cur.tags || []), ...tags.map(String)])].slice(0, 8)
  all[k] = {
    kw: k,
    visits: (cur.visits || 0) + 1,
    samples: merged.slice(-MAX_PER_BAR),
    tags: nextTags,
    mode: mode && MODES[mode] ? mode : (cur.mode || deriveMode(nextTags)),
    updatedAt: new Date().toISOString(),
  }
  writeStyles(all)
  return { ok: true, style: all[k] }
}

/** 给模型看的一小段 */
export function renderStyle(style) {
  if (!style || !(style.samples || []).length) return ''
  const mode = style.mode || deriveMode(style.tags || [])
  return [
    `【环境模式】${mode}：${(MODES[mode] || MODES.日常).rules}`,
    ...((MODES[mode] && MODES[mode].examples) ? ['示范：', ...MODES[mode].examples.map((e) => '- ' + e)] : []),
    `这个吧的说话方式（待得越久越该像它，${style.visits || 0} 次）：`,
    ...style.samples.slice(-5).map((s) => '- ' + s),
    style.tags && style.tags.length ? `语气标签：${style.tags.join('、')}` : '',
  ].filter(Boolean).join('\n')
}

/** 演化时优先用「当前测试吧」的语料 */
export function bestSamplesFor(kw, n = 3) {
  const s = getStyle(kw)
  return (s.samples || []).slice(-n)
}

/** 概览：哪些吧泡过、各多少条 */
export function styleSummary() {
  const all = readStyles()
  return Object.values(all)
    .sort((a, b) => (b.visits || 0) - (a.visits || 0))
    .map((s) => ({ kw: s.kw, visits: s.visits || 0, samples: (s.samples || []).length, tags: s.tags || [], mode: s.mode || deriveMode(s.tags || []) }))
}

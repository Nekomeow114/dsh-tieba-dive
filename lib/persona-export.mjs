/**
 * lib/persona-export.mjs —— 人设导出
 *
 * 两种格式：
 *   · text：纯文本，能直接粘回 B1 人设框；
 *   · json：备份 / 再导入（带 format + schema 标记）。
 *
 * 脱敏：语气样本/口癖逐条过 guard（路径、链接、凭证字样直接丢）；
 * 不含吧友原话、用户名 —— 样本本来就是改写过的，这里再兜一层。
 */
import { checkOutbound } from './guard.mjs'
import { localStamp } from './time.mjs'

export const FORMAT = 'dsh-tieba-persona'
export const SCHEMA = 1

const cleanList = (list = []) => (Array.isArray(list) ? list : [])
  .map((s) => String(s || '').replace(/\s+/g, ' ').trim())
  .filter((s) => s && s.length <= 60 && checkOutbound(s).ok)

export function sanitize(persona) {
  return {
    version: Number(persona.version) || 1,
    traits: { ...(persona.traits || {}) },
    voice: {
      samples: cleanList(persona.voice && persona.voice.samples).slice(0, 10),
      quirks: cleanList(persona.voice && persona.voice.quirks).slice(0, 10),
      sentenceLen: (persona.voice && persona.voice.sentenceLen) === 'medium' ? 'medium' : 'short',
      punctuation: (persona.voice && persona.voice.punctuation) === 'normal' ? 'normal' : 'light',
    },
  }
}

const TRAIT_LABELS = {
  abstract: '抽象度', sharp: '毒舌度', gentle: '温柔度', talkative: '话痨度', imageBias: '发图倾向',
}

export function toText(persona, { core } = {}) {
  const p = sanitize(persona)
  const at = localStamp()
  const lines = [
    `# 莫汐 · 人设导出 v${p.version}`,
    `导出时间：${at}`,
    '',
    '## 核心层（不可改）',
    `名字：${core?.name || '莫汐'}`,
    `自称：${core?.selfRef || '咱'}`,
    `私下称呼使用者：${core?.addressOwner || '主人'}`,
    '底线：',
    ...(core?.bottomLines || []).map((x) => `- ${x}`),
    '',
    '## 性格旋钮（0~10）',
    ...Object.keys(TRAIT_LABELS).map((k) => `- ${TRAIT_LABELS[k]}：${p.traits[k] ?? 0}`),
    '',
    '## 语气层',
    `句长：${p.voice.sentenceLen === 'medium' ? '中等' : '短'}`,
    `标点：${p.voice.punctuation === 'normal' ? '正常' : '从简'}`,
    p.voice.samples.length ? '语气样本：' : '语气样本：（空，回帖会用默认口吻）',
    ...p.voice.samples.map((s) => `- ${s}`),
    p.voice.quirks.length ? '口癖：' : '',
    ...p.voice.quirks.map((s) => `- ${s}`),
    '',
    '（导出内容已脱敏：不含吧友原话、用户名、链接、路径。）',
  ]
  return lines.filter((l) => l !== '').join('\n') + '\n'
}

export function toJson(persona) {
  const p = sanitize(persona)
  return {
    format: FORMAT,
    schema: SCHEMA,
    exportedAt: localStamp(),
    version: p.version,
    traits: p.traits,
    voice: p.voice,
  }
}

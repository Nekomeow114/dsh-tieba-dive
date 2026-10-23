/**
 * lib/persona.mjs —— 三层人设 + 版本快照
 *
 *   核心层（锁死）：名字 / 自称 / 称呼 / 底线。**代码常量**，演化流程读写不到；
 *   性格层（可变）：5 个旋钮 0~10；
 *   语气层（可变）：语气样本、口癖、句长、标点。
 *
 * 每次改动前先存一份完整快照（persona-versions/vNNNN.json），可回滚。
 * 文件：$DSH_HOME/tieba-duty/persona.json
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { localStamp } from './time.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const file = () => path.join(dir(), 'persona.json')
const versionsDir = () => path.join(dir(), 'persona-versions')

export const MAX_VERSIONS = 50
export const MAX_SAMPLES = 10
export const TRAIT_KEYS = ['abstract', 'sharp', 'gentle', 'talkative', 'imageBias']
export const TRAIT_LABELS = {
  abstract: '抽象度',
  sharp: '毒舌度',
  gentle: '温柔度',
  talkative: '话痨度',
  imageBias: '发图倾向',
}

/** 核心层：只读常量。任何 update 传进来都会被丢掉 */
export const CORE = Object.freeze({
  name: '莫汐',
  selfRef: '咱',
  addressOwner: '主人',
  bottomLines: [
    '不伤人、不阴阳、不拿别人的痛处玩梗',
    '不透露账号、路径、机器信息、和主人的私事',
    '不站队、不吵架、不参与挂人',
    '违法、越权、代发不当内容：明确拒绝',
  ],
})

export const DEFAULT_TRAITS = Object.freeze({
  abstract: 3,   // 抽象度
  sharp: 2,      // 毒舌度
  gentle: 7,     // 温柔度
  talkative: 4,  // 话痨度
  imageBias: 2,  // 发图倾向（默认低）
})

const clampTrait = (v) => Math.max(0, Math.min(10, Math.round(Number(v) || 0)))

export function readPersona() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'))
    return normalize(j)
  } catch { return null }
}

export function normalize(raw = {}) {
  const traits = {}
  for (const k of TRAIT_KEYS) traits[k] = clampTrait(raw.traits && raw.traits[k] != null ? raw.traits[k] : DEFAULT_TRAITS[k])
  const voice = raw.voice || {}
  return {
    version: Math.max(1, Number(raw.version) || 1),
    core: CORE,                 // 永远用常量，文件里的 core 不认
    traits,
    voice: {
      samples: (Array.isArray(voice.samples) ? voice.samples : []).map(String).filter(Boolean).slice(0, MAX_SAMPLES),
      quirks: (Array.isArray(voice.quirks) ? voice.quirks : []).map(String).filter(Boolean).slice(0, 10),
      sentenceLen: voice.sentenceLen === 'medium' ? 'medium' : 'short',
      punctuation: voice.punctuation === 'normal' ? 'normal' : 'light',
    },
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    history: Array.isArray(raw.history) ? raw.history.slice(-100) : [],
  }
}

function writePersona(p) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(p, null, 1) + '\n', { mode: 0o600 })
}

function snapshot(p, reason) {
  fs.mkdirSync(versionsDir(), { recursive: true })
  const name = `v${String(p.version).padStart(4, '0')}.json`
  fs.writeFileSync(path.join(versionsDir(), name), JSON.stringify({ ...p, snapshotAt: localStamp(), reason }, null, 1) + '\n', { mode: 0o600 })
}

/** 第一次用：从旧的 styleSamples 迁移出 v1 */
export function ensurePersona(styleSamples = '') {
  const cur = readPersona()
  if (cur) return cur
  const p = normalize({
    version: 1,
    voice: { samples: String(styleSamples || '').split('\n').map((x) => x.trim()).filter(Boolean) },
  })
  writePersona(p)
  snapshot(p, 'initial')
  return p
}

/**
 * 改人设：核心层直接忽略；性格层夹到 0~10；语气样本上限 10。
 * 每次成功修改：版本 +1，并先把**旧版本**存快照。
 */
export function updatePersona(patch = {}, { reason = '' } = {}) {
  const cur = ensurePersona()
  const next = normalize({
    ...cur,
    version: cur.version + 1,
    traits: { ...cur.traits, ...(patch.traits || {}) },
    voice: { ...cur.voice, ...(patch.voice || {}) },
    core: CORE, // 显式重设，patch.core 无效
    updatedAt: new Date().toISOString(),
  })
  snapshot(cur, reason || 'update')
  next.history = [...(cur.history || []), { version: next.version, at: localStamp(), reason: reason || 'update' }].slice(-100)
  writePersona(next)
  return next
}

export function listVersions() {
  ensurePersona()
  try {
    return fs.readdirSync(versionsDir()).filter((f) => /^v\d+\.json$/.test(f)).sort().map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(versionsDir(), f), 'utf8'))
        return { version: j.version, at: j.snapshotAt || '', reason: j.reason || '' }
      } catch { return null }
    }).filter(Boolean).slice(-MAX_VERSIONS)
  } catch { return [] }
}

export function getVersion(v) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(versionsDir(), `v${String(v).padStart(4, '0')}.json`), 'utf8'))
    return normalize(j)
  } catch { return null }
}

/** 回滚：把目标版本的内容当成新版本写回（历史不丢） */
export function rollback(v, { reason = '' } = {}) {
  const target = getVersion(v)
  if (!target) return { ok: false, error: `没有 v${v} 这版` }
  const next = updatePersona({ traits: target.traits, voice: target.voice }, { reason: reason || `rollback v${v}` })
  return { ok: true, persona: next }
}

/** 给模型看的一小段（核心层 + 旋钮 + 语气） */
export function renderForPrompt(p) {
  const t = p.traits
  return [
    `【核心层（不可改）】名字 ${CORE.name}，自称「${CORE.selfRef}」，私下叫使用者「${CORE.addressOwner}」。`,
    `底线：${CORE.bottomLines.join('；')}。`,
    `【性格旋钮 0~10】抽象 ${t.abstract} · 毒舌 ${t.sharp} · 温柔 ${t.gentle} · 话痨 ${t.talkative} · 发图倾向 ${t.imageBias}`,
    p.voice.samples.length ? `【语气样本】\n${p.voice.samples.map((s) => '- ' + s).join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * lib/evolve.mjs —— 人设演化（可选，默认关）
 *
 * 流程：读帖 → 模型提炼 1~3 句「这个吧的人怎么说话」→ 写进 proposals（不直接改人设）
 *       → 主人在设置页点「采纳」→ 才追加到语气样本 / 人设文件。
 *
 * 安全：
 *   - 只收「语气样本」，不收身份、不收梗的出处、不收任何私事；
 *   - 每轮最多 3 条，每条 ≤40 字；
 *   - 含路径/链接/凭证的提案直接丢；
 *   - 只追加，不删除已有样本；总数有上限。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { checkOutbound } from './guard.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const file = () => path.join(dir(), 'persona-proposals.json')

export const MAX_SAMPLES = 30

export function readProposals() {
  try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); return Array.isArray(j) ? j : [] } catch { return [] }
}

function writeProposals(list) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(list.slice(-200), null, 1) + '\n', { mode: 0o600 })
}

/** 校验模型提的样本：短、无路径/链接/凭证、去重 */
export function validateSamples(samples) {
  const out = []
  for (const raw of Array.isArray(samples) ? samples : []) {
    const s = String(raw || '').replace(/\s+/g, ' ').trim()
    if (s.length < 3 || s.length > 40) continue
    if (!checkOutbound(s).ok) continue
    if (out.includes(s)) continue
    out.push(s)
    if (out.length >= 3) break
  }
  return out
}

export function addProposal({ samples, note = '', source = '' }) {
  const clean = validateSamples(samples)
  if (!clean.length) return { ok: false, error: '没有可用的样本（太短/太长/含路径或链接）' }
  const p = {
    id: crypto.randomBytes(4).toString('hex'),
    at: new Date().toISOString(),
    samples: clean,
    note: String(note || '').slice(0, 120),
    source: String(source || '').slice(0, 200),
    status: 'pending',
  }
  const list = readProposals()
  // 和待处理的重复就不再加
  if (list.some((x) => x.status === 'pending' && x.samples.join('|') === clean.join('|'))) {
    return { ok: true, duplicate: true }
  }
  list.push(p)
  writeProposals(list)
  return { ok: true, proposal: p }
}

export function getProposal(id) {
  return readProposals().find((x) => x.id === id) || null
}

export function setStatus(id, status) {
  const list = readProposals()
  const p = list.find((x) => x.id === id)
  if (!p) return { ok: false, error: '没有这条建议' }
  p.status = status
  p.decidedAt = new Date().toISOString()
  writeProposals(list)
  return { ok: true, proposal: p }
}

/** 把采纳的样本并进现有样本（去重、上限） */
export function mergeSamples(existing, added) {
  const list = []
  for (const s of [...(existing || []), ...(added || [])]) {
    const t = String(s || '').trim()
    if (t && !list.includes(t)) list.push(t)
  }
  return list.slice(-MAX_SAMPLES)
}

/** 追加到人设文件的「演化记录」（只追加，不动正文） */
export function appendEvolutionNote(personaText, samples) {
  const base = String(personaText || '')
  const marker = '## 演化记录（自己从吧里捡的，可删）'
  const add = samples.map((s) => `- ${s}`).join('\n')
  if (base.includes(marker)) return base.replace(/\s*$/, '\n') + add + '\n'
  return base.replace(/\s*$/, '\n\n') + marker + '\n\n' + add + '\n'
}

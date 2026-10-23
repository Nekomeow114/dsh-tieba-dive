/**
 * lib/evolution.mjs —— 自动演化（每天最多一次，小步）
 *
 * 规则（写死在代码里，不靠模型自觉）：
 *   · 一天最多一次；
 *   · 每次最多动 1 个旋钮，幅度 ±1；
 *   · 每次增/换 1~3 条语气样本，样本总数 ≤10（满了淘汰最旧的）；
 *   · 每次演化都写「公开日记（人设口吻）」和「私人日记（完整变更）」；
 *   · 核心层不参与 —— updatePersona 里已经锁死。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { localToday, localStamp } from './time.mjs'
import { TRAIT_KEYS, TRAIT_LABELS, ensurePersona, updatePersona, MAX_SAMPLES } from './persona.mjs'
import { validateSamples } from './evolve.mjs'
import { appendDiary } from './diary.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const logFile = () => path.join(dir(), 'evolution.jsonl')
const stateFile = () => path.join(dir(), 'evolution-state.json')

export function readEvolutionState() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) } catch { return { lastDate: '', count: 0 } }
}

function writeEvolutionState(s) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1) + '\n', { mode: 0o600 })
}

export function canEvolveToday() {
  return readEvolutionState().lastDate !== localToday()
}

function mergeKeepLast(existing, added, max = MAX_SAMPLES) {
  const list = []
  for (const s of [...(existing || []), ...(added || [])]) {
    const t = String(s || '').trim()
    if (t && !list.includes(t)) list.push(t)
  }
  return list.slice(-max)
}

function fmtStats(stats = {}) {
  return {
    bars: Array.isArray(stats.bars) ? stats.bars.map(String).slice(0, 10) : [],
    postsSeen: Number(stats.postsSeen) || 0,
    postTypes: String(stats.postTypes || '').slice(0, 120),
    replies: Number(stats.replies) || 0,
    repliesGot: Number(stats.repliesGot) || 0,
    deleted: Number(stats.deleted) || 0,
    images: Number(stats.images) || 0,
    imageNotes: String(stats.imageNotes || '').slice(0, 200),
  }
}

/**
 * 应用一次演化。
 * @param {{samples:string[], traitKey?:string, traitStep?:number, reason?:string, stats?:object, narrative?:string}} input
 */
export function applyEvolution({ samples = [], traitKey = '', traitStep = 0, reason = '', stats = {}, narrative = '' } = {}) {
  if (!canEvolveToday()) {
    return { ok: false, error: '今天已经演化过了（每天最多一次）' }
  }
  const clean = validateSamples(samples).slice(0, 3)
  if (!clean.length) return { ok: false, error: '没有可用的语气样本（1~3 条，3~40 字，不含路径/链接）' }

  let step = Number(traitStep) || 0
  let knob = String(traitKey || '')
  if (knob && !TRAIT_KEYS.includes(knob)) return { ok: false, error: `没有这个旋钮：${knob}` }
  if (knob && step !== 0) step = step > 0 ? 1 : -1        // 单次最多 ±1
  else if (knob) step = 0

  const before = ensurePersona()
  const addedSamples = clean.filter((s) => !before.voice.samples.includes(s))
  if (!addedSamples.length && !(knob && step)) {
    return { ok: false, error: '样本都已经有了，旋钮也没动，这次不算演化' }
  }

  const nextTraits = { ...before.traits }
  let traitChange = null
  if (knob && step) {
    const from = before.traits[knob]
    const to = Math.max(0, Math.min(10, from + step))
    if (to === from) return { ok: false, error: `${TRAIT_LABELS[knob]}已经到头了（${from}）` }
    nextTraits[knob] = to
    traitChange = { key: knob, label: TRAIT_LABELS[knob], from, to }
  }

  const replaced = []
  const nextVoiceSamples = mergeKeepLast(before.voice.samples, addedSamples)
  const dropped = before.voice.samples.filter((s) => !nextVoiceSamples.includes(s))
  for (const s of dropped) replaced.push(s)

  const after = updatePersona(
    { traits: nextTraits, voice: { samples: nextVoiceSamples } },
    { reason: reason || '每日演化' },
  )

  const st = fmtStats(stats)
  const record = {
    at: localStamp(),
    date: localToday(),
    from: before.version,
    to: after.version,
    trait: traitChange,
    samplesAdded: addedSamples,
    samplesDropped: replaced,
    reason: String(reason || '').slice(0, 200),
    stats: st,
  }
  fs.mkdirSync(dir(), { recursive: true })
  fs.appendFileSync(logFile(), JSON.stringify(record) + '\n', { mode: 0o600 })

  const es = readEvolutionState()
  writeEvolutionState({ lastDate: localToday(), count: (Number(es.count) || 0) + 1, lastVersion: after.version })

  // 公开日记：人设口吻
  const pub = [
    `版本 v${before.version} → v${after.version}`,
    '',
    String(narrative || '').trim() || '今天在吧里待了一会儿，捡了几句话，学了一下。',
    '',
    `（今天回了 ${st.replies} 条，收到 ${st.repliesGot} 条回复；看了 ${st.bars.join('、') || '几个吧'}。）`,
  ].join('\n')
  appendDiary('public', pub)

  // 私人日记：完整明细
  const priv = [
    `版本 v${before.version} → v${after.version}`,
    '',
    `- 时间：${localStamp()}`,
    `- 看了：${st.bars.join('、') || '（未记录）'}；帖子 ${st.postsSeen} 个${st.postTypes ? '，类型：' + st.postTypes : ''}`,
    `- 旋钮：${traitChange ? `${traitChange.label} ${traitChange.from} → ${traitChange.to}` : '未动'}`,
    `- 样本新增：${addedSamples.length ? addedSamples.map((s) => '「' + s + '」').join('、') : '无'}`,
    `- 样本淘汰：${replaced.length ? replaced.map((s) => '「' + s + '」').join('、') : '无'}`,
    `- 原因：${record.reason || '（未写）'}`,
    `- 回帖：${st.replies} 条；被回复：${st.repliesGot} 条；被删：${st.deleted} 条`,
    `- 发图：${st.images} 张${st.imageNotes ? '（' + st.imageNotes + '）' : ''}`,
  ].join('\n')
  appendDiary('private', priv)

  return { ok: true, record, persona: after }
}

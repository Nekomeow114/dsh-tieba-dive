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
import { TRAIT_KEYS, TRAIT_LABELS, ensurePersona, updatePersona, getVersion, MAX_SAMPLES, DEFAULT_TRAITS } from './persona.mjs'
import { validateSamples } from './evolve.mjs'
import { appendDiary } from './diary.mjs'
import { appendTimeline } from './timeline.mjs'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const logFile = () => path.join(dir(), 'evolution.jsonl')
const stateFile = () => path.join(dir(), 'evolution-state.json')

export function readEvolutionState() {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    return { lastDate: '', count: 0, paused: false, pausedReason: '', pausedAt: '', ...j }
  } catch { return { lastDate: '', count: 0, paused: false, pausedReason: '', pausedAt: '' } }
}

/** 暂停演化（不影响日记、回帖，只停演化） */
export function pauseEvolution(reason = '') {
  const s = readEvolutionState()
  writeEvolutionState({ ...s, paused: true, pausedReason: String(reason).slice(0, 200), pausedAt: localStamp() })
  return { ok: true, paused: true }
}

export function resumeEvolution() {
  const s = readEvolutionState()
  writeEvolutionState({ ...s, paused: false, pausedReason: '', pausedAt: '' })
  return { ok: true, paused: false }
}

/** 漂移：和 v1 快照比，旋钮差 + 样本变化 */
export function driftReport() {
  const cur = ensurePersona()
  const first = getVersion(1) || cur
  const traitDiff = TRAIT_KEYS.reduce((n, k) => n + Math.abs((cur.traits[k] || 0) - ((first.traits || DEFAULT_TRAITS)[k] || 0)), 0)
  const base = new Set((first.voice && first.voice.samples) || [])
  const now = new Set(cur.voice.samples || [])
  const added = [...now].filter((x) => !base.has(x)).length
  const sampleRatio = now.size ? added / now.size : 0
  const score = Math.min(1, Number(((traitDiff / 50) * 0.7 + sampleRatio * 0.3).toFixed(2)))
  const level = score >= 0.5 ? 'high' : score >= 0.3 ? 'warn' : 'ok'
  return { score, level, traitDiff, addedSamples: added, samples: now.size, fromVersion: first.version, currentVersion: cur.version }
}

function writeEvolutionState(s) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 1) + '\n', { mode: 0o600 })
}

/**
 * 被删帖联动：最近 7 天被删 ≥3 条 → 自动暂停演化，并写私人日记。
 * 返回是否触发了暂停。
 */
export function checkDeletionPause() {
  try {
    const cutoff = Date.now() - 7 * 86400_000
    const recent = fs.readFileSync(logFile(), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      .filter((r) => new Date(String(r.at || '').replace(' ', 'T')).getTime() >= cutoff)
    const deletedSum = recent.reduce((n, r) => n + (Number(r.stats && r.stats.deleted) || 0), 0)
    if (deletedSum >= 3) {
      pauseEvolution(`最近 7 天被删 ${deletedSum} 条，先停演化`)
      appendDiary('private', `⚠️ 自动暂停演化：最近 7 天被删 ${deletedSum} 条。请主人检查回帖是不是太冲，或吧里在清理。`)
      return true
    }
  } catch { /* 统计失败不影响演化本身 */ }
  return false
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
  const gst = readEvolutionState()
  if (gst.paused) return { ok: false, error: `演化已暂停：${gst.pausedReason || '手动暂停'}` }
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
  const recordBars = st.bars
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

  const drift = driftReport()
  const es = readEvolutionState()
  writeEvolutionState({ ...es, lastDate: localToday(), count: (Number(es.count) || 0) + 1, lastVersion: after.version })

  const autoPaused = checkDeletionPause()

  // 公开日记：人设口吻
  const pub = [
    `版本 v${before.version} → v${after.version}`,
    '',
    String(narrative || '').trim() || '今天在吧里待了一会儿，捡了几句话，学了一下。',
    '',
    `（今天回了 ${st.replies} 条，收到 ${st.repliesGot} 条回复；看了 ${st.bars.join('、') || '几个吧'}。）`,
    drift.level === 'high' ? `⚠️ 和最初的样子差得有点多了（漂移 ${drift.score}），要不要停一下？` : '',
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
    `- 漂移：${drift.score}（${drift.level}）· 旋钮差 ${drift.traitDiff} · 新样本 ${drift.addedSamples} 条`,
    autoPaused ? '- ⚠️ 因近期被删偏多，已自动暂停演化' : '',
  ].join('\n')
  appendDiary('private', priv)
  appendTimeline({
    type: 'evolve', kw: recordBars[0] || '', fromVersion: before.version, toVersion: after.version,
    trait: traitChange, samples: addedSamples, reason: record.reason,
  })

  return { ok: true, record, persona: after }
}

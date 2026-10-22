/**
 * lib/integrations.mjs —— 跨插件契约（文件级，不 import 对方代码）
 *
 * $DSH_HOME/shared/
 * ├─ plugins/<name>.json    每个插件报到：provides / consumes / version
 * └─ events/<date>.jsonl    事件流：一轮开始/结束、回帖成功、签到
 *
 * 原则：文件是接口；缺了就跳过；坏了能手改。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const sharedDir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'shared')
export const pluginsDir = () => path.join(sharedDir(), 'plugins')
export const eventsDir = () => path.join(sharedDir(), 'events')

/** 报到：写一份能力清单，别人扫目录就知道能搭什么 */
export function writeManifest({ name, version, provides = [], consumes = [], note = '' }) {
  const file = path.join(pluginsDir(), `${name}.json`)
  fs.mkdirSync(pluginsDir(), { recursive: true })
  const data = { name, version, provides, consumes, note, at: new Date().toISOString() }
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n', { mode: 0o644 })
  return data
}

/** 读所有清单（对方没装就返回空数组，不报错） */
export function readManifests() {
  try {
    return fs.readdirSync(pluginsDir()).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(pluginsDir(), f), 'utf8')) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

/** 是否有人提供某个能力 */
export function hasCapability(cap) {
  return readManifests().some((m) => (m.provides || []).includes(cap))
}

/** 汇总：谁在、能提供什么（缺目录也返回空，不报错） */
export function detect() {
  const list = readManifests()
  const caps = {}
  for (const m of list) for (const c of (m.provides || [])) caps[c] = true
  return { plugins: list.map((m) => ({ name: m.name, version: m.version, provides: m.provides || [] })), caps }
}

/** 给模型看的「这一轮能用什么」；没有就返回空串，不占提示词 */
export function capabilitySection() {
  const { caps } = detect()
  const lines = []
  if (caps.memory) {
    lines.push('- 长记忆可用：开工前 `memory_search` 搜相关印象；学到稳定的东西用 `memory_add` 记一条（不记凭证，不记临时对话）')
  }
  if (caps.notify) lines.push('- 通知可用：需要叫人时用通知工具；叫不到就只写日报')
  if (!lines.length) return ''
  return '\n\n===== 这一轮可用的外部能力（由共享目录探测，没写的不代表坏了）=====\n' + lines.join('\n') + '\n'
}

/** 写一条事件（append-only，一天一个文件） */
export function emitEvent(type, data = {}) {
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  fs.mkdirSync(eventsDir(), { recursive: true })
  const file = path.join(eventsDir(), `${day}.jsonl`)
  const line = JSON.stringify({ at: d.toISOString(), type, ...data })
  fs.appendFileSync(file, line + '\n', { mode: 0o644 })
  return { file, line }
}

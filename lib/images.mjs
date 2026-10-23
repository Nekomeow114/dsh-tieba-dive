/**
 * lib/images.mjs —— 图片库（本地）
 *
 * 存：$DSH_HOME/tieba-duty/images/<id>.<ext> + images.json
 * 给模型的只有「ID + 描述 + 标签」，永远不给路径。
 *
 * 选图硬限制（pickReason 返回原因，调用方据此拒绝或降级）：
 *   · 库外 ID / 未启用 / 该吧被禁用 → 不发
 *   · 同一张图 24 小时冷却
 *   · 每轮最多 1 张、全天最多 imagePerDay 张
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const dir = () => path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'tieba-duty')
const imgDir = () => path.join(dir(), 'images')
const metaFile = () => path.join(dir(), 'images.json')
export const MAX_IMAGES = 50
export const MAX_BYTES = 2 * 1024 * 1024
export const COOLDOWN_MS = 24 * 3600_000

export function listImages() {
  try { const j = JSON.parse(fs.readFileSync(metaFile(), 'utf8')); return Array.isArray(j) ? j : [] } catch { return [] }
}

function writeImages(list) {
  fs.mkdirSync(dir(), { recursive: true })
  fs.writeFileSync(metaFile(), JSON.stringify(list.slice(0, MAX_IMAGES), null, 1) + '\n', { mode: 0o600 })
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export function addImage({ name = '', dataUrl = '', desc = '', tags = [] } = {}) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''))
  if (!m) return { ok: false, error: '只支持 png/jpg/webp/gif 的 data URL' }
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length) return { ok: false, error: '图片是空的' }
  if (buf.length > MAX_BYTES) return { ok: false, error: `单张不能超过 ${Math.round(MAX_BYTES / 1024)}KB` }
  const list = listImages()
  if (list.length >= MAX_IMAGES) return { ok: false, error: `图片库最多 ${MAX_IMAGES} 张` }
  const id = crypto.randomBytes(4).toString('hex')
  const ext = EXT[m[1]] || 'png'
  fs.mkdirSync(imgDir(), { recursive: true })
  fs.writeFileSync(path.join(imgDir(), `${id}.${ext}`), buf, { mode: 0o600 })
  const item = {
    id,
    name: String(name || '').slice(0, 60),
    file: `${id}.${ext}`,
    desc: String(desc || '').slice(0, 200),
    tags: (Array.isArray(tags) ? tags : []).map(String).filter(Boolean).slice(0, 6),
    disabledBars: [],
    enabled: true,
    uses: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
    needsDesc: !String(desc || '').trim(),
  }
  list.push(item)
  writeImages(list)
  return { ok: true, image: publicView(item) }
}

export function updateImage(id, patch = {}) {
  const list = listImages()
  const it = list.find((x) => x.id === id)
  if (!it) return { ok: false, error: '没有这张图' }
  if (patch.desc != null) { it.desc = String(patch.desc).slice(0, 200); it.needsDesc = !it.desc.trim() }
  if (patch.tags != null) it.tags = (Array.isArray(patch.tags) ? patch.tags : []).map(String).filter(Boolean).slice(0, 6)
  if (patch.enabled != null) it.enabled = !!patch.enabled
  if (patch.disabledBars != null) it.disabledBars = (Array.isArray(patch.disabledBars) ? patch.disabledBars : []).map(String).slice(0, 10)
  writeImages(list)
  return { ok: true, image: publicView(it) }
}

export function removeImage(id) {
  const list = listImages()
  const it = list.find((x) => x.id === id)
  if (!it) return { ok: false, error: '没有这张图' }
  try { fs.unlinkSync(path.join(imgDir(), it.file)) } catch { /* 文件可能已没了 */ }
  writeImages(list.filter((x) => x.id !== id))
  return { ok: true }
}

export function imageFile(id) {
  const it = listImages().find((x) => x.id === id)
  if (!it) return null
  return { ...it, abs: path.join(imgDir(), it.file) }
}

/** 发图倾向旋钮 → 给模型的建议（只影响倾向，不突破硬限制） */
export function biasHint(bias) {
  const n = Math.max(0, Math.min(10, Number(bias) || 0))
  if (n <= 2) return '基本不发图。除非这张图和帖子严丝合缝，否则只发文字。'
  if (n <= 5) return '偶尔发。一天最多一张，宁可不发。'
  if (n <= 8) return '合适就发。挑和帖子对得上的，不确定就不发。'
  return '倾向发图，但仍然一条一张、不硬凑；没合适的就不发。'
}

/** 给模型看的：ID + 描述 + 标签，不含路径 */
export function publicView(it) {
  return { id: it.id, desc: it.desc || '（还没写描述）', tags: it.tags || [], enabled: it.enabled, uses: it.uses || 0 }
}

export function usableImages(kw) {
  return listImages()
    .filter((x) => x.enabled && !(x.disabledBars || []).includes(kw))
    .map(publicView)
}

/**
 * 判断能不能发这张图。返回 {ok, error?}
 * @param {{id:string, kw:string, state:object, cfg:object}} p
 */
export function pickImage({ id, kw, state, cfg }) {
  const it = listImages().find((x) => x.id === id)
  if (!it) return { ok: false, error: '库里没有这张图（库外 ID 一律不发）' }
  if (!it.enabled) return { ok: false, error: '这张图停用了' }
  if ((it.disabledBars || []).includes(kw)) return { ok: false, error: `这张图在 ${kw} 吧禁用` }
  if (Date.now() - (it.lastUsedAt || 0) < COOLDOWN_MS) return { ok: false, error: '这张图 24 小时内已经用过了' }
  const today = state.imagesToday || { count: 0, byId: {} }
  if ((today.count || 0) >= (cfg.imagePerDay ?? 10)) return { ok: false, error: `今天发图额度用完了（${cfg.imagePerDay ?? 10} 张）` }
  const round = state.round
  if (round && (round.images || 0) >= 1) return { ok: false, error: '本轮已经发过图了（每轮最多 1 张）' }
  return { ok: true, image: it }
}

export function markUsed(id) {
  const list = listImages()
  const it = list.find((x) => x.id === id)
  if (it) { it.uses = (it.uses || 0) + 1; it.lastUsedAt = Date.now(); writeImages(list) }
}

/** 读成 data URL（上传失败降级时也用得到；不返回给模型） */
export function dataUrlOf(id) {
  const it = imageFile(id)
  if (!it) return null
  try {
    const buf = fs.readFileSync(it.abs)
    const ext = path.extname(it.file).slice(1)
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch { return null }
}

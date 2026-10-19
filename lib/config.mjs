/**
 * lib/config.mjs —— 插件自己的配置（不依赖宿主的 schemastery 表单）
 *
 * 为什么自己存一份：DSH 的自动表单在部分版本/客户端上不渲染，
 * 结果就是「设置页里只有一个 BDUSS 框，吧列表和开关根本没地方改」。
 * 所以：配置文件 + 自己的 HTTP 接口 + 设置页里的控件，三件套自给自足。
 *
 * 位置：$DSH_HOME/tieba-duty/config.json（600）。宿主传进来的 config 只当默认值。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

export const configFile = () => path.join(homeDir(), 'config.json')

export const DEFAULTS = {
  // 默认只刷 deepseek（用户加了新吧就按用户的来）
  bars: ['deepseek'],
  keywords: [],
  autoSign: false,
  autoFollow: true,   // 新加的吧没关注 → 自动关注（否则签到会被「未加入此吧」挡住）
  autoReply: false,
  replyPerDay: 3,
  replyGapSec: 30,
  signHour: 9,
  // 人设：写在这里，或者指一个外部文件
  personaText: '',
  personaFile: '',
  // 日记：总闸 + 私人日记单独一把锁
  diaryEnabled: true,
  diaryPrivate: true,
}

const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

export function normalize(raw = {}) {
  const bars = Array.isArray(raw.bars)
    ? raw.bars.map((s) => String(s).trim()).filter(Boolean)
    : String(raw.bars || '').split(/[\n,，]/).map((s) => s.trim()).filter(Boolean)
  return {
    bars: bars.length ? bars.slice(0, 20) : [...DEFAULTS.bars],
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean).slice(0, 50) : [],
    autoSign: raw.autoSign === true,
    autoFollow: raw.autoFollow !== false,
    personaText: String(raw.personaText || '').slice(0, 20000),
    personaFile: String(raw.personaFile || '').slice(0, 500),
    diaryEnabled: raw.diaryEnabled !== false,
    diaryPrivate: raw.diaryPrivate !== false,
    autoReply: raw.autoReply === true,
    replyPerDay: clampInt(raw.replyPerDay, 0, 20, DEFAULTS.replyPerDay),
    replyGapSec: clampInt(raw.replyGapSec, 10, 3600, DEFAULTS.replyGapSec),
    signHour: clampInt(raw.signHour, 0, 23, DEFAULTS.signHour),
  }
}

export function readConfig(override = {}) {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(configFile(), 'utf8')) } catch { /* 还没有配置文件 */ }
  // 优先级：磁盘里的 > 宿主传进来的 > 内置默认
  return normalize({ ...DEFAULTS, ...override, ...saved })
}

export function writeConfig(patch = {}) {
  const next = normalize({ ...readConfig(), ...patch })
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 1) + '\n', { mode: 0o600 })
  fs.chmodSync(configFile(), 0o600)
  return next
}

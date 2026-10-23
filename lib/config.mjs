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
  // 默认不刷任何吧：必须用户自己填（贴吧名称差异大，猜错就白跑）
  bars: [],
  keywords: [],
  autoSign: false,
  autoFollow: true,   // 新加的吧没关注 → 自动关注（否则签到会被「未加入此吧」挡住）
  signAllFollowed: false,  // 签到时是否连「账号关注的所有吧」一起签
  evolvePersona: false,       // 人设演化：从吧里提炼语气样本，主人采纳才生效
  allowNewThread: false,      // 允许 AI 自己发新帖（默认关）
  newThreadPerDay: 1,         // 每天最多发几个帖
  allowImages: false,         // 允许 AI 发图（默认关）
  imagePostExperimental: false, // 实验：用 /mo/q/apubpost + upload_img_info 真发图（未验证）
  imagePerDay: 10,            // 每天最多发几张图
  autoReply: false,
  answerQuestions: true,   // 允许回帖里解答别人的疑问
  toneGate: true,          // 拦「客服腔」（只拦几个词，不管长短）
  dedupeDays: 7,           // 读过的帖，多少天内不再推
  breakerMin: 30,          // 撞到验证码后熔断多少分钟（0 = 不熔断）
  requestGapMs: 1200,      // 两次请求的间隔（越小越快，越容易被风控）
  mention: '',             // 回帖时 @ 谁（贴吧昵称，留空不 @）
  mentionEvery: false,     // 每条回复都带上？默认关，只在需要时手动传
  autoRun: false,          // 每天自动跑一轮（headless 子进程）—— 默认关
  valleyOnly: true,        // 只在谷时跑（工作日 9-12 / 14-18 之外）
  peakValley: false,       // 峰谷自动刷（总开关，照刷B站的口径）
  noon: true,              // 峰谷子开关：午间谷 12-14
  night: true,             // 峰谷子开关：晚间谷 18-次日9
  runHour: 21,             // 几点后跑
  headlessProfile: 'headless',
  dshBin: '',              // 空 = 走 PATH 里的 dsh
  readPerRound: 5,   // 一轮最多读几个楼
  replyPerRound: 1,  // 一轮最多回几条
  replyPerDay: 5,   // 新装默认全天 5 条（想多回自己调）
  replyGapSec: 30,
  signHour: 9,
  // 人设：写在这里，或者指一个外部文件
  personaText: '',
  personaFile: '',
  styleSamples: '',        // 3~5 句「她平时怎么说话」的样本，回帖时照着学
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
    bars: bars.slice(0, 20),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String).filter(Boolean).slice(0, 50) : [],
    autoSign: raw.autoSign === true,
    autoFollow: raw.autoFollow !== false,
    signAllFollowed: raw.signAllFollowed === true,
    personaText: String(raw.personaText || '').slice(0, 20000),
    personaFile: String(raw.personaFile || '').slice(0, 500),
    styleSamples: String(raw.styleSamples || '').slice(0, 4000),
    diaryEnabled: raw.diaryEnabled !== false,
    diaryPrivate: raw.diaryPrivate !== false,
    evolvePersona: raw.evolvePersona === true,
    allowNewThread: raw.allowNewThread === true,
    newThreadPerDay: clampInt(raw.newThreadPerDay, 0, 10, DEFAULTS.newThreadPerDay),
    allowImages: raw.allowImages === true,
    imagePostExperimental: raw.imagePostExperimental === true,
    imagePerDay: clampInt(raw.imagePerDay, 0, 50, DEFAULTS.imagePerDay),
    autoReply: raw.autoReply === true,
    answerQuestions: raw.answerQuestions !== false,
    toneGate: raw.toneGate !== false,
    dedupeDays: clampInt(raw.dedupeDays, 1, 60, DEFAULTS.dedupeDays),
    breakerMin: clampInt(raw.breakerMin, 0, 720, DEFAULTS.breakerMin),
    requestGapMs: clampInt(raw.requestGapMs, 300, 5000, DEFAULTS.requestGapMs),
    mention: String(raw.mention || '').slice(0, 40),
    mentionEvery: raw.mentionEvery === true,
    autoRun: raw.autoRun === true,
    valleyOnly: raw.valleyOnly !== false,
    runHour: clampInt(raw.runHour, 0, 23, DEFAULTS.runHour),
    peakValley: raw.peakValley === true,
    noon: raw.noon !== false,
    night: raw.night !== false,
    headlessProfile: String(raw.headlessProfile || DEFAULTS.headlessProfile).slice(0, 40),
    dshBin: String(raw.dshBin || '').slice(0, 300),
    readPerRound: clampInt(raw.readPerRound, 1, 20, DEFAULTS.readPerRound),
    replyPerRound: clampInt(raw.replyPerRound, 0, 10, DEFAULTS.replyPerRound),
    replyPerDay: clampInt(raw.replyPerDay, 0, 30, DEFAULTS.replyPerDay),
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

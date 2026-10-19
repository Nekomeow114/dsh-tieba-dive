/**
 * lib/peak.mjs —— DeepSeek 峰谷口径（跟刷B站那边一致）
 *
 * 高峰：工作日 9:00–12:00 与 14:00–18:00（北京时间，按本机时区算）
 * 其余（含周末）都是谷时。
 *
 * 这里只管「什么时候适合跑」，不碰计费 —— 显示价格是 dsh-peak-chip 的活。
 */
const PEAK_WINDOWS = [[9, 12], [14, 18]]

export function isValley(now = new Date()) {
  const day = now.getDay()
  if (day === 0 || day === 6) return true          // 周末全谷时
  const h = now.getHours() + now.getMinutes() / 60
  return !PEAK_WINDOWS.some(([a, b]) => h >= a && h < b)
}

/** 下一次进入谷时是什么时候（给设置页显示用） */
export function nextValley(now = new Date()) {
  const t = new Date(now)
  for (let i = 0; i < 60 * 24 * 3; i++) {          // 最多找三天
    t.setMinutes(t.getMinutes() + 5)
    if (isValley(t)) return t
  }
  return null
}

export function peakLabel(now = new Date()) {
  return isValley(now) ? '谷时' : '高峰'
}

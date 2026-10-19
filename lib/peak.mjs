/**
 * lib/peak.mjs —— DeepSeek 峰谷口径 + 「谷时窗口」
 *
 * 高峰：工作日 9:00–12:00 与 14:00–18:00（本机时区）
 * 谷时窗口（用来触发自动刷）：
 *   · noon  = 12:00–14:00（午间谷）
 *   · night = 18:00–次日 09:00（晚间谷；跨零点）
 * 周末两天全天算谷时，两个窗口都开。
 */
const PEAK_WINDOWS = [[9, 12], [14, 18]]

export function isValley(now = new Date()) {
  const day = now.getDay()
  if (day === 0 || day === 6) return true
  const h = now.getHours() + now.getMinutes() / 60
  return !PEAK_WINDOWS.some(([a, b]) => h >= a && h < b)
}

/** 当前落在哪个谷时窗口：'noon' | 'night' | null */
export function currentWindow(now = new Date()) {
  if (!isValley(now)) return null
  const day = now.getDay()
  const h = now.getHours() + now.getMinutes() / 60
  if (day === 0 || day === 6) return h >= 12 && h < 18 ? 'noon' : 'night'
  if (h >= 12 && h < 14) return 'noon'
  if (h >= 18 || h < 9) return 'night'
  return null
}

export function nextValley(now = new Date()) {
  const t = new Date(now)
  for (let i = 0; i < 60 * 24 * 3; i++) {
    t.setMinutes(t.getMinutes() + 5)
    if (isValley(t)) return t
  }
  return null
}

export function peakLabel(now = new Date()) {
  return isValley(now) ? '谷时' : '高峰'
}

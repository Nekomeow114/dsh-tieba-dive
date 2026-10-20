/**
 * lib/time.mjs —— 本地日期/时间（别用 toISOString，那是 UTC）
 *
 * 教训：`new Date().toISOString().slice(0,10)` 在北京时间 0–8 点会返回「前一天」，
 * 导致「今天已回」在跨零点后 8 小时内都不清零。
 */
const pad = (n) => String(n).padStart(2, '0')

/** 本地日期 YYYY-MM-DD */
export function localToday(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地时间 YYYY-MM-DD HH:mm */
export function localStamp(d = new Date()) {
  return `${localToday(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

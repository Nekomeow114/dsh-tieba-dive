/**
 * lib/origin.mjs —— 同源判断（给本地 HTTP 接口用）
 *
 * 只比 hostname，不比端口：反代/端口映射下 Origin 与 Host 的端口经常不一致。
 * 回环地址（127.0.0.1 / localhost / [::1]）一律放行，方便本机 curl 和调试。
 */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function isSameOrigin(origin, host) {
  if (!origin) return true // curl / 同源 GET 可能没有 Origin
  let o, h
  try {
    o = new URL(origin)
  } catch { return false }
  try {
    h = new URL('http://' + String(host || ''))
  } catch { return false }
  if (LOOPBACK.has(o.hostname) && LOOPBACK.has(h.hostname)) return true
  return o.hostname === h.hostname
}

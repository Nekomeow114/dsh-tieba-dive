/**
 * lib/round-state.mjs —— 「这一轮还在跑吗」的纯函数
 *
 * 背景：一轮的生命周期跨进程（父进程起 dsh → dsh 再起 node → 插件在里面跑），
 * 进程句柄靠不住、心跳又会晚到。这里把判断抽成纯函数，配单测，别再靠猜。
 */
export const GRACE_MS = 90_000   // 刚启动的宽限期：这段时间无条件认为在跑
export const HB_FRESH_MS = 90_000 // 心跳多久算新鲜

/**
 * @param {{running:boolean, startedAt:number, hbAt:number, now?:number}} s
 * @returns {boolean} 这一轮是否还在跑
 */
export function roundAlive({ running, startedAt = 0, hbAt = 0, now = Date.now() }) {
  if (!running) return false
  if (startedAt > 0 && now - startedAt < GRACE_MS) return true   // 宽限期
  return hbAt > 0 && now - hbAt < HB_FRESH_MS                    // 之后看心跳
}

/**
 * lib/toolkit.mjs —— `defineTool` 的取法
 *
 * 宿主（桌面版 / web profile）不一定把 `dsh-tools` 暴露成能直接 import 的依赖
 * （刷B站那个插件就踩过：桌面版 profile 是 autoInstallPeers:false，peer 永远不装）。
 * 所以：先试宿主那棵树，拿不到就用一个**本地等价实现** —— 只要返回的对象形状对，
 * 宿主自己会补默认值，工具照样能注册。
 */
let defineTool = (spec) => spec

try {
  const m = await import('dsh-tools')
  if (typeof m.defineTool === 'function') defineTool = m.defineTool
} catch { /* 宿主没给，就用本地那份 */ }

export { defineTool }

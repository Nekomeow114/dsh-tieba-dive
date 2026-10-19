/**
 * lib/toolkit.mjs —— `defineTool` 的取法 + 参数/输出的兜底
 *
 * 三个坑，都在这一个文件里解决：
 *  1. 宿主不一定把 `dsh-tools` 暴露成能 import 的依赖（桌面版 / headless 都可能没有）；
 *  2. 新版宿主要求每个工具声明 `output { schema, render }`，否则注册失败；
 *  3. 宿主原生的 defineTool 会把「参数映射」转成 JSON Schema；咱的兜底没有这层转换，
 *     所以兜底时要自己转 —— 否则模型调用时报
 *     `Invalid schema ... got 'type: null'`。
 */
let base = (spec) => spec
let usingHost = false

try {
  const m = await import('dsh-tools')
  if (typeof m.defineTool === 'function') { base = m.defineTool; usingHost = true }
} catch { /* 宿主没给，就用本地那份 */ }

export const textOutput = {
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
}

/** 参数映射 → JSON Schema（宿主原生那层转换的等价物） */
export function toJsonSchema(params) {
  if (!params) return { type: 'object', properties: {}, required: [] }
  if (params.type === 'object') return params
  const props = {}
  const required = []
  for (const [key, val] of Object.entries(params)) {
    if (!val || typeof val !== 'object') continue
    props[key] = { ...val }
    required.push(key)
  }
  return { type: 'object', properties: props, required, additionalProperties: false }
}

export function defineTool(spec) {
  if (usingHost) return base({ output: textOutput, ...spec })
  return base({ output: textOutput, ...spec, parameters: toJsonSchema(spec.parameters) })
}

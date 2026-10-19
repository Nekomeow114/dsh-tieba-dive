/**
 * lib/tone.mjs —— 很轻的「客服腔」判定
 *
 * 只拦一眼就露馅的词，不管句子长短、不管自称。
 * 单独拆出来是为了能离线测：`node test/gates.mjs` 直接调纯函数。
 */
export const CLIENT_WORDS = [
  '首先', '其次', '综上所述', '综上', '总而言之',
  '希望对你有帮助', '希望能帮到你', '如有疑问', '请随时',
  '建议您', '以上是', '此外',
]

export function toneCheck(text) {
  const s = String(text ?? '')
  return CLIENT_WORDS.filter((w) => s.includes(w))
}

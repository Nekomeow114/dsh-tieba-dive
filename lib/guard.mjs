/**
 * lib/guard.mjs —— 出站内容过滤
 *
 * 目的：模型可能被帖子里的文字诱导，把本机路径、链接、账号信息写进公开回复。
 * 这不是「内容审查」，只挡三类最危险的东西：
 *   1. 本机路径（/root、~/.dsh、C:\、/home/…）
 *   2. 链接（http/https/file/ftp）—— 贴吧回复带链接最容易被吞、也最像广告
 *   3. 明显的凭证字样（BDUSS、token、password）
 *
 * 正常文本、「@昵称」、表情不受影响。
 */
const PATTERNS = [
  { re: /(^|[\s(（])(~?\/[A-Za-z0-9_.-]+){2,}/, why: '本机路径' },
  { re: /\b[A-Za-z]:\\[^\s]+/, why: 'Windows 路径' },
  { re: /\bhttps?:\/\/|\bfile:\/\/|\bftp:\/\//i, why: '链接' },
  { re: /\b(bduss|token|password|passwd)\b/i, why: '凭证字样' },
  { re: /\.dsh\b|\/root\b|\/home\/[A-Za-z0-9_-]+/i, why: '本机路径' },
]

export function checkOutbound(text) {
  const s = String(text || '')
  const hits = []
  for (const p of PATTERNS) if (p.re.test(s)) hits.push(p.why)
  return { ok: hits.length === 0, hits: [...new Set(hits)] }
}

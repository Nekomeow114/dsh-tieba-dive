/**
 * lib/subreply.mjs —— 判断一条楼中楼是否在「咱自己那条评论」下面
 *
 * 手机版 HTML 里主楼没有 pid，所以用「咱回过的正文」去匹配楼层，
 * 再看这条楼中楼的 floor 是否等于该楼层号。
 */
const norm = (s) => String(s || '').replace(/\s+/g, '')

export function findMyFloor({ floors = [], subReplies = [], myContent = '', pid = '' } = {}) {
  const needle = norm(myContent).slice(0, 10)
  if (needle.length < 2) return { ok: false, error: '没有咱那条评论的正文记录，没法确认楼中楼归属' }
  const idx = floors.findIndex((f) => norm(f).includes(needle))
  if (idx < 0) return { ok: false, error: '在帖子里找不到咱那条评论（可能被删了，或正文变了）' }
  const sub = subReplies.find((s) => String(s.pid) === String(pid))
  if (!sub) return { ok: false, error: '没有这条楼中楼（pid 对不对？）' }
  if (Number(sub.floor) !== idx + 1) {
    return { ok: false, error: '这条楼中楼不在咱的评论下面——只回自己评论里的楼' }
  }
  return { ok: true, floor: idx + 1, sub }
}

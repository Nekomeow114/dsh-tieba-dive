/**
 * lib/tieba.js —— 贴吧读取 + 有限写（签到 / 回帖）
 *
 * ⚠️ 两个「为什么」：
 *
 * 1) **为什么不用官方 API**：老的开放接口早已下线，剩下的接口要签名；
 *    电脑版 `/f?kw=` 对陌生 UA 直接 302/403，手机版给的是「贴吧小程序」空壳；
 *    ✅ 实测只有手机版页面 `/mo/q/m?kw=` `/mo/q/m?kz=` 能稳定拿到内容。
 *
 * 2) **为什么用 curl 而不是 fetch**：百度认 TLS 指纹。同一串 BDUSS、同一组 header，
 *    curl → `{"is_login":1}`；node 的 fetch(undici) → `{"is_login":0}`。
 *    所以网络层交给 curl，cookie 只从 jar 文件读 —— **不进 argv**，ps 里看不到。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'

export const UA =
  'Mozilla/5.0 (Linux; Android 13; V2425A) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

const BASE = 'https://tieba.baidu.com'
let lastAt = 0
let GAP_MS = 1200          // 两次请求之间至少隔多久（配置项 requestGapMs）
const FID = new Map()      // 吧名 → fid，省掉一次列表请求
let TBS = { value: '', at: 0 }

export function setGap(ms) {
  const n = Number(ms)
  if (Number.isFinite(n)) GAP_MS = Math.max(300, Math.min(5000, Math.round(n)))
}
export const getGap = () => GAP_MS
export function cacheFid(kw, fid) { if (kw && fid) FID.set(String(kw), String(fid)) }
export function cachedFid(kw) { return FID.get(String(kw)) || '' }

export function homeDir() {
  const h = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(h, 'tieba-duty')
}
export const cookieFile = () => path.join(homeDir(), 'cookie.txt')
export const jarFile = () => path.join(homeDir(), 'jar.txt')

export function setCookie(raw) {
  let v = String(raw || '').replace(/\s+/g, '')
  if (!v) throw new Error('空着就点保存了，粘贴一下 BDUSS')
  // 用户经常只复制「值」，不带 BDUSS= 前缀 —— 这里自动补，别让前缀把人卡住
  if (/^(ssh-|-----BEGIN)/i.test(v)) {
    throw new Error('这是 SSH 公钥（GitHub 用的），不是贴吧的 BDUSS —— BDUSS 要去贴吧的 cookie 里拿')
  }
  if (!/BDUSS=/i.test(v)) {
    if (!/^[A-Za-z0-9_\-+/=]{40,}$/.test(v)) {
      throw new Error(`这串看着不像 BDUSS（长度 ${v.length}）—— 复制「Cookie Value」那一整串，前缀有没有都行`)
    }
    v = 'BDUSS=' + v
  }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(cookieFile(), v + '\n', { mode: 0o600 })
  fs.chmodSync(cookieFile(), 0o600)
  try { fs.unlinkSync(jarFile()) } catch { /* 没有就算了 */ }
  syncJar()
}
export function getCookie() {
  try { return fs.readFileSync(cookieFile(), 'utf8').trim() } catch { return '' }
}
export const hasCookie = () => /BDUSS=/.test(getCookie())
export function clearCookie() {
  try { fs.unlinkSync(cookieFile()) } catch { /* 本来就没有 */ }
  try { fs.unlinkSync(jarFile()) } catch { /* 本来就没有 */ }
}

/** 把 cookie.txt 里的键值补进 Netscape 格式的 jar（curl -b/-c 用） */
function syncJar() {
  if (!hasCookie()) return
  const need = getCookie().split(';').map((x) => x.trim()).filter(Boolean)
  let lines = []
  try { lines = fs.readFileSync(jarFile(), 'utf8').split('\n').filter(Boolean) } catch { /* 新 jar */ }
  const have = new Set(lines.map((l) => l.split('\t')[5]))
  for (const kv of need) {
    const [k, ...rest] = kv.split('=')
    if (!k || have.has(k)) continue
    lines.push(`.baidu.com\tTRUE\t/\tFALSE\t4102444800\t${k}\t${rest.join('=')}`)
  }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(jarFile(), lines.join('\n') + '\n', { mode: 0o600 })
  fs.chmodSync(jarFile(), 0o600)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function curl(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('curl', args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, out, err }))
  })
}

async function req(url, { method = 'GET', form, referer } = {}) {
  const gap = Date.now() - lastAt
  if (gap < GAP_MS) await sleep(GAP_MS - gap)
  lastAt = Date.now()
  syncJar()

  const args = ['-s', '-L', '--max-time', '25', '-A', UA,
    '-b', jarFile(), '-c', jarFile(),
    '-H', 'Accept-Language: zh-CN,zh;q=0.9',
    '-H', `Referer: ${referer || BASE + '/'}`]
  if (form) for (const [k, v] of Object.entries(form)) args.push('--data-urlencode', `${k}=${v}`)
  if (method !== 'GET') args.unshift('-X', method)
  args.push(url)

  const { code, out, err } = await curl(args)
  if (code !== 0) throw new Error(`curl 失败（code ${code}）：${err.slice(0, 120)}`)
  if (/百度安全验证/.test(out)) {
    const e = new Error('被百度安全验证拦了：BDUSS 可能失效，或出口 IP 要滑块')
    e.code = 'BLOCKED'
    throw e
  }
  return { status: 200, text: out }
}

/** tbs 是签到/回帖都要的令牌，顺便验证 cookie 还活着 */
async function tbs() {
  if (TBS.value && Date.now() - TBS.at < 10 * 60_000) return TBS.value
  const { text } = await req(`${BASE}/dc/common/tbs`)
  let j
  try { j = JSON.parse(text) } catch { throw new Error('tbs 没返回 JSON（多半被拦了）') }
  if (String(j.is_login) !== '1') {
    const e = new Error('BDUSS 没被认成登录态（is_login=0）—— 可能已过期')
    e.code = 'NOT_LOGIN'
    throw e
  }
  TBS = { value: j.tbs, at: Date.now() }
  return j.tbs
}

export async function whoami() {
  if (!hasCookie()) return { loggedIn: false, hint: '设置页里先贴 BDUSS' }
  const t = await tbs()
  return { loggedIn: true, tbs: t, cookieFile: cookieFile(), jarFile: jarFile() }
}

/** 纯解析：吧列表（单独导出 → 测试里拿离线 HTML 跑，不联网） */
export function parseList(text) {
  const fid = /fid=(\d+)/.exec(text)?.[1] || ''
  const out = []
  const seen = new Set()
  const re = /<a[^>]+href="\/p\/(\d+)[^"]*"[^>]*>(.*?)<\/a>/gs
  let m
  while ((m = re.exec(text))) {
    const id = m[1]
    const title = decode(m[2]).replace(/\s+/g, ' ').trim()
    if (!title || seen.has(id)) continue
    seen.add(id)
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 400)
    const num = /ti_num[^>]*>\s*(\d+)/.exec(tail)?.[1] || ''
    out.push({ id, title, reply: num })
  }
  const name = /<title>([^<]+)/.exec(text)?.[1]?.replace(/吧_百度贴吧.*/, '') || ''
  return { kw: name, fid, threads: out }
}

/** 纯解析：楼层正文 + 图 */
export function parseThread(text) {
  const title = /<title>([^<]+)/.exec(text)?.[1] || ''
  const floors = []
  const images = []
  const seenImg = new Set()
  const re = /<div class="([^"]*content[^"]*)"[^>]*>(.*?)<\/div>/gs
  let m
  while ((m = re.exec(text))) {
    if (m[1].includes('top_bar')) continue
    const body = m[2]
    const t = decode(body).replace(/\s+/g, ' ').trim()
    if (t) floors.push(t)
    // 图：帖子里一半的信息在图里（大肥鱼那种尤其），至少把 URL 捞出来
    const imgRe = /<img[^>]+(?:data-src|src)="([^"]+)"/g
    let im
    while ((im = imgRe.exec(body))) {
      let u = im[1].replace(/&amp;/g, '&')
      if (u.startsWith('//')) u = 'https:' + u
      if (!/^https?:\/\//.test(u)) continue
      // 表情/编辑器素材不是「帖子配图」，滤掉
      if (/\/editor\/images\/|image_emoticon/.test(u)) continue
      if (seenImg.has(u)) continue
      seenImg.add(u)
      images.push(u)
    }
  }
  return { title, floors, images: images.slice(0, 20), imageCount: images.length }
}

export async function listBar(kw, { pn = 0 } = {}) {
  const { text } = await req(`${BASE}/mo/q/m?kw=${encodeURIComponent(kw)}&pn=${pn}`)
  const r = parseList(text)
  if (r.fid) cacheFid(kw, r.fid)
  return { kw: r.kw || kw, fid: r.fid, threads: r.threads }
}

export async function readThread(tid, { pn = 1 } = {}) {
  const { text } = await req(`${BASE}/mo/q/m?kz=${tid}&pn=${pn}`, { referer: `${BASE}/p/${tid}` })
  return { tid, ...parseThread(text) }
}

/** 贴吧 app 端签名：md5(按 key 排序的 "k=v" 拼接 + "tiebaclient!!!") */
function appSign(params) {
  const keys = Object.keys(params).sort()
  const raw = keys.map((k) => `${k}=${params[k]}`).join('')
  return crypto.createHash('md5').update(raw).update('tiebaclient!!!').digest('hex')
}

/** 走 app 接口（tiebac 域名 + 签名），关注/取关这类操作只有这条路通 */
async function appPost(path, params) {
  const gap = Date.now() - lastAt
  if (gap < GAP_MS) await sleep(GAP_MS - gap)
  lastAt = Date.now()
  const body = { ...params, sign: appSign(params) }
  const args = ['-s', '-L', '--max-time', '25',
    '-A', 'bdtb for Android 12.60.1.0',
    '-H', 'Content-Type: application/x-www-form-urlencoded']
  for (const [k, v] of Object.entries(body)) args.push('--data-urlencode', `${k}=${v}`)
  args.push(`https://tiebac.baidu.com${path}`)
  const { code, out, err } = await curl(args)
  if (code !== 0) throw new Error(`curl 失败（${code}）：${err.slice(0, 100)}`)
  let j
  try { j = JSON.parse(out) } catch { throw new Error(`app 接口返回不是 JSON：${out.slice(0, 120)}`) }
  return j
}

/** 这个吧关注了没（从吧页面读 is_like） */
export async function isFollowing(kw) {
  const { text } = await req(`${BASE}/mo/q/m?kw=${encodeURIComponent(kw)}`)
  const m = /"is_like"\s*:\s*"?([01])"?/.exec(text)
  return m ? m[1] === '1' : false
}

/** 关注一个吧（fid 可以从 listBar 拿，也可以直接传） */
export async function follow(kw, fid) {
  const bar = fid ? { fid } : (cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw))
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid`)
  const t = await tbs()
  const j = await appPost('/c/c/forum/like', { BDUSS: getCookie().replace(/^BDUSS=/, ''), fid: bar.fid, tbs: t })
  const errno = Number(j?.error?.errno ?? j?.error_code ?? 0)
  if (errno !== 0) throw new Error(j?.error?.errmsg || j?.error_msg || `关注失败（${errno}）`)
  return { ok: true, kw, fid: bar.fid }
}

/** 取关（给测试和「反悔」用） */
export async function unfollow(kw, fid) {
  const bar = fid ? { fid } : (cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw))
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid`)
  const t = await tbs()
  const j = await appPost('/c/c/forum/unfavolike', { BDUSS: getCookie().replace(/^BDUSS=/, ''), fid: bar.fid, tbs: t })
  const errno = Number(j?.error?.errno ?? j?.error_code ?? 0)
  if (errno !== 0) throw new Error(j?.error?.errmsg || j?.error_msg || `取关失败（${errno}）`)
  return { ok: true, kw, fid: bar.fid }
}

/** 关注 + 签到：没关注先关注，然后再签（签到要求先入吧） */
export async function followAndSign(kw, { autoFollow = true, fid } = {}) {
  const already = await isFollowing(kw)
  let followed = already
  if (!already) {
    if (!autoFollow) return { ok: false, kw, error: '还没关注这个吧，且配置里没开自动关注' }
    await follow(kw, fid)
    followed = true
  }
  const r = await sign(kw)
  return { ...r, followed, wasFollowing: already }
}

export async function sign(kw) {
  const t = await tbs()
  const { text } = await req(`${BASE}/sign/add`, {
    method: 'POST',
    form: { ie: 'utf-8', kw, tbs: t },
    referer: `${BASE}/f?kw=${encodeURIComponent(kw)}`,
  })
  let j
  try { j = JSON.parse(text) } catch { return { ok: false, raw: text.slice(0, 200) } }
  if (Number(j.no) !== 0 || Number(j.data?.errno) !== 0) {
    return { ok: false, kw, msg: j.data?.errmsg || j.error || '签到失败' }
  }
  return { ok: true, kw, count: j.data?.current_rank_info?.sign_count ?? null }
}

export async function reply({ kw, tid, content, pid }) {
  const text = String(content || '').trim()
  if (text.length < 4) throw new Error('回复太短（至少 4 个字）')
  if (text.length > 400) throw new Error('回复太长（先压到 400 字内）')
  const bar = cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw)
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid（吧名对不对？）`)
  const t = await tbs()
  const { text: body } = await req(`${BASE}/f/commit/post/add`, {
    method: 'POST',
    form: { ie: 'utf-8', kw, fid: bar.fid, tid, tbs: t, files: '[]', content: text,
      // pid = 被回复的楼层/评论 id，楼中楼走这条（贴吧没有独立接口，实验性）
      ...(pid ? { pid: String(pid) } : {}) },
    referer: `${BASE}/p/${tid}`,
  })
  let j
  try { j = JSON.parse(body) } catch { return { ok: false, raw: body.slice(0, 200) } }
  const no = Number(j.no ?? -1)
  return no === 0
    ? { ok: true, kw, tid, fid: bar.fid, visible: j.data?.is_post_visible !== 0 }
    : { ok: false, no, error: j.error || j.err_code || '发帖失败' }
}

function decode(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
}

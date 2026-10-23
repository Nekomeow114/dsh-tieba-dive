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
import { remainingMs, trip, readCooldown, clearCooldown, cooldownFile, DEFAULT_MINUTES } from './cooldown.mjs'

export const UA =
  'Mozilla/5.0 (Linux; Android 13; V2425A) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

const BASE = 'https://tieba.baidu.com'
let lastAt = 0
let GAP_MS = 1200
let BREAKER_MIN = DEFAULT_MINUTES
let CURL_BIN = 'curl'
export function setCurlBin(bin) { if (bin) CURL_BIN = String(bin) }
export const getCurlBin = () => CURL_BIN          // 两次请求之间至少隔多久（配置项 requestGapMs）
const FID = new Map()      // 吧名 → fid，省掉一次列表请求
let TBS = { value: '', at: 0 }

export function setGap(ms) {
  const n = Number(ms)
  if (Number.isFinite(n)) GAP_MS = Math.max(300, Math.min(5000, Math.round(n)))
}
export const getGap = () => GAP_MS
export function setBreakerMinutes(min) { const n = Number(min); if (Number.isFinite(n)) BREAKER_MIN = Math.max(0, Math.min(720, Math.round(n))) }
export { readCooldown, clearCooldown, cooldownFile }
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

function curlBuffer(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(CURL_BIN, args)
    const out = [], err = []
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => err.push(d))
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err) }))
  })
}

function curl(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(CURL_BIN, args)
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, out, err }))
  })
}

async function req(url, { method = 'GET', form, referer } = {}) {
  // 熔断期内一个请求都不发（撞过一次验证码之后）
  const left = remainingMs()
  if (left > 0) {
    const e = new Error(`风控熔断中：还要等 ${Math.ceil(left / 60000)} 分钟（上次撞到百度安全验证）`)
    e.code = 'COOLDOWN'
    throw e
  }
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
    const t = trip(BREAKER_MIN, '百度安全验证')
    const e = new Error(`被百度安全验证拦了（已熔断 ${BREAKER_MIN} 分钟）：BDUSS 可能失效，或出口 IP 要滑块`)
    e.code = 'BLOCKED'
    e.cooldownUntil = t.until
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
  const kw = /"fname"\s*:\s*"([^"]+)"/.exec(text)?.[1] || /[?&]kw=([^&"]+)/.exec(text)?.[1] || ''
  const floors = []
  const floorAt = []
  const images = []
  const seenImg = new Set()
  const re = /<div class="([^"]*content[^"]*)"[^>]*>(.*?)<\/div>/gs
  let m
  while ((m = re.exec(text))) {
    if (m[1].includes('top_bar')) continue
    const body = m[2]
    const t = decode(body).replace(/\s+/g, ' ').trim()
    if (t) { floorAt.push(m.index); floors.push(t) }
    // 图：两种形态 —— 直接 <img src>，或懒加载占位 div 的 data-url
    const pushImg = (raw) => {
      let u = String(raw || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      const inner = /[?&]src=([^&]+)/.exec(u)
      if (inner) { try { u = decodeURIComponent(inner[1]) } catch { /* 保留原样 */ } }
      if (u.startsWith('//')) u = 'https:' + u
      if (!/^https?:\/\//.test(u)) return
      if (/\/editor\/images\/|image_emoticon/.test(u)) return
      if (seenImg.has(u)) return
      seenImg.add(u)
      images.push(u)
    }
    const imgRe = /<img[^>]+(?:data-src|src)="([^"]+)"/g
    let im
    while ((im = imgRe.exec(body))) pushImg(im[1])
    const lazyRe = /data-url=['"]([^'"]+)['"]/g
    while ((im = lazyRe.exec(body))) pushImg(im[1])
  }
  // 高互动楼层：手机版读不到赞数，用「楼中楼数量」当互动信号（页面里 data-list-count）
  const frRe = /<div class="fr_list[^"]*"[^>]*data-list-count="(\d+)"/g
  const fr = []
  let fm
  while ((fm = frRe.exec(text))) fr.push({ at: fm.index, n: Number(fm[1]) || 0 })
  const hotFloors = []
  for (let i = 0; i < floors.length; i++) {
    const from = floorAt[i]
    const to = i + 1 < floorAt.length ? floorAt[i + 1] : text.length
    const rec = fr.find((x) => x.at > from && x.at < to)
    if (rec && rec.n > 0) hotFloors.push({ floor: i + 1, replies: rec.n, text: floors[i] })
  }
  hotFloors.sort((a, b) => b.replies - a.replies)
  return { title, kw, floors, hotFloors: hotFloors.slice(0, 5), images: images.slice(0, 20), imageCount: images.length }
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
export async function appPost(path, params) {
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

/**
 * 当前账号关注了哪些吧。
 * 走 app 接口 /c/f/forum/like，friend_uid=0 表示「我自己」（实测可用）。
 */
export async function followedForums({ pages = 5, pageSize = 200 } = {}) {
  const names = []
  for (let pn = 1; pn <= pages; pn++) {
    const j = await appPost('/c/f/forum/like', {
      BDUSS: getCookie().replace(/^BDUSS=/, ''),
      _client_version: '12.60.1.0',
      friend_uid: '0',
      page_no: String(pn),
      page_size: String(pageSize),
    })
    const code = Number(j?.error_code ?? 0)
    if (code !== 0) throw new Error(j?.error_msg || `拉取关注列表失败（${code}）`)
    const fl = j?.forum_list || {}
    const rows = [...(fl['non-gconforum'] || []), ...(fl.gconforum || [])]
    for (const r of rows) if (r?.name && !names.includes(r.name)) names.push(r.name)
    if (!Number(j?.has_more)) break
  }
  return names
}

/**
 * 上传一张图到贴吧图床（手机版接口，已验证可返回 imageInfo）
 * 返回 { ok, imageInfo, imageSrc }；不发帖，只上传。
 */
/** 构造手机版带图回帖的表单字段（纯函数，方便测） */
export function buildImageReplyFields({ kw, tid, fid, tbs, content, imageInfo, now = Date.now() }) {
  return {
    co: String(content || ''),
    _t: String(now),
    tag: '11',
    upload_img_info: String(imageInfo || ''),
    fid: String(fid),
    src: '1',
    word: String(kw),
    tbs: String(tbs),
    z: String(tid),
    lp: '6026',
  }
}

/**
 * 手机版带图回帖（实验）：/mo/q/apubpost + upload_img_info
 * 未验证 _BSK 等字段，失败就抛错，由调用方降级。
 */
export async function replyWithImage({ kw, tid, content, imageInfo }) {
  const bar = cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw)
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid`)
  const t = await tbs()
  const form = buildImageReplyFields({ kw, tid, fid: bar.fid, tbs: t, content, imageInfo })
  const { text } = await req(`${BASE}/mo/q/apubpost`, {
    method: 'POST', form, referer: `${BASE}/p/${tid}`,
  })
  let j
  try { j = JSON.parse(text) } catch { return { ok: false, raw: text.slice(0, 200) } }
  const no = Number(j.no ?? -1)
  return no === 0 ? { ok: true, no: 0, data: j.data } : { ok: false, no, error: j.error || '带图回帖失败' }
}

// ── 最小 protobuf：app 端「热门回复」接口（只看 agree / floor / text）────────
const pbVarint = (n) => {
  const out = []
  let v = BigInt(Math.trunc(Number(n)))   // tid 超过 2^32，必须用 BigInt
  while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n }
  out.push(Number(v))
  return Buffer.from(out)
}
const pbTag = (no, wire) => pbVarint((no << 3) | wire)
const pbInt = (no, n) => Buffer.concat([pbTag(no, 0), pbVarint(n)])
const pbStr = (no, s) => { const b = Buffer.from(String(s)); return Buffer.concat([pbTag(no, 2), pbVarint(b.length), b]) }
const pbMsg = (no, b) => Buffer.concat([pbTag(no, 2), pbVarint(b.length), b])

export function encodePageReq({ tid, pn = 1, rn = 30, sort = 1, bduss = '' }) {
  const common = Buffer.concat([
    pbInt(1, 2),                    // _client_type = 2
    pbStr(2, '12.64.1.1'),          // _client_version
    pbStr(10, bduss),               // BDUSS
  ])
  const data = Buffer.concat([
    pbMsg(25, common), pbInt(4, tid), pbInt(5, 0), pbInt(6, sort),
    pbInt(13, rn), pbInt(18, pn), pbInt(8, 0), pbInt(9, 0), pbInt(74, 1),
  ])
  return pbMsg(1, data)
}

function pbReadVarint(buf, pos) {
  let v = 0n, shift = 0n, p = pos
  while (p < buf.length) {
    const b = buf[p++]
    v |= BigInt(b & 127) << shift
    if (!(b & 128)) return { v: Number(v), p }
    shift += 7n
    if (shift > 63n) break
  }
  return { v: 0, p }
}

function pbFields(buf) {
  const out = []
  let p = 0
  while (p < buf.length) {
    const t = pbReadVarint(buf, p); if (t.p === p) break
    const no = Math.floor(t.v / 8), wire = t.v & 7
    p = t.p
    if (wire === 0) { const r = pbReadVarint(buf, p); out.push({ no, wire, v: r.v }); p = r.p }
    else if (wire === 2) {
      const l = pbReadVarint(buf, p); p = l.p
      out.push({ no, wire, b: buf.subarray(p, p + l.v) }); p += l.v
    } else if (wire === 1) p += 8
    else if (wire === 5) p += 4
    else break
  }
  return out
}

const pbText = (buf) => {
  const parts = []
  for (const f of pbFields(buf)) if (f.no === 2 && f.b) parts.push(f.b.toString('utf8'))
  return parts.join('').trim()
}

export function parsePageResponse(buf) {
  const posts = []
  for (const top of pbFields(buf)) {
    if (top.no !== 2 || !top.b) continue
    for (const d of pbFields(top.b)) {
      if (d.no !== 6 || !d.b) continue
      let floor = 0, likes = 0, subs = 0, text = ''
      for (const f of pbFields(d.b)) {
        if (f.no === 3 && f.wire === 0) floor = f.v
        else if (f.no === 13 && f.wire === 0) subs = f.v
        else if (f.no === 37 && f.b) {
          for (const a of pbFields(f.b)) if (a.no === 1 && a.wire === 0) likes = a.v
        } else if (f.no === 5 && f.b) text += pbText(f.b)
      }
      if (floor) posts.push({ floor, likes, replies: subs, text: text.slice(0, 200) })
    }
  }
  return posts
}

/**
 * 真正的「热门回复」：app 端 protobuf 接口，r=1 按热度排序，带 agree_num。
 * 失败就抛错，由调用方退回手机版页面。
 */
export async function hotReplies(tid, { rn = 30, pn = 1 } = {}) {
  syncJar()
  const req = encodePageReq({ tid: Number(tid), pn, rn, sort: 1, bduss: getCookie().replace(/^BDUSS=/, '') })
  const tmp = path.join(homeDir(), `.pb-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`)
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(tmp, req, { mode: 0o600 })
  try {
    const { code, out, err } = await curlBuffer([
      '-s', '--compressed', '--max-time', '25', '-X', 'POST',
      '-A', 'aiotieba/4.8.1',
      '-H', 'x_bd_data_type: protobuf',
      '-H', 'Host: tiebac.baidu.com',
      '-F', `data=@${tmp};filename=file`,
      `${BASE.replace('tieba.baidu.com', 'tiebac.baidu.com')}/c/f/pb/page?cmd=302001`,
    ])
    if (code !== 0) throw new Error(`热门回复请求失败（curl ${code}）：${err.toString().slice(0, 80)}`)
    const posts = parsePageResponse(out).sort((a, b) => b.likes - a.likes)
    if (!posts.length) throw new Error('热门回复为空')
    return posts
  } finally { try { fs.unlinkSync(tmp) } catch { /* ignore */ } }
}

/** 解析图床返回（手机版返回一段 JS，不是 JSON） */
export function parseUploadResponse(text) {
  const out = String(text || '')
  const info = /imageInfo:'([^']+)'/.exec(out)?.[1] || ''
  const src = /imageSrc:'([^']+)'/.exec(out)?.[1] || ''
  if (!info) return { ok: false, error: /图片上传失败/.test(out) ? '贴吧图床拒绝上传（可能被风控）' : '图床返回里没有 imageInfo' }
  return { ok: true, imageInfo: info, imageSrc: src.replace(/\\\//g, '/') }
}

export async function uploadImage(filePath, kw = 'deepseek') {
  syncJar()
  const args = [
    '-s', '--max-time', '30',
    '-A', 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    '-b', jarFile(), '-c', jarFile(),
    '-e', `${BASE}/mo/q/m?kw=${encodeURIComponent(kw)}`,
    '-F', `pic=@${filePath}`,
    '-F', `forum_name=${kw}`,
    `${BASE}/mo/q/cooluploadpic?r=${Date.now()}`,
  ]
  const { code, out, err } = await curl(args)
  if (code !== 0) throw new Error(`上传失败（curl ${code}）：${err.slice(0, 100)}`)
  return parseUploadResponse(out)
}

/** 构造发帖表单（纯函数） */
export function buildThreadFields({ kw, fid, tbs, title, content }) {
  return {
    ie: 'utf-8', kw: String(kw), fid: String(fid), tbs: String(tbs),
    title: String(title), content: String(content),
    rich_text: '1', __type__: 'thread',
  }
}

/** 发一个新帖（只发文字；图片暂不支持） */
export async function createThread({ kw, title, content }) {
  const t = String(title || '').trim()
  const c = String(content || '').trim()
  if (t.length < 4) throw new Error('标题太短（至少 4 个字）')
  if (t.length > 30) throw new Error('标题太长（压到 30 字内）')
  if (c.length < 10) throw new Error('正文太短（至少 10 个字）')
  if (c.length > 2000) throw new Error('正文太长（压到 2000 字内）')
  const bar = cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw)
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid`)
  const tbsV = await tbs()
  const { text } = await req(`${BASE}/f/commit/thread/add`, {
    method: 'POST',
    form: buildThreadFields({ kw, fid: bar.fid, tbs: tbsV, title: t, content: c }),
    referer: `${BASE}/f?kw=${encodeURIComponent(kw)}`,
  })
  let j
  try { j = JSON.parse(text) } catch { return { ok: false, raw: text.slice(0, 200) } }
  const no = Number(j.no ?? -1)
  return no === 0
    ? { ok: true, kw, fid: bar.fid, tid: j.data?.tid ? String(j.data.tid) : '', pid: j.data?.pid ? String(j.data.pid) : '' }
    : { ok: false, no, error: j.error || j.err_code || '发帖失败' }
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

export async function reply({ kw, tid, content }) {
  const text = String(content || '').trim()
  if (text.length < 4) throw new Error('回复太短（至少 4 个字）')
  if (text.length > 400) throw new Error('回复太长（先压到 400 字内）')
  const bar = cachedFid(kw) ? { fid: cachedFid(kw) } : await listBar(kw)
  if (!bar.fid) throw new Error(`拿不到 ${kw} 的 fid（吧名对不对？）`)
  const t = await tbs()
  const { text: body } = await req(`${BASE}/f/commit/post/add`, {
    method: 'POST',
    form: { ie: 'utf-8', kw, fid: bar.fid, tid, tbs: t, files: '[]', content: text },
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

/**
 * lib/runner.mjs —— 跑一轮（headless 子进程）
 *
 * 为什么不用插件自己的定时器直接生成：日报要模型写，插件里没有模型。
 * 所以到点后起一个 `dsh --profile headless "<prompt>"`，把 prompts/duty.md 交给它，
 * 输出全量写进日志，出问题能回看。
 *
 * 保守设计：
 *   · 默认关（autoRun=false），要用户自己开；
 *   · 一天只跑一次（state.lastRunDate）；
 *   · 20 分钟超时，超时杀掉；
 *   · 同一时间只允许一个（running 标志）；
 *   · 子进程的 stdout/stderr 全部落盘，不往宿主控制台灌。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homeDir } from './tieba.js'
import { localToday } from './time.mjs'
import { capabilitySection } from './integrations.mjs'

const lockFile = () => path.join(homeDir(), 'round.lock')

/** 抢锁：另一个进程正在跑就不许起（跨进程，重启也认） */
function acquireLock() {
  try {
    const j = JSON.parse(fs.readFileSync(lockFile(), 'utf8'))
    const pid = Number(j.pid)
    const fresh = Date.now() - Number(j.at || 0) < 30 * 60_000
    if (pid && fresh) {
      try { process.kill(pid, 0); return { ok: false, pid } } catch { /* 进程没了，可以接管 */ }
    }
  } catch { /* 没有锁 */ }
  fs.mkdirSync(homeDir(), { recursive: true })
  fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, at: Date.now() }), { mode: 0o600 })
  return { ok: true }
}

function releaseLock() {
  try {
    const j = JSON.parse(fs.readFileSync(lockFile(), 'utf8'))
    if (Number(j.pid) === process.pid) fs.unlinkSync(lockFile())
  } catch { /* ignore */ }
}

export const hbFile = () => path.join(homeDir(), 'hb.json')

/** headless 子进程里调用：每 20 秒写一次心跳 */
export function startHeartbeat(roundId = '') {
  const write = () => {
    try {
      fs.mkdirSync(homeDir(), { recursive: true })
      fs.writeFileSync(hbFile(), JSON.stringify({ pid: process.pid, at: Date.now(), roundId: String(roundId) }), { mode: 0o600 })
    } catch { /* ignore */ }
  }
  write()
  const t = setInterval(write, 20_000)
  const stop = () => { clearInterval(t); try { fs.unlinkSync(hbFile()) } catch { /* ignore */ } }
  process.on('exit', stop)
  return stop
}

/** 父进程用：最近一次心跳的时间戳（没有返回 0） */
export function heartbeatAt(roundId) {
  try {
    const j = JSON.parse(fs.readFileSync(hbFile(), 'utf8'))
    if (roundId && String(j.roundId || '') !== String(roundId)) return 0
    return Number(j.at) || 0
  } catch { return 0 }
}

/** 父进程用：心跳是否还新鲜（90 秒内） */
export function heartbeatFresh(ms = 90_000) {
  try {
    const j = JSON.parse(fs.readFileSync(hbFile(), 'utf8'))
    return Date.now() - Number(j.at || 0) < ms
  } catch { return false }
}

export const pluginDir = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const logsDir = () => path.join(homeDir(), 'logs')
export const logFile = (date = localToday()) =>
  path.join(logsDir(), `run-${date}.log`)

let current = null

/** 停止正在跑的这一轮（SIGTERM，3 秒后 SIGKILL） */
export function stopRound() {
  if (!current) return { ok: false, error: '当前没有在跑的轮次' }
  const c = current
  const killGroup = (sig) => {
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已经没了 */ }
      return
    }
    try { process.kill(-c.pid, sig) } catch { try { c.kill(sig) } catch { /* 已经没了 */ } }
  }
  killGroup('SIGTERM')
  setTimeout(() => { killGroup('SIGKILL'); try { fs.unlinkSync(hbFile()) } catch { /* ignore */ } }, 3000)
  return { ok: true, pid: c.pid }
}

export const isRunning = () => Boolean(current && current.exitCode === null && !current.killed)

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

const canExec = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false } }

/**
 * GUI 进程的 PATH 经常没有 dsh；这里按常见安装位置找绝对路径。
 * 顺序：显式配置 → node 同目录 → 常见全局 bin → nvm。
 */
export function resolveDshBin(explicit = '') {
  const want = String(explicit || '').trim()
  if (want && canExec(want)) return want   // 显式配置优先
  const cands = []
  const nodeDir = path.dirname(process.execPath)
  const home = os.homedir()
  if (process.platform === 'win32') {
    cands.push(path.join(nodeDir, 'dsh.cmd'), path.join(nodeDir, 'dsh.exe'))
    if (process.env.APPDATA) cands.push(path.join(process.env.APPDATA, 'npm', 'dsh.cmd'))
    if (process.env.NVM_SYMLINK) cands.push(path.join(process.env.NVM_SYMLINK, 'dsh.cmd'))
  } else {
    cands.push(
      path.join(nodeDir, 'dsh'),
      '/usr/local/bin/dsh', '/usr/bin/dsh', '/bin/dsh', '/opt/homebrew/bin/dsh',
      path.join(home, '.local/bin/dsh'), path.join(home, '.npm-global/bin/dsh'),
      path.join(home, '.volta/bin/dsh'), path.join(home, '.bun/bin/dsh'),
    )
    try {
      const base = path.join(home, '.nvm/versions/node')
      for (const v of fs.readdirSync(base)) cands.push(path.join(base, v, 'bin/dsh'))
    } catch { /* 没有 nvm */ }
  }
  for (const c of cands) if (canExec(c)) return c
  // 显式给了绝对路径但不存在时，仍然返回它，让日志暴露问题
  if (want && (path.isAbsolute(want) || want.includes(path.sep))) return want
  return want || 'dsh'
}

/** 等子进程心跳彻底停：先等它出现（最多 20 秒），出现后每 5 秒看一次 */
async function waitHeartbeatDone(spawnAt, deadline, roundId) {
  let seen = false
  while (Date.now() < deadline) {
    const at = heartbeatAt(roundId)
    if (at > spawnAt) seen = true
    if (seen && Date.now() - at > 90_000) return
    if (!seen && Date.now() - spawnAt > 20_000) return   // 旧版子进程不写心跳，别死等
    await sleepMs(5000)
  }
}

export function readLog({ date, lines = 200 } = {}) {
  const f = logFile(date)
  try {
    const raw = fs.readFileSync(f, 'utf8')
    return { ok: true, file: f, text: raw.split('\n').slice(-Math.max(20, lines)).join('\n').trim() }
  } catch { return { ok: false, file: f, error: '还没有运行日志' } }
}

function dutyPrompt() {
  try { return fs.readFileSync(path.join(pluginDir(), 'prompts', 'duty.md'), 'utf8') } catch { return '' }
}

/**
 * 起一轮。返回 Promise<{ok, code, log, timedOut}>；不会抛（错误也写进日志）。
 */
export function runRound({ profile = 'headless', dshBin = '', timeoutMs = 20 * 60_000, roundId = '' } = {}) {
  const prompt = [
    '你现在替使用者刷一轮贴吧。先 `tieba_settings` 看配置，再照下面的说明做。',
    '',
    dutyPrompt(),
    capabilitySection(),
  ].join('\n')

  const lock = acquireLock()
  if (!lock.ok) {
    return Promise.resolve({ ok: false, error: `另一个进程正在跑（pid ${lock.pid}），不重复起轮`, log: logFile() })
  }

  let bin = resolveDshBin(dshBin || process.env.DSH_BIN || '')
  let args = [profile, prompt]

  if (process.platform === 'win32') {
    // Windows 上 npm 装的 `dsh` 是 .cmd，Node 不能直接 spawn；而且长 prompt 里
    // 有换行和引号，塞进 cmd 命令行很容易被拆坏。⇒ prompt 落文件，命令行只传一句短说明。
    const pf = path.join(logsDir(), `prompt-${Date.now()}.md`)
    fs.mkdirSync(logsDir(), { recursive: true })
    fs.writeFileSync(pf, prompt, { mode: 0o600 })
    const instruction = `读取文件 ${pf} ，严格按那里的说明完成这一轮。`
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"'
    if (/\.(cmd|bat)$/i.test(bin) || !path.extname(bin)) {
      // Node 24 会对 cmd /c 的整串参数再做一层转义，导致 cmd 把带字面引号的路径当程序名。
      // 交给 shell: true 让 Node 自己包 cmd（见 issue #1 的最小复现）。
      bin = `${q(bin)} ${q(profile)} ${q(instruction)}`
      args = []
    } else {
      args = [profile, instruction]
    }
  }
  const spawnAt = Date.now()
  const deadline = spawnAt + timeoutMs + 120_000
  const f = logFile()
  fs.mkdirSync(logsDir(), { recursive: true })
  const fd = fs.openSync(f, 'a')
  fs.writeSync(fd, `\n===== ${new Date().toISOString()} 起一轮 =====\n$ ${bin} ${args.slice(0, 2).join(' ')} <prompt ${prompt.length} 字>\n`)

  return new Promise((resolve) => {
    let child
    try {
      // detached：页面退出 / 父进程正常结束，这一轮也能跑完
      child = spawn(bin, args, {
        cwd: process.env.DSH_WORKSPACE || os.homedir(),
        env: { ...process.env, TIEBA_DUTY_NO_SCHEDULE: '1', TIEBA_ROUND_ID: String(roundId) },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        shell: args.length === 0,
      })
      child.unref()
      current = child
    } catch (e) {
      fs.writeSync(fd, `spawn 失败：${e.message}\n`)
      fs.closeSync(fd)
      return resolve({ ok: false, code: -1, log: f, error: e.message })
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* 已经没了 */ }
    }, timeoutMs)

    child.stdout.on('data', (d) => { try { fs.writeSync(fd, d) } catch { /* 盘满 */ } })
    child.stderr.on('data', (d) => { try { fs.writeSync(fd, d) } catch { /* 盘满 */ } })
    child.on('error', (e) => {
      clearTimeout(timer)
      try { fs.writeSync(fd, `子进程错误：${e.message}\n`) } catch { /* ignore */ }
      try { fs.closeSync(fd) } catch { /* ignore */ }
      resolve({ ok: false, code: -1, log: f, error: e.message })
    })
    child.on('exit', () => { current = null })
    let settled = false
    const finish = async (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { fs.writeSync(fd, `\n===== 结束 code=${code}${timedOut ? '（超时被杀）' : ''} =====\n`) } catch { /* ignore */ }
      try { fs.closeSync(fd) } catch { /* ignore */ }
      current = null
      releaseLock()
      // dsh 启动器可能先退出、真正的 node 子进程还在跑：
      // 只要子进程写过心跳，就等心跳彻底停（>90 秒没更新）再算这一轮结束。
      if (!timedOut) await waitHeartbeatDone(spawnAt, deadline, roundId)
      resolve({ ok: code === 0 && !timedOut, code, log: f, timedOut })
    }
    // Windows 上 detached 子进程的 stdio 可能一直不关闭，导致 close 事件不触发、
    // 这一轮永远卡在「运行中」。改用 exit 触发收尾（更可靠），close 只作兜底。
    child.on('exit', (code) => { finish(code) })
    child.on('close', (code) => { finish(code) })
  })
}

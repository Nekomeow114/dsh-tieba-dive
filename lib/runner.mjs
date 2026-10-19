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
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { homeDir } from './tieba.js'

export const pluginDir = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const logsDir = () => path.join(homeDir(), 'logs')
export const logFile = (date = new Date().toISOString().slice(0, 10)) =>
  path.join(logsDir(), `run-${date}.log`)

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
export function runRound({ profile = 'headless', dshBin = '', timeoutMs = 20 * 60_000 } = {}) {
  const prompt = [
    '你现在替使用者刷一轮贴吧。先 `tieba_settings` 看配置，再照下面的说明做。',
    '',
    dutyPrompt(),
  ].join('\n')

  const bin = dshBin || process.env.DSH_BIN || 'dsh'
  const args = [profile, prompt]
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
        env: { ...process.env, TIEBA_DUTY_NO_SCHEDULE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      child.unref()
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
    child.on('close', (code) => {
      clearTimeout(timer)
      try { fs.writeSync(fd, `\n===== 结束 code=${code}${timedOut ? '（超时被杀）' : ''} =====\n`) } catch { /* ignore */ }
      try { fs.closeSync(fd) } catch { /* ignore */ }
      resolve({ ok: code === 0 && !timedOut, code, log: f, timedOut })
    })
  })
}

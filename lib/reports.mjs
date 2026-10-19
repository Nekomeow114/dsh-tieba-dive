/**
 * lib/reports.mjs —— 日报
 *
 * 每天一份：`$DSH_HOME/tieba-duty/reports/YYYY-MM-DD.md`
 * 模型用 `tieba_report_write` 写、用 `tieba_report_read` 读；卸载插件不删。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homeDir } from './tieba.js'

export const reportsDir = () => path.join(homeDir(), 'reports')
export const today = () => new Date().toISOString().slice(0, 10)

const safeDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : today())

export function reportFile(date) {
  return path.join(reportsDir(), `${safeDate(date)}.md`)
}

export function writeReport(content, { date } = {}) {
  const body = String(content || '').trim()
  if (!body) throw new Error('日报内容空着')
  if (body.length > 60000) throw new Error('日报太长了（60000 字上限）')
  fs.mkdirSync(reportsDir(), { recursive: true })
  const file = reportFile(date)
  fs.writeFileSync(file, body.endsWith('\n') ? body : body + '\n')
  return { ok: true, file, date: safeDate(date), bytes: Buffer.byteLength(body) }
}

export function readReport({ date, latest = false, lines = 400 } = {}) {
  let file
  if (latest) {
    const all = listReports()
    file = all.length ? path.join(reportsDir(), all[0].file) : ''
  } else {
    file = reportFile(date)
  }
  if (!file || !fs.existsSync(file)) return { ok: false, error: '还没有日报', date: safeDate(date) }
  const raw = fs.readFileSync(file, 'utf8')
  return {
    ok: true,
    file,
    date: path.basename(file, '.md'),
    text: raw.split('\n').slice(-Math.max(20, lines)).join('\n').trim(),
  }
}

export function listReports({ limit = 30 } = {}) {
  try {
    return fs.readdirSync(reportsDir())
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        const st = fs.statSync(path.join(reportsDir(), f))
        return { file: f, date: f.replace(/\.md$/, ''), bytes: st.size, mtime: st.mtimeMs }
      })
  } catch { return [] }
}

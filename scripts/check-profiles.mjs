#!/usr/bin/env node
/**
 * 检查每个 DSH profile 里有没有装 dsh-tieba-dive、bundle 有没有登记、工具齐不齐。
 *
 *   node scripts/check-profiles.mjs
 *   node scripts/check-profiles.mjs --json
 *
 * 只读，不做任何安装/修改。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILES = path.join(HOME, 'profiles')
const CANDIDATES = ['dsh-tieba-dive', 'dsh-tieba-scroll']
const EXPECTED = [
  'tieba_settings', 'tieba_list', 'tieba_thread', 'tieba_sub_replies',
  'tieba_style_refs', 'tieba_reply', 'tieba_reply_sub',
  'tieba_run_round', 'tieba_run_status', 'tieba_report_read',
]

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
function real(p) { try { return fs.realpathSync(p) } catch { return '' } }
function toolsOf(dir) {
  const index = path.join(dir, 'index.js')
  try {
    const src = fs.readFileSync(index, 'utf8')
    return [...new Set([...src.matchAll(/name:\s*'(tieba_[a-z_]+)'/g)].map((m) => m[1]))]
  } catch { return [] }
}

function checkProfile(name) {
  const dir = path.join(PROFILES, name)
  const pkg = readJson(path.join(dir, 'package.json'))
  if (!pkg) return null
  const deps = pkg.dependencies || {}
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  // 空 profile（没有依赖、只有 base bundle）是模板/未使用，不参与检查
  if (name === 'default' || (!Object.keys(deps).length && bundles.every((b) => b.startsWith('@deepseek-ai/')))) return { profile: name, skipped: true, issues: [] }
  const depKey = CANDIDATES.find((x) => deps[x]) || ''
  const bundleKey = CANDIDATES.find((x) => bundles.includes(x)) || ''
  const installPath = depKey ? path.join(dir, 'node_modules', depKey) : ''
  const realPath = installPath ? real(installPath) : ''
  const installedPkg = realPath ? readJson(path.join(realPath, 'package.json')) : null
  const version = installedPkg ? installedPkg.version : ''
  const actualName = installedPkg ? installedPkg.name : ''
  const tools = realPath ? toolsOf(realPath) : []
  const missingTools = EXPECTED.filter((t) => !tools.includes(t))
  const issues = []
  if (!depKey) issues.push('未安装')
  else if (!realPath) issues.push(`依赖 ${depKey} 指向的目录不存在`)
  else if (actualName && actualName !== depKey) issues.push(`包名不一致：依赖 ${depKey}，实际 ${actualName}`)
  if (depKey && !bundleKey) issues.push('未登记到 dsh.profile.bundles')
  if (depKey && bundleKey && depKey !== bundleKey) issues.push('依赖名与 bundles 名不一致')
  if (realPath && missingTools.length) issues.push(`工具缺 ${missingTools.length} 个：${missingTools.join(', ')}`)
  return { profile: name, installed: Boolean(realPath), depKey, bundleKey, version, actualName, tools, missingTools, issues, path: realPath }
}

const onlyJson = process.argv.includes('--json')
const names = fs.existsSync(PROFILES) ? fs.readdirSync(PROFILES).filter((n) => fs.existsSync(path.join(PROFILES, n, 'package.json'))) : []
const rows = names.map(checkProfile).filter(Boolean)
const broken = rows.filter((r) => r.issues && r.issues.length)

if (onlyJson) {
  console.log(JSON.stringify({ home: HOME, profiles: rows, broken: broken.map((r) => r.profile) }, null, 2))
  process.exit(broken.length ? 1 : 0)
}

console.log(`DSH_HOME: ${HOME}\n`)
for (const r of rows) {
  if (r.skipped) { console.log(`- profile: ${r.profile}（空 profile，跳过）\n`); continue }
  const mark = r.issues.length ? '✗' : '✓'
  console.log(`${mark} profile: ${r.profile}`)
  console.log(`  依赖: ${r.depKey || '—'} | bundles: ${r.bundleKey || '—'} | 版本: ${r.version || '—'}`)
  console.log(`  工具: ${r.tools.length} 个${r.tools.length ? '（' + r.tools.join(', ') + '）' : ''}`)
  console.log(`  路径: ${r.path || '—'}`)
  if (r.issues.length) console.log(`  问题: ${r.issues.join('；')}`)
  console.log('')
}
if (broken.length) {
  console.log('修复建议：')
  for (const r of broken) {
    if (!r.installed || r.depKey !== 'dsh-tieba-dive') {
      console.log(`  dsh plugin --profile ${r.profile} add dsh-tieba-dive`)
    } else if (r.issues.length) {
      console.log(`  dsh plugin --profile ${r.profile} remove dsh-tieba-dive && dsh plugin --profile ${r.profile} add dsh-tieba-dive`)
    }
  }
} else {
  console.log('全部 profile 都正常。')
}
process.exit(broken.length ? 1 : 0)

// 冒烟：用假 ctx 真跑一遍 apply()，确认「工具 + 路由」都挂上了。
// 这个测试是为了拦住「tool 定义在使用之后」这类 TDZ 错 —— 一旦 apply 抛错，
// 宿主那边就是全 404，而且界面上看不出来原因。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-apply-'))
process.env.DSH_HOME = tmp

const calls = { tools: [], routes: [], settings: 0, effects: 0 }
const ctx = {
  settings: { register: () => { calls.settings += 1 } },
  tools: { register: (t) => calls.tools.push(t.name) },
  webServer: { register: (r) => calls.routes.push(r.path) },
  effect: (fn) => { calls.effects += 1; try { fn() } catch { /* 清理函数失败不算 */ } },
  get: () => undefined,
}

const mod = await import('../index.js')
let err = ''
try { mod.apply(ctx, {}) } catch (e) { err = e?.message || String(e) }

const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
  if (!cond) process.exitCode = 1
}

ok(!err, 'apply() 不抛错', err)
ok(calls.routes.includes('/api/tieba-duty'), '路由挂上了')
ok(calls.tools.length >= 12, '工具数量 ≥ 12', String(calls.tools.length))
for (const must of ['tieba_list', 'tieba_thread', 'tieba_reply', 'tieba_sign', 'tieba_follow',
  'tieba_persona', 'tieba_settings', 'tieba_diary_write', 'tieba_report_write']) {
  ok(calls.tools.includes(must), '有工具 ' + must)
}
ok(typeof mod.name === 'string' && mod.name === 'tieba-scroll', '插件名 tieba-scroll')
ok(Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'inject 带 webServer')

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(process.exitCode || 0)

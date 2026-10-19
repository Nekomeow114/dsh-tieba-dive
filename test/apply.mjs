// 冒烟：用假 ctx 真跑 apply()，确认「工具 + 路由」按环境挂载。
// 拦两类事故：① apply 抛错（宿主那边就是全 404，界面上看不出原因）
//            ② headless 下因为 webServer 不是可选依赖而整体 pending
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-apply-'))
process.env.DSH_HOME = tmp

const mod = await import('../index.js')

let bad = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
  if (!cond) bad++
}

/** 造一个假 ctx；withWeb=false 时**连 webServer 属性都没有**，模拟 headless */
function makeCtx(withWeb) {
  const calls = { tools: [], routes: [], settings: 0, effects: 0 }
  const ctx = {
    settings: { register: () => { calls.settings += 1 } },
    tools: { register: (t) => calls.tools.push(t.name) },
    effect: (fn) => { calls.effects += 1; try { fn() } catch { /* ignore */ } },
    get: (name) => (withWeb && name === 'webServer' ? ctx.webServer : undefined),
    // Cordis 的动态注入：服务就绪才回调；这里模拟「有就立刻回调」
    inject: (deps, cb) => { if (withWeb && deps.includes('webServer')) cb(ctx) },
  }
  if (withWeb) ctx.webServer = { register: (r) => calls.routes.push(r.path) }
  return { ctx, calls }
}

// 场景 A：headless（没有 webServer）
const a = makeCtx(false)
let errA = ''
try { mod.apply(a.ctx, {}) } catch (e) { errA = e?.message || String(e) }
ok(!errA, 'headless：apply() 不抛错', errA)
ok(a.calls.routes.length === 0, 'headless：不注册路由')
ok(a.calls.tools.length >= 12, 'headless：工具照常挂上', String(a.calls.tools.length))
ok(a.calls.effects >= 1, 'headless：定时器挂上')

// 场景 B：web（有 webServer）
const b = makeCtx(true)
let errB = ''
try { mod.apply(b.ctx, {}) } catch (e) { errB = e?.message || String(e) }
ok(!errB, 'web：apply() 不抛错', errB)
ok(b.calls.routes.includes('/api/tieba-duty'), 'web：路由挂上')
ok(b.calls.tools.length >= 12, 'web：工具挂上', String(b.calls.tools.length))

// 必备工具
for (const must of ['tieba_list', 'tieba_thread', 'tieba_reply', 'tieba_sign', 'tieba_follow',
  'tieba_persona', 'tieba_settings', 'tieba_diary_write', 'tieba_report_write']) {
  ok(b.calls.tools.includes(must), '有工具 ' + must)
}
ok(mod.name === 'tieba-scroll', '插件名 tieba-scroll')
ok(mod.inject.includes('tools') && mod.inject.includes('settings'), 'inject 带 tools/settings')
ok(!mod.inject.includes('webServer'), 'inject 里没有 webServer（headless 会 pending）')

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)

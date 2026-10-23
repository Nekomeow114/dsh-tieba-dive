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
  const calls = { tools: [], routes: [], settings: 0, effects: 0, toolObjs: [] }
  const ctx = {
    settings: { register: () => { calls.settings += 1 } },
    tools: { register: (t) => { calls.tools.push(t.name); calls.toolObjs.push(t) } },
    effect: (fn) => { calls.effects += 1; try { fn() } catch { /* ignore */ } },
    get: (name) => (withWeb && name === 'webServer' ? ctx.webServer : undefined),
    // Cordis 的动态注入：服务就绪才回调；这里模拟「有就立刻回调」
    inject: (deps, cb) => { if (withWeb && deps.includes('webServer')) cb(ctx) },
  }
  if (withWeb) ctx.webServer = { register: (r) => calls.routes.push(r.path) }
  return { ctx, calls }
}

// 静态检查：设置页七张卡都在（客户端改动是字符串拼接，最容易"改了但没插进去"）
{
  const fs2 = await import('node:fs')
  const src = fs2.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const cards = ['A1 账号', 'A2 每一轮', 'B1 人设', 'B2 图片库', 'C1 回帖规则', 'C2 自动化',
    'D1 演化', 'D2 日记', 'D3 版本与导出']
  const groups = ['账号与刷帖', '人设与表达', '行为与规则', '成长与记录']
  const missing = cards.filter((c) => !src.includes(c))
  ok(missing.length === 0, '设置页九张卡都在', missing.join(','))
  const missG = groups.filter((g) => !src.includes("title: '" + g + "'"))
  ok(missG.length === 0, '设置页四大类都在', missG.join(','))
  const at = (x) => src.indexOf(x)
  ok(at('B1 人设') < at('B2 图片库') && at('B2 图片库') < at("title: '行为与规则'"), 'B2 图片库在 B 组内')
  ok(at('C1 回帖规则') < at('C2 自动化') && at('C2 自动化') < at("title: '成长与记录'"), 'C 组顺序 C1 → C2')
  ok(at('D1 演化') < at('D2 日记') && at('D2 日记') < at('D3 版本与导出'), 'D 组顺序 D1 → D2 → D3')
  ok((src.match(/open: true/g) || []).length === 1, '默认只展开 A 组')

  // 界面里 save({ key: ... }) / num('key') 用到的配置键，必须真的存在于 DEFAULTS
  const { DEFAULTS } = await import('../lib/config.mjs')
  const used = new Set()
  for (const m of src.matchAll(/save\(\{\s*([A-Za-z]+)\s*:/g)) used.add(m[1])
  for (const m of src.matchAll(/num\('([A-Za-z]+)'\)/g)) used.add(m[1])
  const unknown = [...used].filter((k) => !(k in DEFAULTS))
  ok(unknown.length === 0, '设置页引用的配置键都在 DEFAULTS 里', unknown.join(','))
}

// 场景 A：headless（没有 webServer）
const a = makeCtx(false)
let errA = ''
try { mod.apply(a.ctx, {}) } catch (e) { errA = e?.message || String(e) }
ok(!errA, 'headless：apply() 不抛错', errA)
ok(a.calls.routes.length === 0, 'headless：不注册路由')
ok(a.calls.tools.length >= 12, 'headless：工具照常挂上', String(a.calls.tools.length))

// 抓那种「函数被删了但工具还在注册」的事故：persona 曾经就是这样
const personaTool = a.calls.toolObjs.find((t) => t.name === 'tieba_persona')
let personaRes = null
let personaErr = ''
try { personaRes = await personaTool.execute({}) } catch (e) { personaErr = e?.message || String(e) }
ok(!personaErr && personaRes && typeof personaRes === 'object' && 'text' in personaRes,
  'persona 工具可执行且返回对象', personaErr || '')
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
  'tieba_persona', 'tieba_settings', 'tieba_diary_write', 'tieba_report_write', 'tieba_my_replies']) {
  ok(b.calls.tools.includes(must), '有工具 ' + must)
}
ok(mod.name === 'tieba-scroll', '插件名 tieba-scroll')
ok(mod.inject.includes('tools') && mod.inject.includes('settings'), 'inject 带 tools/settings')
ok(!mod.inject.includes('webServer'), 'inject 里没有 webServer（headless 会 pending）')

// 场景 C：webServer 晚于 apply 就绪（真机日志里就是这样，bili 也在等）
const c3 = makeCtx(false)
try { mod.apply(c3.ctx, {}) } catch (e) { /* ignore */ }
await new Promise((r) => setTimeout(r, 50))
ok(c3.calls.routes.length === 0, 'webServer 未就绪时先不挂路由')
c3.ctx.webServer = { register: (r) => c3.calls.routes.push(r.path) }
await new Promise((r) => setTimeout(r, 1600))
ok(c3.calls.routes.includes('/api/tieba-duty'), 'webServer 就绪后自动挂上（轮询兜底）', String(c3.calls.routes.length))

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)

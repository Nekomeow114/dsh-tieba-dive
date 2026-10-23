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
  const calls = { tools: [], routes: [], settings: 0, effects: 0, toolObjs: [], routeObjs: [] }
  const ctx = {
    settings: { register: () => { calls.settings += 1 } },
    tools: { register: (t) => { calls.tools.push(t.name); calls.toolObjs.push(t) } },
    effect: (fn) => { calls.effects += 1; try { fn() } catch { /* ignore */ } },
    get: (name) => (withWeb && name === 'webServer' ? ctx.webServer : undefined),
    // Cordis 的动态注入：服务就绪才回调；这里模拟「有就立刻回调」
    inject: (deps, cb) => { if (withWeb && deps.includes('webServer')) cb(ctx) },
  }
  if (withWeb) ctx.webServer = { register: (r) => { calls.routes.push(r.path); calls.routeObjs.push(r) } }
  return { ctx, calls }
}

// 静态检查：设置页七张卡都在（客户端改动是字符串拼接，最容易"改了但没插进去"）
{
  const fs2 = await import('node:fs')
  const src = fs2.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const cards = ['账号', '每一轮', '人设', '图片库', '回帖规则', '自动化', '演化', '日记']
  const groups = ['账号与刷帖', '人设与表达', '行为与规则', '成长与记录']
  const missing = cards.filter((c) => !src.includes(c))
  ok(missing.length === 0, '设置页九张卡都在', missing.join(','))
  const missG = groups.filter((g) => !src.includes("title: '" + g + "'"))
  ok(missG.length === 0, '设置页四大类都在', missG.join(','))
  const at = (x) => src.indexOf(x)
  ok(at("'人设'") < at("'图片库'") && at("'图片库'") < at("title: '行为与规则'"), '图片库在 B 组内')
  ok(at("'回帖规则'") < at("'自动化'") && at("'自动化'") < at("title: '成长与记录'"), 'C 组顺序 回帖 → 自动化')
  ok(at("'演化'") < at("'日记'"), 'D 组顺序 演化 → 日记')
  ok(at("'演化'") < at('演化时间轴') && at('演化时间轴') < at("'日记'"), '时间轴在演化卡内')
  ok(at("'演化'") < at('版本与导出') && at('版本与导出') < at("'日记'"), '版本与导出并入演化卡')
  ok((src.match(/open: true/g) || []).length === 1, '默认只展开 A 组')

  // 界面里 save({ key: ... }) / num('key') 用到的配置键，必须真的存在于 DEFAULTS
  const { DEFAULTS } = await import('../lib/config.mjs')
  const used = new Set()
  for (const m of src.matchAll(/save\(\{\s*([A-Za-z]+)\s*:/g)) used.add(m[1])
  for (const m of src.matchAll(/num\('([A-Za-z]+)'\)/g)) used.add(m[1])
  // 每个 setXxx 都必须在组件里声明过 const [xxx, setXxx]
  const setters = new Set([...src.matchAll(/set([A-Z][A-Za-z0-9]*)\(/g)].map((m) => m[1]))
  const GLOBALS = new Set(['Timeout', 'Interval', 'Attribute', 'Item', 'RequestHeader', 'Date', 'Title', 'Property'])
  const undeclared = [...setters]
    .filter((n) => !GLOBALS.has(n))
    .filter((n) => !new RegExp('set' + n + '\\s*\\]').test(src))
  ok(undeclared.length === 0, '所有 setXxx 都有对应 state 声明', undeclared.join(','))
  const unknown = [...used].filter((k) => !(k in DEFAULTS))
  ok(unknown.length === 0, '设置页引用的配置键都在 DEFAULTS 里', unknown.join(','))
  ok(!/JSON\.parse\(\(await readBody/.test((await import('node:fs')).readFileSync(new URL('../index.js', import.meta.url), 'utf8')),
    'HTTP 处理里没有对 readBody 二次 JSON.parse')
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
let c3route = null
c3.ctx.webServer = { register: (r) => { c3.calls.routes.push(r.path); c3route = r } }
await new Promise((r) => setTimeout(r, 1600))
ok(c3.calls.routes.includes('/api/tieba-duty'), 'webServer 就绪后自动挂上（轮询兜底）', String(c3.calls.routes.length))

// 真调一次 /images：readBody 已经是对象，不能再 JSON.parse（1.15.3 的坑）
{
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const call = (method, url, obj) => new Promise((resolve) => {
    const body = obj ? JSON.stringify(obj) : ''
    const req = {
      method, url, headers: {},
      on: (ev, cb) => { if (ev === 'data' && body) cb(Buffer.from(body)); if (ev === 'end') cb() },
      destroy: () => {},
    }
    const res = { setHeader: () => {}, writeHead: () => {}, end: (b) => resolve(JSON.parse(String(b))) }
    c3route.handler(req, res)
  })
  const up = await call('POST', '/api/tieba-duty/images', { name: 't.png', dataUrl: PNG, desc: '测试图', tags: ['贴贴'] })
  ok(up.ok && up.image && up.image.id, '/images 上传接口可用（body 不二次解析）', up.error || '')
  const ls = await call('GET', '/api/tieba-duty/images')
  ok(ls.ok && ls.images.length === 1, '/images 列表能读到刚上传的图', String(ls.images && ls.images.length))
}

fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)

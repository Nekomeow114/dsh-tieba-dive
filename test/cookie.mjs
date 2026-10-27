/** BDUSS 校验：~ 是有效字符，不能被误拒；空白/过短仍要挡。 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-cookie-'))
process.env.DSH_HOME = tmp
const t = await import('../lib/tieba.js')

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('PASS ', name) } else { fail++; console.error('FAIL ', name) } }

const value = 'a'.repeat(80) + '~' + 'b'.repeat(20)
t.setCookie(value)
ok(t.getCookie().includes('~') && t.getCookie().startsWith('BDUSS='), '含 ~ 的 BDUSS 能保存')
t.setCookie('BDUSS=' + value)
ok(t.getCookie() === 'BDUSS=' + value, '带前缀也能保存')
try { t.setCookie('short'); ok(false, '过短应拒绝') } catch { ok(true, '过短应拒绝') }
try { t.setCookie('   '); ok(false, '空白应拒绝') } catch { ok(true, '空白应拒绝') }

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseList, parseThread } from '../lib/tieba.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (n) => fs.readFileSync(path.join(here, 'fixtures', n), 'utf8')

let bad = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
  if (!cond) bad++
}

// 1. 吧列表：真页面解析
const bar = parseList(fixture('bar-list.html'))
ok(bar.fid === '28145568', '吧列表：fid 解析出来', bar.fid)
ok(bar.threads.length >= 10, '吧列表：帖子数 ≥ 10', String(bar.threads.length))
ok(bar.threads.every((t) => /^\d+$/.test(t.id)), '吧列表：每个帖子都有数字 id')
ok(bar.threads.some((t) => t.title.includes('大肥鱼')), '吧列表：标题解出来是中文字（没有乱码）')

// 2. 楼层：真页面解析
const th = parseThread(fixture('thread.html'))
ok(th.floors.length >= 10, '楼层：解析出 ≥ 10 楼', String(th.floors.length))
ok(th.floors.every((f) => !f.includes('<')), '楼层：标签都清掉了')
ok(th.floors.some((f) => f.includes('大肥鱼')), '楼层：正文里能读到关键词')

// 3. 解析器对空输入不崩（贴吧改版时最容易炸的地方）
const empty = parseList('<html></html>')
ok(empty.threads.length === 0 && empty.fid === '', '空页面：返回空数组而不是抛错')

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
process.exit(bad ? 1 : 0)

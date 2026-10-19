// 纯函数测试：语气闸门 / 配置归一化 / 日报读写 / 状态日切。断网可跑。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 所有落盘都走临时 DSH_HOME，别碰真环境
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tieba-test-'))
process.env.DSH_HOME = tmp

const { toneCheck } = await import('../lib/tone.mjs')
const { normalize, DEFAULTS } = await import('../lib/config.mjs')
const { writeReport, readReport, listReports } = await import('../lib/reports.mjs')
const { freshState, writeState } = await import('../lib/state.mjs')

let bad = 0
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`)
  if (!cond) bad++
}

// 1. 语气闸门
ok(toneCheck('首先你要知道').includes('首先'), '客服腔：命中「首先」')
ok(toneCheck('希望对你有帮助').length === 1, '客服腔：命中「希望对你有帮助」')
ok(toneCheck('这书我也在看，节奏慢但挺上头').length === 0, '人话：不该命中')
ok(toneCheck('此外我觉得还行').includes('此外'), '客服腔：「此外」也算')
ok(toneCheck('').length === 0 && toneCheck(null).length === 0, '空值不炸')

// 2. 配置
const c = normalize({})
ok(Array.isArray(c.bars) && c.bars.length === 0, '默认不刷任何吧（必须用户自己填）')
ok(c.readPerRound === 5 && c.replyPerRound === 1, '默认读 5 回 1')
ok(c.autoReply === false && c.diaryEnabled === true && c.toneGate === true, '默认开关：回帖关、日记开、闸门开')
ok(c.answerQuestions === true && c.dedupeDays === 7, '默认答疑开、去重 7 天')
ok(normalize({ bars: 'a\nb, c' }).bars.join('|') === 'a|b|c', '吧名支持换行/逗号分隔')
ok(normalize({ replyPerDay: 999 }).replyPerDay === 20, '每日上限被夹到 20')
ok(normalize({ readPerRound: 0 }).readPerRound === 1, '每轮读至少 1')
ok(normalize({ diaiyEnabled: false }).diaryEnabled === true, '拼错的键不会误关功能')

// 3. 日报
const w = writeReport('# 日报\n\n## deepseek吧\n- 一条')
ok(w.ok && fs.existsSync(w.file), '日报：写文件成功', w.file)
const r = readReport({ latest: true })
ok(r.ok && r.text.includes('deepseek吧'), '日报：latest 能读回来')
ok(listReports().length === 1, '日报：列表里有 1 份')
ok(readReport({ date: '2000-01-01' }).ok === false, '日报：没有的日期返回 ok:false')

// 4. 状态日切
const st = freshState()
st.replies = 3
st.date = '2000-01-01'
writeState(st)
const st2 = freshState()
ok(st2.replies === 0, '状态：跨天自动清零回帖数')
ok(st2.date === new Date().toISOString().slice(0, 10), '状态：日期跟今天一致')

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)

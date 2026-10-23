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
ok(normalize({ replyPerDay: 999 }).replyPerDay === 30, '每日上限被夹到 30')
ok(normalize({ readPerRound: 0 }).readPerRound === 1, '每轮读至少 1')
ok(normalize({ diaiyEnabled: false }).diaryEnabled === true, '拼错的键不会误关功能')

// 2.5 风控熔断
const cd = await import('../lib/cooldown.mjs')
ok(cd.readCooldown().active === false, '熔断：初始是不激活')
cd.trip(1, '百度安全验证')
const c1 = cd.readCooldown()
ok(c1.active === true && c1.reason === '百度安全验证', '熔断：写入后立刻生效')
ok(cd.remainingMs() > 0 && cd.remainingMs() <= 60_000, '熔断：剩余时间在范围内', String(cd.remainingMs()))
cd.clearCooldown()
ok(cd.readCooldown().active === false, '熔断：手动解除后失效')

// 3. 日报
const w = writeReport('# 日报\n\n## deepseek吧\n- 一条')
ok(w.ok && fs.existsSync(w.file), '日报：写文件成功', w.file)
const r = readReport({ latest: true })
ok(r.ok && r.text.includes('deepseek吧'), '日报：latest 能读回来')
ok(listReports().length === 1, '日报：列表里有 1 份')
ok(readReport({ date: '2000-01-01' }).ok === false, '日报：没有的日期返回 ok:false')

// 3.5 本地日期（不能是 UTC）
const { localToday } = await import('../lib/time.mjs')
const now = new Date()
const expect = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
ok(localToday() === expect, '本地日期：与本地年月日一致', localToday() + ' vs ' + expect)

// 3.8 一轮存活判断（宽限期 + 心跳）
const { roundAlive, GRACE_MS, HB_FRESH_MS } = await import('../lib/round-state.mjs')
const tsNow = Date.now()
ok(roundAlive({ running: false }) === false, '存活：没在跑就是 false')
ok(roundAlive({ running: true, startedAt: tsNow - 10_000, hbAt: 0, now: tsNow }), '存活：宽限期内没心跳也算在跑')
ok(!roundAlive({ running: true, startedAt: tsNow - GRACE_MS - 1, hbAt: 0, now: tsNow }), '存活：过宽限期且没心跳 → 结束')
ok(roundAlive({ running: true, startedAt: tsNow - GRACE_MS - 1, hbAt: tsNow - 30_000, now: tsNow }), '存活：过宽限期但心跳新鲜 → 还在跑')
ok(!roundAlive({ running: true, startedAt: tsNow - GRACE_MS - 1, hbAt: tsNow - HB_FRESH_MS - 1, now: tsNow }), '存活：心跳也过期 → 结束')

// 4. 状态日切
const st = freshState()
st.replies = 3
st.date = '2000-01-01'
writeState(st)
const st2 = freshState()
ok(st2.replies === 0, '状态：跨天自动清零回帖数')
ok(st2.date === localToday(), '状态：日期跟今天一致（本地时区）')

console.log(bad ? `\n${bad} 项失败` : '\n全部通过')
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(bad ? 1 : 0)

// 11.6 人设演化
const evo = await import('../lib/evolve.mjs')
const vs = evo.validateSamples(['哈？这也行', 'x', '看 https://a.b', '这书我也在看', '哈？这也行'])
ok(vs.length === 2 && vs[0] === '哈？这也行' && vs[1] === '这书我也在看', '演化：过滤太短/链接/重复', JSON.stringify(vs))
const merged = evo.mergeSamples(['a', 'b'], ['b', 'c'])
ok(merged.join('|') === 'a|b|c', '演化：合并去重')
ok(evo.mergeSamples(new Array(40).fill('x').map((_, i) => 's' + i), ['new']).length === evo.MAX_SAMPLES, '演化：样本有上限')
const withNote = evo.appendEvolutionNote('正文', ['哈？这也行'])
ok(withNote.includes('正文') && withNote.includes('演化记录') && withNote.includes('哈？这也行'), '演化：只追加不覆盖正文')

// 11.5 三层人设 + 快照回滚
const per = await import('../lib/persona.mjs')
const p1 = per.ensurePersona('样本一\n样本二')
ok(p1.version >= 1 && p1.voice.samples.includes('样本一'), '人设：迁移旧样本')
const p2 = per.updatePersona({ traits: { gentle: 11, sharp: -3, imageBias: 2 }, core: { name: 'X' } }, { reason: 'test' })
ok(p2.traits.gentle === 10 && p2.traits.sharp === 0, '人设：旋钮夹到 0~10')
ok(p2.core.name === per.CORE.name, '人设：核心层改不动')
ok(p2.version === p1.version + 1, '人设：每次修改版本 +1')
ok(per.listVersions().length >= 1, '人设：有历史快照')
const rb = per.rollback(p1.version)
ok(rb.ok && rb.persona.version > p2.version, '人设：回滚生成新版本')
ok(per.renderForPrompt(rb.persona).includes('核心层'), '人设：提示词包含核心层')

// 11.6 自动演化（每天一次、小步、双日记）
const evo2 = await import('../lib/evolution.mjs')
const fsx = await import('node:fs')
const pathx = await import('node:path')
const r1 = evo2.applyEvolution({
  samples: ['行吧，那就这样', '有点意思'],
  traitKey: 'gentle', traitStep: 5,
  reason: 'test', narrative: '今天学了两句。',
  stats: { bars: ['deepseek'], postsSeen: 3, replies: 1, repliesGot: 2, deleted: 0, images: 0 },
})
ok(r1.ok, '演化：首次应用成功', r1.error || '')
ok(r1.record.trait.to - r1.record.trait.from === 1, '演化：旋钮单次只动 1 格')
ok(r1.record.samplesAdded.length === 2, '演化：样本 1~3 条')
ok(!evo2.applyEvolution({ samples: ['再来一句'] }).ok, '演化：一天只能一次')
const diaryDir = pathx.join(process.env.DSH_HOME, 'tieba-duty', 'diary')
const pub = fsx.readFileSync(pathx.join(diaryDir, 'public.md'), 'utf8')
const priv = fsx.readFileSync(pathx.join(diaryDir, 'private.md'), 'utf8')
ok(pub.includes('版本 v') && priv.includes('旋钮：'), '演化：公开/私人日记都写了')
ok(priv.includes('回帖：') && priv.includes('被回复：'), '演化：私人日记含事实字段')

// 11.62 保险机制：漂移 / 暂停 / 被删联动
const dr = evo2.driftReport()
ok(dr.score >= 0 && dr.score <= 1 && ['ok', 'warn', 'high'].includes(dr.level), '保险：漂移分在 0~1', JSON.stringify(dr))
evo2.pauseEvolution('测试暂停')
ok(evo2.readEvolutionState().paused === true, '保险：暂停生效')
ok(!evo2.applyEvolution({ samples: ['暂停后不该生效'] }).ok, '保险：暂停后不能演化')
evo2.resumeEvolution()
ok(evo2.readEvolutionState().paused === false, '保险：恢复生效')
{
  // 写三条“被删 1”的记录，模拟 7 天内累计 3 条
  const f = pathx.join(process.env.DSH_HOME, 'tieba-duty', 'evolution.jsonl')
  const lines = [1, 2, 3].map(() => JSON.stringify({ at: new Date().toISOString().replace('T', ' ').slice(0, 16), stats: { deleted: 1 } }))
  fsx.appendFileSync(f, lines.join('\n') + '\n')
  ok(evo2.checkDeletionPause() === true, '保险：被删累计 3 条触发自动暂停')
  evo2.resumeEvolution()
}

// 11.605 带图回帖表单构造
{
  const t = await import('../lib/tieba.js')
  const f = t.buildImageReplyFields({ kw: 'deepseek', tid: '123', fid: '28145568', tbs: 'T', content: '正文', imageInfo: 'abc,1,1,false', now: 1700000000000 })
  ok(f.upload_img_info === 'abc,1,1,false' && f.z === '123' && f.word === 'deepseek' && f.tag === '11', '带图回帖：字段齐全')
  ok(f._t === '1700000000000' && f.lp === '6026', '带图回帖：时间与 lp 固定')
}

// 11.61 图床上传响应解析
const { parseUploadResponse } = await import('../lib/tieba.js')
const upOk = parseUploadResponse("window.imageUploadResult=1;var result={imageSrc:'http:\\/\\/m.tiebaimg.com\\/x.jpg',imageInfo:'abc123,1,1,false'};")
ok(upOk.ok && upOk.imageInfo === 'abc123,1,1,false' && upOk.imageSrc.includes('m.tiebaimg.com'), '图床：解析成功响应')
ok(!parseUploadResponse('{"errorMsg":"图片上传失败，请重新上传"}').ok, '图床：失败响应识别')

// 11.62 图片库
const img = await import('../lib/images.mjs')
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const a1 = img.addImage({ name: 't.png', dataUrl: PNG, desc: '测试图', tags: ['贴贴'] })
ok(a1.ok && a1.image.id, '图片：上传成功', a1.error || '')
ok(img.biasHint(1).includes('基本不发') && img.biasHint(9).includes('倾向发图'), '图片：发图倾向分档文案')
ok(!('file' in a1.image) && !('abs' in a1.image), '图片：给模型的视图不含路径')
const iid = a1.image.id
const stImg = { imagesToday: { count: 0, byId: {} }, round: null }
const cfgImg = { imagePerDay: 2 }
ok(img.pickImage({ id: iid, kw: 'deepseek', state: stImg, cfg: cfgImg }).ok, '图片：正常可选')
img.updateImage(iid, { disabledBars: ['deepseek'] })
ok(!img.pickImage({ id: iid, kw: 'deepseek', state: stImg, cfg: cfgImg }).ok, '图片：该吧禁用时不发')
img.updateImage(iid, { disabledBars: [] })
img.markUsed(iid)
ok(!img.pickImage({ id: iid, kw: 'deepseek', state: stImg, cfg: cfgImg }).ok, '图片：24 小时冷却')
ok(!img.pickImage({ id: iid + 'x', kw: 'deepseek', state: stImg, cfg: cfgImg }).ok, '图片：库外 ID 拒绝')
ok(!img.pickImage({ id: iid, kw: 'deepseek', state: { ...stImg, round: { images: 1 } }, cfg: cfgImg }).ok, '图片：每轮最多 1 张')

// 11.63 人设导出
const ex = await import('../lib/persona-export.mjs')
const samplePersona = { version: 7, traits: { abstract: 3, sharp: 2, gentle: 8, talkative: 4, imageBias: 2 }, voice: { samples: ['正常一句', '看 https://example.com'], quirks: [], sentenceLen: 'short', punctuation: 'light' } }
const txt = ex.toText(samplePersona, { core: per.CORE })
ok(txt.includes('v7') && txt.includes('核心层') && txt.includes('温柔度：8'), '导出：文本含版本/核心层/旋钮')
ok(!txt.includes('https://'), '导出：文本剔除链接')
const js = ex.toJson(samplePersona)
ok(js.format === 'dsh-tieba-persona' && js.schema === 1 && js.version === 7, '导出：JSON 带 format/schema/版本')
ok(js.voice.samples.length === 1, '导出：JSON 也脱敏')

// 11.65 配置字段往返（防「加了字段但 normalize 丢了」）
{
  const { DEFAULTS, normalize } = await import('../lib/config.mjs')
  const dropped = Object.keys(DEFAULTS).filter((k) => !(k in normalize({})))
  ok(dropped.length === 0, '配置：DEFAULTS 每个键都在 normalize 结果里', dropped.join(','))
  ok(normalize({ evolvePersona: true }).evolvePersona === true, '配置：evolvePersona 往返正确')
}

// 11.7 同源判断
const { isSameOrigin } = await import('../lib/origin.mjs')
ok(isSameOrigin('http://127.0.0.1:3080', '127.0.0.1:3080'), '同源：完全一致')
ok(isSameOrigin('http://localhost:3080', '127.0.0.1:3080'), '同源：回环地址互通')
ok(isSameOrigin('', '127.0.0.1:3080'), '同源：没有 Origin（curl）放行')
ok(!isSameOrigin('http://evil.com', '127.0.0.1:3080'), '同源：外部域名拒绝')
ok(!isSameOrigin('http://127.0.0.1:3080', 'example.com'), '同源：主机名不同拒绝')

// 11.8 出站内容过滤
const { checkOutbound } = await import('../lib/guard.mjs')
ok(checkOutbound('这书我也在看，节奏慢但挺上头').ok, '出站：正常文本放行')
ok(checkOutbound('看 @某人 说的').ok, '出站：@ 放行')
ok(!checkOutbound('在 /root/.dsh 里').ok, '出站：本机路径拦截')
ok(!checkOutbound('看 https://example.com').ok, '出站：链接拦截')
ok(!checkOutbound('C:\\Users\\x').ok, '出站：Windows 路径拦截')
ok(!checkOutbound('BDUSS=abc').ok, '出站：凭证字样拦截')

// 12. 跨插件契约：manifest + events
const integ = await import('../lib/integrations.mjs')
const m = integ.writeManifest({ name: 'test-plugin', version: '1.2.3', provides: ['memory'], consumes: [] })
ok(m.name === 'test-plugin' && m.provides.includes('memory'), 'manifest：写入并带 provides')
ok(integ.hasCapability('memory') === true, 'manifest：hasCapability 能查到')
ok(integ.readManifests().some((x) => x.name === 'test-plugin'), 'manifest：readManifests 能列出')
const det = integ.detect()
ok(det.caps.memory === true && det.plugins.some((x) => x.name === 'test-plugin'), 'detect：汇总能力与插件')
ok(integ.capabilitySection().includes('长记忆可用'), 'capabilitySection：有 memory 时提示模型')
const ev = integ.emitEvent('test.event', { a: 1 })
ok(ev.line.includes('"type":"test.event"') && ev.file.endsWith('.jsonl'), 'events：一行一条 JSONL')

# dsh-tieba-scroll

> 百度贴吧的 DSH 插件：自动读帖、生成日报、每日签到；回帖可选，并带频率与内容限制。

[![test](https://github.com/Nekomeow114/dsh-tieba-scroll/actions/workflows/test.yml/badge.svg)](https://github.com/Nekomeow114/dsh-tieba-scroll/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/Nekomeow114/dsh-tieba-scroll)](https://github.com/Nekomeow114/dsh-tieba-scroll/releases)
[![license](https://img.shields.io/github/license/Nekomeow114/dsh-tieba-scroll)](LICENSE)

⚠️ 走的是贴吧手机版页面（逆向解析），不是官方 API。贴吧改版可能失效，频繁请求可能触发风控；
账号风险与发布内容由使用者自行承担。

---

## 功能

- **多吧阅读**：按吧列出帖子，读楼层正文，附带帖子内图片链接
- **日报**：把「这吧今天在聊什么、哪条值得点开」写成 markdown，存在本地
- **签到**：未关注的吧先关注（app 端签名接口）再签到，每天一次
- **回帖（默认关闭）**：按接话 / 共鸣 / 玩梗 / 答疑四种意图回复，受四道限制
- **人设与语气**：人设可直接写或导入文件，另有语气样本供回帖参考
- **日记**：公开（给使用者看）与私人（需手动翻开）两份，各有开关
- **定时**：单点时间，或按 DeepSeek 谷时（中午谷 12–14 / 晚上谷 18–次日 9）自动跑
- **后台运行**：模型轮为独立子进程，关闭设置页也会继续跑完
- **风控熔断**：撞到验证码后暂停 30 分钟（可配置），期间不发送任何请求
- **自检**：一键检查 curl / 凭证 / 吧名 / 目录 / headless 环境

## 安装

```bash
dsh plugin --profile web add dsh-tieba-scroll                    # npm（发布后）
dsh plugin --profile web add github:Nekomeow114/dsh-tieba-scroll # 或从仓库
```

安装后重启一次 dsh，进入 **设置 → 刷贴吧**。

**环境要求**：Node 22+、`curl`（Linux / macOS 自带，Windows 10+ 自带）。

Windows 说明：npm 安装的 `dsh` 是 `.cmd` 启动器，插件会通过 `cmd.exe` 调起，
并把这一轮的 prompt 落成文件、命令行只传一句「读取该文件」——避免长文本里的引号和换行被 cmd 拆坏。定时功能另需在 headless profile 中安装本插件：

```bash
dsh plugin --profile headless add dsh-tieba-scroll
```

## 设置页结构

```
A 账号与刷帖   A1 账号 / A2 每一轮（吧列表、关键词、读几贴）
B 人设与表达   B1 人设 / B2 图片库（规划中）
C 行为与规则   C1 回帖规则 / C2 自动化
D 成长与记录   D1 演化 / D2 日记 / D3 版本与导出（规划中）
```

手机上默认只展开 A，其余大类折叠，标题旁显示状态摘要。

## 快速开始

1. **贴 BDUSS**：设置页「① 账号」→ 保存并测试 → 显示「登录态有效」即可
2. **填吧名**：一行一个；也可以点「读取已关注的吧」一键填入（会替换框内内容）
3. **刷一轮**：点击「刷一轮贴吧」，先只采集，确认读到的内容符合预期

BDUSS 获取方式：电脑浏览器登录贴吧 → `F12` → Application → Cookies → `https://tieba.baidu.com` → 复制 `BDUSS` 的 Value（带不带前缀均可）。也可使用 Kiwi + Cookie-Editor 扩展。

## 设置项

| 项 | 默认 | 说明 |
|---|---|---|
| `bars` | 空 | 要刷的吧，一行一个，必须自行填写 |
| `keywords` | 空 | 刷帖关键词：标题命中的帖子排在前面（不过滤） |
| `readPerRound` | 5 | 每轮读取帖子数 |
| `requestGapMs` | 1200 | 请求间隔（毫秒，最低 300） |
| `dedupeDays` | 7 | 已读帖子在该天数内不再推荐 |
| `autoSign` | 关 | 每天 `signHour` 点后自动签到 |
| `autoFollow` | 开 | 签到时未关注的吧自动关注 |
| `signAllFollowed` | 关 | 签到覆盖账号关注的所有吧（不只配置里的） |
| `autoReply` | 关 | 允许回帖 |
| `replyPerRound` / `replyPerDay` | 1 / 3 | 每轮 / 全天回帖上限 |
| `replyGapSec` | 30 | 两条回复的最小间隔 |
| `answerQuestions` | 开 | 允许在回帖中解答疑问 |
| `toneGate` | 开 | 拦截客服腔（首先 / 其次 / 希望对你有帮助 等） |
| `mention` | 空 | 回帖时 @ 的昵称 |
| `peakValley` | 关 | 峰谷自动刷总开关 |
| `noon` / `night` | 开 / 开 | 中午谷、晚上谷子开关 |
| `breakerMin` | 30 | 撞到验证码后的熔断时长（0 表示不熔断） |
| `personaText` / `personaFile` | 空 | 人设文本 / 人设文件（文件优先） |
| `styleSamples` | 空 | 语气样本，供回帖参考 |
| `evolvePersona` | 关 | 人设演化：从吧里提炼语气样本，**主人采纳才生效** |
| `diaryEnabled` / `diaryPrivate` | 开 / 开 | 日记总开关 / 私人日记开关 |

配置保存在 `$DSH_HOME/tieba-duty/config.json`（600），通过 `/api/tieba-duty/config` 读写。

## 回帖限制

回帖默认关闭。开启后同时受到以下限制：

1. `autoReply` 必须开启；
2. `toneGate`：命中客服腔词表会被退回改写；
3. 每轮不超过 `replyPerRound` 条，全天不超过 `replyPerDay` 条；
4. 两条之间至少间隔 `replyGapSec` 秒，同一帖子一天只回一次；
5. 正文 4~400 字，不支持链接。

另支持可选 `@`：正文末尾追加 `@昵称 `（贴吧的 @ 用于提醒他人，格式需带空格）。

## 工具

供模型调用：

| 工具 | 说明 |
|---|---|
| `tieba_whoami` | 登录态检查 |
| `tieba_list` | 列出吧内帖子（id / 标题 / 回复数 / 是否读过） |
| `tieba_thread` | 读取楼层正文与图片链接 |
| `tieba_sign` | 签到（未关注会先关注） |
| `tieba_reply` | 回帖（需 `confirm: true`，受上述限制） |
| `tieba_follow` | 关注一个吧 |
| `tieba_followed` | 列出账号关注的所有吧 |
| `tieba_settings` | 读取当前配置 |
| `tieba_persona` | 读取人设与语气样本 |
| `tieba_report_write` / `tieba_report_read` / `tieba_reports` | 日报写入 / 读取 / 列表 |
| `tieba_diary_write` / `tieba_diary_read` | 日记写入 / 读取（私人需显式确认） |
| `tieba_my_replies` | 本地记录：最近回复过哪些帖子 |
| `tieba_selfcheck` | 环境自检 |
| `tieba_evolve_propose` | 提 1~3 句语气样本（不直接改人设） |

## 定时运行

设置页开启「峰谷自动刷」后，到达谷时窗口会启动一轮：

```bash
dsh --profile headless "<prompts/duty.md>"
```

- 每个谷时窗口每天执行一次；两次自动轮之间至少间隔 6 小时；
- headless 子进程内不会再次启动调度器，避免递归触发；
- 20 分钟超时，输出写入 `$DSH_HOME/tieba-duty/logs/run-YYYY-MM-DD.log`。

## 跨插件（文件契约）

插件之间**不 import 对方代码**，只共享 `$DSH_HOME/shared/`：

```
shared/
├─ plugins/<name>.json   能力报到：provides / consumes / version
└─ events/<date>.jsonl   事件流：tieba.round.start / end、tieba.reply
```

- 启动时写自己的清单（`provides: tieba.read / tieba.reply / tieba.digest / tieba.events`）；
- 每轮开始/结束、每成功回一帖，追加一行事件；
- 装了 `dsh-memory` 时，`consumes` 会带上 `memory`，`/api/tieba-duty/integrations` 能查到；
- 对方没装 → 文件不存在，跳过，不报错；
- **兼容逻辑只写在刷贴吧自己里**：扫共享目录、探测能力，不修改、也不依赖其他插件的代码；
- 探测结果会以一小段「这一轮可用的外部能力」拼进 prompt（没有就不占字数），设置页也会显示「已连接：…」。

## 数据目录

```
$DSH_HOME/tieba-duty/
├─ cookie.txt     # BDUSS（600）
├─ jar.txt        # curl cookie jar（600）
├─ config.json    # 配置（600）
├─ state.json     # 当日计数 / 签到记录 / 已读去重 / 熔断状态
├─ audit.jsonl    # 回帖留痕（内容 / 意图 / 结果）
├─ reports/       # 日报与原始采集数据
├─ diary/         # public.md / private.md
└─ logs/          # 定时运行日志
```

卸载插件不会删除这些文件。

## 实现说明

**通道选择**（实测结果）：

| 通道 | 结果 |
|---|---|
| `/f?kw=` + 桌面 UA | 302 / 403（安全验证） |
| `/f?kw=` + 手机 UA | 200，但仅「贴吧小程序」空壳 |
| `/p/<id>` | 403 |
| `/mo/q/m?kw=` | 200，可解析帖子列表 |
| `/mo/q/m?kz=<id>` | 200，可解析楼层正文 |
| `/sign/add` | 签到可用（需 `tbs`） |
| `/f/commit/post/add` | 回帖可用（需 `fid` + `tbs`） |

因此仅使用手机版页面，解析器依赖页面结构；单测内置真实页面 fixture 以便回归。

**TLS 指纹**：同一凭证与请求头，`curl` 返回 `is_login:1`，Node `fetch`（undici）返回 `is_login:0`。
网络层因此使用 `curl` 子进程，cookie 仅通过 jar 文件传递，不出现在命令行参数中。

**频率控制**：请求串行、间隔可配、`tbs` 与 `fid` 有缓存；撞到验证码即触发熔断，期间不重试。

## 三层人设

| 层 | 内容 | 能不能改 |
|---|---|---|
| 核心层 | 名字 / 自称 / 对使用者的称呼 / 底线 | 代码常量，**改不了** |
| 性格层 | 抽象、毒舌、温柔、话痨、发图倾向（0~10） | 可调 |
| 语气层 | 语气样本、口癖、句长、标点 | 可调 |

每次修改前存一份完整快照（`persona-versions/vNNNN.json`），版本号 +1；可回滚，
回滚本身也会生成新版本，旧历史不丢。

## 导出

D3 里可导出当前或任意历史版本：

- **文本**：核心层 + 旋钮 + 语气层 + 版本号 + 导出时间，可直接粘回 B1；
- **JSON**：`{ format, schema, version, traits, voice, exportedAt }`，用于备份；
- 已脱敏：含路径/链接/凭证字样的样本会被剔除，不含吧友原话与用户名；图片库不随人设导出。

## 保险机制

| 机制 | 行为 |
|---|---|
| 漂移评分 | 与 v1 快照比，0~1；≥0.3 提醒，≥0.5 日记里标红 |
| 暂停 / 恢复 | D1 一键；暂停只停演化，日记与回帖照常 |
| 被删联动 | 最近 7 天被删 ≥3 条 → 自动暂停，并写私人日记 |
| 版本快照 | 每次改动前存完整快照，可回滚 |
| 单步限制 | 旋钮 ±1、样本 1~3 条 |

## 人设演化（可选）

打开 `evolvePersona` 后，每轮读完可以提 **1~3 句**「这个吧的人怎么说话」的样本：

- 只提说话方式（断句、口气、常用词），不提内容、人名、梗的出处；
- 样本 3~40 字，含路径/链接/凭证的直接丢弃；
- 写进 `persona-proposals.json`，**设置页里点「采纳」才并进人设**，不自动改；
- 只追加样本，不删除已有内容；总数有上限。

## 安全边界

- **出站内容过滤**：回复里出现本机路径（`/root`、`~/.dsh`、`C:\`）、链接、`BDUSS`/`token` 字样
  会被直接拒绝，改成不带这些的说法才能发；
- **本地接口只接受同源**：带其他 `Origin` 的请求一律 403（挡本机恶意页面）；
- BDUSS 只存本地 `cookie.txt`（600），不回显、不写日志、不进仓库；
- 回帖默认关闭，开启后仍有每轮/每天/间隔/同帖四道闸；
- 已知风险：模型仍可能被帖子内容诱导，**自动回帖用的是账号本人身份**——建议用小号。

## 已知限制

- 贴吧改版会导致解析失效（单测会先失败）；
- 无法读取消息通知，也不支持楼中楼回复（贴吧无公开接口）；
- 不支持修改头像 / 昵称等账号资料；
- 未实现吧内搜索；
- 桌面版 DSH 的 peer 依赖问题由 `lib/toolkit.mjs` 兜底。

## 开发

```bash
npm test        # smoke（解析器）+ gates（纯函数）+ apply（挂载）三套，全部离线
```

结构：

```
index.js          # 主机半端：工具、HTTP、调度
client.js         # 浏览器半端：设置页
lib/tieba.js      # 抓取与解析
lib/config.mjs    # 配置默认值与归一化
lib/state.mjs     # 运行状态
lib/cooldown.mjs  # 风控熔断
lib/runner.mjs    # headless 子进程
lib/toolkit.mjs   # defineTool 兜底
prompts/duty.md   # 一轮的执行说明（可修改）
test/             # 单测与真实页面 fixture
```

添加 fixture 前必须清理凭证：贴吧页面包含「退出登录」链接，其中带有 `sid=<BDUSS>`。
提交前执行：

```bash
grep -c "<BDUSS 前 20 位>" test/fixtures/*.html   # 结果必须为 0
```

## 免责声明

非官方接口，可能随时失效或触发风控。使用即表示理解并承担账号风险，以及所发布内容带来的责任。

## License

MIT

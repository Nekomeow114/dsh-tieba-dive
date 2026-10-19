# dsh-tieba-scroll · 刷贴吧

[![test](https://github.com/Nekomeow114/dsh-tieba-scroll/actions/workflows/test.yml/badge.svg)](https://github.com/Nekomeow114/dsh-tieba-scroll/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/dsh-tieba-scroll.svg)](https://www.npmjs.com/package/dsh-tieba-scroll)

> DSH 插件：每天替你看几个百度贴吧 —— 读帖、挑值得看的、写一份日报；
> 可选「签到」和「回帖」（**默认都是关的**，回帖还有每日条数 / 间隔 / 去重三道闸）。

像 [dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) 一样，是个「替你看、替你说一句」的小助手，不是爬虫。

---

## 为什么不用官方 API

贴吧的开放接口早就下线了，这条路咱是一条条撞出来的，直接写在这儿省得后来人再撞：

| 通道 | 结果 |
|---|---|
| `/f?kw=xxx` + 桌面 UA | **302 / 403**（`百度安全验证`） |
| `/f?kw=xxx` + 手机 UA | 200，但只是「贴吧小程序」空壳（~7KB），没有帖子 |
| `/p/<id>`（帖子页） | 403 |
| **`/mo/q/m?kw=xxx`** | ✅ 200，370KB，能解析出帖子列表 |
| **`/mo/q/m?kz=<id>`** | ✅ 200，能解析出楼层正文 |
| `/sign/add`（POST） | ✅ 签到可用（要 `tbs`） |
| `/f/commit/post/add`（POST） | ✅ 回帖可用（要 `fid` + `tbs`） |

所以本插件**只走手机版页面**。代价是：贴吧一改版，解析器就得跟着改 —— 单测里放了真实页面做 fixture，就是为了让这件事可测。

### 还有一个坑：TLS 指纹

同一串 BDUSS、同一组 header：

| 客户端 | `tbs` 返回 |
|---|---|
| `curl` | `{"is_login":1}` ✅ |
| Node `fetch`（undici） | `{"is_login":0}` ❌ |

百度认的是 TLS 指纹，不是 cookie 内容。所以本插件**用 `curl` 发请求**（`child_process.spawn`），
cookie 从 jar 文件读、**不进 argv**（`ps` 里看不到）。
⇒ **需要机器上有 `curl`**：Linux / macOS 自带，Windows 10 及以上也自带 `curl.exe`。

## 安装

```bash
dsh plugin --profile web add dsh-tieba-scroll                    # npm
dsh plugin --profile web add github:Nekomeow114/dsh-tieba-scroll # 或直接从仓库装
```

装完**重启一次 DSH**（bundle 要重新组装）。

## 配置

进 **设置 → 刷贴吧**：

1. **BDUSS**：贴进来 → 「保存并测试」。
   从哪拿：电脑浏览器登录贴吧 → `F12` → Application → Cookies → `https://tieba.baidu.com` → 找 `BDUSS`，复制它的 **Value**（带不带 `BDUSS=` 前缀都行）。
   **不会拿也没关系**：直接在聊天里问「教我怎么拿贴吧的 BDUSS」，助手会一步步带。
   （手机上可以用 Kiwi + Cookie-Editor 扩展。）
2. **要刷的吧**：一行一个，默认 `deepseek`、`甜食少女嫁人图书馆`。
3. 下面这些都在**插件自己的设置页**里改（不依赖宿主自动表单）：
   - 要刷的吧（一行一个）
   - 自动签到（每天 `signHour` 点后一次）
   - 每轮刷多少：读几个楼（默认 5）、回几条（默认 1）
   - 允许回帖（**默认关**）+ 每天条数 + 间隔秒数

   配置落盘在 `$DSH_HOME/tieba-duty/config.json`（600），走 `/api/tieba-duty/config` 读写。

### 关于 BDUSS 的实话

- 它等于你的登录态：拿到就能以你的身份发帖、看私信；
- 插件只把它写到 `$DSH_HOME/tieba-duty/cookie.txt`（权限 600），**不回显、不进日志、不写进仓库**；
- **用完请去「账号安全 → 退出所有设备」**，这串立刻作废；
- 长期用建议给小号。

## 工具（给模型用的）

| 工具 | 干什么 |
|---|---|
| `tieba_whoami` | 登录态自检 |
| `tieba_list` | 列某个吧的帖子（id / 标题 / 回复数） |
| `tieba_thread` | 读帖子楼层正文 |
| `tieba_sign` | 签到（一天一次，幂等） |
| `tieba_reply` | 回一条（必须 `confirm: true`，受每日上限/间隔/去重限制） |
| `tieba_follow` | 关注一个吧（app 端签名接口，已关注则 `already: true`） |
| `tieba_settings` | 看当前配置（吧列表 / 每轮读几条回几条 / 各开关） |
| `tieba_report_write` | 写当天日报（`reports/YYYY-MM-DD.md`） |
| `tieba_report_read` | 读日报（今天 / 最近一份 / 指定日期） |
| `tieba_reports` | 列出已有日报 |
| `tieba_persona` | 读当前人设（设置页里写的，或指向的文件） |
| `tieba_diary_write` | 写日记：`public` 给主人看 / `private` 私人 |
| `tieba_diary_read` | 读日记：读 `private` 必须显式 `confirm: true` |

## 定时跑一轮

设置页里可以打开「每天 N 点后自动跑一次」：到点后插件起一个
`dsh --profile headless "<prompts/duty.md>"`，让模型自己读帖、写日报。

- 默认**关**；一天只跑一次；20 分钟超时；同一时间只允许一轮；
- 输出全量写进 `$DSH_HOME/tieba-duty/logs/run-YYYY-MM-DD.log`，设置页能直接看；
- ⚠️ **前提**：headless profile 里也要装本插件，否则子进程里没有 `tieba_*` 工具：
  ```bash
  dsh plugin --profile headless add dsh-tieba-scroll
  # 本地开发：add link:/path/to/dsh-tieba-scroll
  ```

## 设置页上的两个按钮

- **抓取一轮**：只采集——列帖 → 读 `readPerRound` 个楼 → 落成 `reports/raw-YYYY-MM-DD.json`
  （含每楼的正文摘要和**图片链接**），不生成日报；
- **看最近日报**：直接读 `reports/` 里最新那份。

采集和生成分开：模型读原始数据再写日报，人可以随时看原始数据、判断它是不是在瞎编。

## 回帖的三道闸

0. 设置里 `autoReply` 打开（默认关）；
1. `toneGate`（默认开）：正文里出现「首先 / 其次 / 希望对你有帮助」这类客服腔会被退回改写，**长短不限**；
2. 每天不超过 `replyPerDay` 条（默认 3）、两条之间至少 `replyGapSec` 秒（默认 30）；
3. 同一个帖子一天只回一次，内容 4~400 字，不许重复。

另有可选的 `@`：设置页填「回复时 @ 谁」，或单次调用传 `mention`。
贴吧的 @ 是**提醒别人**（格式 `@昵称 ` 跟空格），跟 B 站「@ 自己收通知」不是一回事；
留空就不带，`mentionEvery` 控制是否每条都带。

满一条都拒 —— 宁可少发，不发错。

## 数据都在哪

```
$DSH_HOME/tieba-duty/
├─ cookie.txt      # BDUSS（600）
├─ state.json      # 今天回了几条 / 签到记录 / 已读去重
├─ audit.jsonl     # 每次回帖留痕（发了什么、意图、结果）
├─ diary/          # 日记（public.md / private.md）
└─ reports/        # 日报（YYYY-MM-DD.md）
```

卸载插件不会删这些。

## 开发

```bash
npm test          # = smoke（解析器）+ gates（闸门/配置/日报/状态），全部离线
npm run test:gates
```

⚠️ **加 fixture 之前必须洗凭证**：贴吧页面里有一个「退出登录」链接，
形如 `wappass.baidu.com/passport/?logout&sid=<BDUSS>&u=...` —— **整个 BDUSS 就在里面**。
咱第一次提交就踩了（`git log` 里能看到修复），现在 `test/fixtures/*.html` 里的那一段已替换成 `REDACTED_BDUSS`。
往仓库里贴任何抓下来的页面之前，先跑一遍：

```bash
grep -c "<你的 BDUSS 前 20 位>" test/fixtures/*.html   # 必须是 0
```

仓库结构：

```
index.js          # host 半端：工具 + 设置命名空间 + HTTP + 签到定时器
client.js         # 浏览器半端：设置页
lib/tieba.js      # 抓取 + 解析（parseList / parseThread 单独导出，方便测）
lib/state.mjs     # 运行状态
lib/toolkit.mjs   # defineTool 的取法（宿主没给就本地兜底）
prompts/duty.md   # 一轮要做什么（用户可以改）
test/             # smoke + 真实页面 fixture
```

## 1.0 能做什么

一句话：**每天替你看几个吧，读帖、写日报、签到、按设置回帖，全在本地跑。**

| | |
|---|---|
| 读 | 多吧列表、楼层正文、帖子图片链接 |
| 写 | 日报（`reports/`）、公开/私人日记、日志 |
| 动 | 签到（自动关注）、回帖（四道闸）、可选 @ |
| 跑 | 手动「刷一轮贴吧」/ 定时 / 峰谷两窗口 / 后台 detached |
| 管 | 人设（写或导入文件）、每轮读几回几、请求间隔、各开关 |

## 已知限制

- 贴吧改版 → 解析器失效（单测会先红）；
- 频繁请求会触发风控：所有请求串行 + 1.2 秒间隔，**别拿它当爬虫**；
- 头像 / 昵称这类资料修改，**没有可用接口**（试过 `/setting/user/*` 全是 404），本插件不做；
- 桌面版 DSH 的 peer 依赖问题参考 dsh-bili-scroll 的处理方式（`lib/toolkit.mjs` 就是为这个留的）。

## 免责声明

非官方接口，随时可能失效或被风控。使用即表示你了解：账号风险、封号风险、以及「发出去的话是算你的」这件事，都由使用者自己承担。

## License

MIT

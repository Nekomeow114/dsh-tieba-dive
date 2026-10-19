# 给 AI 助手看的（这个仓库 = 一个 DSH 插件）

`dsh-tieba-scroll`（中文名「**刷贴吧**」）：每天替用户看几个百度贴吧，读帖、挑值得的、写日报；
可选签到与回帖（**默认都关**）。

## 帮用户安装时，按这个顺序

1. 装：
   ```bash
   dsh plugin --profile web add dsh-tieba-scroll
   # 或 github:<name>/dsh-tieba-scroll
   ```
2. ⚠️ **提醒重启一次 dsh**（bundle 层要重启才组装）。
3. 让用户进 **设置 → 刷贴吧**，贴 `BDUSS`，点「保存并测试」。
   - 从哪拿：电脑浏览器登录贴吧 → F12 → Application → Cookies → tieba.baidu.com → `BDUSS` 的 Value，
     前面补 `BDUSS=`；
   - 手机上：Kiwi + Cookie-Editor 扩展（扩展有 Copy 按钮，比手抄靠谱 —— **BDUSS 里 l/I/1 极容易看错**）。
4. **别擅自打开「允许回帖」** —— 那是拿用户的号在公开场合说话。要用让用户自己开，并说清每日上限。

## 常见故障

| 现象 | 原因 / 处理 |
|---|---|
| 返回「百度安全验证」 | BDUSS 失效，或出口 IP 被要求滑块 → 让用户重新贴一次；大量请求也会触发 |
| `is_login=0` | 这串没被认成登录态：抄错一个字符就会这样，**用复制、别手打** |
| 列表为空、页面 ~7KB | 贴吧改版或落到「贴吧小程序」壳 → 解析器要更新 |
| 桌面版装了看不到页面 | peer 依赖问题，见 `lib/toolkit.mjs` 的兜底 |

## 约定

- 凭证与运行数据都在 `$DSH_HOME/tieba-duty/`，**不写进插件包目录**、不进 git；
- 请求串行 + 1.2s 间隔；回帖另有每日上限与间隔闸门；
- `prompts/duty.md` 是给模型的一轮说明书，**用户可以直接改**。

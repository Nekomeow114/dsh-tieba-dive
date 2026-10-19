/**
 * dsh-tieba-scroll —— 浏览器半端（设置里的「刷贴吧」）
 *
 * 布局原则（2026-10 重排）：
 *   · 顶部一条状态带：凭证 / 今天回了几条 / 当前峰谷 / 上次跑完 —— 一眼看全；
 *   · 下面六张卡，按「会用的频率」排：账号 → 每一轮 → 人设 → 自动化 → 回帖规则 → 日记；
 *   · 后三张默认折叠（<details>），低频设置不占视线；
 *   · 回帖的配额数字**只出现在「回帖规则」**里，别在别处重复第二份；
 *   · 长内容（日报 / 日志 / 日记）折叠展示，不撑开页面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-tieba-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/tieba-duty'
    const parse = async (r) => {
      const t = await r.text()
      try { return JSON.parse(t) } catch {
        throw new Error(`接口返回的不是 JSON（HTTP ${r.status}）：${t.slice(0, 120)}`)
      }
    }
    const jget = async (p) => parse(await fetch(API + p, { credentials: 'same-origin' }))
    const jpost = async (p, body) => parse(await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }))

    const CSS = `
      .tb { padding: 14px 16px 28px; max-width: 700px; font-size: 14px; color: #22303f; }
      .tb-h { font-size: 16px; font-weight: 700; margin: 0 0 3px; }
      .tb-sub { color: #7a8ba6; font-size: 12.5px; line-height: 1.6; margin-bottom: 12px; }
      .tb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      .tb-chip { background: #f1f6fd; color: #40597f; border-radius: 999px;
        padding: 4px 10px; font-size: 12px; line-height: 1.4; }
      .tb-chip.ok { background: #e8f7ee; color: #178a4c; }
      .tb-chip.warn { background: #fff6e5; color: #8a6414; }
      .tb-card { border: 1px solid #e2eaf5; border-radius: 12px; background: #fff;
        padding: 12px 14px; margin-bottom: 12px; }
      .tb-card > summary { cursor: pointer; font-weight: 600; list-style: none; }
      .tb-card > summary::-webkit-details-marker { display: none; }
      .tb-card > summary::before { content: '▸ '; color: #8fa8cc; }
      .tb-card[open] > summary::before { content: '▾ '; }
      .tb-tag { color: #8fa8cc; font-weight: 400; font-size: 12px; margin-left: 6px; }
      .tb-body { margin-top: 10px; }
      .tb-label { font-weight: 600; font-size: 13px; margin: 10px 0 6px; display: block; }
      .tb-in, .tb-ta { width: 100%; box-sizing: border-box; padding: 8px 10px;
        border: 1px solid #d3dce8; border-radius: 8px; font-size: 13px;
        font-family: inherit; background: #fff; color: #22303f; }
      .tb-ta { min-height: 64px; resize: vertical; }
      .tb-num { width: 76px; padding: 7px 8px; border: 1px solid #d3dce8; border-radius: 8px;
        font-size: 13px; text-align: center; }
      .tb-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0; }
      .tb-kv { color: #54657c; font-size: 12.5px; line-height: 1.8; }
      .tb-btn { border: 0; border-radius: 8px; padding: 8px 13px; font-size: 13px;
        cursor: pointer; background: #2d6cdf; color: #fff; }
      .tb-btn:disabled { opacity: .55; cursor: default; }
      .tb-btn.ghost { background: #eef3fb; color: #2d6cdf; }
      .tb-btn.sm { padding: 5px 10px; font-size: 12px; }
      .tb-msg { margin-top: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
      .tb-msg.ok { color: #178a4c; } .tb-msg.err { color: #c0392b; }
      .tb-sw { display: flex; align-items: center; gap: 8px; margin: 7px 0; }
      .tb-pre { white-space: pre-wrap; max-height: 220px; overflow: auto; margin-top: 8px;
        background: #f7faff; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
      .tb-warn { background: #fff8e6; border: 1px solid #f0d9a0; color: #7a5a12;
        padding: 9px 11px; border-radius: 8px; font-size: 12px; line-height: 1.7; margin: 10px 0; }
    `

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err } }
      render() {
        if (this.state.err) {
          return h('div', { className: 'tb' }, [
            h('div', { key: 't', className: 'tb-h' }, '刷贴吧 · 面板出错了'),
            h('div', { key: 'm', className: 'tb-msg err' }, String(this.state.err.message || this.state.err)),
            h('div', { key: 's', className: 'tb-pre' }, String(this.state.err.stack || '').split('\n').slice(0, 6).join('\n')),
            h('div', { key: 'h', className: 'tb-kv' }, '把这段发给大肥鱼，它照着修。'),
          ])
        }
        return this.props.children
      }
    }

    const Sw = ({ on, onChange, text }) => h('label', { className: 'tb-sw' }, [
      h('input', { key: 'c', type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked) }),
      h('span', { key: 't', className: 'tb-kv' }, text),
    ])

    function Panel() {
      const [cookie, setCookie] = React.useState('')
      const [cfg, setCfg] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [live, setLive] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [cookieMsg, setCookieMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [report, setReport] = React.useState(null)
      const [diary, setDiary] = React.useState(null)
      const [runLog, setRunLog] = React.useState(null)

      const refresh = React.useCallback(async () => {
        try {
          const st = await jget('/status')
          setStatus(st)
          if (st && st.cfg) setCfg((cur) => cur || st.cfg)
        } catch (e) {
          const m = String(e.message || e)
          setMsg({ ok: false, text: m.includes('404')
            ? '接口 404：插件的「主机半端」还没加载（webServer 未就绪或插件没起来）。重启一次 DSH 再看。'
            : '读状态失败：' + m })
        }
      }, [])
      React.useEffect(() => { refresh() }, [refresh])

      React.useEffect(() => {
        let alive = true
        let n = 0
        const tick = async () => {
          try {
            const st = await jget('/run-status')
            if (alive) setLive(st)
            if (n++ % 5 === 0) { const s2 = await jget('/status'); if (alive && s2 && s2.cfg) { setStatus(s2); setCfg((cur) => cur || s2.cfg) } }
          } catch { /* 等接口 */ }
        }
        tick(); const t = setInterval(tick, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      const save = async (patch) => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/config', patch)
          setCfg(r.cfg); setMsg({ ok: true, text: '已保存' }); await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }
      const num = (key) => ({
        value: cfg ? cfg[key] : '',
        onChange: (e) => setCfg({ ...(cfg || {}), [key]: e.target.value }),
        onBlur: () => save({ [key]: Number(cfg && cfg[key]) }),
      })

      const saveCookie = async () => {
        if (!cookie.trim()) { setCookieMsg({ ok: false, text: '先粘贴 BDUSS（带不带前缀都行）' }); return }
        if (/^(ssh-|-----BEGIN)/i.test(cookie.trim())) {
          setCookieMsg({ ok: false, text: '这是 SSH 公钥（给 GitHub 的），不是 BDUSS。BDUSS 在贴吧 cookie 里，约 190 个字符。' }); return
        }
        setBusy(true); setCookieMsg(null)
        try {
          const r = await jpost('/cookie', { cookie })
          setCookieMsg(r.loggedIn ? { ok: true, text: '登录态有效 ✓ 凭证已存到本机' } : { ok: false, text: '没通过：' + (r.hint || 'is_login=0') })
          setCookie(''); await refresh()
        } catch (e) { setCookieMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const signNow = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/sign', {})
          const lines = (r.results || []).map((x) => x.ok
            ? '✓ ' + x.kw + '：签到成功' + (x.count == null ? '' : '（累计 ' + x.count + ' 天）')
              + (x.followed && !x.wasFollowing ? ' · 顺手关注' : '')
            : '✗ ' + x.kw + '：' + (x.error || x.msg || '失败'))
          setMsg({ ok: lines.every((l) => l.charAt(0) === '✓'), text: lines.join('\n') || '没有可签到的吧' })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const runRound = async () => {
        setBusy(true); setMsg({ ok: true, text: '采集中…（每读一个贴约 1 秒）' })
        try {
          const r = await jpost('/run', {})
          const lines = (r.bars || []).map((b) => b.error
            ? '✗ ' + b.kw + '：' + b.error
            : '✓ ' + b.kw + '：读到 ' + b.read + ' 个贴（新帖 ' + b.fresh + ' 个）')
          let tail = ''
          const c = cfg || {}
          if (c.autoReply && (c.replyPerRound ?? 1) > 0) {
            setMsg({ ok: true, text: lines.join('\n') + '\n\n接着让模型跑一轮…' })
            const rr = await jpost('/run-headless', {})
            tail = '\n模型轮：' + (rr.started ? '已在后台启动' : (rr.error || '没启动')) + '（日志见「自动化」）'
          }
          setMsg({ ok: (r.bars || []).every((b) => !b.error), text: lines.join('\n') + tail })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const runModel = async () => {
        if (!window.confirm('跑一轮会起一个 headless 子进程，让模型读帖、写日报、按设置回帖，可能要几分钟。现在跑？')) return
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/run-headless', {})
          setMsg({ ok: !!r.started, text: (r.started ? '模型轮已在后台跑。' : (r.error || '没启动。')) + '\n' + (r.hint || '') })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const showReport = async () => {
        setBusy(true)
        try { const r = await jget('/report?latest=1'); setReport(r.ok ? r : { text: r.error || '还没有日报' }) }
        catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }
      const showLog = async () => {
        setBusy(true)
        try { setRunLog(await jget('/logs')) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }
      const showDiary = async (scope) => {
        if (scope === 'private' && !window.confirm('这是大肥鱼的私人日记……\n\n只有主人能看。确定现在翻开吗？')) return
        setBusy(true)
        try { setDiary(await jget('/diary?scope=' + scope)) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }
      const importPersona = (e) => {
        const f = e.target.files && e.target.files[0]; e.target.value = ''
        if (!f) return
        if (f.size > 200 * 1024) { setMsg({ ok: false, text: '文件太大（>200KB）' }); return }
        const rd = new FileReader()
        rd.onload = () => {
          const text = String(rd.result || '')
          setCfg((cur) => ({ ...(cur || {}), personaText: text, personaFile: '' }))
          setMsg({ ok: true, text: `已读入「${f.name}」（${text.length} 字），点「保存人设」生效` })
        }
        rd.readAsText(f, 'utf-8')
      }

      const c = cfg || { bars: [], readPerRound: 5, replyPerRound: 1, replyPerDay: 3, replyGapSec: 30, requestGapMs: 1200, signHour: 9, runHour: 21 }
      const running = !!(live && live.busy)
      const hasCookie = !!(status && status.hasCookie)

      return h('div', { className: 'tb' }, [
        h('div', { key: 'h', className: 'tb-h' }, '刷贴吧'),
        h('div', { key: 's', className: 'tb-sub' }, '每天替你看几个吧：读帖、写日报、签到，回帖可选。'),

        // ── 状态带 ──
        h('div', { key: 'chips', className: 'tb-chips' }, [
          h('span', { key: 'a', className: 'tb-chip ' + (hasCookie ? 'ok' : 'warn') }, hasCookie ? '凭证 ✓' : '未登录'),
          h('span', { key: 'b', className: 'tb-chip' }, '今天已回 ' + (status ? (status.repliesToday || 0) : '–') + ' 条'),
          h('span', { key: 'c', className: 'tb-chip ' + (status && status.valley && status.valley.isValley ? 'ok' : 'warn') },
            status && status.valley ? '现在：' + status.valley.now : '峰谷：未知'),
          h('span', { key: 'd', className: 'tb-chip' }, live && live.busy ? (live.collecting ? '采集中…' : '模型轮进行中…') : '空闲'),
          h('span', { key: 'e', className: 'tb-chip' }, live && live.lastRunDate ? '上次跑完 ' + live.lastRunDate : '还没跑过'),
        ]),

        // ── ① 账号 ──
        h('div', { key: 'acct', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, '① 账号'),
          h('input', {
            key: 'i', className: 'tb-in', type: 'text', placeholder: 'BDUSS=... 或只贴值（自动补前缀）',
            value: cookie, onChange: (e) => setCookie(e.target.value),
          }),
          h('div', { key: 'r', className: 'tb-row' }, [
            h('button', { key: 'b', className: 'tb-btn', disabled: busy, onClick: saveCookie }, '保存并测试'),
            h('span', { key: 'k', className: 'tb-kv' }, '不知道去哪拿？在聊天里问「教我怎么拿贴吧的 BDUSS」'),
          ]),
          h('div', { key: 'w', className: 'tb-warn' },
            'BDUSS 等于登录凭证，只存本机（600）。想清除就去贴吧「账号安全 → 退出所有设备」。'),
          h('div', { key: 'bl', className: 'tb-label' }, '要刷的吧（一行一个）'),
          h('textarea', {
            key: 'ba', className: 'tb-ta', value: (c.bars || []).join('\n'),
            onChange: (e) => setCfg({ ...c, bars: e.target.value.split('\n') }),
          }),
          (!c.bars || c.bars.length === 0) ? h('div', { key: 'emp', className: 'tb-warn' },
            '还没填任何吧。要刷哪些吧，必须由主人自己填——贴吧名字差一个字就白跑，所以默认不替主人猜。') : null,
          h('div', { key: 'br', className: 'tb-row' }, [
            h('button', { key: 'b', className: 'tb-btn ghost', disabled: busy,
              onClick: () => save({ bars: (c.bars || []).map((x) => x.trim()).filter(Boolean) }) }, '保存吧列表'),
          ]),
        ]),

        // ── ② 每一轮 ──
        h('div', { key: 'round', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, '② 每一轮'),
          h('div', { key: 'n', className: 'tb-row' }, [
            h('span', { key: 'a', className: 'tb-kv' }, '读'),
            h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('readPerRound') }),
            h('span', { key: 'c', className: 'tb-kv' }, '个贴 · 回几条在「回帖规则」里'),
            h('span', { key: 'd', className: 'tb-kv', style: { marginLeft: 'auto' } }, '请求间隔'),
            h('input', { key: 'e', className: 'tb-num', type: 'number', ...num('requestGapMs') }),
            h('span', { key: 'f', className: 'tb-kv' }, 'ms'),
          ]),
          h('div', { key: 'kw', className: 'tb-row' }, [
            h('span', { key: 'a', className: 'tb-kv' }, '关键词'),
            h('input', { key: 'b', className: 'tb-in', style: { flex: 1, minWidth: 160 },
              placeholder: '逗号分隔，标题命中的排前面（可空）',
              value: (c.keywords || []).join('，'),
              onChange: (e) => setCfg({ ...c, keywords: e.target.value.split(/[，,]/) }),
              onBlur: () => save({ keywords: (c.keywords || []).map((x) => String(x).trim()).filter(Boolean) }) }),
          ]),
          h('div', { key: 'o', className: 'tb-row' }, [
            h('button', { key: 'r', className: 'tb-btn', disabled: busy || running, onClick: runRound },
              live && live.collecting ? '采集中…' : (live && live.running ? '模型轮进行中…' : '刷一轮贴吧')),
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: showReport }, '看最近日报'),
          ]),
          report ? h('pre', { key: 'rp', className: 'tb-pre' }, report.text || '（空）') : null,
        ]),

        // ── ③ 人设 ──
        h('div', { key: 'persona', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, '③ 人设'),
          h('textarea', {
            key: 'p', className: 'tb-ta', style: { minHeight: 92 },
            placeholder: '例：一只蓝发小鲸鱼，自称「咱」，说话短、软、爱夸人……',
            value: c.personaText || '',
            onChange: (e) => setCfg({ ...c, personaText: e.target.value }),
          }),
          h('div', { key: 'r', className: 'tb-row' }, [
            h('label', { key: 'l', className: 'tb-btn ghost sm', style: { cursor: 'pointer', margin: 0 } }, [
              '导入文件',
              h('input', { key: 'i', type: 'file', accept: '.md,.txt,.markdown,text/plain', style: { display: 'none' }, onChange: importPersona }),
            ]),
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
              onClick: () => save({ personaText: c.personaText || '', personaFile: c.personaFile || '' }) }, '保存人设'),
            h('span', { key: 'k', className: 'tb-kv' }, '也可以填文件路径（优先于文本框）'),
          ]),
          h('div', { key: 'sl', className: 'tb-label' }, '语气样本（3~5 句，让回帖更像人）'),
          h('textarea', {
            key: 'ss', className: 'tb-ta', style: { minHeight: 84 },
            placeholder: '例：\n「这书我也在看，节奏慢但挺上头」\n「哈？连这个都要问」\n「被你这么一说，我也有点想看了」',
            value: c.styleSamples || '',
            onChange: (e) => setCfg({ ...c, styleSamples: e.target.value }),
          }),
          h('div', { key: 'ssr', className: 'tb-row' }, [
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
              onClick: () => save({ styleSamples: c.styleSamples || '' }) }, '保存语气样本'),
            h('span', { key: 'k', className: 'tb-kv' }, '模型回帖前会读这几句，照着学长短和口气'),
          ]),
          h('input', { key: 'f', className: 'tb-in', style: { marginTop: 6 }, placeholder: 'persona.md 或 /绝对/路径.md',
            value: c.personaFile || '', onChange: (e) => setCfg({ ...c, personaFile: e.target.value }),
            onBlur: () => save({ personaFile: c.personaFile || '' }) }),
        ]),

        // ── ④ 自动化（折叠）──
        h('details', { key: 'auto', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['④ 自动化', h('span', { key: 't', className: 'tb-tag' }, '签到 · 峰谷定时')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'sg', on: c.autoSign, onChange: (v) => save({ autoSign: v }),
              text: '自动签到（每天 ' + c.signHour + ' 点后，未关注会先关注）' }),
            h('div', { key: 'sr', className: 'tb-row' }, [
              h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy, onClick: signNow }, '立即签到一次'),
            ]),
            h('div', { key: 'sep', style: { height: 1, background: '#eef2f8', margin: '10px 0' } }),
            h(Sw, { key: 'pv', on: c.peakValley, onChange: (v) => save({ peakValley: v }),
              text: '峰谷自动刷（工作日 9–12 / 14–18 之外算谷时）' }),
            h(Sw, { key: 'n', on: c.noon !== false, onChange: (v) => save({ noon: v }), text: '中午谷 12:00–14:00' }),
            h(Sw, { key: 'ni', on: c.night !== false, onChange: (v) => save({ night: v }), text: '晚上谷 18:00–次日 09:00' }),
            h('div', { key: 'st', className: 'tb-kv' },
              status && status.valley
                ? '现在：' + status.valley.now + (status.valley.window ? '（' + status.valley.window + '）' : '')
                  + (status.valley.next ? ' · 下次谷时 ' + String(status.valley.next).slice(5, 16).replace('T', ' ') : '')
                : ''),
            h('div', { key: 'r', className: 'tb-row' }, [
              h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy, onClick: runModel }, '现在跑一轮（模型）'),
              h('button', { key: 'l', className: 'tb-btn ghost sm', disabled: busy, onClick: showLog }, '看运行日志'),
            ]),
            runLog ? h('pre', { key: 'lg', className: 'tb-pre' }, runLog.text || runLog.error || '（空）') : null,
          ]),
        ]),

        // ── ⑤ 回帖规则（折叠）──
        h('details', { key: 'reply', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['⑤ 回帖规则', h('span', { key: 't', className: 'tb-tag' }, c.autoReply ? '已开启' : '默认关')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'a', on: c.autoReply, onChange: (v) => save({ autoReply: v }),
              text: '允许回帖（用这个号发公开回复）' }),
            h(Sw, { key: 'q', on: c.answerQuestions !== false, onChange: (v) => save({ answerQuestions: v }),
              text: '允许解答别人的疑问（关掉就只接话/共鸣/玩梗）' }),
            h(Sw, { key: 'g', on: c.toneGate !== false, onChange: (v) => save({ toneGate: v }),
              text: '拦客服腔（首先/其次/希望对你有帮助…）' }),
            h('div', { key: 'm', className: 'tb-row' }, [
              h('span', { key: 'a', className: 'tb-kv' }, '回复时 @'),
              h('input', { key: 'b', className: 'tb-in', style: { width: 150 }, placeholder: '昵称（留空不 @）',
                value: c.mention || '', onChange: (e) => setCfg({ ...c, mention: e.target.value }),
                onBlur: () => save({ mention: c.mention || '' }) }),
              h('label', { key: 'c', className: 'tb-kv', style: { display: 'flex', gap: 5, alignItems: 'center' } }, [
                h('input', { key: 'i', type: 'checkbox', checked: !!c.mentionEvery,
                  onChange: (e) => save({ mentionEvery: e.target.checked }) }), '每条都带',
              ]),
            ]),
            h('div', { key: 'quota', className: 'tb-row' }, [
              h('span', { key: 'a', className: 'tb-kv' }, '每轮最多'),
              h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('replyPerRound') }),
              h('span', { key: 'c', className: 'tb-kv' }, '条 · 间隔'),
              h('input', { key: 'd', className: 'tb-num', type: 'number', ...num('replyGapSec') }),
              h('span', { key: 'e', className: 'tb-kv' }, '秒 · 全天合计'),
              h('input', { key: 'f', className: 'tb-num', type: 'number', ...num('replyPerDay') }),
              h('span', { key: 'g', className: 'tb-kv' }, '条'),
            ]),
            h('div', { key: 'h', className: 'tb-kv' },
              '现状：一轮最多 ' + (c.replyPerRound ?? 1) + ' 条，全天最多 ' + (c.replyPerDay ?? 3) + ' 条'
              + ((c.replyPerRound ?? 1) > (c.replyPerDay ?? 3) ? '（⚠️ 一轮额度比全天还大）' : '')),
          ]),
        ]),

        // ── ⑥ 日记（折叠）──
        h('details', { key: 'diary', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['⑥ 日记', h('span', { key: 't', className: 'tb-tag' }, '公开 / 私人')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'e', on: c.diaryEnabled !== false, onChange: (v) => save({ diaryEnabled: v }), text: '允许写日记' }),
            h(Sw, { key: 'p', on: c.diaryPrivate !== false, onChange: (v) => save({ diaryPrivate: v }), text: '允许写私人日记' }),
            h('div', { key: 'r', className: 'tb-row' }, [
              h('button', { key: 'a', className: 'tb-btn ghost sm', disabled: busy, onClick: () => showDiary('public') }, '看给主人的日记'),
              h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy, onClick: () => showDiary('private') }, '翻开私人日记'),
            ]),
            diary ? h('pre', { key: 'd', className: 'tb-pre' }, (diary.text || '（还没有）') + '\n\n' + (diary.file || '')) : null,
          ]),
        ]),

        msg ? h('div', { key: 'm', className: 'tb-msg ' + (msg.ok ? 'ok' : 'err') }, msg.text) : null,
      ])
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-tieba-scroll')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-tieba-scroll: 设置页样式')
        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'tieba-scroll', order: 31, label: '刷贴吧' },
          () => h(Boundary, null, h(Panel)),
        ))
      },
    }
  },
})

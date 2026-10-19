/**
 * dsh-tieba-scroll —— 浏览器半端（设置里的「刷贴吧」一页）
 *
 * 自注册脚本：window.__ModuleLoader__.load({ id, factory })，id 必须等于包名。
 * 这一页自己管全部配置（不依赖宿主自动生成的表单），接口在 /api/tieba-duty/*。
 *
 * 设计原则：
 *   · 会发东西出去的（回帖）默认关，且写清代价；
 *   · 状态都从后端拿（关掉面板再回来能接上「进行中」）；
 *   · 面板渲染出错时显示错误，而不是一片空白（ErrorBoundary）。
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
      .tb-wrap { padding: 16px 18px; max-width: 720px; font-size: 14px; }
      .tb-wrap h2 { font-size: 16px; margin: 0 0 4px; }
      .tb-sub { color: #7a8ba6; font-size: 12.5px; margin-bottom: 14px; line-height: 1.6; }
      .tb-warn { background: #fff8e6; border: 1px solid #f0d9a0; color: #7a5a12;
        padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.7; margin-bottom: 16px; }
      .tb-field { margin-bottom: 16px; }
      .tb-label { font-weight: 600; margin-bottom: 6px; display: block; }
      .tb-input, .tb-area { width: 100%; box-sizing: border-box; padding: 8px 10px;
        border: 1px solid #d3dce8; border-radius: 8px; font-size: 13px; font-family: inherit;
        background: #fff; color: #22303f; }
      .tb-area { min-height: 60px; resize: vertical; }
      .tb-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .tb-btn { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
        background: #2d6cdf; color: #fff; }
      .tb-btn:disabled { opacity: .55; cursor: default; }
      .tb-btn.ghost { background: #eef3fb; color: #2d6cdf; }
      .tb-msg { margin-top: 10px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
      .tb-msg.ok { color: #178a4c; } .tb-msg.err { color: #c0392b; }
      .tb-kv { color: #54657c; font-size: 12.5px; line-height: 1.8; }
      .tb-switch { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
      .tb-pre { white-space: pre-wrap; max-height: 240px; overflow: auto; }
    `

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err } }
      componentDidCatch(err) { try { console.error('[刷贴吧] 面板渲染出错', err) } catch { /* ignore */ } }
      render() {
        if (this.state.err) {
          return h('div', { className: 'tb-wrap' }, [
            h('h2', { key: 't' }, '刷贴吧 · 面板出错了'),
            h('div', { key: 'm', className: 'tb-msg err' }, String((this.state.err && this.state.err.message) || this.state.err)),
            h('div', { key: 's', className: 'tb-pre tb-msg err' }, String((this.state.err && this.state.err.stack) || '').split('\n').slice(0, 6).join('\n')),
            h('div', { key: 'h', className: 'tb-kv' }, '把上面这段发给大肥鱼，它照着修。'),
          ])
        }
        return this.props.children
      }
    }

    function Field({ label, children }) {
      return h('div', { className: 'tb-field' }, [h('label', { className: 'tb-label', key: 'l' }, label), children])
    }

    function Sw({ on, onChange, text }) {
      return h('div', { className: 'tb-switch' }, [
        h('input', { key: 'c', type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked) }),
        h('span', { key: 't', className: 'tb-kv' }, text),
      ])
    }

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
          setStatus({ ok: false })
          const m = String(e.message || e)
          setMsg({
            ok: false,
            text: m.includes('404')
              ? '接口 404：插件的「主机半端」没加载（webServer 还没就绪或插件没起来）。重启一次 DSH 再看。'
              : '读状态失败：' + m,
          })
        }
      }, [])
      React.useEffect(() => { refresh() }, [refresh])

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const st = await jget('/run-status')
            if (alive) setLive(st)
          } catch { /* 接口没挂上时安静等一下 */ }
        }
        tick()
        const t = setInterval(tick, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      const saveCfg = async (patch) => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/config', patch)
          setCfg(r.cfg)
          setMsg({ ok: true, text: '配置已保存' })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const saveCookie = async () => {
        if (!cookie.trim()) { setCookieMsg({ ok: false, text: '先粘贴 BDUSS（带不带前缀都行）' }); return }
        if (/^(ssh-|-----BEGIN)/i.test(cookie.trim())) {
          setCookieMsg({ ok: false, text: '这是 SSH 公钥（给 GitHub 的），不是 BDUSS。BDUSS 在贴吧 cookie 里，长约 190 个字符。' })
          return
        }
        setBusy(true); setCookieMsg(null)
        try {
          const r = await jpost('/cookie', { cookie })
          setCookieMsg(r.loggedIn ? { ok: true, text: '登录态有效 ✓ 已经把凭证存到本机' } : { ok: false, text: '没通过：' + (r.hint || 'is_login=0') })
          setCookie('')
          await refresh()
        } catch (e) { setCookieMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const signNow = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/sign', {})
          const lines = (r.results || []).map((x) => x.ok
            ? '✓ ' + x.kw + '：签到成功' + (x.count == null ? '' : '（累计 ' + x.count + ' 天）')
              + (x.followed && !x.wasFollowing ? ' · 顺手关注了这个吧' : '')
            : '✗ ' + x.kw + '：' + (x.error || x.msg || '失败'))
          setMsg({ ok: lines.length > 0 && lines.every((l) => l.charAt(0) === '✓'), text: lines.join('\n') || '没有可签到的吧' })
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
          let tail = '\n原始数据：' + r.file
          const cc = cfg || {}
          if (cc.autoReply && (cc.replyPerRound ?? 1) > 0) {
            setMsg({ ok: true, text: lines.join('\n') + tail + '\n\n接着让模型跑一轮（写日报 + 回帖）…' })
            const rr = await jpost('/run-headless', {})
            tail += '\n模型轮：' + (rr.started ? '已在后台启动' : (rr.error || '没启动')) + '\n日志：' + (rr.log || '-')
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
          setMsg({ ok: !!r.started, text: (r.started ? '模型轮已在后台跑。' : (r.error || '没启动。')) + '\n' + (r.hint || '') + '\n日志：' + (r.log || '-') })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const showReport = async () => {
        setBusy(true)
        try {
          const r = await jget('/report?latest=1')
          setReport(r.ok ? r : { text: r.error || '还没有日报' })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
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
        const f = e.target.files && e.target.files[0]
        e.target.value = ''
        if (!f) return
        if (f.size > 200 * 1024) { setMsg({ ok: false, text: '这个文件太大了（>200KB），人设不用这么长' }); return }
        const reader = new FileReader()
        reader.onload = () => {
          const text = String(reader.result || '')
          setCfg((cur) => ({ ...(cur || {}), personaText: text, personaFile: '' }))
          setMsg({ ok: true, text: `已读入「${f.name}」（${text.length} 字），记得点「保存人设」` })
        }
        reader.onerror = () => setMsg({ ok: false, text: '读文件失败了' })
        reader.readAsText(f, 'utf-8')
      }

      const c = cfg || { bars: [], autoSign: false, autoReply: false, readPerRound: 5, replyPerRound: 1, replyPerDay: 3, replyGapSec: 30, requestGapMs: 1200 }
      const running = !!(live && live.busy)

      return h('div', { className: 'tb-wrap' }, [
        h('h2', { key: 't' }, '刷贴吧'),
        h('div', { className: 'tb-sub', key: 's' },
          '每天替你看几个吧：读帖、挑值得的、写日报。回帖默认关闭，开了也受每轮/每日/间隔三道限制。'),
        h('div', { className: 'tb-warn', key: 'w' },
          'BDUSS 等于你的登录凭证：它只存在本机 $DSH_HOME/tieba-duty/cookie.txt（600），不回显、不进日志。'
          + '想要清除登录数据，去贴吧「账号安全 → 退出所有设备」。'),

        cookieMsg ? h('div', { key: 'cm', className: 'tb-msg ' + (cookieMsg.ok ? 'ok' : 'err'), style: { marginBottom: 12 } }, cookieMsg.text) : null,

        h(Field, { key: 'cookie', label: 'BDUSS' }, [
          h('input', {
            key: 'i', className: 'tb-input', type: 'text', placeholder: 'BDUSS=... 或只贴值（自动补前缀）',
            value: cookie, onChange: (e) => setCookie(e.target.value),
          }),
          h('div', { className: 'tb-row', key: 'r', style: { marginTop: 8 } }, [
            h('button', { key: 'b', className: 'tb-btn', disabled: busy, onClick: saveCookie }, '保存并测试'),
            h('span', { key: 'k', className: 'tb-kv' }, status && status.hasCookie ? '已有凭证 ✓' : '还没有凭证'),
          ]),
          h('div', { key: 'hint', className: 'tb-kv', style: { marginTop: 8 } },
            '不知道怎么拿 BDUSS？直接在聊天里问大肥鱼：「教我怎么拿贴吧的 BDUSS」，它会一步步告诉你。'),
        ]),

        h(Field, { key: 'bars', label: '要刷的吧（一行一个）' }, [
          h('textarea', {
            key: 'a', className: 'tb-area', value: (c.bars || []).join('\n'),
            onChange: (e) => setCfg({ ...c, bars: e.target.value.split('\n') }),
          }),
          h('div', { className: 'tb-row', key: 'r', style: { marginTop: 8 } }, [
            h('button', { key: 'b', className: 'tb-btn ghost', disabled: busy,
              onClick: () => saveCfg({ bars: (c.bars || []).map((x) => x.trim()).filter(Boolean) }) }, '保存吧列表'),
          ]),
        ]),

        h(Field, { key: 'persona', label: '人设（写在这里，或导入一个文件）' }, [
          h('textarea', {
            key: 'p', className: 'tb-area', placeholder: '例：一只蓝发小鲸鱼，自称「咱」，说话短、软、爱夸人……',
            value: c.personaText || '',
            onChange: (e) => setCfg({ ...c, personaText: e.target.value }),
          }),
          h('div', { className: 'tb-row', key: 'f', style: { marginTop: 8 } }, [
            h('label', { key: 'l', className: 'tb-btn ghost', style: { cursor: 'pointer', margin: 0 } }, [
              '导入文件（.md / .txt）',
              h('input', { key: 'i', type: 'file', accept: '.md,.txt,.markdown,text/plain,text/markdown',
                style: { display: 'none' }, onChange: importPersona }),
            ]),
            h('button', { key: 'b', className: 'tb-btn ghost', disabled: busy,
              onClick: () => saveCfg({ personaText: c.personaText || '', personaFile: c.personaFile || '' }) }, '保存人设'),
          ]),
          h('details', { key: 'adv', style: { marginTop: 8 } }, [
            h('summary', { key: 's', className: 'tb-kv', style: { cursor: 'pointer' } }, '进阶：直接指一个文件路径'),
            h('input', {
              key: 'i', className: 'tb-input', style: { marginTop: 6 },
              placeholder: 'persona.md（相对 $DSH_HOME/tieba-duty）或 /绝对/路径.md',
              value: c.personaFile || '',
              onChange: (e) => setCfg({ ...c, personaFile: e.target.value }),
            }),
            h('div', { key: 'h', className: 'tb-kv' }, '路径优先于人设框；留空就用上面框里的内容。'),
          ]),
        ]),

        h(Field, { key: 'round', label: '每轮刷多少' }, [
          h('div', { className: 'tb-row', key: 'n' }, [
            h('span', { key: 'a', className: 'tb-kv' }, '读'),
            h('input', { key: 'b', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.readPerRound,
              onChange: (e) => setCfg({ ...c, readPerRound: e.target.value }),
              onBlur: () => saveCfg({ readPerRound: Number(c.readPerRound) }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '个贴，回'),
            h('input', { key: 'd', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.replyPerRound,
              onChange: (e) => setCfg({ ...c, replyPerRound: e.target.value }),
              onBlur: () => saveCfg({ replyPerRound: Number(c.replyPerRound) }) }),
            h('span', { key: 'e', className: 'tb-kv' }, '条（默认读 5 贴、回 1 条）'),
          ]),
          h('div', { className: 'tb-row', key: 'g', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '请求间隔'),
            h('input', { key: 'b', className: 'tb-input', type: 'number', style: { width: 90 }, value: c.requestGapMs,
              onChange: (e) => setCfg({ ...c, requestGapMs: e.target.value }),
              onBlur: () => saveCfg({ requestGapMs: Number(c.requestGapMs) }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '毫秒（1200 稳；想快可以调到 600，别低于 300）'),
          ]),
        ]),

        h(Field, { key: 'autoSign', label: '自动签到' }, [
          h(Sw, { key: 's', on: c.autoSign, onChange: (v) => saveCfg({ autoSign: v }),
            text: '每天 ' + c.signHour + ' 点后自动签一次（没关注会先关注）' }),
        ]),

        h(Field, { key: 'autoReply', label: '允许回帖（默认关）' }, [
          h(Sw, { key: 's', on: c.autoReply, onChange: (v) => saveCfg({ autoReply: v }),
            text: '⚠️ 打开后，模型可以在你确认下用这个号发公开回复' }),
          h(Sw, { key: 'qa', on: c.answerQuestions !== false, onChange: (v) => saveCfg({ answerQuestions: v }),
            text: '允许回帖里解答别人的疑问（关掉就只接话/共鸣/玩梗）' }),
          h(Sw, { key: 'gate', on: c.toneGate !== false, onChange: (v) => saveCfg({ toneGate: v }),
            text: '拦客服腔（首先/其次/希望对你有帮助…），长短不限' }),
          h('div', { className: 'tb-row', key: 'm', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '回复时 @'),
            h('input', { key: 'b', className: 'tb-input', style: { width: 160 }, placeholder: '贴吧昵称（留空不 @）',
              value: c.mention || '',
              onChange: (e) => setCfg({ ...c, mention: e.target.value }),
              onBlur: () => saveCfg({ mention: c.mention }) }),
            h('label', { key: 'c', className: 'tb-kv', style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('input', { key: 'i', type: 'checkbox', checked: !!c.mentionEvery,
                onChange: (e) => saveCfg({ mentionEvery: e.target.checked }) }),
              '每条回复都自动带上这个 @',
            ]),
          ]),
          h('div', { className: 'tb-row', key: 'n', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '每轮最多回'),
            h('input', { key: 'b', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.replyPerRound,
              onChange: (e) => setCfg({ ...c, replyPerRound: e.target.value }),
              onBlur: () => saveCfg({ replyPerRound: Number(c.replyPerRound) }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '条，间隔'),
            h('input', { key: 'd', className: 'tb-input', type: 'number', style: { width: 80 }, value: c.replyGapSec,
              onChange: (e) => setCfg({ ...c, replyGapSec: e.target.value }),
              onBlur: () => saveCfg({ replyGapSec: Number(c.replyGapSec) }) }),
            h('span', { key: 'e', className: 'tb-kv' }, '秒'),
          ]),
          h('div', { className: 'tb-row', key: 'd', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '全天合计最多'),
            h('input', { key: 'b', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.replyPerDay,
              onChange: (e) => setCfg({ ...c, replyPerDay: e.target.value }),
              onBlur: () => saveCfg({ replyPerDay: Number(c.replyPerDay) }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '条'),
          ]),
        ]),

        h(Field, { key: 'peak', label: '峰谷自动刷（默认关）' }, [
          h(Sw, { key: 's', on: c.peakValley, onChange: (v) => saveCfg({ peakValley: v }),
            text: '到谷时自动跑一轮（工作日 9–12 / 14–18 之外算谷时）' }),
          h(Sw, { key: 'n', on: c.noon !== false, onChange: (v) => saveCfg({ noon: v }),
            text: '中午谷（12:00–14:00）' }),
          h(Sw, { key: 'g', on: c.night !== false, onChange: (v) => saveCfg({ night: v }),
            text: '晚上谷（18:00–次日 09:00）' }),
          h('div', { key: 'st', className: 'tb-kv' },
            status && status.valley
              ? '现在：' + status.valley.now + (status.valley.window ? '（' + status.valley.window + ' 窗口）' : '')
              : '现在：未知'),
          h('div', { key: 'b', className: 'tb-row', style: { marginTop: 8 } }, [
            h('button', { key: 'r', className: 'tb-btn ghost', disabled: busy, onClick: runModel }, '现在跑一轮（模型）'),
            h('button', { key: 'l', className: 'tb-btn ghost', disabled: busy, onClick: showLog }, '看运行日志'),
          ]),
          runLog ? h('pre', { key: 'lg', className: 'tb-area tb-pre', style: { marginTop: 8 } },
            runLog.text || runLog.error || '（空）') : null,
        ]),

        h(Field, { key: 'duty', label: '刷一轮 / 看日报' }, [
          h('div', { className: 'tb-row', key: 'b' }, [
            h('button', { key: 'r', className: 'tb-btn', disabled: busy || running, onClick: runRound },
              live && live.collecting ? '采集中…' : (live && live.running ? '模型轮进行中…' : '刷一轮贴吧')),
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: showReport }, '看最近日报'),
          ]),
          h('div', { key: 'live', className: 'tb-kv', style: { marginTop: 6 } },
            !live ? '状态：读取中…'
              : live.busy
                ? '状态：' + (live.collecting ? '正在采集帖子…' : '模型轮进行中…') + '（退出面板也会继续跑）'
                : '状态：空闲' + (live.lastRunDate ? '（上次跑完：' + live.lastRunDate + '）' : '')),
          h('div', { key: 'h', className: 'tb-kv' },
            '「刷一轮贴吧」：先按设置读 ' + (c.readPerRound || 5) + ' 个贴并保存原始数据；'
            + '开了「允许回帖」时会接着启动模型轮（写日报 + 按设置回帖）。'),
          report ? h('pre', { key: 'rp', className: 'tb-area tb-pre', style: { marginTop: 8 } }, report.text || '（空）') : null,
        ]),

        h(Field, { key: 'diary', label: '日记本' }, [
          h(Sw, { key: 'on', on: c.diaryEnabled !== false, onChange: (v) => saveCfg({ diaryEnabled: v }), text: '允许写日记' }),
          h(Sw, { key: 'pv', on: c.diaryPrivate !== false, onChange: (v) => saveCfg({ diaryPrivate: v }), text: '允许写私人日记（只有主人手动翻开才看得到）' }),
          h('div', { className: 'tb-row', key: 'b' }, [
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: () => showDiary('public') }, '看大肥鱼写给主人的日记'),
            h('button', { key: 'v', className: 'tb-btn ghost', disabled: busy, onClick: () => showDiary('private') }, '翻开私人日记（有点害羞）'),
          ]),
          diary ? h('pre', { key: 'd', className: 'tb-area tb-pre', style: { marginTop: 8 } },
            (diary.text || '（还没有日记）') + '\n\n' + (diary.file || '')) : null,
        ]),

        h('div', { className: 'tb-row', key: 'ops' }, [
          h('button', { key: 's', className: 'tb-btn ghost', disabled: busy, onClick: signNow }, '立即签到一次'),
          h('button', { key: 'r', className: 'tb-btn ghost', disabled: busy, onClick: refresh }, '刷新状态'),
        ]),

        status ? h('div', { className: 'tb-kv', key: 'st', style: { marginTop: 14 } }, [
          h('div', { key: 'a' }, '今天：' + (status.today || '-') + ' · 已回 ' + (status.repliesToday || 0) + ' 条'),
          h('div', { key: 'b' }, '签到记录：' + (Object.entries(status.signed || {}).map(([k, v]) => k + '@' + v).join('、') || '无')),
          h('div', { key: 'c' }, '凭证文件：' + (status.cookieFile || '-')),
        ]) : null,

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

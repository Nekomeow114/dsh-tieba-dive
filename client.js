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
      .tb-chip.run { background: #e8f2ff; color: #1f5aa8; }
      .tb-chip.run::before { content: '●'; color: #2d6cdf; margin-right: 5px; animation: tb-pulse 1.2s ease-in-out infinite; }
      @keyframes tb-pulse { 50% { opacity: .3; } }
      .tb-group { border: 1px solid #dbe7f7; border-radius: 14px; background: #fbfdff; margin-bottom: 14px; }
      .tb-group > summary { cursor: pointer; list-style: none; padding: 12px 14px; display: flex; align-items: center; gap: 8px; }
      .tb-group > summary::-webkit-details-marker { display: none; }
      .tb-group > summary::before { content: '▸'; color: #8fa8cc; }
      .tb-group[open] > summary::before { content: '▾'; }
      .tb-group-id { font-weight: 700; color: #2d6cdf; }
      .tb-group-title { font-weight: 700; color: #22303f; }
      .tb-group-body { padding: 0 10px 10px; }
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
      .tb-loading { display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 12px; min-height: 220px; color: #6b86a8; font-size: 13px; }
      .tb-spinner { width: 26px; height: 26px; border-radius: 50%;
        border: 3px solid #dbe7f7; border-top-color: #2d6cdf; animation: tb-spin .8s linear infinite; }
      @keyframes tb-spin { to { transform: rotate(360deg); } }
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

    const Group = ({ id, title, summary, open, children }) => h('details', { className: 'tb-group', open: !!open }, [
      h('summary', { key: 's', className: 'tb-group-sum' }, [
        h('span', { key: 'i', className: 'tb-group-id' }, id),
        h('span', { key: 't', className: 'tb-group-title' }, title),
        summary ? h('span', { key: 'm', className: 'tb-tag' }, summary) : null,
      ]),
      h('div', { key: 'b', className: 'tb-group-body' }, children),
    ])

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
      const [health, setHealth] = React.useState(null)
      const [proposals, setProposals] = React.useState([])
      const [persona, setPersona] = React.useState(null)
      const [evoState, setEvoState] = React.useState(null)
      const [versions, setVersions] = React.useState([])
      const [images, setImages] = React.useState([])
      const [styleState, setStyleState] = React.useState(null)

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
      const loadProposals = React.useCallback(async () => {
        try { const r = await jget('/persona/proposals'); setProposals(r.proposals || []) } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadProposals() }, [loadProposals])
      const loadPersona = React.useCallback(async () => {
        try { const r = await jget('/persona/state'); setPersona(r.persona) } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadPersona() }, [loadPersona])
      const loadVersions = React.useCallback(async () => {
        try { const r = await jget('/persona/versions'); setVersions(r.versions || []) } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadVersions() }, [loadVersions])
      const loadImages = React.useCallback(async () => {
        try { const r = await jget('/images'); setImages(r.images || []) } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadImages() }, [loadImages])
      const compressImage = (file) => new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
          try {
            const max = 1200
            const scale = Math.min(1, max / Math.max(img.width, img.height))
            const w = Math.max(1, Math.round(img.width * scale))
            const h = Math.max(1, Math.round(img.height * scale))
            const c = document.createElement('canvas')
            c.width = w; c.height = h
            c.getContext('2d').drawImage(img, 0, 0, w, h)
            let q = 0.85
            let data = c.toDataURL('image/jpeg', q)
            while (data.length > 900_000 && q > 0.5) { q -= 0.1; data = c.toDataURL('image/jpeg', q) }
            URL.revokeObjectURL(url)
            resolve(data)
          } catch (e) { URL.revokeObjectURL(url); reject(e) }
        }
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
        img.src = url
      })
      const uploadImage = async (file) => {
        if (!file) return
        if (file.size > 2 * 1024 * 1024) { setMsg({ ok: false, text: '单张不能超过 2MB' }); return }
        setBusy(true)
        try {
          const dataUrl = await compressImage(file)
          if (dataUrl.length > 1_200_000) { setMsg({ ok: false, text: '这张图压不下来了，换一张小点的' }); return }
          const desc = window.prompt('给这张图写一句话描述（留空 = 待补）', '') || ''
          const tags = (window.prompt('适用场景标签（逗号分隔，可留空）', '') || '').split(/[，,]/).map((x) => x.trim()).filter(Boolean)
          const r = await jpost('/images', { name: file.name, dataUrl, desc, tags })
          if (!r.ok) throw new Error(r.error || '上传失败')
          await loadImages(); setMsg({ ok: true, text: '已加入图片库' })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }
      const download = (name, content, type) => {
        const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = name
        document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      }
      const exportPersona = async (format, version) => {
        setBusy(true)
        try {
          const q = '/persona/export?format=' + format + (version ? '&version=' + version : '')
          const r = await jget(q)
          download(r.filename || ('persona.' + format), r.content, format === 'json' ? 'application/json' : 'text/plain;charset=utf-8')
          setMsg({ ok: true, text: '已导出 ' + (r.filename || '') })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

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
        const before = cfg
        setBusy(true); setMsg(null)
        setCfg((cur) => ({ ...(cur || {}), ...patch }))   // 先让开关动起来
        try {
          const r = await jpost('/config', patch)
          setCfg(r.cfg); setMsg({ ok: true, text: '已保存' }); await refresh()
        } catch (e) {
          setCfg(before)                                   // 失败回滚
          setMsg({ ok: false, text: '没保存上：' + String(e.message || e) })
        } finally { setBusy(false) }
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
          const runSelfcheck = async () => {
        setBusy(true)
        try { setHealth(await jget('/health')) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

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

      const runSelfcheck = async () => {
        setBusy(true)
        try { setHealth(await jget('/health')) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      // 配置还没读回来之前，只显示载入态（避免先闪一堆空输入框）
      if (!status || !cfg) {
        return h('div', { className: 'tb tb-loading' }, [
          h('div', { key: 's', className: 'tb-spinner' }),
          h('div', { key: 't' }, '正在读取插件配置…'),
          (status && status.ok === false)
            ? h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy, onClick: refresh }, '重试')
            : null,
        ])
      }

      const c = cfg || { bars: [], readPerRound: 5, replyPerRound: 1, replyPerDay: 3, replyGapSec: 30, requestGapMs: 1200, signHour: 9, runHour: 21 }
      const running = !!(live && live.busy)
      const hasCookie = !!(status && status.hasCookie)

      return h('div', { className: 'tb' }, [
        h('div', { key: 'h', className: 'tb-h' }, ['刷贴吧', h('span', { key: 'v', className: 'tb-tag' },
          'v' + ((live && live.version) || (status && status.version) || '?'))]),
        h('div', { key: 's', className: 'tb-sub' }, '每天替你看几个吧：读帖、写日报、签到，回帖可选。'),

        // ── 状态带 ──
        h('div', { key: 'chips', className: 'tb-chips' }, [
          h('span', { key: 'a', className: 'tb-chip ' + (hasCookie ? 'ok' : 'warn') }, hasCookie ? '凭证 ✓' : '未登录'),
          h('span', { key: 'b', className: 'tb-chip ' + (status && c.autoReply && (status.repliesToday || 0) >= (c.replyPerDay ?? 5) ? 'warn' : '') },
            '今天已回 ' + (status ? (status.repliesToday || 0) : '–')
            + (c.autoReply ? '/' + (c.replyPerDay ?? 5) : '') + ' 条'
            + (status && c.autoReply && (status.repliesToday || 0) >= (c.replyPerDay ?? 5) ? ' · 额度已满' : '')),
          h('span', { key: 'c', className: 'tb-chip ' + (status && status.valley && status.valley.isValley ? 'ok' : 'warn') },
            status && status.valley ? '现在：' + status.valley.now : '峰谷：未知'),
        ]),

        // ── 已连接的其他插件（没有就不显示）──
        (status && status.integrations && status.integrations.plugins && status.integrations.plugins.length)
          ? h('div', { key: 'integ', className: 'tb-kv', style: { marginBottom: 10 } },
            '已连接：' + status.integrations.plugins.map((p) => p.name + '（' + (p.provides || []).join('、') + '）').join(' · '))
          : null,

        // ── 启动检查：curl 缺了会全线失败，必须最先说 ──
        (status && status.curl && status.curl.ok === false) ? h('div', { key: 'nocurl', className: 'tb-warn', style: { borderColor: '#e8a0a0', background: '#fdeeee', color: '#8a2020' } },
          '机器上没有 curl —— 所有贴吧请求都会失败。先装 curl（Linux/macOS 一般自带，Windows 10+ 也自带），再重启 DSH。') : null,

        // ── 风控熔断：撞到验证码后自动歇着 ──
        (status && status.cooldown && status.cooldown.active) ? h('div', { key: 'cd', className: 'tb-warn', style: { borderColor: '#e8c48a', background: '#fff6e5' } }, [
          h('div', { key: 't', style: { fontWeight: 600, marginBottom: 4 } },
            '⏸ 风控熔断中：还剩 ' + (status.cooldown.leftMin || '?') + ' 分钟'),
          h('div', { key: 'm' }, '原因：' + (status.cooldown.reason || '百度安全验证') + '。这段时间插件一个请求都不会发，避免连续撞墙。'),
          h('div', { key: 'r', className: 'tb-row', style: { marginTop: 8 } }, [
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
              onClick: async () => {
                setBusy(true)
                try { await jpost('/cooldown/clear', {}); await refresh(); setMsg({ ok: true, text: '已解除熔断' }) }
                catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
              } }, '我已经处理好了，解除'),
            h('span', { key: 'k', className: 'tb-kv' }, '（比如你刚在手机上过了滑块）'),
          ]),
        ]) : null,

        // ── 最近一次错误（有就显示，能折叠）──
        (status && status.lastError) ? h('details', { key: 'err', className: 'tb-card', style: { borderColor: '#f0c9c9' } }, [
          h('summary', { key: 's', style: { color: '#a33' } },
            '最近一次错误 · ' + String(status.lastError.at || '').slice(5, 16).replace('T', ' ') + ' · ' + (status.lastError.where || '')),
          h('pre', { key: 'p', className: 'tb-pre' }, status.lastError.message || ''),
        ]) : null,

        // ── 首次使用引导：还没登录 / 还没填吧时显示 ──
        ((!hasCookie || !c.bars || c.bars.length === 0)) ? h('div', { key: 'onboard', className: 'tb-card', style: { borderColor: '#cfe0f7', background: '#f7fbff' } }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, '三步就能跑起来'),
          h('div', { key: 'l', className: 'tb-kv', style: { lineHeight: 2 } }, [
            h('div', { key: 'a' }, (hasCookie ? '✅' : '1.') + ' 贴 BDUSS（在「A1 账号」里，点保存并测试）'),
            h('div', { key: 'b' }, ((c.bars && c.bars.length) ? '✅' : '2.') + ' 填要刷的吧（一行一个，贴吧里的吧名）'),
            h('div', { key: 'c' }, '3. 点「刷一轮贴吧」——先只采集，看看它读到了什么'),
          ]),
        ]) : null,

        h(Group, { key: 'A', id: 'A', title: '账号与刷帖', open: true,
          summary: (hasCookie ? '已登录' : '未登录') + ' · ' + ((c.bars || []).length) + ' 个吧' }, [
        // ── A1 账号 ──
        h('div', { key: 'acct', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, 'A1 账号'),
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
          h('div', { key: 'fh', className: 'tb-kv' }, '「读取已关注的吧」会拉当前账号的关注列表，一键填进上面的框（会替换）。'),
        ]),

        // ── A2 每一轮 ──
        h('div', { key: 'round', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, 'A2 每一轮'),
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
            h('button', { key: 'f', className: 'tb-btn ghost', disabled: busy,
              onClick: async () => {
                setBusy(true); setMsg(null)
                try {
                  const r = await jget('/bars/followed')
                  if (!r.ok) throw new Error(r.error || '读取失败')
                  if ((c.bars || []).filter(Boolean).length && !window.confirm('会把框里现有的吧替换成你的关注列表，继续？')) return
                  setCfg({ ...c, bars: r.bars })
                  await save({ bars: r.bars })
                  setMsg({ ok: true, text: `已读取 ${r.count} 个关注的吧并填入` })
                } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
              } }, '读取已关注的吧'),
          ]),
          h('div', { key: 'n', className: 'tb-row' }, [
            h('span', { key: 'a', className: 'tb-kv' }, '读'),
            h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('readPerRound') }),
            h('span', { key: 'c', className: 'tb-kv' }, '个贴 · 回几条在「回帖规则」里'),
            h('span', { key: 'd', className: 'tb-kv', style: { marginLeft: 'auto' } }, '请求间隔'),
            h('input', { key: 'e', className: 'tb-num', type: 'number', ...num('requestGapMs') }),
            h('span', { key: 'f', className: 'tb-kv' }, 'ms'),
          ]),
          h('div', { key: 'kw', className: 'tb-row' }, [
            h('span', { key: 'a', className: 'tb-kv', style: { minWidth: 76 } }, '刷帖关键词'),
            h('input', { key: 'b', className: 'tb-in', style: { flex: 1, minWidth: 160 },
              placeholder: '可空。例：大肥鱼，人设，推书',
              value: (c.keywords || []).join('，'),
              onChange: (e) => setCfg({ ...c, keywords: e.target.value.split(/[，,]/) }),
              onBlur: () => save({ keywords: (c.keywords || []).map((x) => String(x).trim()).filter(Boolean) }) }),
          ]),
          h('div', { key: 'kwh', className: 'tb-kv', style: { marginTop: -2 } },
            (c.keywords && c.keywords.length)
              ? '标题里带这些词的帖会排在前面、日报优先写；不带词的帖照常读，只是排后面。'
              : '留空 = 不挑，按吧里默认顺序读。填了之后，标题带这些词的帖会排前面、日报优先写（不是过滤，别的帖照读）。'),
          h('div', { key: 'o', className: 'tb-row' }, [
            h('button', { key: 'r', className: 'tb-btn', disabled: busy || running, onClick: runRound },
              live && live.collecting ? '采集中…' : (live && live.running ? '模型轮进行中…' : '刷一轮贴吧')),
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: showReport }, '看最近日报'),
            running ? h('button', { key: 's', className: 'tb-btn ghost', disabled: busy,
              onClick: async () => {
                setBusy(true)
                try { const r = await jpost('/run/stop', {}); setMsg({ ok: true, text: r.ok ? '已发送停止信号，本轮结束' : (r.error || '没停掉') }) }
                catch (e) { setMsg({ ok: false, text: String(e.message || e) }) }
                finally { setBusy(false); setTimeout(refresh, 800) }
              } }, '停止本轮') : null,
          ]),
          report ? h('pre', { key: 'rp', className: 'tb-pre' }, report.text || '（空）') : null,
        ]),

        ]),

        h(Group, { key: 'B', id: 'B', title: '人设与表达',
          summary: (c.personaFile ? '人设：文件' : (c.personaText ? '人设：文本' : '人设：未配置'))
            + (c.styleSamples ? ' · 样本 ' + String(c.styleSamples).split('\n').filter(Boolean).length : '') }, [
        // ── B1 人设 ──
        h('div', { key: 'persona', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, 'B1 人设'),
          h('div', { key: 'pv', className: 'tb-kv', style: { marginBottom: 8 } },
            persona ? ('当前版本 v' + persona.version + ' · 核心层（名字/自称/底线）已锁死，不可改') : '读取人设版本中…'),
          persona ? h('div', { key: 'traits' }, [
            h('div', { key: 'l', className: 'tb-label' }, '性格旋钮（0~10）'),
            ...([['abstract','抽象度'],['sharp','毒舌度'],['gentle','温柔度'],['talkative','话痨度'],['imageBias','发图倾向']].map(([k, label]) =>
              h('div', { key: k, className: 'tb-row' }, [
                h('span', { key: 'a', className: 'tb-kv', style: { minWidth: 76 } }, label),
                h('input', { key: 'b', type: 'range', min: 0, max: 10, value: persona.traits[k],
                  style: { flex: 1 },
                  onChange: (e) => setPersona({ ...persona, traits: { ...persona.traits, [k]: Number(e.target.value) } }) }),
                h('span', { key: 'c', className: 'tb-num', style: { textAlign: 'center' } }, String(persona.traits[k])),
              ]))),
            h('div', { key: 'r', className: 'tb-row' }, [
              h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
                onClick: async () => {
                  setBusy(true)
                  try { const r = await jpost('/persona/traits', { traits: persona.traits, reason: 'ui' }); setPersona(r.persona); setMsg({ ok: true, text: '旋钮已保存（v' + r.persona.version + '）' }) }
                  catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                } }, '保存旋钮'),
            ]),
          ]) : null,
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
            value: persona ? persona.voice.samples.join('\n') : (c.styleSamples || ''),
            onChange: (e) => setPersona((cur) => cur ? { ...cur, voice: { ...cur.voice, samples: e.target.value.split('\n') } } : cur),
          }),
          h('div', { key: 'ssr', className: 'tb-row' }, [
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
              onClick: async () => {
                setBusy(true)
                try {
                  const samples = (persona ? persona.voice.samples : String(c.styleSamples || '').split('\n')).map((x) => x.trim()).filter(Boolean)
                  const r = await jpost('/persona/voice', { samples, reason: 'ui' })
                  setPersona(r.persona); setMsg({ ok: true, text: '语气样本已保存（v' + r.persona.version + '）' })
                } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
              } }, '保存语气样本'),
            h('span', { key: 'k', className: 'tb-kv' }, '模型回帖前会读这几句，照着学长短和口气'),
          ]),
          h('details', { key: 'adv2', style: { marginTop: 8 } }, [
            h('summary', { key: 's', className: 'tb-kv', style: { cursor: 'pointer' } }, '进阶：改用人设文件（填了会覆盖上面的文本框）'),
            h('input', { key: 'f', className: 'tb-in', style: { marginTop: 6 },
              placeholder: 'persona.md（相对 tieba-duty 目录）或 /绝对/路径.md',
              value: c.personaFile || '', onChange: (e) => setCfg({ ...c, personaFile: e.target.value }),
              onBlur: () => save({ personaFile: c.personaFile || '' }) }),
            h('div', { key: 'h', className: 'tb-kv' }, '相对路径从 $DSH_HOME/tieba-duty/ 算起；留空就用上面的文本框。'),
          ]),
        ]),

        // ── B2 图片库 ──
        h('div', { key: 'images', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, 'B2 图片库'),
          h('div', { key: 'h', className: 'tb-kv' }, '给模型的只有 ID + 描述 + 标签；发图默认关，上限 50 张、单张 2MB。'),
          h('div', { key: 'u', className: 'tb-row' }, [
            h('label', { key: 'l', className: 'tb-btn ghost sm', style: { cursor: 'pointer', margin: 0 } }, [
              '上传图片',
              h('input', { key: 'i', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' },
                onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; uploadImage(f) } }),
            ]),
            h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy, onClick: loadImages }, '刷新'),
          ]),
          images.length ? h('div', { key: 'grid', style: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 } },
            images.map((im) => h('div', { key: im.id, style: { width: 140, border: '1px solid #e2eaf5', borderRadius: 10, padding: 8 } }, [
              h('img', { key: 'p', src: im.fileUrl, alt: im.desc, style: { width: '100%', height: 90, objectFit: 'cover', borderRadius: 8, opacity: im.enabled === false ? 0.4 : 1 } }),
              h('div', { key: 'd', className: 'tb-kv', style: { marginTop: 4, lineHeight: 1.4 } }, im.desc + (im.needsDesc ? '（待补描述）' : '')),
              im.tags && im.tags.length ? h('div', { key: 'g', className: 'tb-kv' }, im.tags.join(' · ')) : null,
              h('div', { key: 's', className: 'tb-kv' }, '用过 ' + (im.uses || 0) + ' 次'),
              h('div', { key: 'a', className: 'tb-row', style: { marginTop: 4 } }, [
                h('button', { key: 'e', className: 'tb-btn ghost sm', disabled: busy,
                  onClick: async () => {
                    const desc = window.prompt('修改描述', im.desc)
                    if (desc == null) return
                    setBusy(true)
                    try { await jpost('/images/update', { id: im.id, desc }); await loadImages() }
                    catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                  } }, '编辑'),
                h('button', { key: 't', className: 'tb-btn ghost sm', disabled: busy,
                  onClick: async () => {
                    setBusy(true)
                    try { await jpost('/images/update', { id: im.id, enabled: im.enabled === false }); await loadImages() }
                    catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                  } }, im.enabled === false ? '启用' : '停用'),
                h('button', { key: 'x', className: 'tb-btn ghost sm', disabled: busy,
                  onClick: async () => {
                    if (!window.confirm('删除这张图？')) return
                    setBusy(true)
                    try { await jpost('/images/delete', { id: im.id }); await loadImages() }
                    catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                  } }, '删除'),
              ]),
            ])))
            : h('div', { key: 'none', className: 'tb-kv' }, '还没有图片。'),
        ]),
        ]),

        h(Group, { key: 'C', id: 'C', title: '行为与规则',
          summary: c.autoReply ? ('回帖开 · 今天 ' + (status.repliesToday || 0) + '/' + (c.replyPerDay ?? 5)) : '回帖关' }, [
        // ── C1 回帖规则 ──
        h('details', { key: 'reply', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['C1 回帖规则', h('span', { key: 't', className: 'tb-tag' }, c.autoReply ? '已开启' : '默认关')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'a', on: c.autoReply, onChange: (v) => save({ autoReply: v }),
              text: '允许回帖（用这个号发公开回复）' }),
            h(Sw, { key: 'q', on: c.answerQuestions !== false, onChange: (v) => save({ answerQuestions: v }),
              text: '允许解答别人的疑问（关掉就只接话/共鸣/玩梗）' }),
            h(Sw, { key: 'g', on: c.toneGate !== false, onChange: (v) => save({ toneGate: v }),
              text: '拦客服腔（首先/其次/希望对你有帮助…）' }),
            h('div', { key: 'quota', className: 'tb-row' }, [
              h('span', { key: 'a', className: 'tb-kv' }, '每轮最多'),
              h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('replyPerRound') }),
              h('span', { key: 'c', className: 'tb-kv' }, '条 · 间隔'),
              h('input', { key: 'd', className: 'tb-num', type: 'number', ...num('replyGapSec') }),
              h('span', { key: 'e', className: 'tb-kv' }, '秒 · 全天合计'),
              h('input', { key: 'f', className: 'tb-num', type: 'number', ...num('replyPerDay') }),
              h('span', { key: 'g', className: 'tb-kv' }, '条'),
            ]),
            h(Sw, { key: 'nt', on: c.allowNewThread === true, onChange: (v) => save({ allowNewThread: v }),
              text: '允许 AI 发新帖（默认关；只发文字）' }),
            h('div', { key: 'ntq', className: 'tb-row' }, [
              h('span', { key: 'a', className: 'tb-kv' }, '每天最多'),
              h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('newThreadPerDay') }),
              h('span', { key: 'c', className: 'tb-kv' }, '帖'),
            ]),
            h(Sw, { key: 'img', on: c.allowImages === true, onChange: (v) => save({ allowImages: v }),
              text: '允许 AI 发图（默认关；上传失败会降级为纯文字）' }),
            h('div', { key: 'imgq', className: 'tb-row' }, [
              h('span', { key: 'a', className: 'tb-kv' }, '每天最多'),
              h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('imagePerDay') }),
              h('span', { key: 'c', className: 'tb-kv' }, '张（每轮 1 张 · 同图 24 小时冷却）'),
            ]),
            h('div', { key: 'h', className: 'tb-kv' },
              '现状：一轮最多 ' + (c.replyPerRound ?? 1) + ' 条，全天最多 ' + (c.replyPerDay ?? 3) + ' 条'
              + ((c.replyPerRound ?? 1) > (c.replyPerDay ?? 3) ? '（⚠️ 一轮额度比全天还大）' : '')),
          ]),
        ]),

        // ── ④ 自动化（折叠）──
        h('details', { key: 'auto', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['C2 自动化', h('span', { key: 't', className: 'tb-tag' }, '签到 · 峰谷定时')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'sg', on: c.autoSign, onChange: (v) => save({ autoSign: v }),
              text: '自动签到（每天 ' + c.signHour + ' 点后，未关注会先关注）' }),
            h(Sw, { key: 'sa', on: c.signAllFollowed === true, onChange: (v) => save({ signAllFollowed: v }),
              text: '签到也覆盖「账号关注的所有吧」（不只框里这些）' }),
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

        ]),

        h(Group, { key: 'D', id: 'D', title: '成长与记录',
          summary: (c.evolvePersona ? '演化开' : '演化关') + ((c.diaryEnabled === false) ? ' · 日记关' : ' · 日记开') }, [
        // ── D1 演化 ──
        h('details', { key: 'evolve', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['D1 演化', h('span', { key: 't', className: 'tb-tag' }, '吃语料 · 主人点头才改')]),
          h('div', { key: 'b', className: 'tb-body' }, [
            h(Sw, { key: 'e', on: c.evolvePersona === true, onChange: (v) => save({ evolvePersona: v }),
              text: '允许从吧里提炼语气样本（只提建议，不会自动改人设）' }),
            h('div', { key: 'h', className: 'tb-kv' }, '每个吧有自己的语料，待得越久越像它；回帖前先看这个吧怎么说话。'),
            (styleState && styleState.bars && styleState.bars.length)
              ? h('div', { key: 'sk', className: 'tb-kv' },
                '泡过：' + styleState.bars.slice(0, 5).map((b) => b.kw + '（' + b.mode + ' · ' + b.visits + ' 次 / ' + b.samples + ' 条）').join(' · '))
              : h('div', { key: 'sk0', className: 'tb-kv' }, '还没泡过任何吧。'),
            proposals.filter((p) => p.status === 'pending').length
              ? h('div', { key: 'list' }, proposals.filter((p) => p.status === 'pending').map((p) =>
                h('div', { key: p.id, style: { borderTop: '1px solid #eef2f8', marginTop: 8, paddingTop: 8 } }, [
                  h('div', { key: 's', style: { fontSize: 13, lineHeight: 1.8 } }, p.samples.map((x, i) => h('div', { key: i }, '· ' + x))),
                  p.note ? h('div', { key: 'n', className: 'tb-kv' }, p.note) : null,
                  h('div', { key: 'r', className: 'tb-row' }, [
                    h('button', { key: 'a', className: 'tb-btn ghost sm', disabled: busy,
                      onClick: async () => {
                        setBusy(true)
                        try { await jpost('/persona/apply', { id: p.id }); await loadProposals(); await refresh(); setMsg({ ok: true, text: '已采纳，样本已并进人设' }) }
                        catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                      } }, '采纳'),
                    h('button', { key: 'd', className: 'tb-btn ghost sm', disabled: busy,
                      onClick: async () => {
                        setBusy(true)
                        try { await jpost('/persona/dismiss', { id: p.id }); await loadProposals() }
                        catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                      } }, '忽略'),
                  ]),
                ])))
              : h('div', { key: 'none', className: 'tb-kv' }, '还没有待处理的建议。'),
          ]),
        ]),

        // ── ⑥ 日记（折叠）──
        h('details', { key: 'diary', className: 'tb-card' }, [
          h('summary', { key: 's' }, ['D2 日记', h('span', { key: 't', className: 'tb-tag' }, '公开 / 私人')]),
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

        h('div', { key: 'self', className: 'tb-row' }, [
          h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy, onClick: runSelfcheck }, '运行自检'),
          health ? h('span', { key: 'k', className: 'tb-kv' },
            'curl ' + (health.curl && health.curl.ok ? '✓' : '✗')
            + (health.curl && health.curl.bin ? '（' + health.curl.bin + '）' : '')
            + ' · 凭证 ' + (health.cookie && health.cookie.ok ? '✓' : '✗')
            + ' · 目录 ' + (health.dirs && health.dirs.writable ? '✓' : '✗')
            + ' · headless ' + (health.headless && health.headless.ok ? '✓' : '✗')) : null,
        ]),
        health ? h('pre', { key: 'hp', className: 'tb-pre' }, JSON.stringify(health, null, 1)) : null,

        // ── D3 版本与导出 ──
        h('div', { key: 'versions', className: 'tb-card' }, [
          h('div', { key: 't', className: 'tb-label', style: { marginTop: 0 } }, 'D3 版本与导出'),
          h('div', { key: 'cur', className: 'tb-kv' },
            persona ? ('当前 v' + persona.version + ' · 共 ' + versions.length + ' 个快照') : ''),
          h('div', { key: 'e', className: 'tb-row' }, [
            h('button', { key: 't', className: 'tb-btn ghost sm', disabled: busy, onClick: () => exportPersona('text') }, '导出当前（文本）'),
            h('button', { key: 'j', className: 'tb-btn ghost sm', disabled: busy, onClick: () => exportPersona('json') }, '导出当前（JSON）'),
          ]),
          versions.length
            ? h('div', { key: 'list' }, versions.slice().reverse().slice(0, 10).map((v) =>
              h('div', { key: v.version, style: { borderTop: '1px solid #eef2f8', marginTop: 8, paddingTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } }, [
                h('span', { key: 'a', className: 'tb-kv', style: { flex: 1 } },
                  'v' + v.version + ' · ' + (v.at || '') + (v.reason ? ' · ' + v.reason : '')),
                h('button', { key: 'x', className: 'tb-btn ghost sm', disabled: busy, onClick: () => exportPersona('text', v.version) }, '导出'),
                h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy,
                  onClick: async () => {
                    if (!window.confirm('回滚到 v' + v.version + '？会作为一个新版本写回，历史不丢。')) return
                    setBusy(true)
                    try {
                      const r = await jpost('/persona/rollback', { version: v.version })
                      if (!r.ok) throw new Error(r.error || '回滚失败')
                      await loadPersona(); await loadVersions(); await loadEvo()
                      setMsg({ ok: true, text: '已回滚到 v' + v.version + '（新版本 v' + r.persona.version + '）' })
                    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                  } }, '回滚'),
              ])))
            : h('div', { key: 'none', className: 'tb-kv' }, '还没有快照。改一次人设就会出现。'),
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

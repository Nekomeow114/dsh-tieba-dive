/**
 * dsh-tieba-scroll —— 浏览器半端（设置里的「刷贴吧」一页）
 * ============================================================================
 * 自注册脚本：window.__ModuleLoader__.load({ id, factory })，id 必须等于包名。
 *
 * 这一页自己管全部配置（不依赖宿主自动生成的表单）：
 *   BDUSS → 保存并测试  ·  吧列表  ·  签到/回帖开关  ·  每日条数  ·  立即签到  ·  状态
 * 接口：/api/tieba-duty/{status,config,cookie,sign}
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
    `

    function Field({ label, children }) {
      return h('div', { className: 'tb-field' }, [h('label', { className: 'tb-label', key: 'l' }, label), children])
    }

    function Panel() {
      const [cookie, setCookie] = React.useState('')
      const [cfg, setCfg] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [diary, setDiary] = React.useState(null)
      const [cookieMsg, setCookieMsg] = React.useState(null)
      const [round, setRound] = React.useState(null)
      const [report, setReport] = React.useState(null)

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
              ? '接口 404：插件的「主机半端」没加载。请把 DSH 完全重启一次（不是只关这个页面），再回来看。'
              : '读状态失败：' + m,
          })
        }
      }, [])
      React.useEffect(() => { refresh() }, [refresh])

      const saveCookie = async () => {
        if (!cookie.trim()) { setMsg({ ok: false, text: '先粘贴 BDUSS（带不带前缀都行）' }); return }
        if (/^(ssh-|-----BEGIN)/i.test(cookie.trim())) {
          setMsg({ ok: false, text: '这是 SSH 公钥（给 GitHub 的），不是 BDUSS。BDUSS 在贴吧 cookie 里，长约 190 个字符。' })
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

      const saveCfg = async (patch) => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/config', patch)
          setCfg(r.cfg)
          setMsg({ ok: true, text: '配置已保存' })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
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
        setBusy(true); setMsg({ ok: true, text: '抓取中…（每读一个楼约 1~2 秒）' }); setRound(null)
        try {
          const r = await jpost('/run', {})
          setRound(r)
          const lines = (r.bars || []).map((b) => b.error
            ? '✗ ' + b.kw + '：' + b.error
            : '✓ ' + b.kw + '：读到 ' + b.read + ' 个楼（新帖 ' + b.fresh + ' 个）')
          setMsg({ ok: (r.bars || []).every((b) => !b.error), text: lines.join('\n') + '\n\n原始数据：' + r.file })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const showReport = async () => {
        setBusy(true)
        try {
          const r = await jget('/report?latest=1')
          setReport(r.ok ? r : { text: r.error || '还没有日报' })
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const c = cfg || { bars: [], autoSign: false, autoReply: false, replyPerDay: 3, replyGapSec: 30, signHour: 9 }

      return h('div', { className: 'tb-wrap' }, [
        h('h2', { key: 't' }, '刷贴吧'),
        h('div', { className: 'tb-sub', key: 's' },
          '每天替你看几个吧：读帖、挑值得的、写日报。回帖默认关闭，开了也受每日条数和间隔限制。'),
        h('div', { className: 'tb-warn', key: 'w' },
          'BDUSS 等于你的登录凭证：它只存在本机 $DSH_HOME/tieba-duty/cookie.txt（600），不回显、不进日志。'
          + '想要清除登录数据，去贴吧「账号安全 → 退出所有设备」。'),

        cookieMsg ? h('div', { key: 'cm', className: 'tb-msg ' + (cookieMsg.ok ? 'ok' : 'err'),
          style: { marginTop: -6, marginBottom: 12 } }, cookieMsg.text) : null,

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

        h(Field, { key: 'persona', label: '人设（写在这里，或指一个文件）' }, [
          h('textarea', {
            key: 'p', className: 'tb-area', placeholder: '例：一只蓝发小鲸鱼，自称「咱」，说话短、软、爱夸人……',
            value: c.personaText || '',
            onChange: (e) => setCfg({ ...c, personaText: e.target.value }),
          }),
          h('div', { className: 'tb-row', key: 'f', style: { marginTop: 8 } }, [
            h('label', { key: 'l', className: 'tb-btn ghost', style: { cursor: 'pointer', margin: 0 } }, [
              '导入文件（.md / .txt）',
              h('input', {
                key: 'i', type: 'file', accept: '.md,.txt,.markdown,text/plain,text/markdown',
                style: { display: 'none' },
                onChange: (e) => {
                  const f = e.target.files && e.target.files[0]
                  if (!f) return
                  if (f.size > 200 * 1024) { setMsg({ ok: false, text: '这个文件太大了（>200KB），人设不用这么长' }); return }
                  const reader = new FileReader()
                  reader.onload = () => {
                    const text = String(reader.result || '')
                    setCfg((cur) => ({ ...(cur || c), personaText: text, personaFile: '' }))
                    setMsg({ ok: true, text: `已读入「${f.name}」（${text.length} 字），记得点「保存人设」` })
                  }
                  reader.onerror = () => setMsg({ ok: false, text: '读文件失败了' })
                  reader.readAsText(f, 'utf-8')
                  e.target.value = ''
                },
              }),
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
              onChange: (e) => setCfg({ ...c, readPerRound: Number(e.target.value) }),
              onBlur: () => saveCfg({ readPerRound: c.readPerRound }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '个楼，回'),
            h('input', { key: 'd', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.replyPerRound,
              onChange: (e) => setCfg({ ...c, replyPerRound: Number(e.target.value) }),
              onBlur: () => saveCfg({ replyPerRound: c.replyPerRound }) }),
            h('span', { key: 'e', className: 'tb-kv' }, '条（默认读 5 回 1）'),
          ]),
        ]),

        h(Field, { key: 'autoSign', label: '自动签到' }, [
          h('div', { className: 'tb-switch', key: 's' }, [
            h('input', { key: 'c', type: 'checkbox', checked: !!c.autoSign,
              onChange: (e) => saveCfg({ autoSign: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '每天 ' + c.signHour + ' 点后自动签一次'),
          ]),
        ]),

        h(Field, { key: 'autoReply', label: '允许回帖（默认关）' }, [
          h('div', { className: 'tb-switch', key: 's' }, [
            h('input', { key: 'c', type: 'checkbox', checked: !!c.autoReply,
              onChange: (e) => saveCfg({ autoReply: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '⚠️ 打开后，模型可以在你确认下用这个号发公开回复'),
          ]),
          h('div', { className: 'tb-switch', key: 'qa', style: { marginTop: 8 } }, [
            h('input', { key: 'c', type: 'checkbox', checked: c.answerQuestions !== false,
              onChange: (e) => saveCfg({ answerQuestions: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '允许回帖里解答别人的疑问（关掉就只接话/共鸣/玩梗）'),
          ]),
          h('div', { className: 'tb-switch', key: 'gate', style: { marginTop: 8 } }, [
            h('input', { key: 'c', type: 'checkbox', checked: c.toneGate !== false,
              onChange: (e) => saveCfg({ toneGate: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '拦客服腔（首先/其次/希望对你有帮助…），长短不限'),
          ]),
          h('div', { className: 'tb-row', key: 'm', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '回复时 @'),
            h('input', { key: 'b', className: 'tb-input', style: { width: 160 }, placeholder: '贴吧昵称（留空不 @）',
              value: c.mention || '',
              onChange: (e) => setCfg({ ...c, mention: e.target.value }),
              onBlur: () => saveCfg({ mention: c.mention }) }),
            h('label', { key: 'c', className: 'tb-kv', style: { display: 'flex', gap: 6, alignItems: 'center' } }, [
              h('input', { key: 'i', type: 'checkbox', checked: !!c.mentionEvery,
                onChange: (e) => saveCfg({ mentionEvery: e.target.checked }) }),
              '每条都带',
            ]),
          ]),
          h('div', { className: 'tb-row', key: 'n', style: { marginTop: 8 } }, [
            h('span', { key: 'a', className: 'tb-kv' }, '每天最多'),
            h('input', { key: 'b', className: 'tb-input', type: 'number', style: { width: 70 }, value: c.replyPerDay,
              onChange: (e) => setCfg({ ...c, replyPerDay: Number(e.target.value) }),
              onBlur: () => saveCfg({ replyPerDay: c.replyPerDay }) }),
            h('span', { key: 'c', className: 'tb-kv' }, '条，间隔'),
            h('input', { key: 'd', className: 'tb-input', type: 'number', style: { width: 80 }, value: c.replyGapSec,
              onChange: (e) => setCfg({ ...c, replyGapSec: Number(e.target.value) }),
              onBlur: () => saveCfg({ replyGapSec: c.replyGapSec }) }),
            h('span', { key: 'e', className: 'tb-kv' }, '秒'),
          ]),
        ]),

        h(Field, { key: 'duty', label: '跑一轮 / 看日报' }, [
          h('div', { className: 'tb-row', key: 'b' }, [
            h('button', { key: 'r', className: 'tb-btn', disabled: busy, onClick: runRound }, '抓取一轮'),
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: showReport }, '看最近日报'),
          ]),
          h('div', { key: 'h', className: 'tb-kv' },
            '「抓取一轮」只采集（列帖 → 读 ' + (c.readPerRound || 5) + ' 个楼 → 存原始数据），不生成日报；日报由模型读原始数据后写。'),
          report ? h('pre', { key: 'rp', className: 'tb-area', style: { marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' } },
            report.text || '（空）') : null,
        ]),

        h('div', { className: 'tb-row', key: 'ops' }, [
          h('button', { key: 's', className: 'tb-btn ghost', disabled: busy, onClick: signNow }, '立即签到一次'),
          h('button', { key: 'r', className: 'tb-btn ghost', disabled: busy, onClick: refresh }, '刷新状态'),
        ]),

        h(Field, { key: 'diary', label: '日记本' }, [
          h('div', { className: 'tb-switch', key: 'on' }, [
            h('input', { key: 'c', type: 'checkbox', checked: c.diaryEnabled !== false,
              onChange: (e) => saveCfg({ diaryEnabled: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '允许写日记'),
          ]),
          h('div', { className: 'tb-switch', key: 'pv' }, [
            h('input', { key: 'c', type: 'checkbox', checked: c.diaryPrivate !== false,
              onChange: (e) => saveCfg({ diaryPrivate: e.target.checked }) }),
            h('span', { key: 't', className: 'tb-kv' }, '允许写私人日记（只有主人手动翻开才看得到）'),
          ]),
          h('div', { className: 'tb-row', key: 'b' }, [
            h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy,
              onClick: async () => { setBusy(true); try { setDiary(await jget('/diary?scope=public')) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) } } },
              '看大肥鱼写给主人的日记'),
            h('button', { key: 'v', className: 'tb-btn ghost', disabled: busy,
              onClick: async () => {
                if (!window.confirm('这是大肥鱼的私人日记……\n\n只有主人能看。确定现在翻开吗？')) return
                setBusy(true)
                try { setDiary(await jget('/diary?scope=private')) } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
              } },
              '翻开私人日记（有点害羞）'),
          ]),
          diary ? h('pre', { key: 'd', className: 'tb-area', style: { marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto' } },
            (diary.text || '（还没有日记）') + '\n\n' + (diary.file || '')) : null,
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
          () => h(Panel),
        ))
      },
    }
  },
})

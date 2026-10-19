/**
 * dsh-tieba-scroll —— 浏览器半端（设置里的「刷贴吧」一页）
 * ============================================================================
 * client bundle 不是 ESM，是自注册脚本：window.__ModuleLoader__.load({ id, factory })
 * id 必须等于 package.json 的 name。
 *
 * 这一页要满足的形状：
 *   · 账号绑定在设置页里（贴 BDUSS → 「保存并测试」当场验证）
 *   · 多吧可编辑（一行一个）
 *   · 开关默认保守：签到关、回帖**关**
 *   · 立刻能「签到一次」「看今天回了几条」
 */
window.__ModuleLoader__.load({
  id: 'dsh-tieba-scroll',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/tieba-duty'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p, body) => (await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })).json()

    const CSS = `
      .tb-wrap { padding: 16px 18px; max-width: 720px; font-size: 14px; }
      .tb-wrap h2 { font-size: 16px; margin: 0 0 4px; }
      .tb-sub { color: #7a8ba6; font-size: 12.5px; margin-bottom: 16px; line-height: 1.6; }
      .tb-field { margin-bottom: 16px; }
      .tb-label { font-weight: 600; margin-bottom: 6px; display: block; }
      .tb-input, .tb-area { width: 100%; box-sizing: border-box; padding: 8px 10px;
        border: 1px solid #d3dce8; border-radius: 8px; font-size: 13px; font-family: inherit;
        background: #fff; color: #22303f; }
      .tb-area { min-height: 64px; resize: vertical; }
      .tb-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .tb-btn { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer;
        background: #2d6cdf; color: #fff; }
      .tb-btn:disabled { opacity: .55; cursor: default; }
      .tb-btn.ghost { background: #eef3fb; color: #2d6cdf; }
      .tb-msg { margin-top: 10px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
      .tb-msg.ok { color: #178a4c; } .tb-msg.err { color: #c0392b; }
      .tb-warn { background: #fff8e6; border: 1px solid #f0d9a0; color: #7a5a12;
        padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.7; margin-bottom: 16px; }
      .tb-kv { color: #54657c; font-size: 12.5px; }
    `

    function Panel() {
      const [cookie, setCookie] = React.useState('')
      const [status, setStatus] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const refresh = React.useCallback(async () => {
        try { setStatus(await jget('/status')) } catch (e) { setStatus({ ok: false, error: String(e) }) }
      }, [])
      React.useEffect(() => { refresh() }, [refresh])

      const save = async () => {
        if (!/BDUSS=/.test(cookie)) { setMsg({ ok: false, text: '要带 BDUSS= 前缀，整串贴进来' }); return }
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/cookie', { cookie })
          setMsg(r.loggedIn
            ? { ok: true, text: `登录态有效 ✓（tbs 已拿到）` }
            : { ok: false, text: `没通过：${r.hint || 'is_login=0'}` })
          setCookie('')
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e) }) } finally { setBusy(false) }
      }

      const signNow = async () => {
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/sign', {})
          const lines = (r.results || []).map((x) => x.ok
            ? `✓ ${x.kw}：签到成功（累计 ${x.count ?? '?'} 天）`
            : `✗ ${x.kw}：${x.error || x.msg || '失败'}`)
          setMsg({ ok: lines.every((l) => l.startsWith('✓')), text: lines.join('\n') })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e) }) } finally { setBusy(false) }
      }

      return h('div', { className: 'tb-wrap' }, [
        h('h2', { key: 't' }, '刷贴吧'),
        h('div', { className: 'tb-sub', key: 's' },
          '每天替你看几个吧：读帖、挑值得的、写日报。回帖默认关闭，开了也受每日条数和间隔限制。'),
        h('div', { className: 'tb-warn', key: 'w' },
          'BDUSS 等于你的登录凭证：它只存在本机 $DSH_HOME/tieba-duty/cookie.txt（600），不回显、不进日志。'
          + '用完请去贴吧「账号安全 → 退出所有设备」，这串会立刻作废。'),

        h('div', { className: 'tb-field', key: 'cookie' }, [
          h('label', { className: 'tb-label', key: 'l' }, 'BDUSS'),
          h('input', {
            key: 'i', className: 'tb-input', type: 'password', placeholder: 'BDUSS=....',
            value: cookie, onChange: (e) => setCookie(e.target.value),
          }),
          h('div', { className: 'tb-row', key: 'r', style: { marginTop: 8 } }, [
            h('button', { key: 'b', className: 'tb-btn', disabled: busy, onClick: save }, '保存并测试'),
            h('span', { key: 'k', className: 'tb-kv' },
              status?.hasCookie ? '已有凭证' : '还没有凭证'),
          ]),
        ]),

        h('div', { className: 'tb-field', key: 'bars' }, [
          h('label', { className: 'tb-label', key: 'l' }, '要刷的吧'),
          h('div', { className: 'tb-kv', key: 'v' },
            (status?.bars || []).join('、') || '（还没读到配置）'),
          h('div', { className: 'tb-kv', key: 'k', style: { marginTop: 6 } },
            '吧列表 / 签到 / 回帖开关都在下方 DSH 自动生成的表单里改（本页只做登录与手动操作）。'),
        ]),

        h('div', { className: 'tb-row', key: 'ops' }, [
          h('button', { key: 's', className: 'tb-btn ghost', disabled: busy, onClick: signNow }, '立即签到一次'),
          h('button', { key: 'r', className: 'tb-btn ghost', disabled: busy, onClick: refresh }, '刷新状态'),
        ]),

        status ? h('div', { className: 'tb-kv', key: 'st', style: { marginTop: 14, lineHeight: 1.9 } }, [
          h('div', { key: 'a' }, `今天：${status.today} · 已回 ${status.repliesToday} 条`),
          h('div', { key: 'b' }, `签到记录：${Object.entries(status.signed || {}).map(([k, v]) => `${k}@${v}`).join('、') || '无'}`),
          h('div', { key: 'c' }, `凭证文件：${status.cookieFile || '-'}`),
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

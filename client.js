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

      const refresh = React.useCallback(async () => {
        try {
          const st = await jget('/status')
          setStatus(st)
          if (st && st.cfg) setCfg((cur) => cur || st.cfg)
        } catch (e) {
          setStatus({ ok: false })
          setMsg({ ok: false, text: '读状态失败：' + (e.message || e) })
        }
      }, [])
      React.useEffect(() => { refresh() }, [refresh])

      const saveCookie = async () => {
        if (!cookie.trim()) { setMsg({ ok: false, text: '先粘贴 BDUSS（带不带前缀都行）' }); return }
        setBusy(true); setMsg(null)
        try {
          const r = await jpost('/cookie', { cookie })
          setMsg(r.loggedIn ? { ok: true, text: '登录态有效 ✓' } : { ok: false, text: '没通过：' + (r.hint || 'is_login=0') })
          setCookie('')
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
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
            ? '✓ ' + x.kw + '：签到成功（累计 ' + (x.count == null ? '?' : x.count) + ' 天）'
            : '✗ ' + x.kw + '：' + (x.error || x.msg || '失败'))
          setMsg({ ok: lines.length > 0 && lines.every((l) => l.charAt(0) === '✓'), text: lines.join('\n') || '没有可签到的吧' })
          await refresh()
        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
      }

      const c = cfg || { bars: [], autoSign: false, autoReply: false, replyPerDay: 3, replyGapSec: 30, signHour: 9 }

      return h('div', { className: 'tb-wrap' }, [
        h('h2', { key: 't' }, '刷贴吧'),
        h('div', { className: 'tb-sub', key: 's' },
          '每天替你看几个吧：读帖、挑值得的、写日报。回帖默认关闭，开了也受每日条数和间隔限制。'),
        h('div', { className: 'tb-warn', key: 'w' },
          'BDUSS 等于你的登录凭证：它只存在本机 $DSH_HOME/tieba-duty/cookie.txt（600），不回显、不进日志。'
          + '用完请去贴吧「账号安全 → 退出所有设备」。'),

        h(Field, { key: 'cookie', label: 'BDUSS' }, [
          h('input', {
            key: 'i', className: 'tb-input', type: 'text', placeholder: 'BDUSS=... 或只贴值（自动补前缀）',
            value: cookie, onChange: (e) => setCookie(e.target.value),
          }),
          h('div', { className: 'tb-row', key: 'r', style: { marginTop: 8 } }, [
            h('button', { key: 'b', className: 'tb-btn', disabled: busy, onClick: saveCookie }, '保存并测试'),
            h('span', { key: 'k', className: 'tb-kv' }, status && status.hasCookie ? '已有凭证 ✓' : '还没有凭证'),
          ]),
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
          () => h(Panel),
        ))
      },
    }
  },
})

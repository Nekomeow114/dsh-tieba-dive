/**
 * dsh-tieba-scroll —— 浏览器半端（设置里的「刷贴吧」）
 *
 * 布局与视觉架构（2026-10 焕新版）：
 *   · 顶部仪表盘（Hero + 四宫格状态卡 + 快捷分组导航）：凭证 / 今日配额 / 峰谷窗口 / 最近运行 一目了然；
 *   · 四大折叠分组（默认展开首组，支持一键全部展开 / 收起低频）；
 *   · 八张标准卡片统一卡片头、状态徽章、子面板与响应式栅格排版，消除双层嵌套折叠与结构错位；
 *   · 原生感滑动开关（Switch）、24h 峰谷排班可视化条、参数网格、时间轴与快照列表；
 *   · 顶部浮动消息条 + 底部环境自检栏，任何操作即时反馈。
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
      .tb {
        --tb-bg: #f4f7fb;
        --tb-surface: #ffffff;
        --tb-surface-alt: #f8fafd;
        --tb-border: #e2e8f0;
        --tb-border-strong: #cbd5e1;
        --tb-text: #0f172a;
        --tb-text-sec: #475569;
        --tb-text-muted: #64748b;
        --tb-primary: #2563eb;
        --tb-primary-hover: #1d4ed8;
        --tb-primary-soft: #eff6ff;
        --tb-primary-border: #bfdbfe;
        --tb-ok: #15803d;
        --tb-ok-bg: #f0fdf4;
        --tb-ok-border: #bbf7d0;
        --tb-warn: #b45309;
        --tb-warn-bg: #fffbeb;
        --tb-warn-border: #fde68a;
        --tb-err: #b91c1c;
        --tb-err-bg: #fef2f2;
        --tb-err-border: #fecaca;
        --tb-radius-lg: 16px;
        --tb-radius-md: 12px;
        --tb-radius-sm: 8px;
        --tb-shadow: 0 1px 3px rgba(15, 23, 42, 0.05), 0 1px 2px rgba(15, 23, 42, 0.03);
        --tb-shadow-md: 0 4px 14px rgba(15, 23, 42, 0.07);
        padding: 18px 20px 36px;
        max-width: 780px;
        margin: 0 auto;
        font-size: 13.5px;
        line-height: 1.55;
        color: var(--tb-text);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      }

      /* ── 顶部浮动通知 ── */
      .tb-toast {
        position: sticky;
        top: 10px;
        z-index: 30;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 14px;
        margin-bottom: 14px;
        border-radius: var(--tb-radius-md);
        box-shadow: var(--tb-shadow-md);
        font-size: 13px;
        line-height: 1.55;
        white-space: pre-wrap;
        backdrop-filter: blur(8px);
      }
      .tb-toast.ok {
        background: rgba(240, 253, 244, 0.96);
        border: 1px solid var(--tb-ok-border);
        color: var(--tb-ok);
      }
      .tb-toast.err {
        background: rgba(254, 242, 242, 0.96);
        border: 1px solid var(--tb-err-border);
        color: var(--tb-err);
      }
      .tb-toast-close {
        border: 0;
        background: transparent;
        color: inherit;
        opacity: 0.65;
        cursor: pointer;
        font-size: 15px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .tb-toast-close:hover { opacity: 1; background: rgba(0, 0, 0, 0.06); }

      /* ── 顶部 Hero 与状态仪表盘 ── */
      .tb-hero {
        background: linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%);
        border: 1px solid #dbe7f7;
        border-radius: var(--tb-radius-lg);
        padding: 16px 18px;
        margin-bottom: 12px;
        box-shadow: var(--tb-shadow);
      }
      .tb-hero-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 14px;
      }
      .tb-brand {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .tb-logo {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
        color: #fff;
        font-weight: 800;
        font-size: 17px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(37, 99, 235, 0.25);
        flex-shrink: 0;
      }
      .tb-h {
        font-size: 17px;
        font-weight: 700;
        color: var(--tb-text);
        margin: 0;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tb-sub {
        color: var(--tb-text-muted);
        font-size: 12.5px;
        margin: 2px 0 0;
      }
      .tb-ver {
        background: var(--tb-primary-soft);
        color: var(--tb-primary);
        border: 1px solid var(--tb-primary-border);
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11.5px;
        font-weight: 600;
      }
      .tb-hero-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      /* ── 状态仪表盘四宫格 ── */
      .tb-stats-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      @media (max-width: 600px) {
        .tb-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      .tb-stat-box {
        background: #fff;
        border: 1px solid #e2eaf5;
        border-radius: 10px;
        padding: 9px 11px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .tb-stat-box.ok { border-color: var(--tb-ok-border); background: #f9fefb; }
      .tb-stat-box.warn { border-color: var(--tb-warn-border); background: #fffdf7; }
      .tb-stat-box.run { border-color: var(--tb-primary-border); background: #f5f9ff; }
      .tb-stat-label {
        font-size: 11px;
        color: var(--tb-text-muted);
        font-weight: 500;
      }
      .tb-stat-val {
        font-size: 13px;
        font-weight: 700;
        color: var(--tb-text);
        display: flex;
        align-items: center;
        gap: 5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tb-stat-box.ok .tb-stat-val { color: var(--tb-ok); }
      .tb-stat-box.warn .tb-stat-val { color: var(--tb-warn); }
      .tb-stat-box.run .tb-stat-val { color: var(--tb-primary); }
      .tb-stat-meta {
        font-size: 11px;
        color: var(--tb-text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── 状态胶囊 ── */
      .tb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      .tb-chip {
        background: #f1f5f9;
        color: var(--tb-text-sec);
        border: 1px solid #e2e8f0;
        border-radius: 999px;
        padding: 3px 10px;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .tb-chip.ok { background: var(--tb-ok-bg); color: var(--tb-ok); border-color: var(--tb-ok-border); }
      .tb-chip.warn { background: var(--tb-warn-bg); color: var(--tb-warn); border-color: var(--tb-warn-border); }
      .tb-chip.run { background: var(--tb-primary-soft); color: var(--tb-primary); border-color: var(--tb-primary-border); }
      .tb-chip.run::before {
        content: '●';
        color: var(--tb-primary);
        font-size: 10px;
        animation: tb-pulse 1.2s ease-in-out infinite;
      }
      @keyframes tb-pulse { 50% { opacity: 0.25; } }

      /* ── 首次引导与告警框 ── */
      .tb-onboard {
        background: linear-gradient(135deg, #f8fbff 0%, #eff6ff 100%);
        border: 1px solid #bfdbfe;
        border-radius: var(--tb-radius-md);
        padding: 12px 14px;
        margin-bottom: 14px;
      }
      .tb-onboard-steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 8px;
      }
      @media (max-width: 600px) {
        .tb-onboard-steps { grid-template-columns: 1fr; }
      }
      .tb-step {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid #dbeafe;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        color: var(--tb-text-sec);
        display: flex;
        align-items: flex-start;
        gap: 7px;
      }
      .tb-step.done {
        border-color: var(--tb-ok-border);
        background: #f0fdf4;
        color: var(--tb-ok);
      }
      .tb-step-num {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--tb-primary);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .tb-step.done .tb-step-num { background: var(--tb-ok); }

      .tb-warn {
        background: var(--tb-warn-bg);
        border: 1px solid var(--tb-warn-border);
        color: var(--tb-warn);
        padding: 10px 12px;
        border-radius: var(--tb-radius-sm);
        font-size: 12.5px;
        line-height: 1.65;
        margin: 10px 0;
      }
      .tb-warn.danger {
        background: var(--tb-err-bg);
        border-color: var(--tb-err-border);
        color: var(--tb-err);
      }

      /* ── 四大分组容器 ── */
      .tb-group {
        border: 1px solid #dbe4f0;
        border-radius: var(--tb-radius-lg);
        background: var(--tb-surface-alt);
        margin-bottom: 14px;
        box-shadow: var(--tb-shadow);
        overflow: hidden;
      }
      .tb-group[open] {
        border-color: #c3d4ec;
      }
      .tb-group > summary {
        cursor: pointer;
        list-style: none;
        padding: 13px 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        background: #fff;
        user-select: none;
        transition: background 0.15s ease;
      }
      .tb-group > summary:hover {
        background: #f8fbff;
      }
      .tb-group > summary::-webkit-details-marker { display: none; }
      .tb-group[open] > summary {
        border-bottom: 1px solid #e8eef6;
      }
      .tb-group-id {
        width: 26px;
        height: 26px;
        border-radius: 7px;
        background: var(--tb-primary-soft);
        color: var(--tb-primary);
        border: 1px solid var(--tb-primary-border);
        font-weight: 800;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .tb-group[open] .tb-group-id {
        background: var(--tb-primary);
        color: #fff;
        border-color: var(--tb-primary);
      }
      .tb-group-title {
        font-weight: 700;
        font-size: 14.5px;
        color: var(--tb-text);
      }
      .tb-group-sum-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tb-group-arrow {
        color: #94a3b8;
        font-size: 12px;
        transition: transform 0.2s ease;
      }
      .tb-group[open] .tb-group-arrow {
        transform: rotate(90deg);
        color: var(--tb-primary);
      }
      .tb-group-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      /* ── 标准卡片与子面板 ── */
      .tb-card {
        border: 1px solid var(--tb-border);
        border-radius: var(--tb-radius-md);
        background: var(--tb-surface);
        padding: 15px 16px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02);
      }
      .tb-card-hd {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding-bottom: 10px;
        margin-bottom: 12px;
        border-bottom: 1px solid #f1f5f9;
      }
      .tb-card-title {
        font-weight: 700;
        font-size: 14px;
        color: var(--tb-text);
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
      }
      .tb-subcard {
        background: var(--tb-surface-alt);
        border: 1px solid #e8eef6;
        border-radius: 10px;
        padding: 11px 13px;
        margin-top: 10px;
      }
      .tb-subcard-title {
        font-weight: 600;
        font-size: 12.5px;
        color: var(--tb-text-sec);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
      }

      /* ── 24h 峰谷排班可视化条 ── */
      .tb-sched-bar {
        display: grid;
        grid-template-columns: 2.8fr 1.6fr 1.5fr 1.7fr 2.4fr;
        gap: 4px;
        margin: 8px 0 8px;
        border-radius: 8px;
        overflow: hidden;
      }
      .tb-sched-seg {
        padding: 6px 6px;
        text-align: center;
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.3;
        white-space: nowrap;
        border-radius: 6px;
      }
      .tb-sched-seg.valley {
        background: #dbeafe;
        color: #1e40af;
      }
      .tb-sched-seg.valley.off {
        background: #f1f5f9;
        color: #94a3b8;
      }
      .tb-sched-seg.peak {
        background: #fef3c7;
        color: #92400e;
      }

      .tb-tag {
        background: #f1f5f9;
        color: var(--tb-text-sec);
        border-radius: 999px;
        padding: 2px 9px;
        font-weight: 500;
        font-size: 11.5px;
        line-height: 1.4;
      }
      .tb-tag.ok { background: var(--tb-ok-bg); color: var(--tb-ok); }
      .tb-tag.warn { background: var(--tb-warn-bg); color: var(--tb-warn); }
      .tb-tag.primary { background: var(--tb-primary-soft); color: var(--tb-primary); }

      .tb-body { margin-top: 10px; }
      .tb-label {
        font-weight: 600;
        font-size: 12.5px;
        color: var(--tb-text-sec);
        margin: 10px 0 5px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .tb-in, .tb-ta {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 11px;
        border: 1px solid #cbd5e1;
        border-radius: var(--tb-radius-sm);
        font-size: 13px;
        font-family: inherit;
        background: #fff;
        color: var(--tb-text);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .tb-in:focus, .tb-ta:focus, .tb-num:focus {
        outline: none;
        border-color: var(--tb-primary);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
      }
      .tb-ta { min-height: 76px; resize: vertical; line-height: 1.55; }
      .tb-num {
        width: 70px;
        padding: 6px 8px;
        border: 1px solid #cbd5e1;
        border-radius: var(--tb-radius-sm);
        font-size: 13px;
        font-weight: 600;
        text-align: center;
        color: var(--tb-text);
        background: #fff;
        font-variant-numeric: tabular-nums;
      }

      /* ── 栅格与表单行 ── */
      .tb-grid-2 {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .tb-grid-3 {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }
      @media (max-width: 560px) {
        .tb-grid-2, .tb-grid-3 { grid-template-columns: 1fr; }
      }
      .tb-param-box {
        background: var(--tb-surface-alt);
        border: 1px solid #e8eef6;
        border-radius: 8px;
        padding: 8px 11px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .tb-row {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin: 8px 0;
      }
      .tb-kv {
        color: var(--tb-text-muted);
        font-size: 12px;
        line-height: 1.65;
      }
      .tb-divider {
        height: 1px;
        background: #eef2f6;
        margin: 12px 0;
      }

      /* ── 按钮体系 ── */
      .tb-btn {
        border: 1px solid transparent;
        border-radius: var(--tb-radius-sm);
        padding: 7px 14px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        background: var(--tb-primary);
        color: #fff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transition: all 0.15s ease;
      }
      .tb-btn:hover:not(:disabled) {
        background: var(--tb-primary-hover);
      }
      .tb-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .tb-btn.ghost {
        background: #f1f5f9;
        color: #1e293b;
        border-color: #e2e8f0;
      }
      .tb-btn.ghost:hover:not(:disabled) {
        background: #e2e8f0;
        color: var(--tb-text);
      }
      .tb-btn.soft {
        background: var(--tb-primary-soft);
        color: var(--tb-primary);
        border-color: var(--tb-primary-border);
      }
      .tb-btn.soft:hover:not(:disabled) {
        background: #dbeafe;
      }
      .tb-btn.danger-ghost {
        background: #fef2f2;
        color: var(--tb-err);
        border-color: #fecaca;
      }
      .tb-btn.sm {
        padding: 5px 10px;
        font-size: 12px;
        border-radius: 6px;
      }

      /* ── 现代滑动开关（Switch） ── */
      .tb-sw {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 11px;
        margin: 6px 0;
        background: var(--tb-surface-alt);
        border: 1px solid #edf2f7;
        border-radius: 9px;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
      }
      .tb-sw:hover {
        border-color: #cbd5e1;
        background: #f1f5f9;
      }
      .tb-sw.active {
        background: #f8fbff;
        border-color: #dbeafe;
      }
      .tb-sw-text {
        font-size: 13px;
        color: var(--tb-text);
        font-weight: 500;
        line-height: 1.45;
      }
      .tb-sw-track {
        position: relative;
        width: 38px;
        height: 22px;
        border-radius: 999px;
        background: #cbd5e1;
        flex-shrink: 0;
        transition: background 0.2s ease;
      }
      .tb-sw.active .tb-sw-track {
        background: var(--tb-primary);
      }
      .tb-sw-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
        transition: transform 0.2s ease;
      }
      .tb-sw.active .tb-sw-thumb {
        transform: translateX(16px);
      }
      .tb-sw input {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
      }

      /* ── 图片库网格 ── */
      .tb-img-scroll {
        max-height: 52vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding-right: 4px;
        margin-top: 10px;
        border-radius: 10px;
      }
      .tb-img-scroll::-webkit-scrollbar { width: 6px; }
      .tb-img-scroll::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
      .tb-img-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(155px, 1fr));
        gap: 10px;
        margin-top: 10px;
      }
      .tb-img-card {
        border: 1px solid var(--tb-border);
        border-radius: 10px;
        padding: 8px;
        background: #fff;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        transition: box-shadow 0.15s ease;
      }
      .tb-img-card:hover {
        box-shadow: var(--tb-shadow-md);
      }
      .tb-ver-item {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        padding: 8px 0;
        border-top: 1px solid #eef2f8;
      }
      .tb-ver-meta {
        flex: 1 1 100%;
        min-width: 0;
        overflow-wrap: anywhere;
        line-height: 1.6;
      }
      .tb-ver-item .tb-row { margin: 0; }
      .tb-img-thumb {
        width: 100%;
        height: 96px;
        object-fit: cover;
        border-radius: 7px;
        background: #f1f5f9;
      }

      /* ── 时间轴与版本列表 ── */
      .tb-timeline {
        position: relative;
        padding-left: 14px;
        border-left: 2px solid #dbeafe;
        margin: 8px 0 8px 4px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tb-tl-item {
        position: relative;
        font-size: 12px;
        color: var(--tb-text-sec);
        background: #fff;
        border: 1px solid #edf2f7;
        border-radius: 8px;
        padding: 7px 10px;
      }
      .tb-tl-item::before {
        content: '';
        position: absolute;
        left: -19px;
        top: 11px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--tb-primary);
        border: 2px solid #fff;
      }
      .tb-ver-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-wrap: wrap;
        padding: 7px 10px;
        border: 1px solid #edf2f7;
        border-radius: 8px;
        background: #fff;
        margin-top: 6px;
      }

      /* ── 代码与日志预览框 ── */
      .tb-pre {
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 240px;
        overflow: auto;
        margin-top: 8px;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: var(--tb-radius-sm);
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.6;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }
      .tb-pre.light {
        background: #f8fafc;
        color: #1e293b;
        border: 1px solid #e2e8f0;
      }

      .tb-msg {
        margin-top: 8px;
        padding: 8px 11px;
        border-radius: var(--tb-radius-sm);
        font-size: 12.5px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .tb-msg.ok {
        background: var(--tb-ok-bg);
        border: 1px solid var(--tb-ok-border);
        color: var(--tb-ok);
      }
      .tb-msg.err {
        background: var(--tb-err-bg);
        border: 1px solid var(--tb-err-border);
        color: var(--tb-err);
      }

      .tb-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        min-height: 240px;
        color: var(--tb-text-muted);
        font-size: 13px;
      }
      .tb-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid #dbe7f7;
        border-top-color: var(--tb-primary);
        animation: tb-spin 0.8s linear infinite;
      }
      @keyframes tb-spin { to { transform: rotate(360deg); } }

      .tb-footer {
        margin-top: 16px;
        padding: 12px 14px;
        background: #fff;
        border: 1px solid var(--tb-border);
        border-radius: var(--tb-radius-md);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
      }
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

    const Group = ({ id, title, summary, open, children }) => h('details', { id: 'tb-group-' + id, className: 'tb-group', open: !!open }, [
      h('summary', { key: 's', className: 'tb-group-sum' }, [
        h('span', { key: 't', className: 'tb-group-title' }, title),
        h('span', { key: 'r', className: 'tb-group-sum-right' }, [
          summary ? h('span', { key: 'm', className: 'tb-tag' }, summary) : null,
          h('span', { key: 'a', className: 'tb-group-arrow' }, '▸'),
        ]),
      ]),
      h('div', { key: 'b', className: 'tb-group-body' }, children),
    ])

    const Sw = ({ on, onChange, text }) => h('label', { className: 'tb-sw' + (on ? ' active' : '') }, [
      h('span', { key: 't', className: 'tb-sw-text' }, text),
      h('span', { key: 'k', className: 'tb-sw-track' }, [
        h('input', { key: 'c', type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked) }),
        h('span', { key: 'b', className: 'tb-sw-thumb' }),
      ]),
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
      const [profile, setProfile] = React.useState('')
      const [evoState, setEvoState] = React.useState(null)
      const [versions, setVersions] = React.useState([])
      const [images, setImages] = React.useState([])
      const [styleState, setStyleState] = React.useState(null)
      const [timeline, setTimeline] = React.useState([])

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
        try { const r = await jget('/persona/state'); setPersona(r.persona); setProfile(r.profile || '') } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadPersona() }, [loadPersona])

      const loadVersions = React.useCallback(async () => {
        try { const r = await jget('/persona/versions'); setVersions(r.versions || []) } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadVersions() }, [loadVersions])

      const loadEvo = React.useCallback(async () => {
        try {
          const [ev, st, tl] = await Promise.all([
            jget('/evolution/state').catch(() => null),
            jget('/style/state').catch(() => null),
            jget('/timeline?n=12').catch(() => null),
          ])
          if (ev) setEvoState(ev)
          if (st) setStyleState(st)
          if (tl && Array.isArray(tl.entries)) setTimeline(tl.entries)
        } catch { /* ignore */ }
      }, [])
      React.useEffect(() => { loadEvo() }, [loadEvo])

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
            if (n++ % 5 === 0) {
              const s2 = await jget('/status')
              if (alive && s2 && s2.cfg) { setStatus(s2); setCfg((cur) => cur || s2.cfg) }
            }
          } catch { /* 等接口 */ }
        }
        tick(); const t = setInterval(tick, 3000)
        return () => { alive = false; clearInterval(t) }
      }, [])

      const save = async (patch) => {
        const before = cfg
        setBusy(true); setMsg(null)
        setCfg((cur) => ({ ...(cur || {}), ...patch }))
        try {
          const r = await jpost('/config', patch)
          setCfg(r.cfg); setMsg({ ok: true, text: '✓ 配置已保存' }); await refresh()
        } catch (e) {
          setCfg(before)
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
          const resMsg = r.loggedIn
            ? { ok: true, text: '登录态有效 ✓ 凭证已安全存到本机' }
            : { ok: false, text: '没通过：' + (r.hint || 'is_login=0') }
          setCookieMsg(resMsg)
          setMsg(resMsg)
          setCookie(''); await refresh()
        } catch (e) {
          const errObj = { ok: false, text: String(e.message || e) }
          setCookieMsg(errObj); setMsg(errObj)
        } finally { setBusy(false) }
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
            tail = '\n模型轮：' + (rr.started ? '已在后台启动' : (rr.error || '没启动')) + '（日志见下方自动化卡）'
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

      const jumpToGroup = (id, expandAll) => {
        if (typeof expandAll === 'boolean') {
          ['A', 'B', 'C', 'D'].forEach((g) => {
            const el = document.getElementById('tb-group-' + g)
            if (el) el.open = expandAll || g === 'A'
          })
          return
        }
        const el = document.getElementById('tb-group-' + id)
        if (el) {
          el.open = true
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }

      if (!status || !cfg) {
        return h('div', { className: 'tb tb-loading' }, [
          h('div', { key: 's', className: 'tb-spinner' }),
          h('div', { key: 't' }, '正在读取贴吧插件配置…'),
          (status && status.ok === false)
            ? h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy, onClick: refresh }, '重试')
            : null,
        ])
      }

      const c = cfg || { bars: [], readPerRound: 5, replyPerRound: 1, replyPerDay: 3, replyGapSec: 30, requestGapMs: 1200, signHour: 9, runHour: 21 }
      const running = !!(live && live.busy)
      const hasCookie = !!(status && status.hasCookie)
      const barCount = (c.bars || []).filter(Boolean).length
      const repliesToday = status ? (status.repliesToday || 0) : 0
      const replyLimit = c.replyPerDay ?? 5
      const quotaFull = !!(status && c.autoReply && repliesToday >= replyLimit)
      const isVal = !!(status && status.valley && status.valley.isValley)
      const pendingProposals = proposals.filter((p) => p.status === 'pending')

      return h('div', { className: 'tb' }, [
        // ── 顶部即时浮动消息 ──
        msg ? h('div', { key: 'toast', className: 'tb-toast ' + (msg.ok ? 'ok' : 'err') }, [
          h('span', { key: 'txt' }, msg.text),
          h('button', { key: 'cls', className: 'tb-toast-close', title: '关闭提示', onClick: () => setMsg(null) }, '×'),
        ]) : null,

        // ── 顶部 Hero 仪表盘 ──
        h('div', { key: 'hero', className: 'tb-hero' }, [
          h('div', { key: 'top', className: 'tb-hero-top' }, [
            h('div', { key: 'brand', className: 'tb-brand' }, [
              h('div', { key: 'logo', className: 'tb-logo' }, '吧'),
              h('div', { key: 'titles' }, [
                h('div', { key: 'h', className: 'tb-h' }, [
                  '刷贴吧',
                  h('span', { key: 'v', className: 'tb-ver' },
                    'v' + ((live && live.version) || (status && status.version) || '?')),
                  running ? h('span', { key: 'r', className: 'tb-chip run' },
                    live && live.collecting ? '采集中…' : '模型轮运行中…') : null,
                ]),
                h('div', { key: 's', className: 'tb-sub' }, '每天替你看几个吧：读帖挑重点、写日报、自动签到，回帖与人设演化按需开启。'),
              ]),
            ]),
            h('div', { key: 'act', className: 'tb-hero-actions' }, [
              h('button', { key: 'run', className: 'tb-btn sm', disabled: busy || running, onClick: runRound },
                live && live.collecting ? '采集中…' : (live && live.running ? '运行中…' : '▶ 刷一轮贴吧')),
              h('button', { key: 'rep', className: 'tb-btn ghost sm', disabled: busy, onClick: showReport }, '看最近日报'),
            ]),
          ]),

          // 四宫格状态卡片
          h('div', { key: 'stats', className: 'tb-stats-grid' }, [
            h('div', { key: 's1', className: 'tb-stat-box ' + (hasCookie ? 'ok' : 'warn') }, [
              h('span', { key: 'l', className: 'tb-stat-label' }, '账号凭证'),
              h('span', { key: 'v', className: 'tb-stat-val' }, hasCookie ? '凭证 ✓ 已登录' : '未配置 BDUSS'),
              h('span', { key: 'm', className: 'tb-stat-meta' }, barCount ? `已设 ${barCount} 个目标吧` : '尚未填写目标吧'),
            ]),
            h('div', { key: 's2', className: 'tb-stat-box ' + (quotaFull ? 'warn' : (c.autoReply ? 'ok' : '')) }, [
              h('span', { key: 'l', className: 'tb-stat-label' }, '今日回帖'),
              h('span', { key: 'v', className: 'tb-stat-val' },
                '今天已回 ' + repliesToday + (c.autoReply ? '/' + replyLimit : '') + ' 条'),
              h('span', { key: 'm', className: 'tb-stat-meta' },
                quotaFull ? '今日额度已满' : (c.autoReply ? `每轮上限 ${c.replyPerRound ?? 1} 条` : '回帖默认关闭（只读）')),
            ]),
            h('div', { key: 's3', className: 'tb-stat-box ' + (isVal ? 'ok' : 'warn') }, [
              h('span', { key: 'l', className: 'tb-stat-label' }, '时段与峰谷'),
              h('span', { key: 'v', className: 'tb-stat-val' },
                status && status.valley ? '现在：' + status.valley.now : '峰谷：未知'),
              h('span', { key: 'm', className: 'tb-stat-meta' },
                c.peakValley ? '峰谷排班：已开启' : '峰谷排班：未开启'),
            ]),
            h('div', { key: 's4', className: 'tb-stat-box ' + (running ? 'run' : '') }, [
              h('span', { key: 'l', className: 'tb-stat-label' }, '运行与人设'),
              h('span', { key: 'v', className: 'tb-stat-val' },
                running ? '后台执行中' : ((status && status.lastRunDate) ? '上次：' + status.lastRunDate : '尚未自动运行')),
              h('span', { key: 'm', className: 'tb-stat-meta' },
                persona ? `人设 v${persona.version} · ${c.evolvePersona ? '演化开' : '演化关'}` : '人设加载中…'),
            ]),
          ]),

          // 已连接的其他插件
          (status && status.integrations && status.integrations.plugins && status.integrations.plugins.length)
            ? h('div', { key: 'integ', className: 'tb-chips', style: { marginTop: 10 } },
              status.integrations.plugins.map((p) => h('span', { key: p.name, className: 'tb-chip ok' },
                '🔗 已连接：' + p.name + '（' + (p.provides || []).join('、') + '）')))
            : null,
        ]),

        // ── 启动检查：curl 缺了会全线失败 ──
        (status && status.curl && status.curl.ok === false) ? h('div', { key: 'nocurl', className: 'tb-warn danger' },
          '⚠️ 机器上没有 curl —— 所有贴吧请求都会失败。先装 curl（Linux/macOS 一般自带，Windows 10+ 也自带），再重启 DSH。') : null,

        // ── 风控熔断：撞到验证码后自动歇着 ──
        (status && status.cooldown && status.cooldown.active) ? h('div', { key: 'cd', className: 'tb-warn' }, [
          h('div', { key: 't', style: { fontWeight: 700, marginBottom: 4 } },
            '⏸ 风控熔断保护中：还剩 ' + (status.cooldown.leftMin || '?') + ' 分钟'),
          h('div', { key: 'm' }, '原因：' + (status.cooldown.reason || '百度安全验证') + '。这段时间插件一个请求都不会发，避免连续撞墙。'),
          h('div', { key: 'r', className: 'tb-row', style: { marginTop: 8, marginBottom: 0 } }, [
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy,
              onClick: async () => {
                setBusy(true)
                try { await jpost('/cooldown/clear', {}); await refresh(); setMsg({ ok: true, text: '已解除熔断' }) }
                catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
              } }, '我已经处理好了，解除熔断'),
            h('span', { key: 'k', className: 'tb-kv' }, '（比如你刚在手机上过了滑块）'),
          ]),
        ]) : null,

        // ── 最近一次错误（有就显示，能折叠）──
        (status && status.lastError) ? h('details', { key: 'err', className: 'tb-card', style: { borderColor: '#fecaca', background: '#fffafa', marginBottom: 14 } }, [
          h('summary', { key: 's', style: { color: '#b91c1c', fontWeight: 600, cursor: 'pointer' } },
            '最近一次错误 · ' + String(status.lastError.at || '').slice(5, 16).replace('T', ' ') + ' · ' + (status.lastError.where || '')),
          h('pre', { key: 'p', className: 'tb-pre' }, status.lastError.message || ''),
        ]) : null,

        // ── 首次使用三步引导 ──
        ((!hasCookie || !c.bars || c.bars.length === 0)) ? h('div', { key: 'onboard', className: 'tb-onboard' }, [
          h('div', { key: 't', style: { fontWeight: 700, fontSize: 13.5, color: '#1e3a8a' } }, '🚀 三步就能跑起来'),
          h('div', { key: 'steps', className: 'tb-onboard-steps' }, [
            h('div', { key: 'a', className: 'tb-step' + (hasCookie ? ' done' : '') }, [
              h('span', { key: 'n', className: 'tb-step-num' }, hasCookie ? '✓' : '1'),
              h('span', { key: 'x' }, '贴 BDUSS（在下方账号卡片里，点保存并测试）'),
            ]),
            h('div', { key: 'b', className: 'tb-step' + (barCount ? ' done' : '') }, [
              h('span', { key: 'n', className: 'tb-step-num' }, barCount ? '✓' : '2'),
              h('span', { key: 'x' }, '填要刷的吧（一行一个，或一键读取关注列表）'),
            ]),
            h('div', { key: 'c', className: 'tb-step' }, [
              h('span', { key: 'n', className: 'tb-step-num' }, '3'),
              h('span', { key: 'x' }, '点「刷一轮贴吧」——先只采集，看看读到了什么'),
            ]),
          ]),
        ]) : null,

        // ====================================================================
        // Group A
        // ====================================================================
        h(Group, { key: 'A', id: 'A', title: '账号与刷帖', open: true,
          summary: (hasCookie ? '已登录' : '未登录') + ' · ' + barCount + ' 个吧' }, [

          h('div', { key: 'acct', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '账号'),
              h('span', { key: 'st', className: 'tb-tag ' + (hasCookie ? 'ok' : 'warn') },
                hasCookie ? '登录态有效 ✓' : '待配置凭证'),
            ]),
            h('div', { key: 'form', className: 'tb-row', style: { marginTop: 0 } }, [
              h('input', {
                key: 'i', className: 'tb-in', style: { flex: 1, minWidth: 220 },
                type: 'password', placeholder: '粘贴 BDUSS=... 或直接贴值（自动补前缀）',
                value: cookie, onChange: (e) => setCookie(e.target.value),
              }),
              h('button', { key: 'b', className: 'tb-btn', disabled: busy, onClick: saveCookie }, '保存并测试'),
            ]),
            cookieMsg ? h('div', { key: 'cm', className: 'tb-msg ' + (cookieMsg.ok ? 'ok' : 'err') }, cookieMsg.text) : null,
            h('div', { key: 'k', className: 'tb-kv', style: { marginTop: 6 } },
              '💡 不知道去哪拿？在聊天里问「教我怎么拿贴吧的 BDUSS」。登录成功后可在下方一键拉取已关注的吧。'),
            h('div', { key: 'w', className: 'tb-warn', style: { marginBottom: 0 } },
              '🔒 BDUSS 等于登录凭证，仅保存在本机（权限 600），不回显、不进日志。想让凭证失效可去贴吧「账号安全 → 退出所有设备」。'),
          ]),

          h('div', { key: 'round', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '每一轮'),
              h('span', { key: 'st', className: 'tb-tag primary' },
                `每轮读 ${c.readPerRound ?? 5} 贴 · 间隔 ${c.requestGapMs ?? 1200}ms · 去重 ${c.dedupeDays ?? 7} 天`),
            ]),

            h('div', { key: 'bl', className: 'tb-label', style: { marginTop: 0 } }, [
              h('span', { key: 'l' }, '要刷的吧（一行一个，不带「吧」字后缀也可）'),
              h('span', { key: 'c', className: 'tb-kv' }, `当前 ${barCount} 个`),
            ]),
            h('textarea', {
              key: 'ba', className: 'tb-ta',
              placeholder: '例如：\ndeepseek\n弱智\n抗压背锅',
              value: (c.bars || []).join('\n'),
              onChange: (e) => setCfg({ ...c, bars: e.target.value.split('\n') }),
            }),
            (!c.bars || barCount === 0) ? h('div', { key: 'emp', className: 'tb-warn' },
              '还没填任何吧。要刷哪些吧必须由主人自己填——贴吧名字差一个字就白跑，默认不替主人猜。') : null,
            h('div', { key: 'br', className: 'tb-row' }, [
              h('button', { key: 'b', className: 'tb-btn soft sm', disabled: busy,
                onClick: () => save({ bars: (c.bars || []).map((x) => x.trim()).filter(Boolean) }) }, '💾 保存吧列表'),
              h('button', { key: 'f', className: 'tb-btn ghost sm', disabled: busy,
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
                } }, '📥 读取已关注的吧'),
            ]),

            h('div', { key: 'div1', className: 'tb-divider' }),

            // 采集与风控参数网格
            h('div', { key: 'pg', className: 'tb-grid-3' }, [
              h('div', { key: 'p1', className: 'tb-param-box' }, [
                h('div', { key: 'l' }, [
                  h('div', { key: 'a', style: { fontWeight: 600, fontSize: 12.5 } }, '每轮读帖数'),
                  h('div', { key: 'b', className: 'tb-kv' }, '每个吧采集几贴'),
                ]),
                h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                  h('input', { key: 'i', className: 'tb-num', type: 'number', ...num('readPerRound') }),
                  h('span', { key: 'u', className: 'tb-kv' }, '贴'),
                ]),
              ]),
              h('div', { key: 'p2', className: 'tb-param-box' }, [
                h('div', { key: 'l' }, [
                  h('div', { key: 'a', style: { fontWeight: 600, fontSize: 12.5 } }, '请求间隔'),
                  h('div', { key: 'b', className: 'tb-kv' }, '最低 300ms'),
                ]),
                h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                  h('input', { key: 'i', className: 'tb-num', type: 'number', ...num('requestGapMs') }),
                  h('span', { key: 'u', className: 'tb-kv' }, 'ms'),
                ]),
              ]),
              h('div', { key: 'p3', className: 'tb-param-box' }, [
                h('div', { key: 'l' }, [
                  h('div', { key: 'a', style: { fontWeight: 600, fontSize: 12.5 } }, '已读去重'),
                  h('div', { key: 'b', className: 'tb-kv' }, 'N 天内不重复推'),
                ]),
                h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                  h('input', { key: 'i', className: 'tb-num', type: 'number', ...num('dedupeDays') }),
                  h('span', { key: 'u', className: 'tb-kv' }, '天'),
                ]),
              ]),
            ]),

            // 关键词优先排序
            h('div', { key: 'kwl', className: 'tb-label' }, '刷帖优先关键词（逗号分隔，命中排前面）'),
            h('input', {
              key: 'kwi', className: 'tb-in',
              placeholder: '可留空。例：大肥鱼，人设，推书',
              value: (c.keywords || []).join('，'),
              onChange: (e) => setCfg({ ...c, keywords: e.target.value.split(/[，,]/) }),
              onBlur: () => save({ keywords: (c.keywords || []).map((x) => String(x).trim()).filter(Boolean) }),
            }),
            h('div', { key: 'kwh', className: 'tb-kv', style: { marginTop: 4 } },
              (c.keywords && c.keywords.length)
                ? '已设关键词：标题带这些词的帖会排在前面、日报优先写；不带词的帖照常读。'
                : '留空 = 按吧内默认顺序读。填了之后标题命中词会优先排前面（不过滤其他帖）。'),

            h('div', { key: 'div2', className: 'tb-divider' }),

            // 操作栏与日报预览
            h('div', { key: 'o', className: 'tb-row', style: { marginBottom: 0 } }, [
              h('button', { key: 'r', className: 'tb-btn', disabled: busy || running, onClick: runRound },
                live && live.collecting ? '采集中…' : (live && live.running ? '模型轮进行中…' : '▶ 刷一轮贴吧')),
              h('button', { key: 'p', className: 'tb-btn ghost', disabled: busy, onClick: showReport }, '📄 看最近日报'),
              running ? h('button', { key: 's', className: 'tb-btn danger-ghost', disabled: busy,
                onClick: async () => {
                  setBusy(true)
                  try { const r = await jpost('/run/stop', {}); setMsg({ ok: true, text: r.ok ? '已发送停止信号，本轮结束' : (r.error || '没停掉') }) }
                  catch (e) { setMsg({ ok: false, text: String(e.message || e) }) }
                  finally { setBusy(false); setTimeout(refresh, 800) }
                } }, '⏹ 停止本轮') : null,
            ]),
            report ? h('div', { key: 'rpbox', className: 'tb-subcard' }, [
              h('div', { key: 'rphd', className: 'tb-subcard-title' }, [
                h('span', { key: 't' }, '最近一份日报 ' + (report.date ? `（${report.date}）` : '')),
                h('button', { key: 'c', className: 'tb-btn ghost sm', onClick: () => setReport(null) }, '收起'),
              ]),
              h('pre', { key: 'rp', className: 'tb-pre light', style: { marginTop: 0 } }, report.text || '（空）'),
            ]) : null,
          ]),
        ]),

        // ====================================================================
        // Group B
        // ====================================================================
        h(Group, { key: 'B', id: 'B', title: '人设与表达',
          summary: (c.personaFile ? '人设：文件' : (c.personaText ? '人设：文本' : '人设：默认'))
            + (persona && persona.voice && persona.voice.samples ? ' · 样本 ' + persona.voice.samples.length : '')
            + (images.length ? ' · 图 ' + images.length : '') }, [

          h('div', { key: 'persona', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '人设'),
              h('span', { key: 'st', className: 'tb-tag primary' },
                persona ? ('当前版本 v' + persona.version + ' · 核心层已锁定') : '读取人设版本中…'),
            ]),

            // 语气词与句式（可手改）
            persona ? h('div', { key: 'voice', className: 'tb-subcard', style: { marginTop: 0, marginBottom: 12 } }, [
              h('div', { key: 'l', className: 'tb-subcard-title' }, [
                h('span', { key: 'a' }, '✍️ 语气词与句式（可手改）'),
              ]),
              h('div', { key: 'g', className: 'tb-grid-2' }, [
                h('div', { key: 'g1' }, [
                  h('div', { key: 'pl', className: 'tb-label', style: { marginTop: 0 } }, '常用语气词（顿号/逗号分隔）'),
                  h('input', {
                    key: 'pi', className: 'tb-in',
                    placeholder: '例：哈？ / 行吧 / 乐 / 咕噜',
                    value: (persona.voice.particles || []).join('、'),
                    onChange: (e) => setPersona({ ...persona, voice: { ...persona.voice, particles: e.target.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) } }),
                  }),
                ]),
                h('div', { key: 'g2' }, [
                  h('div', { key: 'ql', className: 'tb-label', style: { marginTop: 0 } }, '常用句式（顿号/逗号分隔）'),
                  h('input', {
                    key: 'qi', className: 'tb-in',
                    placeholder: '例：反问 / 先接后转 / 一句一停',
                    value: (persona.voice.patterns || []).join('、'),
                    onChange: (e) => setPersona({ ...persona, voice: { ...persona.voice, patterns: e.target.value.split(/[、,，]/).map((x) => x.trim()).filter(Boolean) } }),
                  }),
                ]),
              ]),
            ]) : null,

            // 人设设定文本
            h('div', { key: 'ptl', className: 'tb-label', style: { marginTop: 0 } }, '角色背景与性格描述'),
            h('textarea', {
              key: 'p', className: 'tb-ta', style: { minHeight: 88 },
              placeholder: '例：一只蓝发小鲸鱼，自称「咱」，说话短、软、爱夸人……',
              value: c.personaText || '',
              onChange: (e) => setCfg({ ...c, personaText: e.target.value }),
            }),
            h('div', { key: 'r', className: 'tb-row' }, [
              h('button', { key: 'b', className: 'tb-btn soft sm', disabled: busy,
                onClick: () => save({ personaText: c.personaText || '', personaFile: c.personaFile || '' }) }, '💾 保存人设'),
              h('label', { key: 'l', className: 'tb-btn ghost sm', style: { cursor: 'pointer', margin: 0 } }, [
                '📂 导入文件 (.md/.txt)',
                h('input', { key: 'i', type: 'file', accept: '.md,.txt,.markdown,text/plain', style: { display: 'none' }, onChange: importPersona }),
              ]),
            ]),

            h('div', { key: 'div', className: 'tb-divider' }),

            // 语气样本
            h('div', { key: 'sl', className: 'tb-label', style: { marginTop: 0 } }, [
              h('span', { key: 'a' }, '语气样本（3~5 句，回帖前照着学长短和口气）'),
              h('span', { key: 'b', className: 'tb-kv' }, '每行一句'),
            ]),
            h('textarea', {
              key: 'ss', className: 'tb-ta', style: { minHeight: 84 },
              placeholder: '例：\n「这书我也在看，节奏慢但挺上头」\n「哈？连这个都要问」\n「被你这么一说，我也有点想看了」',
              value: persona ? persona.voice.samples.join('\n') : (c.styleSamples || ''),
              onChange: (e) => setPersona((cur) => cur ? { ...cur, voice: { ...cur.voice, samples: e.target.value.split('\n') } } : cur),
            }),
            h('div', { key: 'ssr', className: 'tb-row' }, [
              h('button', { key: 'b', className: 'tb-btn soft sm', disabled: busy,
                onClick: async () => {
                  setBusy(true)
                  try {
                    const samples = (persona ? persona.voice.samples : String(c.styleSamples || '').split('\n')).map((x) => x.trim()).filter(Boolean)
                    const particles = persona ? (persona.voice.particles || []) : []
                    const patterns = persona ? (persona.voice.patterns || []) : []
                    const r = await jpost('/persona/voice', { samples, particles, patterns, reason: 'ui' })
                    setPersona(r.persona)
                    setProfile((await jget('/persona/state')).profile || '')
                    await loadVersions()
                    setMsg({ ok: true, text: '✓ 声音与语气样本已保存（v' + r.persona.version + '）' })
                  } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                } }, '💾 保存语气样本与句式'),
            ]),

            h('details', { key: 'adv2', style: { marginTop: 8 } }, [
              h('summary', { key: 's', className: 'tb-kv', style: { cursor: 'pointer', fontWeight: 500 } },
                '进阶：改用外部人设文件（填写后优先于上方文本框）'),
              h('input', {
                key: 'f', className: 'tb-in', style: { marginTop: 6 },
                placeholder: 'persona.md（相对 tieba-duty 目录）或 /绝对/路径.md',
                value: c.personaFile || '', onChange: (e) => setCfg({ ...c, personaFile: e.target.value }),
                onBlur: () => save({ personaFile: c.personaFile || '' }),
              }),
              h('div', { key: 'h', className: 'tb-kv', style: { marginTop: 4 } },
                '相对路径从 $DSH_HOME/tieba-duty/ 算起；留空则使用上方文本框。'),
            ]),
          ]),

          h('div', { key: 'images', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '图片库'),
              h('span', { key: 'st', className: 'tb-tag' }, `已存 ${images.length} / 50 张 · 单张 ≤2MB`),
            ]),
            h('div', { key: 'u', className: 'tb-row', style: { marginTop: 0, justifyContent: 'space-between' } }, [
              h('span', { key: 'h', className: 'tb-kv' }, '给模型的只有 ID + 描述 + 标签（不含本地路径）；发图开关在下方规则卡。'),
              h('div', { key: 'btns', className: 'tb-row', style: { margin: 0 } }, [
                h('label', { key: 'l', className: 'tb-btn soft sm', style: { cursor: 'pointer', margin: 0 } }, [
                  '＋ 上传图片',
                  h('input', { key: 'i', type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' },
                    onChange: (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; uploadImage(f) } }),
                ]),
                h('button', { key: 'r', className: 'tb-btn ghost sm', disabled: busy, onClick: loadImages }, '刷新'),
              ]),
            ]),
            images.length ? h('div', { key: 'gridwrap' }, [
              images.length > 4 ? h('div', { key: 'hint', className: 'tb-kv', style: { marginTop: 6 } },
                '共 ' + images.length + ' 张，可上下滑动') : null,
              h('div', { key: 'grid', className: 'tb-img-scroll' },
                h('div', { key: 'inner', className: 'tb-img-grid' },
                  images.map((im) => h('div', { key: im.id, className: 'tb-img-card' }, [
                    h('div', { key: 'top' }, [
                      h('img', {
                        key: 'p', className: 'tb-img-thumb', src: im.fileUrl, alt: im.desc,
                        style: { opacity: im.enabled === false ? 0.4 : 1 },
                      }),
                      h('div', { key: 'd', style: { fontWeight: 600, fontSize: 12.5, marginTop: 6, lineHeight: 1.4 } },
                        (im.desc || '未填描述') + (im.needsDesc ? '（待补）' : '')),
                      im.tags && im.tags.length ? h('div', { key: 'g', className: 'tb-kv', style: { marginTop: 2 } }, im.tags.join(' · ')) : null,
                    ]),
                    h('div', { key: 'bot', style: { marginTop: 8 } }, [
                      h('div', { key: 's', className: 'tb-kv', style: { display: 'flex', justifyContent: 'space-between' } }, [
                        h('span', { key: 'u' }, '用过 ' + (im.uses || 0) + ' 次'),
                        h('span', { key: 'st', style: { color: im.enabled === false ? '#b45309' : '#15803d' } },
                          im.enabled === false ? '已停用' : '启用中'),
                      ]),
                      h('div', { key: 'a', className: 'tb-row', style: { marginTop: 6, marginBottom: 0 } }, [
                        h('button', { key: 'e', className: 'tb-btn ghost sm', style: { flex: 1 }, disabled: busy,
                          onClick: async () => {
                            const desc = window.prompt('修改描述', im.desc)
                            if (desc == null) return
                            setBusy(true)
                            try { await jpost('/images/update', { id: im.id, desc }); await loadImages() }
                            catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                          } }, '编辑'),
                        h('button', { key: 't', className: 'tb-btn ghost sm', style: { flex: 1 }, disabled: busy,
                          onClick: async () => {
                            setBusy(true)
                            try { await jpost('/images/update', { id: im.id, enabled: im.enabled === false }); await loadImages() }
                            catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                          } }, im.enabled === false ? '启用' : '停用'),
                        h('button', { key: 'x', className: 'tb-btn danger-ghost sm', disabled: busy,
                          onClick: async () => {
                            if (!window.confirm('删除这张图？')) return
                            setBusy(true)
                            try { await jpost('/images/delete', { id: im.id }); await loadImages() }
                            catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                          } }, '删'),
                      ]),
                    ]),
                  ])),
                ),
              ),
            ]) : h('div', { key: 'none', className: 'tb-subcard', style: { textAlign: 'center', color: '#64748b' } },
              '图片库还是空的，点右上角「＋ 上传图片」添加表情包或配图。'),
          ]),
        ]),

        // ====================================================================
        // Group C
        // ====================================================================
        h(Group, { key: 'C', id: 'C', title: '行为与规则',
          summary: c.autoReply ? ('回帖开 · 今天 ' + repliesToday + '/' + replyLimit) : '回帖关' }, [

          h('div', { key: 'reply', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '回帖规则'),
              h('span', { key: 'st', className: 'tb-tag ' + (c.autoReply ? 'ok' : '') },
                c.autoReply ? '已开启回帖' : '默认关闭（只读安全模式）'),
            ]),

            h(Sw, { key: 'a', on: c.autoReply, onChange: (v) => save({ autoReply: v }),
              text: '允许回帖（用当前账号发布公开回复）' }),
            h(Sw, { key: 'q', on: c.answerQuestions !== false, onChange: (v) => save({ answerQuestions: v }),
              text: '允许解答别人的疑问（关掉则只接话 / 共鸣 / 玩梗）' }),
            h(Sw, { key: 'g', on: c.toneGate !== false, onChange: (v) => save({ toneGate: v }),
              text: '客服腔拦截闸门（自动打回「首先 / 其次 / 希望对你有帮助」等说教句）' }),

            // 频控三宫格
            h('div', { key: 'quota', className: 'tb-subcard' }, [
              h('div', { key: 'qt', className: 'tb-subcard-title' }, [
                h('span', { key: 'a' }, '🛡️ 回帖频率限制（四道闸硬上限）'),
                h('span', { key: 'b', className: 'tb-kv' },
                  '现状：每轮 ≤' + (c.replyPerRound ?? 1) + ' 条，全天 ≤' + (c.replyPerDay ?? 3) + ' 条'
                  + ((c.replyPerRound ?? 1) > (c.replyPerDay ?? 3) ? '（⚠️ 单轮大于全天）' : '')),
              ]),
              h('div', { key: 'qg', className: 'tb-grid-3' }, [
                h('div', { key: 'q1', className: 'tb-param-box', style: { background: '#fff' } }, [
                  h('span', { key: 'l', className: 'tb-kv', style: { fontWeight: 600, color: '#334155' } }, '每轮最多'),
                  h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                    h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('replyPerRound') }),
                    h('span', { key: 'u', className: 'tb-kv' }, '条'),
                  ]),
                ]),
                h('div', { key: 'q2', className: 'tb-param-box', style: { background: '#fff' } }, [
                  h('span', { key: 'l', className: 'tb-kv', style: { fontWeight: 600, color: '#334155' } }, '最小间隔'),
                  h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                    h('input', { key: 'd', className: 'tb-num', type: 'number', ...num('replyGapSec') }),
                    h('span', { key: 'u', className: 'tb-kv' }, '秒'),
                  ]),
                ]),
                h('div', { key: 'q3', className: 'tb-param-box', style: { background: '#fff' } }, [
                  h('span', { key: 'l', className: 'tb-kv', style: { fontWeight: 600, color: '#334155' } }, '全天合计'),
                  h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                    h('input', { key: 'f', className: 'tb-num', type: 'number', ...num('replyPerDay') }),
                    h('span', { key: 'u', className: 'tb-kv' }, '条'),
                  ]),
                ]),
              ]),
            ]),

            // 发新帖与发图双栏扩展
            h('div', { key: 'ext', className: 'tb-grid-2', style: { marginTop: 10 } }, [
              h('div', { key: 'ntbox', className: 'tb-subcard', style: { marginTop: 0 } }, [
                h(Sw, { key: 'nt', on: c.allowNewThread === true, onChange: (v) => save({ allowNewThread: v }),
                  text: '允许 AI 发新帖（纯文字）' }),
                h('div', { key: 'ntq', className: 'tb-row', style: { justifyContent: 'space-between', marginBottom: 0 } }, [
                  h('span', { key: 'a', className: 'tb-kv' }, '每天最多发帖上限'),
                  h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                    h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('newThreadPerDay') }),
                    h('span', { key: 'c', className: 'tb-kv' }, '帖'),
                  ]),
                ]),
              ]),
              h('div', { key: 'imgbox', className: 'tb-subcard', style: { marginTop: 0 } }, [
                h(Sw, { key: 'img', on: c.allowImages === true, onChange: (v) => save({ allowImages: v }),
                  text: '允许 AI 发图（失败降级文字）' }),
                h('div', { key: 'imgq', className: 'tb-row', style: { justifyContent: 'space-between', marginBottom: 0 } }, [
                  h('span', { key: 'a', className: 'tb-kv' }, '每天上限（每轮1张/24h冷却）'),
                  h('div', { key: 'r', className: 'tb-row', style: { margin: 0 } }, [
                    h('input', { key: 'b', className: 'tb-num', type: 'number', ...num('imagePerDay') }),
                    h('span', { key: 'c', className: 'tb-kv' }, '张'),
                  ]),
                ]),
              ]),
            ]),
          ]),

          h('div', { key: 'auto', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '自动化'),
              h('span', { key: 'st', className: 'tb-tag' },
                (c.autoSign ? '自动签到开' : '自动签到关') + ' · ' + (c.peakValley ? '峰谷排班开' : '排班关')),
            ]),

            // 签到块
            h('div', { key: 'signbox', className: 'tb-subcard', style: { marginTop: 0 } }, [
              h('div', { key: 'st', className: 'tb-subcard-title' }, [
                h('span', { key: 'a' }, '📅 每日签到'),
                h('button', { key: 'b', className: 'tb-btn soft sm', disabled: busy, onClick: signNow }, '⚡ 立即签到一次'),
              ]),
              h(Sw, { key: 'sg', on: c.autoSign, onChange: (v) => save({ autoSign: v }),
                text: '自动签到（每天 ' + c.signHour + ' 点后执行，未关注的吧会顺手关注）' }),
              h(Sw, { key: 'sa', on: c.signAllFollowed === true, onChange: (v) => save({ signAllFollowed: v }),
                text: '签到覆盖「账号关注的所有吧」（不只列表里的吧）' }),
            ]),

            // 峰谷排班与定时运行块
            h('div', { key: 'pvbox', className: 'tb-subcard' }, [
              h('div', { key: 'pvt', className: 'tb-subcard-title' }, [
                h('span', { key: 'a' }, '⏰ 24h 峰谷自动排班（Headless 后台轮）'),
                h('span', { key: 'b', className: 'tb-kv' },
                  status && status.valley
                    ? '现在：' + status.valley.now + (status.valley.window ? '（' + status.valley.window + '）' : '')
                      + (status.valley.next ? ' · 下次谷时 ' + String(status.valley.next).slice(5, 16).replace('T', ' ') : '')
                    : ''),
              ]),

              // 24小时峰谷排班可视化轴
              h('div', { key: 'bar', className: 'tb-sched-bar' }, [
                h('div', { key: 's1', className: 'tb-sched-seg valley' + (c.peakValley && c.night !== false ? '' : ' off') }, '00–09 夜间谷'),
                h('div', { key: 's2', className: 'tb-sched-seg peak' }, '09–12 高峰'),
                h('div', { key: 's3', className: 'tb-sched-seg valley' + (c.peakValley && c.noon !== false ? '' : ' off') }, '12–14 午谷'),
                h('div', { key: 's4', className: 'tb-sched-seg peak' }, '14–18 高峰'),
                h('div', { key: 's5', className: 'tb-sched-seg valley' + (c.peakValley && c.night !== false ? '' : ' off') }, '18–24 晚间谷'),
              ]),

              h(Sw, { key: 'pv', on: c.peakValley, onChange: (v) => save({ peakValley: v }),
                text: '开启峰谷自动刷（工作日 9–12 / 14–18 之外算谷时，两轮间隔 ≥6 小时）' }),
              h('div', { key: 'pvg', className: 'tb-grid-2' }, [
                h(Sw, { key: 'n', on: c.noon !== false, onChange: (v) => save({ noon: v }), text: '☀️ 中午谷班次 12:00–14:00' }),
                h(Sw, { key: 'ni', on: c.night !== false, onChange: (v) => save({ night: v }), text: '🌙 晚上谷班次 18:00–次日 09:00' }),
              ]),
              h('div', { key: 'r', className: 'tb-row', style: { marginBottom: 0 } }, [
                h('button', { key: 'r', className: 'tb-btn soft sm', disabled: busy, onClick: runModel }, '🤖 现在跑一轮（模型）'),
                h('button', { key: 'l', className: 'tb-btn ghost sm', disabled: busy, onClick: showLog }, '📋 看运行日志'),
                runLog ? h('button', { key: 'c', className: 'tb-btn ghost sm', onClick: () => setRunLog(null) }, '收起日志') : null,
              ]),
              runLog ? h('pre', { key: 'lg', className: 'tb-pre' }, runLog.text || runLog.error || '（空）') : null,
            ]),
          ]),
        ]),

        // ====================================================================
        // Group D
        // ====================================================================
        h(Group, { key: 'D', id: 'D', title: '成长与记录',
          summary: (c.evolvePersona ? '演化开' : '演化关') + ((c.diaryEnabled === false) ? ' · 日记关' : ' · 日记开') }, [

          h('div', { key: 'evolve', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '演化'),
              h('span', { key: 'st', className: 'tb-tag primary' }, '吃语料 · 主人点头才改'),
            ]),

            h(Sw, { key: 'e', on: c.evolvePersona === true, onChange: (v) => save({ evolvePersona: v }),
              text: '允许从吧里提炼语气样本与语料浸泡（提议需采纳，长期浸泡受漂移阈值保护）' }),

            // 演化状态与漂移保险条
            evoState ? h('div', { key: 'evobar', className: 'tb-subcard' }, [
              h('div', { key: 'row', className: 'tb-row', style: { margin: 0, justifyContent: 'space-between' } }, [
                h('div', { key: 'chips', className: 'tb-chips', style: { marginTop: 0 } }, [
                  h('span', { key: 'st', className: 'tb-chip ' + (evoState.last && evoState.last.paused ? 'warn' : (evoState.canEvolveToday ? 'ok' : '')) },
                    evoState.last && evoState.last.paused
                      ? ('⏸ 演化已暂停' + (evoState.last.pausedReason ? '：' + evoState.last.pausedReason : ''))
                      : (evoState.canEvolveToday ? '今日可演化' : '今日已演化')),
                  evoState.drift ? h('span', {
                    key: 'dr',
                    className: 'tb-chip ' + (evoState.drift.level === 'high' ? 'warn' : (evoState.drift.level === 'warn' ? 'warn' : 'ok')),
                  }, `漂移度 ${evoState.drift.score}（${evoState.drift.level}）`) : null,
                ]),
                h('button', {
                  key: 'pauseBtn', className: 'tb-btn ghost sm', disabled: busy,
                  onClick: async () => {
                    setBusy(true)
                    try {
                      const paused = !!(evoState.last && evoState.last.paused)
                      await jpost(paused ? '/evolution/resume' : '/evolution/pause', {})
                      await loadEvo()
                      setMsg({ ok: true, text: paused ? '已恢复演化' : '已暂停演化（日记与回帖照常）' })
                    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                  },
                }, (evoState.last && evoState.last.paused) ? '▶ 恢复演化' : '⏸ 暂停演化'),
              ]),
            ]) : null,

            // 按吧语料浸泡池
            h('div', { key: 'skhd', className: 'tb-label' }, [
              h('span', { key: 'a' }, '🫧 按吧语料浸泡池'),
              h('span', { key: 'b', className: 'tb-kv' }, '每泡满 3 次向人设底子微调 1 格'),
            ]),
            (styleState && styleState.bars && styleState.bars.length)
              ? h('div', { key: 'sk', className: 'tb-grid-2' }, styleState.bars.slice(0, 6).map((b) =>
                h('div', { key: b.kw, className: 'tb-subcard', style: { marginTop: 0 } }, [
                  h('div', { key: 'h', className: 'tb-subcard-title', style: { marginBottom: 4 } }, [
                    h('span', { key: 'n', style: { color: '#0f172a', fontWeight: 700 } }, b.kw),
                    h('span', { key: 'm', className: 'tb-tag primary' }, b.mode + ' · 泡了 ' + b.visits + ' 次'),
                  ]),
                  h('div', { key: 'n', className: 'tb-kv', style: { marginBottom: 4 } },
                    '距离下次底子浸泡还差 ' + (b.nextSoakIn || '?') + ' 次'),
                  ...(b.sampleList || []).map((x, i) => h('div', { key: 's' + i, className: 'tb-kv', style: { color: '#334155' } },
                    '「' + x + '」 · 来自 ' + b.kw)),
                ])))
              : h('div', { key: 'sk0', className: 'tb-subcard', style: { marginTop: 0 } },
                h('span', { className: 'tb-kv' }, '还没泡过任何吧。开启演化后跑一轮就会积累各吧的说话方式。')),

            // 待处理演化建议
            h('div', { key: 'prhd', className: 'tb-label' }, [
              h('span', { key: 'a' }, '💡 待采纳的语气样本建议'),
              h('span', { key: 'b', className: 'tb-kv' }, pendingProposals.length ? `${pendingProposals.length} 条待处理` : '无待处理'),
            ]),
            pendingProposals.length
              ? h('div', { key: 'list' }, pendingProposals.map((p) =>
                h('div', { key: p.id, className: 'tb-subcard', style: { marginTop: 6 } }, [
                  h('div', { key: 's', style: { fontSize: 13, lineHeight: 1.75, fontWeight: 500 } },
                    p.samples.map((x, i) => h('div', { key: i }, '· 「' + x + '」'))),
                  p.note ? h('div', { key: 'n', className: 'tb-kv', style: { marginTop: 4 } }, p.note) : null,
                  h('div', { key: 'r', className: 'tb-row', style: { marginBottom: 0 } }, [
                    h('button', { key: 'a', className: 'tb-btn soft sm', disabled: busy,
                      onClick: async () => {
                        setBusy(true)
                        try {
                          await jpost('/persona/apply', { id: p.id })
                          await loadProposals(); await loadPersona(); await loadVersions(); await refresh()
                          setMsg({ ok: true, text: '✓ 已采纳，样本已并进人设' })
                        } catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                      } }, '✓ 采纳并入人设'),
                    h('button', { key: 'd', className: 'tb-btn ghost sm', disabled: busy,
                      onClick: async () => {
                        setBusy(true)
                        try { await jpost('/persona/dismiss', { id: p.id }); await loadProposals() }
                        catch (e) { setMsg({ ok: false, text: String(e.message || e) }) } finally { setBusy(false) }
                      } }, '忽略'),
                  ]),
                ])))
              : h('div', { key: 'none', className: 'tb-kv' }, '还没有待处理的建议。'),

            h('div', { key: 'tl', className: 'tb-label' }, '演化时间轴'),
            timeline.length
              ? h('div', { key: 'tll', className: 'tb-timeline' }, timeline.slice(0, 8).map((e, i) =>
                h('div', { key: i, className: 'tb-tl-item' },
                  (e.type === 'soak' ? '🌱 浸泡 · ' : '✦ 演化 · ') + (e.at || '') + (e.kw ? ' · ' + e.kw : '')
                  + (e.fromVersion ? (' · v' + e.fromVersion + ' → v' + e.toVersion) : '')
                  + (e.trait ? (' · ' + e.trait.key + ' ' + e.trait.from + '→' + e.trait.to) : '')
                  + ((e.samples && e.samples.length) ? (' · 学了「' + e.samples[0] + '」') : '')
                  + (e.type === 'soak' ? (' · 第 ' + e.visits + ' 次') : ''))))
              : h('div', { key: 'tl0', className: 'tb-kv' }, '还没有演化或浸泡记录。'),

            h('div', { key: 'div', className: 'tb-divider' }),

            h('div', { key: 'versions' }, [
              h('div', { key: 'hd', className: 'tb-subcard-title' }, [
                h('span', { key: 't', style: { fontWeight: 700, fontSize: 13, color: '#0f172a' } }, '版本与导出'),
                h('span', { key: 'cur', className: 'tb-kv' },
                  persona ? ('当前 v' + persona.version + ' · 共 ' + versions.length + ' 个历史快照') : ''),
              ]),
              h('div', { key: 'e', className: 'tb-row', style: { marginTop: 4 } }, [
                h('button', { key: 't', className: 'tb-btn soft sm', disabled: busy, onClick: () => exportPersona('text') }, '📤 导出当前（文本）'),
                h('button', { key: 'j', className: 'tb-btn ghost sm', disabled: busy, onClick: () => exportPersona('json') }, '📦 导出当前（JSON）'),
              ]),
              versions.length
                ? h('div', { key: 'list' }, versions.slice().reverse().slice(0, 10).map((v) =>
                  h('div', { key: v.version, className: 'tb-ver-item' }, [
                    h('span', { key: 'a', className: 'tb-kv tb-ver-meta', style: { color: '#334155', fontWeight: 500 } },
                      'v' + v.version + ' · ' + (v.at || '') + (v.reason ? ' · ' + v.reason : '')),
                    h('div', { key: 'btns', className: 'tb-row', style: { margin: 0, flex: '1 1 100%' } }, [
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
                    ]),
                  ])))
                : h('div', { key: 'none', className: 'tb-kv' }, '还没有快照。改一次人设就会生成快照。'),
            ]),
          ]),

          h('div', { key: 'diary', className: 'tb-card' }, [
            h('div', { key: 'hd', className: 'tb-card-hd' }, [
              h('div', { key: 't', className: 'tb-card-title' }, '日记'),
              h('span', { key: 'st', className: 'tb-tag' }, '公开日记 / 私人日记'),
            ]),
            h('div', { key: 'swg', className: 'tb-grid-2' }, [
              h(Sw, { key: 'e', on: c.diaryEnabled !== false, onChange: (v) => save({ diaryEnabled: v }), text: '允许写日记（总开关）' }),
              h(Sw, { key: 'p', on: c.diaryPrivate !== false, onChange: (v) => save({ diaryPrivate: v }), text: '允许写私人日记（需手动翻开）' }),
            ]),
            h('div', { key: 'r', className: 'tb-row', style: { marginBottom: 0 } }, [
              h('button', { key: 'a', className: 'tb-btn soft sm', disabled: busy, onClick: () => showDiary('public') }, '📖 看给主人的日记'),
              h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy, onClick: () => showDiary('private') }, '🔒 翻开私人日记'),
              diary ? h('button', { key: 'c', className: 'tb-btn ghost sm', onClick: () => setDiary(null) }, '收起日记') : null,
            ]),
            diary ? h('div', { key: 'dbox', className: 'tb-subcard' }, [
              h('div', { key: 'dhd', className: 'tb-subcard-title' }, [
                h('span', { key: 't' }, '日记内容'),
                h('span', { key: 'f', className: 'tb-kv' }, diary.file || ''),
              ]),
              h('pre', { key: 'd', className: 'tb-pre light', style: { marginTop: 0 } }, diary.text || '（还没有）'),
            ]) : null,
          ]),
        ]),

        // ── 底部环境自检栏 ──
        h('div', { key: 'self', className: 'tb-footer' }, [
          h('div', { key: 'l', className: 'tb-row', style: { margin: 0 } }, [
            h('button', { key: 'b', className: 'tb-btn ghost sm', disabled: busy, onClick: runSelfcheck }, '🩺 运行环境自检'),
            h('span', { key: 'h', className: 'tb-kv' }, '检查 curl、登录凭证、目录权限与 headless 环境'),
          ]),
          health ? h('div', { key: 'k', className: 'tb-chips', style: { marginTop: 0 } }, [
            h('span', { key: 'c1', className: 'tb-chip ' + (health.curl && health.curl.ok ? 'ok' : 'warn') },
              'curl ' + (health.curl && health.curl.ok ? '✓' : '✗')),
            h('span', { key: 'c2', className: 'tb-chip ' + (health.cookie && health.cookie.ok ? 'ok' : 'warn') },
              '凭证 ' + (health.cookie && health.cookie.ok ? '✓' : '✗')),
            h('span', { key: 'c3', className: 'tb-chip ' + (health.dirs && health.dirs.writable ? 'ok' : 'warn') },
              '目录 ' + (health.dirs && health.dirs.writable ? '✓' : '✗')),
            h('span', { key: 'c4', className: 'tb-chip ' + (health.headless && health.headless.ok ? 'ok' : '✗') },
              'headless ' + (health.headless && health.headless.ok ? '✓' : '✗')),
          ]) : null,
        ]),
        health ? h('pre', { key: 'hp', className: 'tb-pre' }, JSON.stringify(health, null, 2)) : null,
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

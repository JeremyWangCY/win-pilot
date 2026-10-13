// Win-Pilot Settings card (browser half).
//
// Hand-authored ModuleLoader bundle: the harness serves this file at
// /plugins/win-pilot/client.js and materializes it with `window.__ModuleLoader__`,
// so no bundler is required. `react` is host-provided (the same contract
// dsh-at-file relies on); nothing else is imported.
//
// The card binds the `win-pilot` settings namespace through whichever settings
// seam the running harness serves, because the two generations differ:
//   * DSH >= 0.1.7  exposes `configForms`, keyed by the Loader entry id.
//   * DSH 0.1.5/0.1.6 expose `settingsScope`, keyed by the legacy namespace.
// Neither is declared as a hard `inject`: a static inject of the wrong name
// parks the fiber forever on hosts of the other generation. Both are probed at
// apply time and a degraded scope keeps the card honest when neither exists.
window.__ModuleLoader__.load({
  id: 'win-pilot',
  factory: (require) => {
    const React = require('react')

    const NS = 'win-pilot'
    const SETTINGS_NAMESPACE = 'win-pilot'

    /**
     * The user-editable fields, mirroring lib/settings.js. A test asserts this
     * table stays identical to WIN_PILOT_SETTINGS_FIELDS so the card can never
     * offer a field the host schema would reject, or hide one it accepts.
     */
    const FIELDS = [
      { key: 'overlay', type: 'boolean', group: 'appearance' },
      { key: 'statusPill', type: 'boolean', group: 'appearance' },
      { key: 'statusPillIdleGraceMs', type: 'number', min: 0, max: 600000, group: 'appearance' },
      { key: 'visibleImageHistory', type: 'number', min: 0, max: 8, group: 'appearance' },
      { key: 'screenshotMaxBytes', type: 'number', min: 65536, max: 67108864, group: 'appearance' },
      { key: 'actionTimeoutMs', type: 'number', min: 1000, max: 600000, group: 'timeouts' },
      { key: 'waitActionTimeoutMs', type: 'number', min: 1000, max: 600000, group: 'timeouts' },
      { key: 'hostTimeoutMs', type: 'number', min: 1000, max: 3600000, group: 'timeouts' },
      { key: 'daemonIdleMs', type: 'number', min: 1000, max: 86400000, group: 'timeouts' },
      { key: 'browserCommandTimeoutMs', type: 'number', min: 2000, max: 30000, group: 'timeouts' },
      { key: 'browserCaptureNetworkWaitMs', type: 'number', min: 0, max: 10000, group: 'timeouts' },
      { key: 'maxBatchActions', type: 'number', min: 1, max: 200, group: 'behaviour' },
      { key: 'defaultDispatch', type: 'string', values: ['background', 'foreground'], group: 'behaviour' },
      { key: 'foregroundRecovery', type: 'boolean', group: 'behaviour' },
      { key: 'observeAfterAction', type: 'boolean', group: 'behaviour' },
      { key: 'includeTextDefault', type: 'boolean', group: 'behaviour' },
      { key: 'browserHeadlessDefault', type: 'boolean', group: 'behaviour' },
      { key: 'lockGuard', type: 'boolean', group: 'safety' },
      { key: 'userActivityGuard', type: 'boolean', group: 'safety' },
      { key: 'focusPolicy', type: 'string', values: ['yield', 'restore', 'never'], group: 'safety' },
      { key: 'exclusiveControl', type: 'boolean', group: 'safety' },
      { key: 'allowSystemKeys', type: 'boolean', group: 'safety' },
      { key: 'confirmConsequential', type: 'boolean', group: 'safety' },
    ]

    /** Copy for the card. Kept inline: one card, two locales, no locale seat. */
    const COPY = {
      zh: {
        title: 'Win-Pilot 电脑操作',
        intro: '这些值写入 $DSH_HOME/settings.yaml 的 win-pilot: 分区并热重载，无需重启。未设置的字段沿用部署默认值。',
        groupAppearance: '外观与截图',
        groupTimeouts: '超时',
        groupBehaviour: '行为',
        groupSafety: '安全',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        reset: '恢复默认',
        overridden: '已覆盖',
        unavailable: '当前环境未提供设置服务，无法在此编辑。请在 $DSH_HOME/settings.yaml 中手工设置 win-pilot: 分区。',
        loadFailed: '读取设置失败，请重试。',
        saveFailed: '保存失败，已保留草稿。',
        invalid: '取值超出允许范围。',
        fieldOverlay: '显示虚拟光标与状态条',
        fieldStatusPill: '动作进行中显示状态条',
        fieldStatusPillIdleGraceMs: '状态条隐藏前空闲时间（毫秒）',
        fieldVisibleImageHistory: '保留在视觉上下文中的截图数量',
        fieldScreenshotMaxBytes: '单张截图最大字节数',
        fieldActionTimeoutMs: '单步动作超时（毫秒）',
        fieldWaitActionTimeoutMs: 'wait 动作超时（毫秒）',
        fieldHostTimeoutMs: '工具调用总超时（毫秒）',
        fieldDaemonIdleMs: '守护进程空闲回收时间（毫秒）',
        fieldBrowserCommandTimeoutMs: '浏览器 CDP 命令超时（毫秒）',
        fieldBrowserCaptureNetworkWaitMs: '点击后网络证据等待（毫秒）',
        fieldMaxBatchActions: '单次批处理最大动作数',
        fieldDefaultDispatch: '默认输入通道',
        fieldForegroundRecovery: '后台失败时自动前台重试一次',
        fieldObserveAfterAction: '动作后自动观察',
        fieldIncludeTextDefault: 'get_window_state 默认包含无障碍树',
        fieldBrowserHeadlessDefault: '默认无头启动浏览器',
        fieldLockGuard: '锁屏时拒绝输入',
        fieldUserActivityGuard: '你正在操作时让路（后台模式，仅报告不争抢）',
        fieldFocusPolicy: '动作改变前台窗口时的处理方式',
        fieldExclusiveControl: '独占控制（同一时间仅一个会话可输入）',
        fieldAllowSystemKeys: '允许 Windows/Meta 系统键',
        fieldConfirmConsequential: '将有副作用的动作标记为需要确认',
        valueBackground: '后台（不抢焦点）',
        valueForeground: '前台（真实 SendInput）',
        valueYield: '让路（只报告，不争抢焦点）',
        valueRestore: '尽力还原（非抢占，失败就放弃）',
        valueNever: '不处理（完全不干预）',
      },
      en: {
        title: 'Win-Pilot Computer Use',
        intro: 'These values live in the win-pilot: section of $DSH_HOME/settings.yaml and hot-reload without a restart. Unset fields keep the deployment default.',
        groupAppearance: 'Appearance & capture',
        groupTimeouts: 'Timeouts',
        groupBehaviour: 'Behaviour',
        groupSafety: 'Safety',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        reset: 'Reset to default',
        overridden: 'Overridden',
        unavailable: 'This host serves no settings service, so the card cannot edit them. Set the win-pilot: section in $DSH_HOME/settings.yaml by hand.',
        loadFailed: 'Reading settings failed; retry.',
        saveFailed: 'Save failed; drafts were kept.',
        invalid: 'Value is outside the allowed range.',
        fieldOverlay: 'Show the virtual cursor and status pill',
        fieldStatusPill: 'Show the status pill while an action runs',
        fieldStatusPillIdleGraceMs: 'Idle time before the pill hides (ms)',
        fieldVisibleImageHistory: 'Screenshots kept in active visual context',
        fieldScreenshotMaxBytes: 'Largest screenshot attached (bytes)',
        fieldActionTimeoutMs: 'Per-action timeout (ms)',
        fieldWaitActionTimeoutMs: 'wait action timeout (ms)',
        fieldHostTimeoutMs: 'Tool call budget (ms)',
        fieldDaemonIdleMs: 'Helper daemon idle reclaim (ms)',
        fieldBrowserCommandTimeoutMs: 'Browser CDP command timeout (ms)',
        fieldBrowserCaptureNetworkWaitMs: 'Post-click network evidence wait (ms)',
        fieldMaxBatchActions: 'Maximum actions per batch',
        fieldDefaultDispatch: 'Default input channel',
        fieldForegroundRecovery: 'Retry once in the foreground after a background refusal',
        fieldObserveAfterAction: 'Observe automatically after an action',
        fieldIncludeTextDefault: 'get_window_state includes the UIA tree by default',
        fieldBrowserHeadlessDefault: 'Launch browsers headless by default',
        fieldLockGuard: 'Refuse input while the desktop is locked',
        fieldUserActivityGuard: 'Yield while you are using the desktop (background mode only)',
        fieldFocusPolicy: 'What to do when an action moves the foreground window',
        fieldExclusiveControl: 'Exclusive control (one session may inject input)',
        fieldAllowSystemKeys: 'Allow Windows/Meta system keys',
        fieldConfirmConsequential: 'Mark consequential actions as needing confirmation',
        valueBackground: 'Background (never steals focus)',
        valueForeground: 'Foreground (real SendInput)',
        valueYield: 'Yield (report only, never compete for focus)',
        valueRestore: 'Restore (non-preemptive, gives up if refused)',
        valueNever: 'Never (do not touch focus at all)',
      },
    }

    const GROUP_TITLE = {
      appearance: 'groupAppearance',
      timeouts: 'groupTimeouts',
      behaviour: 'groupBehaviour',
      safety: 'groupSafety',
    }

    /** Host with neither settings generation: reads empty, writes refuse, never throws. */
    function degradedScope() {
      return {
        getSnapshot: () => ({ value: undefined, writable: false, status: 'unavailable' }),
        subscribe: () => () => {},
        set: async () => false,
        unset: async () => false,
        load: async () => {},
      }
    }

    /** Read the bound namespace scope from whichever seam this host serves. */
    function resolveScope(ctx) {
      try {
        const configForms = ctx.get('configForms')
        if (configForms && typeof configForms.get === 'function') {
          const scope = configForms.get(SETTINGS_NAMESPACE)
          if (scope) return scope
        }
      } catch { /* service absent or guarded */ }
      try {
        const settingsScope = ctx.get('settingsScope')
        if (settingsScope && typeof settingsScope.bind === 'function') {
          return settingsScope.bind({ namespace: SETTINGS_NAMESPACE })
        }
      } catch { /* service absent or guarded */ }
      return degradedScope()
    }

    /** Localized label for one enum value, falling back to the raw value. */
    function valueLabel(t, value) {
      const key = 'value' + value.charAt(0).toUpperCase() + value.slice(1)
      return t[key] || value
    }

    /** Clamp/validate one field's candidate value; null means "reject the draft". */
    function coerce(field, raw) {
      if (field.type === 'boolean') return raw === true
      if (field.type === 'string') return field.values.includes(raw) ? raw : null
      const n = Number(raw)
      if (!Number.isFinite(n)) return null
      const rounded = Math.round(n)
      if (field.min !== undefined && rounded < field.min) return null
      if (field.max !== undefined && rounded > field.max) return null
      return rounded
    }

    /** Effective value for a field: user layer, then resolved value, then a blank. */
    function valueOf(snapshot, field) {
      const user = snapshot && typeof snapshot.user === 'object' && snapshot.user ? snapshot.user[field.key] : undefined
      if (user !== undefined) return user
      const resolved = snapshot && typeof snapshot.value === 'object' && snapshot.value ? snapshot.value[field.key] : undefined
      return resolved
    }

    function isOverridden(snapshot, field) {
      return Boolean(snapshot && typeof snapshot.user === 'object' && snapshot.user && field.key in snapshot.user)
    }

    function WinPilotSettingsCard(props) {
      const { scope, locale } = props
      const t = COPY[locale] || COPY.en
      const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
      const [drafts, setDrafts] = React.useState({})
      const [status, setStatus] = React.useState('idle')
      const [invalid, setInvalid] = React.useState({})

      React.useEffect(() => {
        const off = scope.subscribe(() => setSnapshot(scope.getSnapshot()))
        void Promise.resolve(scope.load ? scope.load() : undefined).catch(() => setStatus('load-failed'))
        return off
      }, [scope])

      const writable = snapshot?.writable === true
      const unavailable = snapshot?.status === 'unavailable'

      const stage = (field, raw) => {
        const next = coerce(field, raw)
        setInvalid((prev) => ({ ...prev, [field.key]: next === null }))
        setDrafts((prev) => ({ ...prev, [field.key]: next === null ? raw : next }))
        setStatus('idle')
      }

      const save = async () => {
        setStatus('saving')
        const keys = Object.keys(drafts)
        try {
          for (const key of keys) {
            if (invalid[key]) continue
            const field = FIELDS.find((f) => f.key === key)
            if (!field) continue
            await scope.set(key, drafts[key])
          }
          setDrafts({})
          setInvalid({})
          setStatus('saved')
        } catch {
          setStatus('save-failed')
        }
      }

      const reset = async (field) => {
        try {
          await scope.unset(field.key)
          setDrafts((prev) => {
            const next = { ...prev }
            delete next[field.key]
            return next
          })
          setStatus('saved')
        } catch {
          setStatus('save-failed')
        }
      }

      const dirty = Object.keys(drafts).some((key) => !invalid[key]) && writable

      const header = React.createElement('div', { className: 'wp-head' },
        React.createElement('h2', { className: 'wp-title' }, t.title),
        React.createElement('p', { className: 'wp-intro' }, t.intro))

      if (unavailable) {
        return React.createElement('div', { className: 'wp-card' }, header,
          React.createElement('p', { className: 'wp-note' }, t.unavailable))
      }

      const groups = []
      for (const field of FIELDS) {
        const group = field.group
        let bucket = groups.find((g) => g.group === group)
        if (!bucket) { bucket = { group, fields: [] }; groups.push(bucket) }
        bucket.fields.push(field)
      }

      const control = (field) => {
        const staged = field.key in drafts ? drafts[field.key] : valueOf(snapshot, field)
        const bad = invalid[field.key] === true
        if (field.type === 'boolean') {
          return React.createElement('input', {
            type: 'checkbox',
            checked: staged === true,
            disabled: !writable,
            'aria-label': t['field' + field.key[0].toUpperCase() + field.key.slice(1)],
            onChange: (event) => stage(field, event.target.checked),
          })
        }
        if (field.type === 'string') {
          return React.createElement('select', {
            className: 'wp-input',
            value: staged ?? field.values[0],
            disabled: !writable,
            'aria-label': t['field' + field.key[0].toUpperCase() + field.key.slice(1)],
            onChange: (event) => stage(field, event.target.value),
          }, field.values.map((value) => React.createElement('option', {
            key: value, value,
          }, valueLabel(t, value))))
        }
        return React.createElement('input', {
          type: 'number',
          className: 'wp-input' + (bad ? ' wp-input-bad' : ''),
          value: staged ?? '',
          min: field.min,
          max: field.max,
          disabled: !writable,
          'aria-label': t['field' + field.key[0].toUpperCase() + field.key.slice(1)],
          onChange: (event) => stage(field, event.target.value),
        })
      }

      const rows = []
      for (const bucket of groups) {
        rows.push(React.createElement('h3', { key: 'g-' + bucket.group, className: 'wp-group' }, t[GROUP_TITLE[bucket.group]]))
        for (const field of bucket.fields) {
          const labelKey = 'field' + field.key[0].toUpperCase() + field.key.slice(1)
          rows.push(React.createElement('div', { key: field.key, className: 'wp-row' },
            React.createElement('label', { className: 'wp-label' },
              t[labelKey] || field.key,
              isOverridden(snapshot, field)
                ? React.createElement('span', { className: 'wp-badge' }, t.overridden)
                : null),
            React.createElement('div', { className: 'wp-control' }, control(field)),
            isOverridden(snapshot, field) && writable
              ? React.createElement('button', {
                type: 'button', className: 'wp-reset', onClick: () => reset(field),
              }, t.reset)
              : null,
            invalid[field.key] === true
              ? React.createElement('span', { className: 'wp-err' }, t.invalid)
              : null))
        }
      }

      const footer = React.createElement('div', { className: 'wp-foot' },
        React.createElement('button', {
          type: 'button',
          className: 'wp-save',
          disabled: !dirty || status === 'saving',
          onClick: save,
        }, status === 'saving' ? t.saving : t.save),
        status === 'saved' ? React.createElement('span', { className: 'wp-ok' }, t.saved) : null,
        status === 'save-failed' ? React.createElement('span', { className: 'wp-err' }, t.saveFailed) : null,
        status === 'load-failed' ? React.createElement('span', { className: 'wp-err' }, t.loadFailed) : null)

      return React.createElement('div', { className: 'wp-card' }, header,
        React.createElement('div', { className: 'wp-body' }, rows), footer)
    }

    const STYLE = `
.wp-card{display:flex;flex-direction:column;gap:12px;padding:16px 18px;font-size:13px;color:var(--dsw-alias-label-primary)}
.wp-title{margin:0;font-size:15px;font-weight:600}
.wp-intro{margin:4px 0 0;color:var(--dsw-alias-label-secondary);line-height:1.6;font-size:12px}
.wp-group{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);text-transform:none}
.wp-body{display:flex;flex-direction:column}
.wp-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.wp-row:last-child{border-bottom:0}
.wp-label{display:flex;align-items:center;gap:6px;min-width:0;line-height:1.5}
.wp-control{display:flex;align-items:center;justify-content:flex-end}
.wp-input{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:inherit;font:inherit;padding:4px 8px;min-width:120px}
.wp-input-bad{border-color:var(--dsw-alias-state-error-primary)}
.wp-badge{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:10px;padding:1px 7px}
.wp-reset{background:0 0;border:0;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;font-size:11px;padding:0 2px;text-decoration:underline;text-underline-offset:2px}
.wp-foot{display:flex;align-items:center;gap:10px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.wp-save{background:var(--dsw-alias-button-primary-fill);border:0;border-radius:6px;color:var(--dsw-alias-label-primary-foreground);cursor:pointer;font:inherit;padding:6px 16px}
.wp-save:disabled{opacity:.5;cursor:default}
.wp-ok{color:var(--dsw-alias-state-success-primary);font-size:12px}
.wp-err{color:var(--dsw-alias-state-error-primary);font-size:12px}
.wp-note{color:var(--dsw-alias-label-secondary);line-height:1.6;margin:0}
`

    /**
     * Mount the Win-Pilot settings card.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const scope = resolveScope(ctx)
      const localeOf = () => {
        try {
          const snapshot = ctx.get('locale')?.getSnapshot?.()
          const active = snapshot && snapshot.active
          return typeof active === 'string' && active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
        } catch {
          return 'en'
        }
      }
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'win-pilot'
        style.textContent = STYLE
        document.head.appendChild(style)
        return () => style.remove()
      }, 'win-pilot: card styles')

      const cardProps = () => ({ scope, locale: localeOf() })

      // Settings -> Plugins -> a Win-Pilot page.
      //
      // This build serves the Plugins section as a set of tabs declared through
      // `settings.plugins.tab`, and that is the seam a visible plugin card has to
      // use here: dsh-image-gen registers exactly this way (id "image-generation",
      // order 30) and its page is present in the running app.
      ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: SETTINGS_NAMESPACE,
        order: 70,
        label: () => COPY[localeOf()].title,
        inject: cardProps,
      }, WinPilotSettingsCard))

      // Settings -> Plugins -> this plugin's card, keyed by settings namespace.
      //
      // Where the Plugins section dispatches `settings.plugin.item` once per
      // served namespace (`entryKey = <namespace>`) this card answers for the
      // `win-pilot` namespace. That seam is declared lazily by the section's own
      // configurable tab, so `inject` defers rather than failing; on builds that
      // do not declare it, the tab registration above still provides the page.
      ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NAMESPACE,
        inject: cardProps,
      }, WinPilotSettingsCard))

      // A top-level Settings page as well, so the same card is reachable at the
      // nav root on builds that render plugin entry points there.
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'win-pilot',
        order: 70,
        label: () => COPY[localeOf()].title,
        inject: cardProps,
      }, WinPilotSettingsCard))
    }

    return { name: NS, inject: ['slots'], apply }
  },
})

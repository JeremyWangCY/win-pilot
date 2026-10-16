// Win-Pilot Settings card (browser half).
//
// Hand-authored ModuleLoader bundle: the harness serves this file at
// /plugins/win-pilot/client.js and materializes it with `window.__ModuleLoader__`,
// so no bundler is required. `react` is host-provided (the same contract
// dsh-at-file relies on); nothing else is imported.
//
// Requires the current host's configForms service. The host describes the Loader
// entry id asynchronously, so binding follows its live namespace mirror.
window.__ModuleLoader__.load({
  id: 'win-pilot',
  factory: (require) => {
    const React = require('react')

    const NS = 'win-pilot'

    /**
     * The user-editable fields, mirroring lib/settings.js. A test asserts this
     * table stays identical to WIN_PILOT_SETTINGS_FIELDS so the card can never
     * offer a field the host schema would reject, or hide one it accepts.
     */
    const FIELDS = [
      { key: 'overlay', type: 'boolean', group: 'appearance' },
      { key: 'statusPill', type: 'boolean', group: 'appearance' },
      { key: 'browserHeadlessDefault', type: 'boolean', group: 'behaviour' },
      { key: 'desktopEnvironment', type: 'enum', values: ['current', 'task'], group: 'desktop' },
    ]

    /** Copy for the card. Kept inline: one card, two locales, no locale seat. */
    const COPY = {
      zh: {
        title: 'Win-Pilot 电脑操作',
        intro: '外观与浏览器偏好保存后立即生效。电脑操作环境对新任务生效。未单独设置的选项沿用默认值。',
        groupAppearance: '外观',
        groupBehaviour: '浏览器',
        groupDesktop: '电脑操作环境',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        reset: '恢复默认',
        overridden: '已覆盖',
        unavailable: '当前无法读取此插件的可编辑设置。请确认插件已启用并重新打开设置页。',
        loadFailed: '读取设置失败，请重试。',
        saveFailed: '保存失败，已保留草稿。',
        fieldOverlay: '显示操作光标',
        fieldStatusPill: '动作进行中显示状态条',
        fieldBrowserHeadlessDefault: '浏览器在后台运行（不显示窗口）',
        fieldDesktopEnvironment: '电脑操作环境',
        desktopCurrent: '当前桌面',
        desktopTask: '独立任务窗口（实验性）',
        desktopHint: '对新任务生效。首次使用完成 Windows 功能授权和本机登录设置；勾选记住登录后可自动连接。在任务窗口的「登录设置」可更新或清除。',
      },
      en: {
        title: 'Win-Pilot Computer Use',
        intro: 'Appearance and browser preferences take effect on save. The computer environment applies to new tasks. Unset options keep their defaults.',
        groupAppearance: 'Appearance',
        groupBehaviour: 'Browser',
        groupDesktop: 'Computer environment',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        reset: 'Reset to default',
        overridden: 'Overridden',
        unavailable: 'Editable settings for this plugin are unavailable. Check that the plugin is enabled and reopen its settings page.',
        loadFailed: 'Reading settings failed; retry.',
        saveFailed: 'Save failed; drafts were kept.',
        fieldOverlay: 'Show the operation cursor',
        fieldStatusPill: 'Show the status pill while an action runs',
        fieldBrowserHeadlessDefault: 'Run browsers without a visible window',
        fieldDesktopEnvironment: 'Computer environment',
        desktopCurrent: 'Current desktop',
        desktopTask: 'Separate task window (experimental)',
        desktopHint: 'Applies to new tasks. Complete Windows feature setup and local sign-in once. Remember sign-in to connect automatically; update or clear it in the task window’s Sign-in settings.',
      },
    }

    const GROUP_TITLE = {
      appearance: 'groupAppearance',
      behaviour: 'groupBehaviour',
      desktop: 'groupDesktop',
    }

    /** The empty read a host with no usable settings entry reports. */
    const UNAVAILABLE_SNAPSHOT = { value: undefined, writable: false, status: 'unavailable' }

    /**
     * A scope that tracks the Loader entry serving this plugin.
     *
     * Two host rules force this indirection:
     *   * `configForms.get(entryId)` NEVER returns undefined — it lazily builds a
     *     controller — and that controller resolves its view by exact `ns` match
     *     (`candidate.ns === this.spec.namespace`); a wrong key therefore yields a
     *     scope that stays `unavailable` forever rather than an obvious miss.
     *   * the id is the Loader ENTRY id (`entry.options.id`), not the package name,
     *     so a patched profile serves `include:win-pilot` while a plain one serves
     *     `win-pilot`. At apply() time the shared describe mirror is usually still
     *     loading, so the correct spelling cannot be known yet.
     *
     * So the binding is re-resolved whenever the mirror reports new served
     * namespaces, preferring an exact served match, and only the namespace the
     * Host actually serves is ever used. Until then the card shows the unavailable
     * note while the namespace mirror loads.
     */
    function liveScope(ctx) {
      const listeners = new Set()
      let bound = null
      let offMirror = null
      let offBound = null

      const notify = () => { for (const listener of [...listeners]) guard(() => listener()) }
      const bind = (current) => {
        const changed = bound !== current
        if (bound !== current && offBound) {
          offBound()
          offBound = null
        }
        bound = current
        if (bound && listeners.size > 0 && !offBound && typeof bound.subscribe === 'function') {
          offBound = bound.subscribe(notify)
        }
        if (changed && bound && typeof bound.load === 'function') {
          void Promise.resolve(guard(() => bound.load())).catch(() => {})
        }
        return bound
      }

      const formsOf = () => {
        const forms = readService(ctx, 'configForms')
        return forms && typeof forms.get === 'function' ? forms : null
      }

      /** Namespaces the Host currently serves, from the shared describe mirror. */
      const servedNamespaces = () => {
        const forms = formsOf()
        if (!forms || typeof forms.describe !== 'function') return []
        const describe = guard(() => forms.describe())
        const snapshot = describe && typeof describe.getSnapshot === 'function' ? guard(() => describe.getSnapshot()) : undefined
        const list = snapshot && snapshot.view && Array.isArray(snapshot.view.namespaces) ? snapshot.view.namespaces : []
        return list.map((view) => (typeof view === 'string' ? view : view && view.ns)).filter((ns) => typeof ns === 'string')
      }

      /** Only namespace ids actually described by the current host may bind. */
      const candidateKeys = () => servedNamespaces().filter((ns) => ns === NS || ns.endsWith(':' + NS))

      /** Bind to the first candidate that reports a live entry; null when none does. */
      const pick = () => {
        const forms = formsOf()
        if (!forms) return null
        for (const key of candidateKeys()) {
          const scope = guard(() => forms.get(key))
          if (!scope || typeof scope.getSnapshot !== 'function') continue
          const snapshot = guard(() => scope.getSnapshot())
          // `unavailable` is the verdict for a key that names no served entry;
          // `loading` means the mirror has not answered yet and may still be it.
          if (snapshot && snapshot.status !== 'unavailable') {
            return bind(scope)
          }
        }
        return bind(null)
      }

      const scope = {
        getSnapshot() {
          const current = pick()
          const snapshot = current ? guard(() => current.getSnapshot()) : undefined
          return snapshot && snapshot.status !== 'unavailable' ? snapshot : UNAVAILABLE_SNAPSHOT
        },
        subscribe(listener) {
          listeners.add(listener)
          const forms = formsOf()
          const describe = forms && typeof forms.describe === 'function' ? guard(() => forms.describe()) : null
          if (!offMirror && describe && typeof describe.subscribe === 'function') {
            // The mirror is the authority on served namespaces, so a later answer
            // re-binds the card when a served entry becomes available.
            offMirror = guard(() => describe.subscribe(() => { pick(); notify() })) || null
            if (typeof describe.ensure === 'function') guard(() => describe.ensure())
          }
          pick()
          return () => {
            listeners.delete(listener)
            if (listeners.size === 0) {
              if (offMirror) offMirror()
              offMirror = null
              if (offBound) offBound()
              offBound = null
            }
          }
        },
        set: async (field, value) => {
          const current = pick()
          if (!current || typeof current.set !== 'function') return false
          return current.set(field, value)
        },
        unset: async (field) => {
          const current = pick()
          if (!current || typeof current.unset !== 'function') return false
          return current.unset(field)
        },
        load: async () => {
          const current = pick()
          if (current && typeof current.load === 'function') return current.load()
        },
      }
      return scope
    }

    /** Read a current host service from the browser context. */
    function readService(ctx, key) {
      const direct = guard(() => ctx[key])
      if (direct) return direct
      return guard(() => ctx.get(key))
    }

    /** Run a probe, treating a guarded/absent service as "no value". */
    function guard(body) {
      try {
        return body()
      } catch {
        return undefined
      }
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

      React.useEffect(() => {
        const off = scope.subscribe(() => setSnapshot(scope.getSnapshot()))
        void Promise.resolve(scope.load ? scope.load() : undefined).catch(() => setStatus('load-failed'))
        return off
      }, [scope])

      const writable = snapshot?.writable === true
      const unavailable = snapshot?.status === 'unavailable'

      const stage = (field, value) => {
        if (field.type === 'enum' ? !field.values.includes(value) : typeof value !== 'boolean') return
        setDrafts((prev) => ({ ...prev, [field.key]: value }))
        setStatus('idle')
      }

      const save = async () => {
        setStatus('saving')
        const keys = Object.keys(drafts)
        try {
          for (const key of keys) {
            const field = FIELDS.find((f) => f.key === key)
            if (!field) continue
            if (await scope.set(key, drafts[key]) === false) throw new Error('Setting was not accepted')
          }
          setDrafts({})
          setStatus('saved')
        } catch {
          setStatus('save-failed')
        }
      }

      const reset = async (field) => {
        setStatus('saving')
        try {
          if (await scope.unset(field.key) === false) throw new Error('Reset was not accepted')
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

      const dirty = Object.keys(drafts).length > 0 && writable

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
        if (field.type === 'enum') {
          return React.createElement('select', {
            value: field.values.includes(staged) ? staged : 'current',
            disabled: !writable || status === 'saving',
            'aria-label': t.fieldDesktopEnvironment,
            onChange: (event) => stage(field, event.target.value),
          }, field.values.map((value) => React.createElement('option', {
            key: value, value,
          }, value === 'task' ? t.desktopTask : t.desktopCurrent)))
        }
        return React.createElement('input', {
          type: 'checkbox',
          checked: staged === true,
          disabled: !writable || status === 'saving',
          'aria-label': t['field' + field.key[0].toUpperCase() + field.key.slice(1)],
          onChange: (event) => stage(field, event.target.checked),
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
                type: 'button', className: 'wp-reset', disabled: status === 'saving', onClick: () => reset(field),
              }, t.reset)
              : null,
            field.key === 'desktopEnvironment'
              ? React.createElement('p', { className: 'wp-field-note' }, t.desktopHint)
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
.wp-control select{font:inherit;max-width:100%;padding:4px 6px;color:inherit;background:var(--dsw-alias-background-l1);border:1px solid var(--dsw-alias-border-l2);border-radius:4px}
.wp-field-note{grid-column:1/-1;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
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
      const scope = liveScope(ctx)
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

      // Current host: the installed package's detail page owns this keyed slot.
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: NS,
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

    return { name: NS, inject: ['slots', 'configForms'], apply }
  },
})

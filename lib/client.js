// Win-Pilot Settings card (browser half).
//
// Hand-authored ModuleLoader bundle: the harness serves this file at
// /plugins/win-pilot/client.js and materializes it with `window.__ModuleLoader__`,
// so no bundler is required. `react` is host-provided (the same contract
// dsh-at-file relies on); nothing else is imported.
//
// Requires the current host's configForms service. The host describes the Loader
// entry id asynchronously, so binding follows its live namespace mirror.
//
// Layout rule: a settings panel is not a content page. Every control fits in one
// compact panel without scrolling, and the card carries labels and state only —
// no intro, headings or hint paragraphs.
window.__ModuleLoader__.load({
  id: 'win-pilot',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'win-pilot'

    /**
     * The user-editable fields, mirroring lib/settings.js. A test asserts this
     * table stays identical to WIN_PILOT_SETTINGS_FIELDS so the card can never
     * offer a field the host schema would reject, or hide one it accepts.
     */
    const FIELDS = [
      { key: 'overlay', type: 'boolean', icon: 'cursor' },
      { key: 'statusPill', type: 'boolean', icon: 'pill' },
      { key: 'browserHeadlessDefault', type: 'boolean', icon: 'browser' },
      { key: 'desktopEnvironment', type: 'enum', values: ['current', 'task'], icon: 'monitor' },
      { key: 'remoteControlPolicy', type: 'enum', values: ['fallback', 'refuse'], icon: 'shield' },
    ]

    /** Per-option copy keys and glyphs, so the segmented control stays generic. */
    const OPTIONS = {
      'desktopEnvironment:current': { label: 'desktopCurrent', icon: 'monitor' },
      'desktopEnvironment:task': { label: 'desktopTask', icon: 'layers' },
      'remoteControlPolicy:fallback': { label: 'remoteFallback', icon: 'undo' },
      'remoteControlPolicy:refuse': { label: 'remoteRefuse', icon: 'stop' },
    }

    /** Labels and state messages. Kept inline: one card, two locales, no locale seat. */
    const COPY = {
      zh: {
        title: 'Win-Pilot 电脑操作',
        save: '保存',
        saving: '保存中…',
        saved: '已保存',
        discard: '放弃',
        pending: (n) => n + ' 项未保存',
        readOnly: '只读',
        reset: '恢复默认',
        overridden: '已覆盖',
        unavailable: '当前无法读取此插件的可编辑设置。请确认插件已启用并重新打开设置页。',
        loadFailed: '读取设置失败',
        retry: '重试',
        saveFailed: '保存失败，已保留草稿。',
        fieldOverlay: '显示操作光标',
        fieldStatusPill: '动作进行中显示状态条',
        fieldBrowserHeadlessDefault: '浏览器后台运行',
        fieldDesktopEnvironment: '运行位置',
        desktopCurrent: '当前桌面',
        desktopTask: '独立任务窗口',
        fieldRemoteControlPolicy: '远程控制接入时',
        remoteFallback: '改用当前桌面',
        remoteRefuse: '停止并提示',
        toggleOn: '开启',
        toggleOff: '关闭',
        runtimeOffline: '未连接',
        runtimeVersion: '实际运行',
        installedVersion: '已安装',
        runtimeUnavailable: '暂时无法读取运行版本',
        reload: '重新加载',
        reloadWaiting: '等待动作完成…',
        reloading: '重新加载中…',
        restartRequired: '重启 DSH 后生效',
        reloadFailed: '重新加载失败',
      },
      en: {
        title: 'Win-Pilot Computer Use',
        save: 'Save',
        saving: 'Saving…',
        saved: 'Saved',
        discard: 'Discard',
        pending: (n) => n + ' unsaved',
        readOnly: 'Read-only',
        reset: 'Reset to default',
        overridden: 'Overridden',
        unavailable: 'Editable settings for this plugin are unavailable. Check that the plugin is enabled and reopen its settings page.',
        loadFailed: 'Reading settings failed',
        retry: 'Retry',
        saveFailed: 'Save failed; drafts were kept.',
        fieldOverlay: 'Show the operation cursor',
        fieldStatusPill: 'Show the status pill while an action runs',
        fieldBrowserHeadlessDefault: 'Run browsers in background',
        fieldDesktopEnvironment: 'Where it runs',
        desktopCurrent: 'This desktop',
        desktopTask: 'Task window',
        fieldRemoteControlPolicy: 'While remote control is attached',
        remoteFallback: 'Use this desktop',
        remoteRefuse: 'Stop and warn',
        toggleOn: 'On',
        toggleOff: 'Off',
        runtimeOffline: 'Offline',
        runtimeVersion: 'Running',
        installedVersion: 'Installed',
        runtimeUnavailable: 'Runtime version is unavailable',
        reload: 'Reload',
        reloadWaiting: 'Waiting…',
        reloading: 'Reloading…',
        restartRequired: 'Restart DSH to apply',
        reloadFailed: 'Reload failed',
      },
    }

    /**
     * Line glyphs on a 24px grid, stroked with currentColor so they follow the
     * theme. Each entry is a list of [tag, attributes] pairs.
     */
    const GLYPHS = {
      cursor: [['path', { d: 'M5 3.5 18.5 9l-5.6 1.9L11 16.5z' }], ['path', { d: 'm13 11 5.5 5.5' }]],
      pill: [['rect', { x: 2.5, y: 8, width: 19, height: 8, rx: 4 }], ['circle', { cx: 7, cy: 12, r: 1.4, fill: 'currentColor' }], ['path', { d: 'M11 12h6' }]],
      browser: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }], ['path', { d: 'M3 9h18' }], ['path', { d: 'M6.5 6.5h.01M9 6.5h.01' }]],
      monitor: [['rect', { x: 2.5, y: 4, width: 19, height: 13, rx: 2.5 }], ['path', { d: 'M8.5 21h7M12 17v4' }]],
      layers: [['rect', { x: 7, y: 3.5, width: 14, height: 11, rx: 2.5 }], ['path', { d: 'M17 17.5v.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 18v-6.5A2.5 2.5 0 0 1 5.5 9H7' }]],
      shield: [['path', { d: 'M12 3 19.5 6v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
      undo: [['path', { d: 'M9 14 4 9l5-5' }], ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11' }]],
      stop: [['circle', { cx: 12, cy: 12, r: 9 }], ['rect', { x: 9, y: 9, width: 6, height: 6, rx: 1 }]],
      refresh: [['path', { d: 'M20 11a8 8 0 0 0-14.3-4.9L4 8' }], ['path', { d: 'M4 4v4h4' }], ['path', { d: 'M4 13a8 8 0 0 0 14.3 4.9L20 16' }], ['path', { d: 'M20 20v-4h-4' }]],
      check: [['path', { d: 'm5 12.5 4.5 4.5L19 7.5' }]],
      alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5.5M12 16.5h.01' }]],
      reset: [['path', { d: 'M4 12a8 8 0 1 0 2.4-5.7L4 8.5' }], ['path', { d: 'M4 4v4.5h4.5' }]],
    }

    function glyph(name, size = 16) {
      const parts = GLYPHS[name] || []
      return h('svg', {
        className: 'wp-glyph', width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, parts.map(([tag, attrs], index) => h(tag, { key: index, ...attrs })))
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

    const labelKeyOf = (field) => 'field' + field.key[0].toUpperCase() + field.key.slice(1)

    /** Runtime status polling: fast while a reload is in motion, slow otherwise. */
    const POLL_BUSY_MS = 1500
    const POLL_IDLE_MS = 10000
    const SAVED_MS = 2400

    function useRuntimeStatus(runtime) {
      const [info, setInfo] = React.useState(null)
      React.useEffect(() => {
        if (!runtime || typeof runtime.status !== 'function') return
        let disposed = false
        let timer = null
        const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
        const read = async () => {
          if (disposed) return
          let next = null
          if (!hidden()) {
            try { next = await runtime.status() } catch { next = { ok: false } }
            if (disposed) return
            setInfo((previous) => (next && next.ok === false && previous ? { ...previous, ok: false } : next))
          }
          const phase = next && next.reload_state
          timer = setTimeout(read, phase === 'waiting' || phase === 'reloading' ? POLL_BUSY_MS : POLL_IDLE_MS)
          timer.unref?.()
        }
        void read()
        return () => { disposed = true; clearTimeout(timer) }
      }, [runtime])
      return [info, setInfo]
    }

    function WinPilotSettingsCard(props) {
      const { scope, locale, runtime } = props
      const t = COPY[locale] || COPY.en
      const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot())
      const [drafts, setDrafts] = React.useState({})
      const [status, setStatus] = React.useState('idle')
      const [runtimeInfo, setRuntimeInfo] = useRuntimeStatus(runtime)
      const [reloadError, setReloadError] = React.useState(false)

      React.useEffect(() => {
        const off = scope.subscribe(() => setSnapshot(scope.getSnapshot()))
        void Promise.resolve(scope.load ? scope.load() : undefined).catch(() => setStatus('load-failed'))
        return off
      }, [scope])

      const writable = snapshot?.writable === true
      const unavailable = snapshot?.status === 'unavailable'
      // Until the first answer arrives the values are unknown, so the controls
      // render as placeholders instead of showing everything switched off.
      const loading = snapshot?.status === 'loading'
      const saving = status === 'saving'

      // A confirmation is transient; errors stay until the next action.
      React.useEffect(() => {
        if (status !== 'saved') return
        const timer = setTimeout(() => setStatus((current) => (current === 'saved' ? 'idle' : current)), SAVED_MS)
        return () => clearTimeout(timer)
      }, [status])

      const retry = () => {
        setStatus('idle')
        void Promise.resolve(scope.load ? scope.load() : undefined).catch(() => setStatus('load-failed'))
      }

      const stage = (field, value) => {
        if (field.type === 'enum' ? !field.values.includes(value) : typeof value !== 'boolean') return
        setDrafts((prev) => {
          const next = { ...prev, [field.key]: value }
          // Staging the stored value again is not an edit.
          if (valueOf(snapshot, field) === value) delete next[field.key]
          return next
        })
        setStatus('idle')
      }

      const save = async () => {
        setStatus('saving')
        try {
          for (const key of Object.keys(drafts)) {
            if (!FIELDS.some((f) => f.key === key)) continue
            if (await scope.set(key, drafts[key]) === false) throw new Error('Setting was not accepted')
            // Drop each accepted value at once, so a later failure leaves only
            // the values that still need saving staged.
            setDrafts((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
          }
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

      const discard = () => { setDrafts({}); setStatus('idle') }

      const pendingCount = Object.keys(drafts).length
      const dirty = pendingCount > 0 && writable
      const reloadPhase = runtimeInfo?.reload_state
      const reloadBusy = reloadPhase === 'waiting' || reloadPhase === 'reloading'
      const reloadFailed = reloadError || reloadPhase === 'failed'
      const reload = async () => {
        setReloadError(false)
        try {
          const value = await runtime.reload()
          if (value?.ok !== true) throw new Error('Reload was not accepted')
          setRuntimeInfo((previous) => ({ ...previous, reload_state: value.reload_state }))
        } catch { setReloadError(true) }
      }

      // Runtime: one compact chip, plus an inline action only when an update waits.
      const online = runtimeInfo?.ok === true
      const updated = online && runtimeInfo.installed_version && runtimeInfo.installed_version !== runtimeInfo.running_version
      const runtimeBar = h('div', { className: 'wp-runtime', role: 'status', 'aria-live': 'polite' },
        h('span', {
          className: 'wp-chip' + (online ? ' is-live' : ''),
          title: online
            ? t.runtimeVersion + ' ' + runtimeInfo.running_version + ' · ' + t.installedVersion + ' ' + runtimeInfo.installed_version
            : t.runtimeUnavailable,
        }, h('span', { className: 'wp-dot', 'aria-hidden': 'true' }),
        online ? 'v' + runtimeInfo.running_version + (updated ? ' → v' + runtimeInfo.installed_version : '') : t.runtimeOffline),
        runtimeInfo?.restart_required ? h('span', { className: 'wp-note' }, t.restartRequired) : null,
        runtimeInfo?.can_reload || reloadBusy
          ? h('button', {
            type: 'button', className: 'wp-reload', disabled: dirty || saving || reloadBusy, onClick: reload,
          }, glyph('refresh', 13), reloadPhase === 'waiting' ? t.reloadWaiting : reloadPhase === 'reloading' ? t.reloading : t.reload)
          : null,
        reloadFailed ? h('span', { className: 'wp-err' }, t.reloadFailed) : null)

      if (unavailable) {
        return h('div', { className: 'wp-card' },
          h('div', { className: 'wp-empty' }, glyph('alert', 18), h('p', { className: 'wp-note' }, t.unavailable)),
          h('div', { className: 'wp-foot' }, runtimeBar))
      }

      const control = (field) => {
        const staged = field.key in drafts ? drafts[field.key] : valueOf(snapshot, field)
        const busy = !writable || saving || loading
        // A stable id lets the visible label point at the control with htmlFor.
        const id = 'wp-' + field.key
        if (field.type === 'enum') {
          const selected = field.values.includes(staged) ? staged : field.values[0]
          // A radiogroup is one tab stop with arrow-key movement inside it; only
          // the selected option is reachable by Tab.
          const move = (delta) => {
            const at = field.values.indexOf(selected)
            const next = field.values[(at + delta + field.values.length) % field.values.length]
            if (next !== undefined && !busy) stage(field, next)
          }
          return h('div', {
            id, className: 'wp-seg', role: 'radiogroup', 'aria-label': t[labelKeyOf(field)] || field.key,
            onKeyDown: (event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(1) }
              else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
            },
          }, field.values.map((value) => {
            const option = OPTIONS[field.key + ':' + value] || {}
            const on = selected === value
            return h('button', {
              key: value,
              type: 'button',
              role: 'radio',
              'aria-checked': on,
              tabIndex: on ? 0 : -1,
              className: 'wp-seg-btn' + (on ? ' is-on' : ''),
              title: t[option.label] || value,
              disabled: busy,
              onClick: () => stage(field, value),
            }, glyph(option.icon || 'monitor', 14), h('span', null, t[option.label] || value))
          }))
        }
        const on = staged === true
        return h('button', {
          id,
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': t[labelKeyOf(field)],
          title: on ? t.toggleOn : t.toggleOff,
          className: 'wp-switch' + (on ? ' is-on' : ''),
          disabled: busy,
          onClick: () => stage(field, !on),
        }, h('span', { className: 'wp-switch-knob' }))
      }

      const rows = FIELDS.map((field) => {
        const overridden = !loading && isOverridden(snapshot, field)
        return h('div', { key: field.key, className: 'wp-row' + (field.key in drafts ? ' is-changed' : '') },
          h('span', { className: 'wp-tile' }, glyph(field.icon, 16)),
          h('label', { className: 'wp-label', htmlFor: 'wp-' + field.key }, t[labelKeyOf(field)] || field.key),
          overridden ? h('span', { className: 'wp-badge' }, t.overridden) : null,
          overridden && writable
            ? h('button', {
              type: 'button', className: 'wp-reset', disabled: saving, onClick: () => reset(field),
              title: t.reset, 'aria-label': t.reset + ' · ' + (t[labelKeyOf(field)] || field.key),
            }, glyph('reset', 13))
            : null,
          h('div', { className: 'wp-control' }, control(field)))
      })

      let summary = null
      if (status === 'save-failed') summary = h('span', { className: 'wp-err' }, t.saveFailed)
      else if (status === 'load-failed') {
        summary = h('span', { className: 'wp-err' }, glyph('alert', 13), t.loadFailed,
          h('button', { type: 'button', className: 'wp-retry', onClick: retry, title: t.retry, 'aria-label': t.retry }, glyph('refresh', 13)))
      }
      else if (dirty) summary = h('span', { className: 'wp-pending' }, t.pending(pendingCount))
      else if (status === 'saved') summary = h('span', { className: 'wp-ok' }, glyph('check', 13), t.saved)
      else if (!writable) summary = h('span', { className: 'wp-note' }, t.readOnly)

      const footer = h('div', { className: 'wp-foot' },
        runtimeBar,
        h('div', { className: 'wp-actions' },
          summary,
          dirty ? h('button', { type: 'button', className: 'wp-discard', disabled: saving, onClick: discard }, t.discard) : null,
          h('button', {
            type: 'button',
            className: 'wp-save',
            disabled: !dirty || saving,
            onClick: save,
          }, saving ? t.saving : t.save)))

      const onKeyDown = (event) => {
        if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 's') {
          event.preventDefault()
          if (dirty && !saving) void save()
        } else if (event.key === 'Escape' && dirty && !saving) {
          discard()
        }
      }

      return h('div', { className: 'wp-card', onKeyDown },
        h('div', { className: 'wp-panel' + (loading ? ' is-loading' : ''), 'aria-busy': loading }, rows), footer)
    }

    const STYLE = `
.wp-card{
  --wp-accent:#4d6bfe;--wp-accent-strong:#3a56e8;--wp-accent-soft:color-mix(in srgb,#4d6bfe 12%,transparent);
  --wp-fg:var(--dsw-alias-label-primary,#0f1115);--wp-fg-2:var(--dsw-alias-label-secondary,#4c5260);
  --wp-fg-3:var(--dsw-alias-label-tertiary,#6b7180);
  --wp-bg:var(--dsw-alias-bg-base,#fff);--wp-sunken:var(--dsw-alias-bg-module-platform,#f5f6f7);
  --wp-line:var(--dsw-alias-border-l2,rgba(0,0,0,.1));--wp-line-soft:var(--dsw-alias-border-l1,rgba(0,0,0,.05));
  --wp-ok:var(--dsw-alias-state-success-primary,#1f9d55);--wp-bad:var(--dsw-alias-state-error-primary,#d93025);
  display:flex;flex-direction:column;gap:10px;max-width:720px;font-size:13.5px;line-height:1.4;color:var(--wp-fg)}
.wp-card *{box-sizing:border-box}
.wp-card button{font:inherit}
.wp-card button:focus-visible{outline:2px solid var(--wp-accent);outline-offset:2px}
.wp-glyph{flex:none;display:block}

.wp-panel{border:1px solid var(--wp-line);border-radius:12px;overflow:hidden}
.wp-row{position:relative;display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 12px;
  border-top:1px solid var(--wp-line-soft);transition:background .15s}
.wp-row:hover{background:color-mix(in srgb,var(--wp-fg) 2.5%,transparent)}
.wp-row:first-child{border-top:0}
.wp-row.is-changed{background:color-mix(in srgb,#4d6bfe 5%,transparent)}
.wp-row.is-changed::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:3px;border-radius:0 3px 3px 0;background:var(--wp-accent)}
.wp-tile{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;flex:none;color:var(--wp-accent);background:var(--wp-accent-soft)}
.wp-label{min-width:0;flex:0 1 auto;font-weight:500;cursor:pointer;overflow-wrap:anywhere}
.wp-badge{flex:none;height:18px;line-height:18px;padding:0 7px;border-radius:999px;font-size:10.5px;font-weight:550;
  color:var(--wp-accent);background:var(--wp-accent-soft);white-space:nowrap}
.wp-reset{display:grid;place-items:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;
  background:none;color:var(--wp-fg-3);cursor:pointer}
.wp-reset:hover:not(:disabled){color:var(--wp-accent);background:var(--wp-accent-soft)}
.wp-reset:disabled{opacity:.4;cursor:default}
.wp-control{margin-left:auto;flex:none;display:flex;align-items:center}

.wp-switch{position:relative;width:40px;height:24px;padding:0;border:0;border-radius:999px;cursor:pointer;flex:none;
  background:var(--wp-line);transition:background .2s ease}
.wp-switch.is-on{background:var(--wp-accent)}
.wp-switch:disabled{opacity:.45;cursor:default}
.wp-switch-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;
  box-shadow:0 1px 3px rgba(15,17,21,.3);transition:transform .22s cubic-bezier(.3,1.4,.5,1)}
.wp-switch.is-on .wp-switch-knob{transform:translateX(16px)}

.wp-seg{display:inline-flex;padding:3px;gap:2px;border-radius:9px;background:var(--wp-sunken);border:1px solid var(--wp-line-soft)}
.wp-seg-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border:0;border-radius:7px;cursor:pointer;
  background:none;color:var(--wp-fg-2);font-size:12.5px;white-space:nowrap;transition:background .15s,color .15s}
.wp-seg-btn:hover:not(:disabled):not(.is-on){color:var(--wp-fg)}
.wp-seg-btn.is-on{background:var(--wp-bg);color:var(--wp-accent);font-weight:600;box-shadow:0 1px 2px rgba(15,17,21,.12)}
.wp-seg-btn:disabled{opacity:.5;cursor:default}

.wp-foot{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;min-height:34px}
.wp-runtime{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px}
.wp-chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;color:var(--wp-fg-2);
  border:1px solid var(--wp-line);white-space:nowrap;font-variant-numeric:tabular-nums}
.wp-dot{width:7px;height:7px;border-radius:50%;background:var(--wp-fg-3);flex:none}
.wp-chip.is-live .wp-dot{background:var(--wp-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wp-ok) 22%,transparent)}
.wp-reload{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:999px;border:0;cursor:pointer;
  background:var(--wp-accent-soft);color:var(--wp-accent);font-size:12px;font-weight:550}
.wp-reload:hover:not(:disabled){background:color-mix(in srgb,#4d6bfe 20%,transparent)}
.wp-reload:disabled{opacity:.5;cursor:default}
.wp-actions{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12.5px}
.wp-actions>span{display:inline-flex;align-items:center;gap:5px}
.wp-pending{color:var(--wp-accent);font-weight:550}
.wp-save,.wp-discard{height:30px;padding:0 16px;border-radius:999px;cursor:pointer;font-size:13px;font-weight:550}
.wp-save{border:0;background:var(--wp-accent);color:#fff}
.wp-save:hover:not(:disabled){background:var(--wp-accent-strong)}
.wp-save:disabled{opacity:.4;cursor:default}
.wp-discard{border:1px solid var(--wp-line);background:none;color:var(--wp-fg-2)}
.wp-discard:hover:not(:disabled){color:var(--wp-fg);background:var(--wp-sunken)}
.wp-ok{color:var(--wp-ok)}
.wp-err{color:var(--wp-bad)}
.wp-retry{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;cursor:pointer;
  background:none;color:inherit}
.wp-retry:hover{background:color-mix(in srgb,var(--wp-bad) 12%,transparent)}
.wp-panel.is-loading .wp-switch,.wp-panel.is-loading .wp-seg{opacity:1;color:transparent;background:var(--wp-sunken);
  border-color:transparent;animation:wp-pulse 1.2s ease-in-out infinite}
.wp-panel.is-loading .wp-switch-knob,.wp-panel.is-loading .wp-seg-btn>*{visibility:hidden}
.wp-panel.is-loading .wp-seg-btn{box-shadow:none;background:none}
@keyframes wp-pulse{50%{opacity:.55}}
.wp-ok{animation:wp-in .18s ease-out}
@keyframes wp-in{from{opacity:0;transform:translateY(2px)}}
.wp-note{margin:0;color:var(--wp-fg-3)}
.wp-empty{display:flex;align-items:flex-start;gap:10px;padding:14px;border-radius:12px;border:1px dashed var(--wp-line);color:var(--wp-fg-3)}

@media (max-width:560px){
  .wp-row:has(.wp-seg){flex-wrap:wrap;padding-bottom:10px}
  .wp-row:has(.wp-seg) .wp-control{width:calc(100% - 38px);margin-left:38px}
  .wp-seg{display:flex;width:100%}
  .wp-seg-btn{flex:1 1 0;min-width:0;justify-content:center}
  .wp-seg-btn span{overflow:hidden;text-overflow:ellipsis}
}
@media (prefers-reduced-motion:reduce){.wp-card *{transition:none!important;animation:none!important}}
`

    /**
     * Mount the Win-Pilot settings card.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const scope = liveScope(ctx)
      let remoteRuntime = null
      if (typeof ctx.inject === 'function') ctx.inject(['remote', 'remote.winPilotRuntime'], runtimeCtx => {
        remoteRuntime = runtimeCtx.remote.winPilotRuntime
        if (typeof runtimeCtx.effect === 'function') runtimeCtx.effect(() => () => { remoteRuntime = null }, 'win-pilot.runtime-face')
      })
      const runtime = {
        async status() {
          if (!remoteRuntime) return { ok:false }
          const result = await remoteRuntime.status()
          return result.ok ? result.value : { ok:false }
        },
        async reload() {
          if (!remoteRuntime) return { ok:false }
          const result = await remoteRuntime.reload()
          return result.ok ? result.value : { ok:false }
        },
      }
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

      const cardProps = () => ({ scope, locale: localeOf(), runtime })

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

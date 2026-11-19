/**
 * Auto update — browser half.
 *
 * One sidebar entry, two jobs, both started when the page loads (which is what
 * "DSH NEXT opened" means for a plugin):
 *
 * 1. Installed plugins: for every bundle the profile installed from a registry,
 *    ask the registry for newer versions and install the newest one that still
 *    declares a bundle patch and accepts the running DSH version, through the
 *    same `pluginManager` Remote the Plugins page uses.
 * 2. DSH NEXT itself: inside the desktop window, drive the shell's own updater
 *    (`window.dshDesktop.command`) — check, download the signed installer, and,
 *    by default, install it and restart. The page never downloads or runs an
 *    installer itself.
 *
 * Preferences and the last report live in the window's local storage, so a page
 * reload (a plugin update can cause one) keeps the report and does not restart
 * a run that just happened.
 */

window.__ModuleLoader__.load({
  id: 'dsh-next-auto-update',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'autoUpdate'
    const PANEL_ID = 'auto-update'
    const OWN_PACKAGE = 'dsh-next-auto-update'
    const STORAGE_KEY = 'dsh-next-auto-update/v1'
    const RELEASES_URL = 'https://github.com/anywhere-labs/dsh-desktop/releases'

    /** A finished launch run suppresses the next ones for this long. */
    const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000
    /** Two attempts closer than this mean the previous one was interrupted. */
    const RETRY_FLOOR_MS = 90 * 1000
    /** Let the page finish booting (connection, layout) before touching the profile. */
    const LAUNCH_DELAY_MS = 2500

    const DEFAULT_PREFS = {
      plugins: true,
      app: true,
      appInstall: true,
      prerelease: false,
    }

    const DICTS = {
      en: {
        panel: 'Auto update',
        title: 'Auto update',
        subtitle: 'Updates installed plugins and DSH NEXT itself when the app opens.',
        checkNow: 'Check now',
        running: 'Working…',
        neverRun: 'No run yet',
        lastRun: 'Last run: {when}',
        skippedRecent: 'The last run finished recently, so this launch skipped it.',
        appSection: 'DSH NEXT',
        pluginsSection: 'Plugins',
        prefsSection: 'Preferences',
        currentVersion: 'Installed version {version}',
        versionUnknown: 'Version unknown',
        appIdle: 'Not checked yet',
        appChecking: 'Checking for a new version…',
        appCurrent: 'Up to date',
        appAvailable: 'Version {version} is available',
        appDownloading: 'Downloading version {version} — {percent}%',
        appDownloadingUnknown: 'Downloading version {version}…',
        appReady: 'Version {version} is downloaded',
        appInstalling: 'Installing version {version} and restarting…',
        appManual: 'This build updates by hand — open the release page to get version {version}.',
        appError: 'The update could not complete ({reason}).',
        appUnsupported: 'App updates run inside the DSH NEXT desktop app; this window can only update plugins.',
        appDisabled: 'App updates are turned off below.',
        installNow: 'Install and restart',
        releasePage: 'Open release page',
        none: 'No registry-installed bundles to update.',
        checkingList: 'Asking the registry…',
        statusChecking: 'Checking',
        statusCurrent: 'Up to date',
        statusUpdating: 'Updating…',
        statusUpdated: 'Updated',
        statusRestart: 'Updated — restart DSH NEXT to load',
        statusSkipped: 'Skipped',
        statusFailed: 'Failed',
        stepChecking: 'Verifying the release',
        stepRemoving: 'Removing the old version',
        stepInstalling: 'Installing the new version',
        stepRestoring: 'Restoring the previous version',
        rolledBack: 'rolled back to {version}',
        claimedElsewhere: 'Another DSH window is already running the update.',
        appFailedBefore: 'Version {version} did not install last time.',
        installAgain: 'Install again',
        appLockHint: 'If the installer reports that it cannot replace the folder, quit DSH NEXT and any program holding DSH NEXT.exe open — a browser-extension host, an Explorer window — then retry.',
        reasonGit: 'Installed from a Git commit',
        reasonNotUpdatable: 'Not updatable from a registry',
        reasonNotFound: 'Not found in the registry',
        reasonNetwork: 'Registry unreachable',
        reasonUnknown: 'Registry check failed',
        pluginManagerMissing: 'Plugin management is unavailable in this window.',
        appInstallingSoon: 'Update downloaded — installing and restarting in a few seconds…',
        timeoutLabel: 'timed out',
        unknownLabel: 'unknown failure',
        prefPlugins: 'Update installed plugins on launch',
        prefApp: 'Update DSH NEXT on launch',
        prefAppInstall: 'Install app updates and restart automatically',
        prefPrerelease: 'Include pre-release plugin versions',
        footer: 'A plugin update applies right away; an app update restarts DSH NEXT. Launch runs happen at most every six hours.',
        runManual: 'manual',
        runAuto: 'automatic',
        pluginError: 'Plugin updates could not complete: {reason}',
        notChecked: 'Not checked yet',
      },
      zh: {
        panel: '自动更新',
        title: '自动更新',
        subtitle: '打开应用时更新已安装的插件，以及 DSH NEXT 自身。',
        checkNow: '立即检查',
        running: '正在处理…',
        neverRun: '尚未运行',
        lastRun: '上次运行：{when}',
        skippedRecent: '上次运行刚结束，本次启动已跳过。',
        appSection: 'DSH NEXT',
        pluginsSection: '插件',
        prefsSection: '选项',
        currentVersion: '已安装版本 {version}',
        versionUnknown: '版本未知',
        appIdle: '尚未检查',
        appChecking: '正在检查新版本…',
        appCurrent: '已是最新版本',
        appAvailable: '发现新版本 {version}',
        appDownloading: '正在下载版本 {version} — {percent}%',
        appDownloadingUnknown: '正在下载版本 {version}…',
        appReady: '版本 {version} 已下载',
        appInstalling: '正在安装版本 {version} 并重启…',
        appManual: '此安装方式需手动更新，请到发布页下载版本 {version}。',
        appError: '更新未能完成（{reason}）。',
        appUnsupported: '应用自身的更新只在 DSH NEXT 桌面应用中执行；当前窗口只能更新插件。',
        appDisabled: '应用更新已在下方关闭。',
        installNow: '安装并重启',
        releasePage: '打开发布页',
        none: '没有需要更新的注册表插件。',
        checkingList: '正在向注册表查询…',
        statusChecking: '检查中',
        statusCurrent: '已是最新',
        statusUpdating: '更新中',
        statusUpdated: '已更新',
        statusRestart: '已更新，重启 DSH NEXT 后加载',
        statusSkipped: '已跳过',
        statusFailed: '失败',
        stepChecking: '正在核对版本',
        stepRemoving: '正在移除旧版本',
        stepInstalling: '正在安装新版本',
        stepRestoring: '正在恢复旧版本',
        rolledBack: '已回滚到 {version}',
        claimedElsewhere: '另一个 DSH 窗口正在执行更新。',
        appFailedBefore: '版本 {version} 上次没有安装成功。',
        installAgain: '再次安装',
        appLockHint: '安装器提示无法替换目录时，先退出 DSH NEXT，以及那些占用 DSH NEXT.exe 的程序（浏览器扩展宿主、资源管理器窗口），再重试。',
        reasonGit: '由 Git 提交安装',
        reasonNotUpdatable: '无法从注册表更新',
        reasonNotFound: '注册表中未找到',
        reasonNetwork: '无法连接注册表',
        reasonUnknown: '注册表检查失败',
        pluginManagerMissing: '当前窗口无法管理插件。',
        appInstallingSoon: '更新已下载，几秒后自动安装并重启…',
        timeoutLabel: '超时',
        unknownLabel: '未知错误',
        prefPlugins: '启动时自动更新已安装的插件',
        prefApp: '启动时自动更新 DSH NEXT',
        prefAppInstall: '自动安装应用更新并重启',
        prefPrerelease: '包含插件的预发布版本',
        footer: '插件更新立即生效；应用更新会重启 DSH NEXT。启动运行最多每六小时一次。',
        runManual: '手动',
        runAuto: '自动',
        pluginError: '插件更新未能完成：{reason}',
        notChecked: '尚未检查',
      },
    }

    /** Resolve after `ms`; every timer the controller keeps is cancelled with it. */
    function delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    }

    /** Read one line of failure text out of anything a Remote or the shell throws. */
    function failureText(error) {
      if (error === undefined || error === null) return 'unknown'
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message !== '') return error.message
      return String(error)
    }

    /** Whether a registry version carries a semver pre-release suffix. */
    function isPrerelease(version) {
      return typeof version === 'string' && version.indexOf('-') > 0
    }

    /**
     * Read one Remote answer: the Client face resolves every call to an
     * `{ ok, value }` / `{ ok, error }` envelope instead of rejecting.
     * @param result - the envelope a `ctx.remote` method resolved to.
     * @returns the business value.
     * @throws {Error} carrying the Remote failure's own message.
     */
    function remoteValue(result) {
      if (result !== null && typeof result === 'object' && result.ok === true) return result.value
      const failure = result !== null && typeof result === 'object' && result.error !== undefined ? result.error : result
      throw new Error(failureText(failure))
    }

    /** Read the persisted preferences and last report, tolerating absent or broken storage. */
    function readStored() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null) return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /** Persist the preferences and last report; a storage failure stays silent. */
    function writeStored(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch {
        // A window without storage keeps the run in memory only.
      }
    }

    /**
     * The desktop shell's own update bridge, present only inside the DSH NEXT
     * window. The shell exposes `command`/`state` on `desktopNext`; `dshDesktop`
     * carries only the browser, keyboard and file bridges.
     */
    function desktopBridge() {
      if (typeof window === 'undefined') return undefined
      for (const candidate of [window.desktopNext, window.dshDesktop]) {
        if (candidate !== null && typeof candidate === 'object'
          && typeof candidate.command === 'function' && typeof candidate.state === 'function') return candidate
      }
      return undefined
    }

    /** Read the desktop state, treating a failed call as absent. */
    async function readDesktopState(bridge) {
      try {
        return await bridge.state()
      } catch {
        return undefined
      }
    }

    /** The empty app section for one run. */
    function emptyApp() {
      return { supported: null, current: null, phase: 'idle', version: null, percent: null, error: null }
    }

    /**
     * Rebuild the app section from the persisted report: a settled result from a
     * recent run stays visible after a reload, while a transitional phase (a
     * download or install the reload interrupted) falls back to "not checked".
     * @param report - the report stored by the last run, if any.
     * @returns the app section the page opens with.
     */
    function hydrateApp(report) {
      const empty = emptyApp()
      if (report === null || typeof report !== 'object' || report.app === null || typeof report.app !== 'object') return empty
      const stored = { ...empty, ...report.app }
      const settled = stored.phase === 'current' || stored.phase === 'error' || stored.phase === 'manual' || stored.phase === 'unsupported' || stored.phase === 'disabled'
      const recent = typeof report.finishedAt === 'number' && Date.now() - report.finishedAt < RUN_INTERVAL_MS
      return { ...stored, phase: settled && recent ? stored.phase : 'idle' }
    }

    /**
     * Create the controller for one attached page: it owns the report, the
     * launch run, and the only writes to the two external systems.
     * @param ctx - the browser plugin context.
     */
    function createController(ctx) {
      const stored = readStored()
      const prefs = { ...DEFAULT_PREFS, ...(stored.prefs !== null && typeof stored.prefs === 'object' ? stored.prefs : {}) }
      const storedReport = stored.report !== null && typeof stored.report === 'object' ? stored.report : null

      let state = {
        phase: 'idle',
        reason: null,
        startedAt: null,
        finishedAt: storedReport !== null && typeof storedReport.finishedAt === 'number' ? storedReport.finishedAt : null,
        note: null,
        app: hydrateApp(storedReport),
        plugins: storedReport !== null && Array.isArray(storedReport.plugins) ? storedReport.plugins : [],
        prefs,
        localeRevision: ctx.locale.getSnapshot().revision,
      }
      const listeners = new Set()
      let launchTimer = null
      /** Update request id → bundle name, so the Host's step events name a row. */
      const updateRequests = new Map()
      /**
       * What survives a reload besides the report: the app install this window
       * started, and the version whose install failed, so a launch run does not
       * repeat a doomed install of the same release.
       */
      const memory = {
        pendingInstall: stored.pendingInstall !== null && typeof stored.pendingInstall === 'object' && typeof stored.pendingInstall.version === 'string'
          ? stored.pendingInstall
          : null,
        failedInstall: stored.failedInstall !== null && typeof stored.failedInstall === 'object' && typeof stored.failedInstall.version === 'string'
          ? stored.failedInstall
          : null,
      }

      /** Merge a change into the stored record, keeping every other field. */
      function saveRecord(change) {
        const current = readStored()
        writeStored({ ...current, ...change })
      }

      /** Publish a new immutable snapshot and wake every subscriber. */
      function patch(next) {
        state = next
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch {
            // One broken subscriber must not stop the others.
          }
        }
      }

      /** Merge a shallow change into the current snapshot. */
      function update(change) {
        patch({ ...state, ...change })
      }

      /** Merge a change into the app section. */
      function patchApp(change) {
        update({ app: { ...state.app, ...change } })
      }

      /** Replace one plugin row, preserving its position. */
      function patchPlugin(name, change) {
        update({ plugins: state.plugins.map(row => (row.name === name ? { ...row, ...change } : row)) })
      }

      /** Persist the preferences and the current report. */
      function persist() {
        saveRecord({
          prefs: state.prefs,
          report: {
            finishedAt: state.finishedAt,
            startedAt: state.startedAt,
            note: state.note,
            app: state.app,
            plugins: state.plugins,
          },
        })
      }

      /** Compare two release strings, ignoring a leading `v`. */
      function sameVersion(left, right) {
        if (typeof left !== 'string' || typeof right !== 'string') return false
        const normalize = value => value.trim().replace(/^v/iu, '')
        return normalize(left) === normalize(right) && normalize(left) !== ''
      }

      /**
       * Settle the install this window started before the page was replaced: an
       * unchanged running version means the installer could not replace the
       * folder, so that release must not be auto-installed again.
       * @param installed - the version the running app reports, if known.
       */
      function settlePendingInstall(installed) {
        if (memory.pendingInstall === null) return
        if (installed !== null && sameVersion(memory.pendingInstall.version, installed)) {
          memory.pendingInstall = null
          memory.failedInstall = null
          saveRecord({ pendingInstall: null, failedInstall: null })
          return
        }
        memory.failedInstall = { version: memory.pendingInstall.version, at: memory.pendingInstall.at, error: 'unchanged' }
        memory.pendingInstall = null
        saveRecord({ pendingInstall: null, failedInstall: memory.failedInstall })
      }

      /** Remember that this window asked the shell to install `version`. */
      function rememberInstall(version) {
        memory.pendingInstall = { version, at: Date.now() }
        saveRecord({ pendingInstall: memory.pendingInstall })
      }

      /** Forget a failed install once the user asks for it again. */
      function forgetFailure(version) {
        if (memory.failedInstall === null) return
        if (version !== null && version !== undefined && !sameVersion(memory.failedInstall.version, version)) return
        memory.failedInstall = null
        saveRecord({ failedInstall: null })
      }

      /** Resolve one dictionary key in the active language, falling back to English. */
      function t(key, params) {
        const active = ctx.locale.getSnapshot().active
        const dict = DICTS[active] || DICTS.en
        const raw = typeof dict[key] === 'string' ? dict[key] : typeof DICTS.en[key] === 'string' ? DICTS.en[key] : key
        if (params === undefined) return raw
        return raw.replace(/\{(\w+)\}/g, (match, name) => (params[name] === undefined ? match : String(params[name])))
      }

      /** Format a stored timestamp, or say that nothing has run yet. */
      function whenText(timestamp) {
        if (typeof timestamp !== 'number') return t('neverRun')
        try {
          return new Date(timestamp).toLocaleString()
        } catch {
          return String(timestamp)
        }
      }

      /** Pick the newest installable registry version, honouring the pre-release switch. */
      function pickVersion(list, installed, settings) {
        const allowPrerelease = settings.prerelease === true || isPrerelease(installed)
        for (const candidate of list.versions) {
          if (candidate.bundle === false) continue
          if (candidate.deprecated !== undefined) continue
          if (candidate.incompatible !== undefined) continue
          if (candidate.prerelease === true && !allowPrerelease) continue
          return candidate
        }
        return null
      }

      /**
       * Update every registry bundle the profile installed, one at a time so the
       * package manager never runs two installs at once.
       */
      async function updatePlugins() {
        const remote = ctx.remote === undefined ? undefined : ctx.remote.pluginManager
        if (remote === undefined) {
          update({ plugins: [], note: t('pluginManagerMissing') })
          return
        }
        let bundles
        try {
          const listed = remoteValue(await remote.listBundles())
          if (!Array.isArray(listed)) throw new Error('pluginManager.listBundles returned no list')
          bundles = listed
        } catch (error) {
          update({ plugins: [], note: failureText(error) })
          return
        }
        const candidates = bundles.filter(bundle =>
          bundle.installed === true
          && bundle.name !== OWN_PACKAGE
          && (bundle.update === 'registry' || bundle.update === 'git'))
        update({
          plugins: candidates.map(bundle => ({
            name: bundle.name,
            from: typeof bundle.version === 'string' ? bundle.version : null,
            to: null,
            status: bundle.update === 'git' ? 'skipped' : 'checking',
            reason: bundle.update === 'git' ? 'git' : null,
            note: null,
          })),
        })
        for (const bundle of candidates) {
          if (bundle.update !== 'registry') continue
          let list
          try {
            // The generated Remote takes every business argument before its
            // optional signal; `{}` asks the Host's own registry plan.
            list = remoteValue(await remote.listVersions(bundle.name, {}))
          } catch (error) {
            patchPlugin(bundle.name, { status: 'failed', note: failureText(error) })
            continue
          }
          if (list === null || typeof list !== 'object' || list.status !== 'listed') {
            patchPlugin(bundle.name, {
              status: 'skipped',
              reason: list !== null && typeof list === 'object' && typeof list.problem === 'string' ? list.problem : 'unknown',
            })
            continue
          }
          const pick = pickVersion(list, list.installed, state.prefs)
          if (pick === null) {
            patchPlugin(bundle.name, { status: 'current', to: list.installed })
            continue
          }
          patchPlugin(bundle.name, { status: 'updating', to: pick.version, step: null })
          const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          updateRequests.set(requestId, bundle.name)
          try {
            const result = remoteValue(await remote.updateBundle(bundle.name, pick.version, { requestId }))
            const application = result !== undefined && result !== null && result.result !== undefined ? result.result.application : undefined
            const restore = result !== undefined && result !== null && result.restore !== undefined ? result.restore : null
            const restoredTo = restore !== null && restore.application === 'applied'
              ? restore.version !== undefined && restore.version !== null ? restore.version : result.from
              : null
            if (application === 'applied') {
              patchPlugin(bundle.name, { status: 'updated', to: pick.version, step: null })
            } else if (application === 'restart-required') {
              patchPlugin(bundle.name, { status: 'restart', to: pick.version, step: null })
            } else {
              const reason = result !== undefined && result !== null && result.result !== undefined && result.result.error !== undefined
                ? result.result.error.message
                : application
              patchPlugin(bundle.name, { status: 'failed', step: null, note: failureText(reason), restoredTo })
            }
          } catch (error) {
            patchPlugin(bundle.name, { status: 'failed', step: null, note: failureText(error) })
          } finally {
            updateRequests.delete(requestId)
          }
          persist()
        }
      }

      /** Wait until the desktop updater reaches an accepted phase, or the bound expires. */
      async function waitForUpdatePhase(bridge, accept, timeoutMs, onTick) {
        const deadline = Date.now() + timeoutMs
        let snapshot
        for (;;) {
          const desktop = await readDesktopState(bridge)
          snapshot = desktop === undefined ? undefined : desktop.updates
          if (onTick !== undefined) onTick(snapshot)
          if (snapshot !== undefined && accept(snapshot)) return snapshot
          if (Date.now() > deadline) return snapshot
          await delay(900)
        }
      }

      /**
       * Check, download, and (by preference) install the DSH NEXT update through
       * the shell.
       * @param reason - 'launch' refuses to repeat an install that already failed.
       */
      async function updateApp(reason) {
        const bridge = desktopBridge()
        if (bridge === undefined) {
          patchApp({ supported: false, phase: 'unsupported' })
          return
        }
        patchApp({ supported: true })
        const initial = await readDesktopState(bridge)
        const installed = initial !== undefined && typeof initial.version === 'string' ? initial.version : null
        patchApp({ current: installed })
        settlePendingInstall(installed)

        let snapshot = initial === undefined ? undefined : initial.updates
        if (snapshot === undefined || snapshot.phase === 'idle' || snapshot.phase === 'error') {
          patchApp({ phase: 'checking' })
          try {
            await bridge.command({ type: 'check-updates' })
          } catch (error) {
            patchApp({ phase: 'error', error: failureText(error) })
            return
          }
          snapshot = await waitForUpdatePhase(
            bridge,
            candidate => candidate.phase !== 'checking' && candidate.phase !== 'idle',
            60 * 1000,
            candidate => {
              if (candidate === undefined) return
              patchApp({ phase: candidate.phase, version: candidate.version || null })
            },
          )
        }
        if (snapshot === undefined) {
          patchApp({ phase: 'error', error: t('timeoutLabel') })
          return
        }
        const version = typeof snapshot.version === 'string' ? snapshot.version : null
        if (snapshot.phase === 'error') {
          patchApp({ phase: 'error', error: snapshot.error === undefined || snapshot.error === null ? t('unknownLabel') : failureText(snapshot.error) })
          return
        }
        if (snapshot.phase === 'current') {
          patchApp({ phase: 'current', version })
          return
        }
        if (snapshot.phase !== 'available' && snapshot.phase !== 'downloading' && snapshot.phase !== 'ready') {
          patchApp({ phase: snapshot.phase, version })
          return
        }
        patchApp({ phase: snapshot.phase, version })
        // The shell's own comparison can offer the running release again; never
        // reinstall a version this app already runs.
        if (sameVersion(version, installed)) {
          patchApp({ phase: 'current', version: installed })
          return
        }
        if (snapshot.installable !== true) {
          patchApp({ phase: 'manual', version })
          return
        }
        // A launch run never repeats an install that did not take effect; the
        // panel keeps it visible with a retry instead.
        if (reason !== 'manual' && memory.failedInstall !== null && sameVersion(version, memory.failedInstall.version)) {
          patchApp({ phase: 'failedBefore', version })
          return
        }
        if (snapshot.phase !== 'ready') {
          try {
            await bridge.command({ type: 'download-update' })
          } catch (error) {
            patchApp({ phase: 'error', error: failureText(error) })
            return
          }
          snapshot = await waitForUpdatePhase(
            bridge,
            candidate => candidate.phase === 'ready' || candidate.phase === 'error',
            30 * 60 * 1000,
            candidate => {
              if (candidate === undefined) return
              const percent = typeof candidate.total === 'number' && candidate.total > 0
                ? Math.min(100, Math.floor((candidate.received || 0) / candidate.total * 100))
                : null
              patchApp({ phase: candidate.phase, version: candidate.version || version, percent })
            },
          )
        }
        if (snapshot === undefined || snapshot.phase !== 'ready') {
          patchApp({ phase: 'error', error: snapshot === undefined ? t('timeoutLabel') : failureText(snapshot.error) })
          return
        }
        patchApp({ phase: 'ready', percent: 100 })
        persist()
        if (state.prefs.appInstall !== true) return
        patchApp({ phase: 'installing' })
        rememberInstall(version)
        persist()
        await delay(4000)
        try {
          await bridge.command({ type: 'install-update' })
        } catch (error) {
          patchApp({ phase: 'error', error: failureText(error) })
        }
      }

      /** Install the already-downloaded app update on request; a second click while it installs is ignored. */
      async function installAppNow() {
        const bridge = desktopBridge()
        if (bridge === undefined || state.app.phase === 'installing') return
        // An explicit retry clears the block for this release.
        const target = typeof state.app.version === 'string' ? state.app.version : null
        forgetFailure(target)
        patchApp({ phase: 'installing' })
        rememberInstall(target)
        persist()
        try {
          await bridge.command({ type: 'install-update' })
        } catch (error) {
          patchApp({ phase: 'error', error: failureText(error) })
        }
      }

      /** Open the release page for a build with no in-app installer. */
      function openReleasePage() {
        try {
          window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')
        } catch {
          // A blocked popup leaves the panel as the only surface.
        }
      }

      let running = false

      /**
       * Claim this window's run in shared storage before touching the profile, so
       * two DSH windows never run the package manager at the same time. The claim
       * is a token the winner reads back after a short settle window.
       * @param startedAt - the attempt's timestamp, also the next launch's floor.
       * @returns whether this window won the claim.
       */
      async function claimRun(startedAt) {
        const token = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`
        const stored = readStored()
        writeStored({
          ...stored,
          prefs: state.prefs,
          lastAttemptAt: startedAt,
          claim: token,
          report: stored.report !== undefined ? stored.report : { finishedAt: state.finishedAt },
        })
        await delay(150)
        return readStored().claim === token
      }

      /**
       * Record the Host's step for an update request this window started.
       * @param progress - one `plugin-manager/update-state` event.
       */
      function updateProgress(progress) {
        if (progress === null || typeof progress !== 'object') return
        const name = updateRequests.get(progress.requestId)
        if (name === undefined) return
        patchPlugin(name, { step: typeof progress.step === 'string' ? progress.step : null })
      }

      /**
       * Run one pass over plugins and then the app.
       * @param reason - 'launch' is recorded so the panel can label the run.
       */
      async function run(reason) {
        if (running) return
        running = true
        const startedAt = Date.now()
        if (!(await claimRun(startedAt))) {
          running = false
          update({ note: 'claimed-elsewhere' })
          return
        }
        update({ phase: 'running', reason, startedAt, finishedAt: null, note: null, app: emptyApp(), plugins: [] })
        try {
          if (state.prefs.plugins === true) {
            try {
              await updatePlugins()
            } catch (error) {
              update({ note: failureText(error) })
            }
          }
          if (state.prefs.app === true) {
            try {
              await updateApp(reason)
            } catch (error) {
              patchApp({ phase: 'error', error: failureText(error) })
            }
          } else {
            patchApp({ phase: 'disabled', supported: desktopBridge() !== undefined })
          }
        } finally {
          running = false
          update({ phase: 'done', finishedAt: Date.now() })
          persist()
          collectFacts()
        }
      }

      /** One line per run in the browser console and the Host diagnostics, for support. */
      function collectFacts() {
        try {
          const updated = state.plugins.filter(row => row.status === 'updated' || row.status === 'restart').length
          const failed = state.plugins.filter(row => row.status === 'failed').length
          console.log(`[auto-update] run ${state.reason || 'unknown'}: ${updated} plugin update(s), ${failed} failure(s), app ${state.app.phase}`)
        } catch {
          // Diagnostics must never decide the run.
        }
      }

      /** Start the launch run once, after the page has settled. */
      function scheduleLaunchRun() {
        if (launchTimer !== null) return
        const storedState = readStored()
        const now = Date.now()
        const lastAttempt = typeof storedState.lastAttemptAt === 'number' ? storedState.lastAttemptAt : null
        if (typeof state.finishedAt === 'number' && now - state.finishedAt < RUN_INTERVAL_MS) {
          update({ note: 'skipped-recent' })
          patchApp({ supported: desktopBridge() !== undefined })
          console.log('[auto-update] launch: skipped, the last run finished within six hours')
          return
        }
        // An interrupted attempt (a reload during the run) resumes once the floor
        // has passed instead of being dropped for the whole interval.
        const attemptWait = lastAttempt === null ? 0 : Math.max(0, RETRY_FLOOR_MS - (now - lastAttempt))
        if (attemptWait > 0) {
          console.log(`[auto-update] launch: resuming in ${Math.ceil(attemptWait / 1000)}s after an interrupted run`)
          launchTimer = window.setTimeout(() => {
            launchTimer = null
            scheduleLaunchRun()
          }, attemptWait + 1000)
          return
        }
        console.log('[auto-update] launch: run scheduled')
        launchTimer = window.setTimeout(() => {
          launchTimer = null
          void run('launch')
        }, LAUNCH_DELAY_MS)
      }

      /** Turn one preference on or off. */
      function setPreference(key, value) {
        const nextPrefs = { ...state.prefs, [key]: value }
        patch({ prefs: nextPrefs })
        writeStored({ ...readStored(), prefs: nextPrefs })
        if (key === 'appInstall' && value === false && state.app.phase === 'installing') patchApp({ phase: 'ready' })
      }

      return {
        getSnapshot: () => state,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        t,
        whenText,
        run,
        scheduleLaunchRun,
        installAppNow,
        openReleasePage,
        setPreference,
        updateProgress,
        /** Re-render after a language switch without touching the report. */
        relocalized(revision) {
          if (revision === state.localeRevision) return
          update({ localeRevision: revision })
        },
        dispose() {
          if (launchTimer !== null) {
            window.clearTimeout(launchTimer)
            launchTimer = null
          }
          listeners.clear()
        },
      }
    }

    /** The page's own styles; unmounting the page removes them. */
    function styles() {
      return h('style', { key: 'styles' }, `
        .dsh-next-auto-update-root { height: 100%; overflow: auto; padding: 20px 24px 40px; color: var(--dsw-alias-label-primary); }
        .dsh-next-auto-update-inner { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
        .dsh-next-auto-update-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .dsh-next-auto-update-head-text { min-width: 0; }
        .dsh-next-auto-update-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }
        .dsh-next-auto-update-sub { margin: 2px 0 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
        .dsh-next-auto-update-meta { margin: 2px 0 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
        .dsh-next-auto-update-card { border: 0.5px solid var(--dsw-alias-settings-card-stroke); border-radius: var(--dsw-radius-xl); background: var(--dsw-alias-settings-card-fill); padding: 12px 16px; }
        .dsh-next-auto-update-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
        .dsh-next-auto-update-card-title { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
        .dsh-next-auto-update-hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
        .dsh-next-auto-update-bad { color: var(--dsw-alias-state-error-primary); }
        .dsh-next-auto-update-body { font-size: 13px; line-height: 20px; display: flex; flex-direction: column; gap: 8px; }
        .dsh-next-auto-update-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; overflow-wrap: anywhere; }
        .dsh-next-auto-update-dot { width: 8px; height: 8px; border-radius: 50%; corner-shape: round; flex: none; background: var(--dsw-alias-state-idle-primary); }
        .dsh-next-auto-update-dot[data-tone="busy"] { background: var(--dsw-alias-brand-primary); }
        .dsh-next-auto-update-dot[data-tone="ok"] { background: var(--dsw-alias-state-success-primary); }
        .dsh-next-auto-update-dot[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
        .dsh-next-auto-update-dot[data-tone="bad"] { background: var(--dsw-alias-state-error-primary); }
        .dsh-next-auto-update-button { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 10px; border: 0.5px solid transparent; border-radius: var(--dsw-radius-sm); box-shadow: inset 0 0 0 var(--dsh-hairline-width, 0.5px) var(--dsh-button-outline-color, var(--dsw-alias-border-l3)); background: transparent; color: var(--dsw-alias-label-primary); font-family: inherit; font-size: 12px; line-height: 18px; white-space: nowrap; cursor: pointer; }
        .dsh-next-auto-update-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
        .dsh-next-auto-update-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
        .dsh-next-auto-update-button:disabled { cursor: not-allowed; opacity: 0.4; }
        .dsh-next-auto-update-button:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
        .dsh-next-auto-update-button[data-primary="true"] { border: 0; box-shadow: none; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
        .dsh-next-auto-update-button[data-primary="true"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
        .dsh-next-auto-update-rows { display: flex; flex-direction: column; }
        .dsh-next-auto-update-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 2px 12px; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; line-height: 20px; }
        .dsh-next-auto-update-row:first-child { border-top: 0; }
        .dsh-next-auto-update-row-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
        .dsh-next-auto-update-name { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dsh-next-auto-update-version { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
        .dsh-next-auto-update-detail { grid-column: 1 / -1; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
        .dsh-next-auto-update-state { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
        .dsh-next-auto-update-state[data-tone="busy"] { color: var(--dsw-alias-brand-primary); }
        .dsh-next-auto-update-state[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }
        .dsh-next-auto-update-state[data-tone="bad"] { color: var(--dsw-alias-state-error-primary); }
        .dsh-next-auto-update-state[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
        .dsh-next-auto-update-pref { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 36px; font-size: 13px; line-height: 20px; border-top: 1px solid var(--dsw-alias-border-l1); }
        .dsh-next-auto-update-pref:first-child { border-top: 0; }
        .dsh-next-auto-update-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-border-l3); cursor: pointer; }
        .dsh-next-auto-update-switch[aria-checked="true"] { background: var(--dsw-alias-brand-primary); }
        .dsh-next-auto-update-switch:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
        .dsh-next-auto-update-knob { display: block; width: 16px; height: 16px; border-radius: 50%; corner-shape: round; background: var(--dsw-alias-switch-thumb); transition: transform 120ms ease; }
        .dsh-next-auto-update-switch[aria-checked="true"] .dsh-next-auto-update-knob { transform: translateX(16px); background: var(--dsw-alias-label-primary-foreground); }
        .dsh-next-auto-update-footer { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin: 0; }
      `)
    }

    /** The switch every preference row uses. */
    function Switch({ checked, label, onToggle }) {
      return h('button', {
        type: 'button',
        className: 'dsh-next-auto-update-switch',
        role: 'switch',
        'aria-checked': checked === true ? 'true' : 'false',
        'aria-label': label,
        onClick: onToggle,
      }, h('span', { className: 'dsh-next-auto-update-knob' }))
    }

    /** The sidebar's entry glyph: a ring around a downward arrow, in the sidebar's own color. */
    function AutoUpdateIcon({ size }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
      h('circle', { cx: 18, cy: 18, r: 8.6, stroke: 'currentColor', strokeWidth: 2.6 }),
      h('path', { d: 'M18 12.6 18 22.5', stroke: 'currentColor', strokeWidth: 2.7, strokeLinecap: 'round' }),
      h('path', { d: 'M14 18.5 18 22.8 22 18.5', stroke: 'currentColor', strokeWidth: 2.7, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    /** One plugin row: name, the version move, and the status word. */
    function PluginRow({ row, t }) {
      const tone = row.status === 'updated' || row.status === 'current'
        ? 'ok'
        : row.status === 'failed'
          ? 'bad'
          : row.status === 'restart'
            ? 'warn'
            : row.status === 'checking' || row.status === 'updating'
              ? 'busy'
              : undefined
      const statusKey = {
        checking: 'statusChecking',
        current: 'statusCurrent',
        updating: 'statusUpdating',
        updated: 'statusUpdated',
        restart: 'statusRestart',
        skipped: 'statusSkipped',
        failed: 'statusFailed',
      }[row.status] || 'statusChecking'
      const reasonKey = {
        git: 'reasonGit',
        'not-updatable': 'reasonNotUpdatable',
        'not-found': 'reasonNotFound',
        network: 'reasonNetwork',
        unknown: 'reasonUnknown',
      }[row.reason]
      const explanation = reasonKey !== undefined ? t(reasonKey) : row.reason !== null && row.reason !== undefined ? String(row.reason) : ''
      const stepKey = {
        checking: 'stepChecking',
        removing: 'stepRemoving',
        installing: 'stepInstalling',
        restoring: 'stepRestoring',
      }[row.step]
      const stepText = stepKey !== undefined ? t(stepKey) : ''
      const rollbackText = row.restoredTo !== null && row.restoredTo !== undefined ? t('rolledBack', { version: row.restoredTo }) : ''
      const move = row.to !== null && row.to !== undefined && row.to !== row.from
        ? `${row.from || '?'} → ${row.to}`
        : row.from || ''
      const extra = [stepText, explanation, rollbackText, row.note]
        .filter(part => part !== null && part !== undefined && part !== '')
        .join(' · ')
      return h('div', { className: 'dsh-next-auto-update-row' },
        h('div', { className: 'dsh-next-auto-update-row-main' },
          h('span', { className: 'dsh-next-auto-update-name', title: row.name }, row.name),
          move !== '' ? h('span', { className: 'dsh-next-auto-update-version' }, move) : null),
        h('span', { className: 'dsh-next-auto-update-state', 'data-tone': tone }, t(statusKey)),
        extra !== '' ? h('span', { className: 'dsh-next-auto-update-detail' }, extra) : null)
    }

    /** The Auto update page in the main column. */
    function AutoUpdatePage({ controller }) {
      const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      const t = controller.t
      const app = snapshot.app
      const running = snapshot.phase === 'running'

      const appText = (() => {
        switch (app.phase) {
          case 'unsupported': return t('appUnsupported')
          case 'disabled': return t('appDisabled')
          case 'checking': return t('appChecking')
          case 'current': return t('appCurrent')
          case 'available': return t('appAvailable', { version: app.version || '?' })
          case 'downloading':
            return app.percent === null || app.percent === undefined
              ? t('appDownloadingUnknown', { version: app.version || '?' })
              : t('appDownloading', { version: app.version || '?', percent: app.percent })
          case 'ready': return t('appReady', { version: app.version || '?' })
          case 'installing': return t('appInstalling', { version: app.version || '?' })
          case 'manual': return t('appManual', { version: app.version || '?' })
          case 'failedBefore': return t('appFailedBefore', { version: app.version || '?' })
          case 'error': return t('appError', { reason: app.error || 'unknown' })
          default: return t('appIdle')
        }
      })()
      const appTone = app.phase === 'current'
        ? 'ok'
        : app.phase === 'error' || app.phase === 'failedBefore'
          ? 'bad'
          : app.phase === 'checking' || app.phase === 'downloading' || app.phase === 'installing'
            ? 'busy'
            : app.phase === 'ready' || app.phase === 'available' || app.phase === 'manual'
              ? 'warn'
              : undefined

      return h('div', { className: 'dsh-next-auto-update-root' },
        styles(),
        h('div', { className: 'dsh-next-auto-update-inner' },
          h('div', { className: 'dsh-next-auto-update-head' },
            h('div', { className: 'dsh-next-auto-update-head-text' },
              h('h1', { className: 'dsh-next-auto-update-title' }, t('title')),
              h('p', { className: 'dsh-next-auto-update-sub' }, t('subtitle')),
              h('p', { className: 'dsh-next-auto-update-meta' },
                snapshot.finishedAt !== null && snapshot.finishedAt !== undefined
                  ? `${t('lastRun', { when: controller.whenText(snapshot.finishedAt) })} · ${snapshot.reason === 'manual' ? t('runManual') : t('runAuto')}`
                  : t('neverRun'))),
            h('button', {
              type: 'button',
              className: 'dsh-next-auto-update-button',
              'data-primary': 'true',
              disabled: running,
              onClick: () => { void controller.run('manual') },
            }, running ? t('running') : t('checkNow'))),

          snapshot.note === 'skipped-recent'
            ? h('div', { className: 'dsh-next-auto-update-hint', 'aria-live': 'polite' }, t('skippedRecent'))
            : snapshot.note === 'claimed-elsewhere'
              ? h('div', { className: 'dsh-next-auto-update-hint', 'aria-live': 'polite' }, t('claimedElsewhere'))
              : snapshot.note !== null && snapshot.note !== undefined
                ? h('div', { className: 'dsh-next-auto-update-hint dsh-next-auto-update-bad', 'aria-live': 'polite' }, t('pluginError', { reason: snapshot.note }))
                : null,

          h('section', { className: 'dsh-next-auto-update-card' },
            h('div', { className: 'dsh-next-auto-update-card-head' },
              h('h2', { className: 'dsh-next-auto-update-card-title' }, t('appSection'))),
            h('div', { className: 'dsh-next-auto-update-body' },
              h('div', { className: 'dsh-next-auto-update-line', role: 'status', 'aria-live': 'polite' },
                h('span', { className: 'dsh-next-auto-update-dot', 'data-tone': appTone }),
                h('span', null, appText)),
              h('div', { className: 'dsh-next-auto-update-hint' },
                app.current !== null && app.current !== undefined
                  ? t('currentVersion', { version: app.current })
                  : t('versionUnknown')),
              app.phase === 'ready' || app.phase === 'failedBefore'
                ? app.phase === 'ready' && snapshot.prefs.appInstall === true
                  ? h('div', { className: 'dsh-next-auto-update-hint' }, t('appInstallingSoon'))
                  : h('div', { className: 'dsh-next-auto-update-line' },
                      h('button', {
                        type: 'button',
                        className: 'dsh-next-auto-update-button',
                        'data-primary': 'true',
                        onClick: () => { void controller.installAppNow() },
                      }, app.phase === 'failedBefore' ? t('installAgain') : t('installNow')),
                      app.phase === 'failedBefore'
                        ? h('button', {
                            type: 'button',
                            className: 'dsh-next-auto-update-button',
                            onClick: () => { controller.openReleasePage() },
                          }, t('releasePage'))
                        : null)
                : null,
              app.phase === 'failedBefore'
                ? h('div', { className: 'dsh-next-auto-update-hint' }, t('appLockHint'))
                : null,
              app.phase === 'manual'
                ? h('div', { className: 'dsh-next-auto-update-line' },
                    h('button', {
                      type: 'button',
                      className: 'dsh-next-auto-update-button',
                      onClick: () => { controller.openReleasePage() },
                    }, t('releasePage')))
                : null)),

          h('section', { className: 'dsh-next-auto-update-card', 'aria-busy': running ? 'true' : 'false' },
            h('div', { className: 'dsh-next-auto-update-card-head' },
              h('h2', { className: 'dsh-next-auto-update-card-title' }, t('pluginsSection')),
              h('span', { className: 'dsh-next-auto-update-hint' }, running ? t('checkingList') : '')),
            snapshot.plugins.length === 0
              ? h('div', { className: 'dsh-next-auto-update-hint' },
                  running
                    ? t('checkingList')
                    : snapshot.finishedAt === null || snapshot.finishedAt === undefined ? t('notChecked') : t('none'))
              : h('div', { className: 'dsh-next-auto-update-rows' },
                  snapshot.plugins.map(row => h(PluginRow, { key: row.name, row, t })))),

          h('section', { className: 'dsh-next-auto-update-card' },
            h('div', { className: 'dsh-next-auto-update-card-head' },
              h('h2', { className: 'dsh-next-auto-update-card-title' }, t('prefsSection'))),
            h('div', null,
              h('div', { className: 'dsh-next-auto-update-pref' },
                h('span', null, t('prefPlugins')),
                h(Switch, {
                  checked: snapshot.prefs.plugins === true,
                  label: t('prefPlugins'),
                  onToggle: () => { controller.setPreference('plugins', snapshot.prefs.plugins !== true) },
                })),
              h('div', { className: 'dsh-next-auto-update-pref' },
                h('span', null, t('prefApp')),
                h(Switch, {
                  checked: snapshot.prefs.app === true,
                  label: t('prefApp'),
                  onToggle: () => { controller.setPreference('app', snapshot.prefs.app !== true) },
                })),
              h('div', { className: 'dsh-next-auto-update-pref' },
                h('span', null, t('prefAppInstall')),
                h(Switch, {
                  checked: snapshot.prefs.appInstall === true,
                  label: t('prefAppInstall'),
                  onToggle: () => { controller.setPreference('appInstall', snapshot.prefs.appInstall !== true) },
                })),
              h('div', { className: 'dsh-next-auto-update-pref' },
                h('span', null, t('prefPrerelease')),
                h(Switch, {
                  checked: snapshot.prefs.prerelease === true,
                  label: t('prefPrerelease'),
                  onToggle: () => { controller.setPreference('prerelease', snapshot.prefs.prerelease !== true) },
                })))),

          h('p', { className: 'dsh-next-auto-update-footer' }, t('footer'))))
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.pluginManager', 'remoteAccess'],

      /**
       * Contribute the sidebar entry and its page, then start the launch run once
       * the current Peer may list the installed bundles.
       * @param ctx - the browser plugin context.
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }), 'auto-update: dictionaries')
        const controller = createController(ctx)
        ctx.effect(() => () => { controller.dispose() }, 'auto-update: controller')
        const offLocale = ctx.locale.subscribe(() => { controller.relocalized(ctx.locale.getSnapshot().revision) })
        ctx.effect(() => offLocale, 'auto-update: locale')

        const contributions = function* () {
          yield ctx.remote.$on('plugin-manager/update-state', progress => { controller.updateProgress(progress) })
          yield ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
            inject: () => ({ controller }),
          }, AutoUpdatePage))
          yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 10,
            label: () => controller.t('panel'),
          }, AutoUpdateIcon))
          controller.scheduleLaunchRun()
        }

        let dispose
        if (ctx.remoteAccess !== undefined && typeof ctx.remoteAccess.whenAccess === 'function') {
          dispose = ctx.remoteAccess.whenAccess('pluginManager/listBundles', contributions)
        } else {
          const iterator = contributions()
          const disposers = []
          for (let step = iterator.next(); !step.done; step = iterator.next()) {
            if (typeof step.value === 'function') disposers.push(step.value)
          }
          dispose = () => {
            for (const disposer of disposers.reverse()) {
              try {
                disposer()
              } catch {
                // Every contribution the gate kept must still be removed.
              }
            }
          }
        }
        ctx.effect(() => dispose, 'auto-update: contributions')
      },
    }
  },
})

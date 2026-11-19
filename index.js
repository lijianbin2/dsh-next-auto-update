/**
 * Host half of dsh-next-auto-update.
 *
 * The browser half only asks the desktop shell to *download* a DSH NEXT update.
 * This half watches the shell's download directory and then installs the package
 * itself, through `scripts/desktop-install.ps1`, started detached: DSH NEXT's own
 * install step cannot replace the folder while Chrome's chrome-bridge
 * native-messaging host runs `DSH NEXT.exe` from inside it (Win32 error 5), and
 * Chrome recreates that host within seconds. The wrapper takes the launcher out of
 * service, ends the app, installs, restores the launcher and reopens the app.
 *
 * The watcher ignores downloads older than this process, so a failed attempt never
 * fires again on the next start; the panel's own rules decide when a download
 * happens at all.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root: this module sits beside `cordis.patch.yml` and `scripts/`. */
const packageDir = dirname(fileURLToPath(import.meta.url))

/** How often the download directory is scanned. */
const POLL_INTERVAL_MS = 2000

/** A file smaller than this is not a finished 350 MB installer. */
const MIN_INSTALLER_BYTES = 50 * 1024 * 1024

/** Launchers the wrapper may have disabled when it was killed mid-install. */
const LAUNCHER_CANDIDATES = [
  join(process.env.USERPROFILE ?? '', '.dsh', 'chrome-bridge', 'host', 'run.bat'),
]

const SUFFIX = '.dsh-auto-update-disabled'

/**
 * Put back a launcher a killed run left disabled, so chrome-bridge keeps working.
 * @param log - the operation log writer.
 */
function restoreLaunchers(log) {
  for (const launcher of LAUNCHER_CANDIDATES) {
    const backup = `${launcher}${SUFFIX}`
    try {
      if (existsSync(backup) && !existsSync(launcher)) {
        renameSync(backup, launcher)
        log(`restored launcher left disabled by an earlier run: ${launcher}`)
      }
    } catch (error) {
      log(`could not restore launcher ${launcher}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * The newest finished installer below the shell's download directory, if it was
 * written after this process started.
 * @param updatesDir - `<home>/electron-user-data/next-updates`.
 * @param notBefore - epoch milliseconds; older files belong to earlier runs.
 * @param stable - per-path size seen by the previous scans, so a file that is
 *   still being written is not mistaken for a finished download.
 * @param settled - how many consecutive scans must report the same size.
 * @returns the absolute installer path, or undefined.
 */
function findFreshInstaller(updatesDir, notBefore, stable, settled) {
  if (!existsSync(updatesDir)) return undefined
  let best
  for (const entry of readdirSync(updatesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const directory = join(updatesDir, entry.name)
    let names
    try {
      names = readdirSync(directory)
    } catch {
      continue
    }
    for (const name of names) {
      if (!/^DSH-.*\.exe$/iu.test(name) || !/windows/iu.test(name)) continue
      const path = join(directory, name)
      try {
        const stats = statSync(path)
        if (!stats.isFile() || stats.size < MIN_INSTALLER_BYTES) continue
        if (stats.mtimeMs < notBefore) continue
        const previous = stable.get(path)
        if (previous !== undefined && previous.size === stats.size) {
          stable.set(path, { size: stats.size, count: previous.count + 1 })
        } else {
          stable.set(path, { size: stats.size, count: 1 })
        }
        const seen = stable.get(path)
        if (seen === undefined || seen.count < settled) continue
        if (best === undefined || stats.mtimeMs > best.mtimeMs) best = { path, mtimeMs: stats.mtimeMs }
      } catch {
        // A file that disappears mid-scan is simply not a candidate.
      }
    }
  }
  return best === undefined ? undefined : best.path
}

/**
 * Start the install wrapper outside this process tree, so it survives the app the
 * wrapper has to close.
 * @param installerPath - the downloaded package to install.
 * @param appDir - the DSH NEXT installation directory.
 * @param scriptPath - `scripts/desktop-install.ps1`.
 * @param logPath - the file the wrapper appends to.
 */
function spawnInstall(installerPath, appDir, scriptPath, logPath) {
  const inner = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`
    + ` -InstallerPath "${installerPath}" -AppDir "${appDir}" -LogPath "${logPath}"`
  const quoted = inner.replace(/'/gu, "''")
  const command = 'Invoke-CimMethod -ClassName Win32_Process -MethodName Create'
    + ` -Arguments @{ CommandLine = '${quoted}' } | Out-Null`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

/**
 * Watch for a downloaded update and install it once.
 * @param ctx - the Host plugin context.
 */
export function apply(ctx) {
  const installDir = process.env.DSH_INSTALL_DIR ?? ''
  // Only the packaged desktop app can be updated this way.
  if (!/app\.asar$/iu.test(installDir)) return
  const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? '', '.dsh')
  const appDir = dirname(dirname(installDir))
  const updatesDir = join(home, 'electron-user-data', 'next-updates')
  const scriptPath = join(packageDir, 'scripts', 'desktop-install.ps1')
  const logDir = join(home, 'logs')
  const logPath = join(logDir, 'next-auto-update-install.log')

  const log = (message) => {
    try {
      mkdirSync(logDir, { recursive: true })
      appendFileSync(logPath, `${new Date().toISOString()} [host] ${message}\n`)
    } catch {
      // Diagnostics never decide whether an install runs.
    }
  }

  if (!existsSync(scriptPath)) {
    log(`install wrapper missing: ${scriptPath}`)
    return
  }

  restoreLaunchers(log)

  const startedAt = Date.now()
  let fired = false
  const stable = new Map()
  log(`watching ${updatesDir} for a new installer (app dir ${appDir})`)

  ctx.effect(() => {
    const timer = setInterval(() => {
      if (fired) return
      const installer = findFreshInstaller(updatesDir, startedAt, stable, 3)
      if (installer === undefined) return
      fired = true
      log(`installing ${installer}`)
      try {
        spawnInstall(installer, appDir, scriptPath, logPath)
      } catch (error) {
        fired = false
        log(`could not start the install wrapper: ${error instanceof Error ? error.message : String(error)}`)
      }
    }, POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, 'auto-update: installer watcher')
}

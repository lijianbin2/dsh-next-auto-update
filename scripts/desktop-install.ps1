# Install a DSH NEXT update even while Chrome's chrome-bridge native host is
# running.
#
# The Windows installer replaces the install folder by renaming it, which fails
# with Win32 error 5 whenever a process still runs an executable from inside it.
# The chrome-bridge native-messaging host does exactly that (it runs
# `DSH NEXT.exe host.js` from the install folder), and Chrome recreates it within
# seconds of being killed. So this wrapper temporarily takes the launcher out of
# service, ends the app, installs, restores the launcher and reopens the app.
#
# Spawned detached by the plugin's Host half (Win32_Process.Create), so it keeps
# running after the DSH NEXT processes it ends are gone.
#
# Log: <AppDir>\..\dsh-next-auto-update-install.log  (also passed in)

param(
  [Parameter(Mandatory = $true)][string] $InstallerPath,
  [Parameter(Mandatory = $true)][string] $AppDir,
  [string] $LogPath = '',
  [int] $WaitForAppSeconds = 240,
  [switch] $DryRun
)

$ErrorActionPreference = 'Continue'
$appExe = Join-Path $AppDir 'DSH NEXT.exe'
$appAsar = Join-Path $AppDir 'resources\app.asar'
if ([string]::IsNullOrWhiteSpace($LogPath)) { $LogPath = Join-Path (Split-Path -Parent $AppDir) 'dsh-next-auto-update-install.log' }

function Write-Log([string] $message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  try { Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8 } catch { }
}

function Get-BridgeHosts {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and (
      $_.CommandLine -match 'chrome-bridge\\host\\host\.js' -or
      $_.CommandLine -match 'chrome-bridge\\host\\run\.bat'
    )
  }
}

function Get-AppProcesses {
  Get-Process -Name 'DSH NEXT' -ErrorAction SilentlyContinue | Where-Object {
    $path = $null
    try { $path = $_.Path } catch { $path = $null }
    $path -and $path.StartsWith($AppDir, [System.StringComparison]::OrdinalIgnoreCase)
  }
}

function Get-AsarSize {
  if (Test-Path -LiteralPath $appAsar) { return (Get-Item -LiteralPath $appAsar).Length }
  return -1
}

# Every chrome-bridge launcher this machine may use: the running host names the
# script it was started from, and the default lives under the user's ~/.dsh.
function Get-Launchers {
  $found = New-Object System.Collections.Generic.List[string]
  foreach ($bridge in @(Get-BridgeHosts)) {
    if ($bridge.CommandLine -match '([A-Za-z]:\\[^"]*?run\.bat)') {
      $candidate = $Matches[1]
      if (-not $found.Contains($candidate)) { $found.Add($candidate) }
    }
  }
  $default = Join-Path $env:USERPROFILE '.dsh\chrome-bridge\host\run.bat'
  if ((Test-Path -LiteralPath $default) -and -not $found.Contains($default)) { $found.Add($default) }
  return $found
}

$disabled = New-Object System.Collections.Generic.List[string]
$exitCode = 0

Write-Log '=== desktop update install start ==='
Write-Log "installer: $InstallerPath"
Write-Log "app dir: $AppDir"
$before = Get-AsarSize
Write-Log "app.asar before: $before bytes"

try {
  if (-not (Test-Path -LiteralPath $InstallerPath)) { throw "installer not found: $InstallerPath" }
  if (-not (Test-Path -LiteralPath $appExe)) { throw "app executable not found: $appExe" }

  # 1. Take the native-messaging launchers out of service so Chrome cannot
  #    recreate the host while the folder has to be replaced.
  foreach ($launcher in @(Get-Launchers)) {
    $backup = "$launcher.dsh-auto-update-disabled"
    try {
      Move-Item -LiteralPath $launcher -Destination $backup -Force
      $disabled.Add($launcher)
      Write-Log "launcher disabled: $launcher"
    } catch {
      Write-Log ("could not disable launcher " + $launcher + ': ' + $_.Exception.Message)
    }
  }

  # 2. End whatever is still running from the install folder.
  foreach ($bridge in @(Get-BridgeHosts)) {
    Write-Log ("ending bridge host pid " + $bridge.ProcessId)
    Stop-Process -Id $bridge.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 500

  if ($DryRun) {
    # Prove the launcher handling without closing the app or touching the install.
    Start-Sleep -Seconds 6
    $still = @(Get-BridgeHosts)
    Write-Log ('dry run: bridge hosts after 6s = ' + $still.Count + ' (0 means Chrome cannot recreate them)')
    Write-Log 'dry run: skipping DSH NEXT shutdown and the installer'
    exit 0
  }

  $appDeadline = (Get-Date).AddSeconds($WaitForAppSeconds)
  # Ask the app to quit first: Electron closes its windows and flushes the session
  # log, which a forced termination skips.
  foreach ($app in @(Get-AppProcesses)) {
    try { $null = $app.CloseMainWindow() } catch { }
  }
  Start-Sleep -Seconds 4
  do {
    $running = @(Get-AppProcesses)
    foreach ($app in $running) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    if ($running.Count -gt 0) {
      Write-Log ('ended ' + $running.Count + ' DSH NEXT process(es)')
      Start-Sleep -Seconds 1
    }
  } while ((Get-Date) -lt $appDeadline -and @(Get-AppProcesses).Count -gt 0)

  $left = @(Get-AppProcesses)
  if ($left.Count -gt 0) { throw ('DSH NEXT is still running: ' + (($left | ForEach-Object { $_.Id }) -join ',')) }
  Start-Sleep -Seconds 2
  Write-Log 'install folder should now be free'

  if ($DryRun) {
    Write-Log 'dry run: skipping the installer'
  } else {
    # 3. Silent install.
    Write-Log 'running installer'
    $proc = Start-Process -FilePath $InstallerPath -ArgumentList '/S' -PassThru
    if (-not $proc.WaitForExit(420000)) { Write-Log 'installer still running after 7 minutes' }
    else { Write-Log ('installer exit code: ' + $proc.ExitCode) }

    $after = $before
    $watchUntil = (Get-Date).AddMinutes(4)
    while ((Get-Date) -lt $watchUntil) {
      Start-Sleep -Seconds 3
      $after = Get-AsarSize
      if ($after -ne $before) { break }
    }
    Write-Log "app.asar after: $after bytes"
    if ($after -eq $before) { Write-Log 'WARNING: install folder was not replaced' }
    else { Write-Log 'install folder replaced' }
  }
} catch {
  $exitCode = 1
  Write-Log ('FAILED: ' + $_.Exception.Message)
} finally {
  # 4. Always put the launchers back.
  foreach ($launcher in $disabled) {
    $backup = "$launcher.dsh-auto-update-disabled"
    try {
      if (Test-Path -LiteralPath $backup) {
        Move-Item -LiteralPath $backup -Destination $launcher -Force
        Write-Log "launcher restored: $launcher"
      }
    } catch {
      Write-Log ('could not restore launcher ' + $launcher + ': ' + $_.Exception.Message)
    }
  }

  # 5. Leave the user with a running app.
  try {
    if (Test-Path -LiteralPath $appExe) {
      if (@(Get-AppProcesses).Count -eq 0) {
        Write-Log 'reopening DSH NEXT'
        Start-Process -FilePath $appExe
      } else {
        Write-Log 'DSH NEXT is running already; not reopening'
      }
    }
  } catch {
    Write-Log ('could not reopen DSH NEXT: ' + $_.Exception.Message)
  }
  Write-Log "=== done (exit $exitCode) ==="
}

exit $exitCode

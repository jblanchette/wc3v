# WC3V installer - https://wc3v.com/install.ps1
#
#   irm https://wc3v.com/install.ps1 | iex
#
# You are about to pipe a script from the internet into your shell, so this file
# is written to be read first. It does four things: reads the release manifest,
# downloads the installer, checks its SHA-256, and runs it. Nothing else. No
# elevation, no registry writes of its own, no telemetry.
#
# Why this exists: the installer is not code-signed, so downloading it in a
# browser gets it stamped with the Mark of the Web and Windows greets you with
# "Windows protected your PC". Invoke-WebRequest does not apply that mark, so
# this path is quiet. It does NOT make the binary signed. See /download for what
# that does and does not mean.
#
# The SHA-256 check is what replaces the signature here. The same hash is shown
# on https://wc3v.com/download, so you can compare the two independently.
#
# To pass options through the one-liner, create the scriptblock explicitly:
#   & ([scriptblock]::Create((irm https://wc3v.com/install.ps1))) -DryRun
#
# ASCII ONLY, deliberately. Windows PowerShell 5.1 decodes a file with no byte
# order mark as ANSI, so a single non-ASCII character here becomes mojibake and
# takes the parser down with it. Verified: em dashes in an earlier draft broke
# this script on 5.1 while working fine on PowerShell 7.

param(
  # Resolve, download and verify, but stop before installing.
  [switch]$DryRun,
  # Do not launch WC3V when the install finishes.
  [switch]$NoStart,
  # Reinstall even if the installed version already matches the manifest.
  [switch]$Force,
  # Remove WC3V instead of installing it.
  [switch]$Uninstall,
  # Release manifest. Overridable so the failure paths are testable.
  [string]$Manifest = 'https://cdn.wc3v.com/desktop/latest.json'
)

$ErrorActionPreference = 'Stop'

# NSIS in currentUser mode registers here, keyed on productName ("WC3V" in
# desktop/src-tauri/tauri.conf.json), not on the bundle identifier.
$RegKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\WC3V'
$AppExe = 'wc3v-desktop.exe'

function Write-Step { param([string]$Message) Write-Host "  $Message" }

# Every failure below uses `throw`, never `exit`. Under `| iex` this script runs
# in the caller's session, and `exit` would close their shell. `throw` still
# gives `powershell -File install.ps1` a non-zero exit code.

function Get-InstalledInfo {
  if (-not (Test-Path $RegKey)) { return $null }
  $p = Get-ItemProperty $RegKey
  [PSCustomObject]@{
    Version = $p.DisplayVersion
    # The stored InstallLocation carries literal quotes.
    Location = ($p.InstallLocation -replace '^"|"$', '')
    UninstallString = ($p.UninstallString -replace '^"|"$', '')
  }
}

function Assert-Supported {
  if ($PSVersionTable.PSVersion.Major -ge 6 -and -not $IsWindows) {
    throw 'WC3V is Windows-only. There is no macOS or Linux build yet.'
  }
  if ($PSVersionTable.PSVersion -lt [version]'5.1') {
    throw "PowerShell 5.1 or newer is required (found $($PSVersionTable.PSVersion))."
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw 'WC3V requires 64-bit Windows.'
  }
  # Windows PowerShell 5.1 still negotiates SSL3/TLS1.0 by default, which
  # Cloudflare refuses. PowerShell 7 picks a sane protocol on its own.
  if ($PSVersionTable.PSVersion.Major -lt 6) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  }
}

function Invoke-Uninstall {
  $installed = Get-InstalledInfo
  if (-not $installed) { Write-Host 'WC3V is not installed.'; return }
  Write-Host "Removing WC3V $($installed.Version)..."
  # The registry entry has no QuietUninstallString, so pass NSIS /S ourselves.
  Start-Process -FilePath $installed.UninstallString -ArgumentList '/S' -Wait
  Write-Host 'Removed.'
}

function Install-Wc3v {
  Write-Host ''
  Write-Host 'WC3V'

  Write-Step "Reading $Manifest"
  try {
    # A local path is accepted so the failure paths below can be exercised
    # without a server. Invoke-RestMethod itself refuses the file: scheme.
    if (Test-Path -LiteralPath $Manifest -PathType Leaf) {
      $release = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
    } else {
      $release = Invoke-RestMethod -Uri $Manifest -UseBasicParsing
    }
  } catch {
    throw "Could not read the release manifest at $Manifest. $($_.Exception.Message)"
  }

  $win = $release.platforms.'windows-x86_64'
  if (-not $win -or -not $win.url) {
    throw "The manifest at $Manifest has no windows-x86_64 download. This is a problem on our end, not yours."
  }
  $version = $release.version
  Write-Step "Latest is $version"

  # -DryRun deliberately skips this short-circuit: its whole job is to exercise
  # the download-and-verify chain, which is unreachable once you are current.
  $installed = Get-InstalledInfo
  if ($installed -and $installed.Version -eq $version -and -not $Force -and -not $DryRun) {
    Write-Host ''
    Write-Host "Already on $version. Nothing to do. Pass -Force to reinstall."
    Write-Host ''
    return
  }

  $work = Join-Path $env:TEMP 'wc3v-install'
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  $setup = Join-Path $work ($win.url -split '/')[-1]

  try {
    Write-Step "Downloading $(($win.url -split '/')[-1])"
    # The progress bar makes Invoke-WebRequest roughly an order of magnitude
    # slower on Windows PowerShell 5.1. We print our own steps instead.
    $prevProgress = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
      Invoke-WebRequest -Uri $win.url -OutFile $setup -UseBasicParsing
    } finally {
      $ProgressPreference = $prevProgress
    }

    if ($win.sha256) {
      $actual = (Get-FileHash -Path $setup -Algorithm SHA256).Hash.ToLower()
      $expected = $win.sha256.ToLower()
      if ($actual -ne $expected) {
        throw "Checksum mismatch. The download does not match the published release. Expected $expected, got $actual. The file has been deleted and nothing was installed."
      }
      Write-Step "SHA-256 verified ($($expected.Substring(0, 16))...)"
    } else {
      Write-Warning 'The manifest published no SHA-256, so the download could not be verified.'
    }

    # A no-op when there is no Mark of the Web, which is the normal case here.
    # Cheap insurance if this script is ever fed a file that has one.
    Unblock-File -Path $setup

    if ($DryRun) {
      Write-Host ''
      Write-Host "Dry run. Verified $version but did not install."
      Write-Host "  $($win.url)"
      Write-Host ''
      return
    }

    Write-Step 'Installing'
    # currentUser install into %LOCALAPPDATA%, so no elevation prompt.
    $proc = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
      throw "The installer exited with code $($proc.ExitCode)."
    }
  } finally {
    Remove-Item -Path $work -Recurse -Force -ErrorAction SilentlyContinue
  }

  $installed = Get-InstalledInfo
  if (-not $installed) {
    throw 'The installer finished but WC3V is not registered. Try the installer from https://wc3v.com/download.'
  }

  Write-Host ''
  Write-Host "WC3V $($installed.Version) installed to $($installed.Location)"
  Write-Host 'Updates are handled inside the app, so you will not need this command again.'
  Write-Host ''

  if (-not $NoStart) {
    $exe = Join-Path $installed.Location $AppExe
    if (Test-Path $exe) { Start-Process -FilePath $exe }
  }
}

Assert-Supported
if ($Uninstall) { Invoke-Uninstall } else { Install-Wc3v }

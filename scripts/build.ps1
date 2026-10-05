#Requires -Version 5.1
<#
.SYNOPSIS
    Build Hugo Publisher from source on Windows. Please read it before you run it.

.DESCRIPTION
    What it does, in order:
      1. Checks the tools it needs and prints how to install anything that is missing.
         It never installs anything by itself.
      2. npm ci                       exact JavaScript packages from package-lock.json
      3. npx tauri build -- --locked  exact Rust crates from src-tauri\Cargo.lock
      4. Prints the installers it built and their SHA-256.
    Tool versions are pinned in rust-toolchain.toml (Rust) and .nvmrc (Node.js).

.PARAMETER CheckOnly
    Only check the prerequisites; do not build.

.PARAMETER Bundles
    Bundle types to build, comma-separated: nsis, msi. Default: both.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -CheckOnly

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Bundles nsis
#>
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [string]$Bundles = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$script:Missing = 0

function Ok([string]$What) { Write-Host "  ok       $What" }

function Miss([string]$What, [string]$How) {
    Write-Host "  MISSING  $What" -ForegroundColor Red
    Write-Host "           -> $How"
    $script:Missing++
}

# Returns the .exe or .cmd for a tool. npm also installs .ps1 shims, but PowerShell
# does not reliably pass `--` through to scripts, and we need it for `tauri build -- --locked`.
function Find-Tool([string]$Name) {
    $cmd = Get-Command "$Name.exe", "$Name.cmd" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($cmd) { return $cmd.Source }
    return $null
}

function Invoke-Tool([string]$Exe, [string[]]$Arguments) {
    Write-Host ""
    Write-Host "==> $(Split-Path -Leaf $Exe) $($Arguments -join ' ')" -ForegroundColor Cyan
    $ErrorActionPreference = 'Continue' # progress output on stderr is not an error
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Exe) failed with exit code $LASTEXITCODE" }
}

Push-Location $Root
try {
    Write-Host "Checking prerequisites (Windows)..."

    # Rust through rustup, at the version pinned in rust-toolchain.toml, MSVC toolchain.
    $channel = ([regex]'(?m)^channel\s*=\s*"([^"]+)"').Match((Get-Content rust-toolchain.toml -Raw)).Groups[1].Value
    $rustup = Find-Tool rustup
    if (-not $rustup) {
        Miss 'rustup' "Install it from https://rustup.rs (rustup-init.exe, MSVC host), then run 'rustup toolchain install' in $Root"
    } elseif (-not (& $rustup toolchain list | Where-Object { $_ -like "$channel-*-msvc*" })) {
        Miss "Rust $channel MSVC toolchain (rust-toolchain.toml)" "Run in ${Root}: rustup toolchain install   (MSVC host: rustup set default-host x86_64-pc-windows-msvc)"
    } else {
        Ok (& (Find-Tool rustc) --version)
    }

    # Node.js at least the major version in .nvmrc, plus npm and git.
    $nodeWant = [int]([regex]'\d+').Match((Get-Content .nvmrc -Raw)).Value
    $node = Find-Tool node
    $nodeVersion = if ($node) { "$(& $node --version)".Trim() } else { '' }
    if (-not $node) {
        Miss "Node.js $nodeWant or newer" "Install Node.js $nodeWant LTS from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS)"
    } elseif ([int]$nodeVersion.TrimStart('v').Split('.')[0] -lt $nodeWant) {
        Miss "Node.js $nodeWant or newer (found $nodeVersion)" "Install Node.js $nodeWant LTS from https://nodejs.org"
    } else {
        Ok "Node.js $nodeVersion"
    }
    $npm = Find-Tool npm
    if ($npm) { Ok "npm $(& $npm --version)" } else { Miss 'npm' 'It comes with Node.js; reinstall Node.js' }
    $git = Find-Tool git
    if ($git) { Ok (& $git --version) } else { Miss 'git' 'Install Git for Windows from https://git-scm.com (or: winget install Git.Git)' }

    # MSVC compiler, linker and Windows SDK, found with vswhere (comes with the Visual Studio Installer).
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vcTools = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $vcTools = 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' }
    $vs = $null
    if (Test-Path $vswhere) { $vs = & $vswhere -latest -products * -requires $vcTools -property displayName }
    if ($vs) {
        Ok "$vs (C++ build tools)"
    } else {
        Miss 'Visual Studio C++ build tools' "Install 'Build Tools for Visual Studio' from https://visualstudio.microsoft.com/visual-cpp-build-tools/ with the 'Desktop development with C++' workload"
    }

    # WebView2 runtime: part of Windows 11; older systems need the Evergreen runtime.
    $wv2Key = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $wv2 = "HKLM:\SOFTWARE\WOW6432Node\$wv2Key", "HKLM:\SOFTWARE\$wv2Key", "HKCU:\SOFTWARE\$wv2Key" |
        ForEach-Object { Get-ItemPropertyValue -Path $_ -Name pv -ErrorAction SilentlyContinue } |
        Where-Object { $_ -and $_ -ne '0.0.0.0' } |
        Select-Object -First 1
    if ($wv2) {
        Ok "WebView2 runtime $wv2"
    } else {
        Miss 'WebView2 runtime' 'Install the Evergreen runtime from https://developer.microsoft.com/microsoft-edge/webview2/'
    }

    # The .msi bundler (WiX) needs VBScript, an optional Windows feature that can be turned off.
    if ((-not $Bundles -or $Bundles -match 'msi') -and -not (Test-Path "$env:SystemRoot\System32\vbscript.dll")) {
        Miss 'VBScript (needed for the .msi)' "Settings > System > Optional features: add VBSCRIPT. Or build only the setup .exe: -Bundles nsis"
    }

    if ($script:Missing -gt 0) {
        Write-Host ""
        Write-Host "$($script:Missing) prerequisite(s) missing. Install them and run this script again." -ForegroundColor Red
        exit 1
    }
    Write-Host "All prerequisites found." -ForegroundColor Green
    if ($CheckOnly) { exit 0 }

    $started = Get-Date
    Invoke-Tool $npm @('ci')
    $tauriArgs = @('tauri', 'build')
    if ($Bundles) { $tauriArgs += @('--bundles', $Bundles) }
    Invoke-Tool (Find-Tool npx) ($tauriArgs + @('--', '--locked')) # everything after -- goes to cargo

    Write-Host ""
    Write-Host "Built (SHA-256  file):"
    $bundleDir = Join-Path $Root 'src-tauri\target\release\bundle'
    Get-ChildItem -Path "$bundleDir\nsis\*.exe", "$bundleDir\msi\*.msi" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $started } |
        ForEach-Object { Write-Host ('{0}  {1}' -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower(), $_.FullName) }
    Write-Host ""
    Write-Host "Hugo Publisher needs git and Hugo (extended edition) on your PATH at run time."
} finally {
    Pop-Location
}

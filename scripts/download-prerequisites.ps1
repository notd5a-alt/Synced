# download-prerequisites.ps1
# Downloads prerequisite installers for bundling with the Synced Windows installer.
# Run this once before building the installer, or in CI.
#
# Usage:
#   .\scripts\download-prerequisites.ps1
#
# Downloaded files are placed in src-tauri/windows/prereqs/ and are .gitignored.

$ErrorActionPreference = "Stop"

$prereqDir = Join-Path $PSScriptRoot "..\src-tauri\windows\prereqs"
if (-not (Test-Path $prereqDir)) {
    New-Item -ItemType Directory -Path $prereqDir -Force | Out-Null
}

# ── Visual C++ Redistributable 2015-2022 (x64) ────────────────────────────

$vcRedistUrl  = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
$vcRedistPath = Join-Path $prereqDir "vc_redist.x64.exe"

if (Test-Path $vcRedistPath) {
    Write-Host "[OK] VC++ Redistributable already downloaded: $vcRedistPath"
} else {
    Write-Host "[DL] Downloading VC++ Redistributable x64..."
    try {
        Invoke-WebRequest -Uri $vcRedistUrl -OutFile $vcRedistPath -UseBasicParsing
        Write-Host "[OK] Downloaded to: $vcRedistPath"
    } catch {
        Write-Error "Failed to download VC++ Redistributable: $_"
        exit 1
    }
}

# Verify the download is a valid PE executable (not an HTML error page)
$header = [System.IO.File]::ReadAllBytes($vcRedistPath)[0..1]
if ($header[0] -ne 0x4D -or $header[1] -ne 0x5A) {
    Write-Error "Downloaded file is not a valid executable. Delete $vcRedistPath and retry."
    exit 1
}

$size = (Get-Item $vcRedistPath).Length / 1MB
Write-Host "[OK] VC++ Redistributable size: $([math]::Round($size, 1)) MB"

Write-Host ""
Write-Host "All prerequisites downloaded to: $prereqDir"
Write-Host "You can now build the installer with: cd src-tauri && cargo tauri build"

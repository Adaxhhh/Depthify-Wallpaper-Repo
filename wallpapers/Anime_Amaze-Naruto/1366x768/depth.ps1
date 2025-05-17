<#
.SYNOPSIS
    Update wallpaper via SystemParametersInfo, push custom Rainmeter.ini,
    replace specific Rainmeter skins, and restart Rainmeter.
#>

# ── Parameters ────────────────────────────────────────────────────────────────
param(
    [string]$ImagePath = (Join-Path $PSScriptRoot 'wallpaper.png')   # default
)

# ── Helper: Win32.SetWallpaper() (your snippet) ──────────────────────────────
$code = @'
using System.Runtime.InteropServices;
namespace Win32 {
    public class Wallpaper {
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern int SystemParametersInfo(int uAction, int uParam,
                                                       string lpvParam, int fuWinIni);

        public static void SetWallpaper(string path) {
            const int SPI_SETDESKWALLPAPER = 20;
            const int SPIF_UPDATEINIFILE   = 0x01;
            const int SPIF_SENDWININICHANGE = 0x02;
            SystemParametersInfo(SPI_SETDESKWALLPAPER, 0, path,
                                 SPIF_UPDATEINIFILE | SPIF_SENDWININICHANGE);
        }
    }
}
'@
Add-Type -TypeDefinition $code -ErrorAction Stop

# ── 1. Locate Rainmeter ─────────────────────────────────────────────────────—
Write-Host 'Checking for Rainmeter installation…'
$rmExe = @(
    "$env:ProgramFiles\Rainmeter\Rainmeter.exe",
    "${env:ProgramFiles(x86)}\Rainmeter\Rainmeter.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $rmExe) {
    $regKeys = @(
        'HKLM:\SOFTWARE\Rainmeter',
        'HKLM:\SOFTWARE\WOW6432Node\Rainmeter',
        'HKCU:\SOFTWARE\Rainmeter'
    )
    foreach ($rk in $regKeys) {
        $install = (Get-ItemProperty -Path $rk -Name InstallPath -ErrorAction SilentlyContinue).InstallPath
        if ($install) {
            $candidate = Join-Path $install 'Rainmeter.exe'
            if (Test-Path $candidate) { $rmExe = $candidate; break }
        }
    }
}

if (-not $rmExe) { Write-Error 'Rainmeter installation not found. Aborting.'; exit 1 }
Write-Host "Rainmeter found at: $rmExe"

# ── 2. Stop Rainmeter if running ─────────────────────────────────────────────
if ($proc = Get-Process Rainmeter -ErrorAction SilentlyContinue) {
    Write-Host 'Stopping Rainmeter…'
    $proc | Stop-Process -Force -ErrorAction Stop
    Start-Sleep 3 # Give time for process to fully terminate and release file locks
} else { Write-Host 'Rainmeter not running, skip stop.' }

# ── 3. Apply wallpaper via SystemParametersInfo ──────────────────────────────
Write-Host "Setting wallpaper to '$ImagePath'…"
if (-not (Test-Path $ImagePath)) { Write-Error "File not found: $ImagePath"; exit 1 }

try   { [Win32.Wallpaper]::SetWallpaper($ImagePath) }
catch { Write-Error "Failed to set wallpaper: $_"; exit 1 }

Write-Host 'Wallpaper set successfully (SystemParametersInfo).'

# ── 4. Copy Rainmeter.ini ────────────────────────────────────────────────────
$srcIni  = Join-Path $PSScriptRoot 'Rainmeter.ini'
$destDir = Join-Path $env:APPDATA 'Rainmeter' # This is for Rainmeter.ini
$destIni = Join-Path $destDir 'Rainmeter.ini'

if (-not (Test-Path $srcIni)) { Write-Error "Source Rainmeter.ini not found at '$srcIni'."; exit 1 }
if (-not (Test-Path $destDir)) {
    Write-Host "Rainmeter settings directory not found. Creating: $destDir"
    New-Item -Path $destDir -ItemType Directory -Force -ErrorAction Stop | Out-Null
}

Copy-Item $srcIni $destIni -Force -ErrorAction Stop
Write-Host "Rainmeter.ini copied to '$destIni'."

# ── 5. Replace specified Rainmeter skin folders ──────────────────────────────
Write-Host "Processing Rainmeter skin folders..."
$skinsSourceBaseDir = $PSScriptRoot
# Typically C:\Users\<UserName>\Documents\Rainmeter\Skins
$skinsDestBaseDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Rainmeter\Skins'

# Ensure the base destination skins directory exists
if (-not (Test-Path $skinsDestBaseDir)) {
    Write-Host "Destination skins directory not found. Creating: $skinsDestBaseDir"
    try {
        New-Item -Path $skinsDestBaseDir -ItemType Directory -Force -ErrorAction Stop | Out-Null
        Write-Host "Destination skins directory created: $skinsDestBaseDir"
    } catch {
        Write-Error "Failed to create destination skins directory '$skinsDestBaseDir'. Error: $_"
        # Decide if you want to exit or continue. For now, let's make it critical.
        exit 1
    }
}

$skinFoldersToReplace = @('DepthEffect', 'OneplusStyleWidget')

foreach ($skinFolderName in $skinFoldersToReplace) {
    $srcSkinPath = Join-Path $skinsSourceBaseDir $skinFolderName
    $destSkinPath = Join-Path $skinsDestBaseDir $skinFolderName # e.g., ...\Skins\DepthEffect

    if (Test-Path -Path $srcSkinPath -PathType Container) {
        Write-Host "Preparing to replace skin folder '$skinFolderName':"
        Write-Host "  Source: $srcSkinPath"
        Write-Host "  Destination: $destSkinPath"

        # Remove the destination folder if it exists to ensure a clean replacement
        if (Test-Path -Path $destSkinPath -PathType Container) {
            Write-Host "  Removing existing destination folder: '$destSkinPath'..."
            try {
                Remove-Item -Path $destSkinPath -Recurse -Force -ErrorAction Stop
                Write-Host "  Existing folder '$destSkinPath' removed."
            } catch {
                Write-Warning "  Could not remove existing folder '$destSkinPath'. Files might be in use. Error: $_. Will attempt to overwrite."
                # The subsequent Copy-Item -Force might still work for non-locked files.
            }
        }

        # Copy the new skin folder from source to the SKINS directory (not into the specific skin folder path)
        # Copy-Item 'C:\script\DepthEffect' 'C:\Users\User\Documents\Rainmeter\Skins'
        # This creates 'C:\Users\User\Documents\Rainmeter\Skins\DepthEffect'
        try {
            Copy-Item -Path $srcSkinPath -Destination $skinsDestBaseDir -Recurse -Force -ErrorAction Stop
            Write-Host "  Skin folder '$skinFolderName' copied successfully to '$skinsDestBaseDir'."
        } catch {
            Write-Error "  Failed to copy skin folder '$skinFolderName' from '$srcSkinPath' to '$skinsDestBaseDir'. Error: $_"
            # Optionally, you could decide to exit 1 here if skin copy is critical
        }
    } else {
        Write-Warning "Source skin folder '$skinFolderName' not found at '$srcSkinPath'. Skipping this skin."
    }
}
Write-Host "Rainmeter skin folders processed."

# ── 6. Restart Rainmeter ─────────────────────────────────────────────────────
Write-Host 'Restarting Rainmeter…'
try {
    Start-Process -FilePath $rmExe -WorkingDirectory (Split-Path $rmExe) -ErrorAction Stop
    Start-Sleep 5 # Allow Rainmeter time to initialize
    Write-Host "`nAll tasks completed successfully.`n"
} catch {
    Write-Error "Failed to restart Rainmeter. Error: $_"
    exit 1
}
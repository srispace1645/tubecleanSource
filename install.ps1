<#
  Builds TubeClean and installs it on a Fire TV Stick over Wi-Fi.
    .\install.ps1 -Ip 192.168.1.50          # build + install + launch
    .\install.ps1 -Ip 192.168.1.50 -SkipBuild
  First time: on the Fire Stick turn on Settings > My Fire TV > Developer Options > ADB Debugging,
  then accept the "Allow USB debugging?" prompt that appears on the TV.
#>
param(
    [Parameter(Mandatory = $true)][string]$Ip,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw "adb not found at $adb. Install Android SDK platform-tools." }

$studioJdk = 'C:\Program Files\Android\Android Studio\jbr'
if (-not $env:JAVA_HOME -and (Test-Path $studioJdk)) { $env:JAVA_HOME = $studioJdk }

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'gradlew.bat') -p $PSScriptRoot test assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Build or tests failed; nothing was installed.' }
}

$apk = Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk'
$target = if ($Ip -match ':') { $Ip } else { "${Ip}:5555" }

& $adb connect $target
# Older Fire OS installs via "push + pm install", where adb exits 0 even when the install fails,
# so trust only the "Success" line.
$result = (& $adb -s $target install -r $apk | Out-String).Trim()
Write-Output $result
if ($LASTEXITCODE -ne 0 -or $result -notmatch '(?m)^Success') {
    if ($result -match 'INSTALL_FAILED_OLDER_SDK') {
        throw "Install failed: this device's Android is older than the app's minSdk (see app\build.gradle.kts)."
    }
    if ($result -match 'unauthorized|failed to authenticate') {
        throw 'Install failed: accept the debugging prompt on the TV (tick "Always allow"), then run this again.'
    }
    throw 'Install failed; see the message above. Nothing was started.'
}
& $adb -s $target shell am start -n com.srinath.tubeclean/.MainActivity | Out-Null
Write-Output "TubeClean installed and started on $target."

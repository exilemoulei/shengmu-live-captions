[CmdletBinding()]
param(
    [int]$Port = 9223,
    [string]$ProfileDir = '',
    [string]$Url = 'about:blank'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $ProfileDir) {
    $ProfileDir = Join-Path $root 'chrome-profile'
}
$ProfileDir = [IO.Path]::GetFullPath($ProfileDir)
New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates |
    Where-Object { $_ -and (Test-Path -LiteralPath $_) } |
    Select-Object -First 1
if (-not $chrome) {
    throw "Google Chrome was not found."
}

function Test-DevToolsEndpoint([int]$TargetPort) {
    try {
        Invoke-RestMethod "http://127.0.0.1:$TargetPort/json/version" -TimeoutSec 2 |
            Out-Null
        return $true
    } catch {
        return $false
    }
}

$wasRunning = Test-DevToolsEndpoint $Port
if (-not $wasRunning) {
    $arguments = @(
        "--remote-debugging-port=$Port",
        '--enable-unsafe-extension-debugging',
        "--user-data-dir=$ProfileDir",
        '--no-first-run',
        '--no-default-browser-check',
        '--autoplay-policy=no-user-gesture-required',
        $Url
    )
    Start-Process -FilePath $chrome -ArgumentList $arguments

    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 500
    } until ((Test-DevToolsEndpoint $Port) -or (Get-Date) -gt $deadline)
    if (-not (Test-DevToolsEndpoint $Port)) {
        throw "Chrome did not expose DevTools on port $Port. Close other Chrome instances using $ProfileDir and retry."
    }
} elseif ($Url -and $Url -ne 'about:blank') {
    Start-Process -FilePath $chrome -ArgumentList @(
        "--user-data-dir=$ProfileDir",
        $Url
    )
}

$loaded = & (Join-Path $PSScriptRoot 'Load-DevExtension.ps1') -Port $Port
[pscustomobject]@{
    ChromePid = (Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'chrome.exe' -and
            $_.CommandLine -match [regex]::Escape("--remote-debugging-port=$Port")
        } |
        Select-Object -First 1 -ExpandProperty ProcessId)
    DevToolsPort = $Port
    ProfileDir = $ProfileDir
    Extension = $loaded
} | Format-List

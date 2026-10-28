[CmdletBinding()]
param(
    [int]$Port = 8014
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs'
$serverFile = Join-Path $root 'scripts\local-service\server.mjs'

New-Item -ItemType Directory -Path $logs -Force | Out-Null

if (-not (Test-Path -LiteralPath $serverFile)) {
    throw "Local control service not found: $serverFile"
}

function Get-Health([int]$TargetPort) {
    try {
        return Invoke-RestMethod "http://127.0.0.1:$TargetPort/health" -TimeoutSec 2
    } catch {
        return $null
    }
}

$existing = Get-Health $Port
if ($existing -and $existing.service -eq 'shengmu-local') {
    [pscustomobject]@{
        Status = 'running'
        Port = $Port
        Url = "http://127.0.0.1:$Port"
    }
    return
}

$node = (Get-Command node -ErrorAction Stop).Source
$stdoutLog = Join-Path $logs 'local-service.stdout.log'
$stderrLog = Join-Path $logs 'local-service.stderr.log'
$env:SHENGMU_LOCAL_SERVICE_PORT = $Port.ToString()

$process = Start-Process `
    -FilePath $node `
    -ArgumentList @("`"$serverFile`"") `
    -WorkingDirectory (Join-Path $root 'scripts\local-service') `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

$deadline = (Get-Date).AddSeconds(15)
do {
    Start-Sleep -Milliseconds 400
    $health = Get-Health $Port
} until (($health -and $health.service -eq 'shengmu-local') -or (Get-Date) -gt $deadline -or $process.HasExited)

if (-not $health -or $health.service -ne 'shengmu-local') {
    if (Test-Path -LiteralPath $stderrLog) {
        Get-Content -LiteralPath $stderrLog -Encoding utf8 | Select-Object -Last 40
    }
    throw "Local control service did not become ready on port $Port."
}

[pscustomobject]@{
    Status = 'started'
    Port = $Port
    Pid = $process.Id
    Url = "http://127.0.0.1:$Port"
}

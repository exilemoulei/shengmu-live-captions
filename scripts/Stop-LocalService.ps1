[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverFile = Join-Path $root 'scripts\local-service\server.mjs'
$pidFile = Join-Path $root 'scripts\local-service\server.pid'
$pattern = [regex]::Escape($serverFile)

$targets = @(
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'node.exe' -and
            $_.CommandLine -and
            $_.CommandLine -match $pattern
        } |
        Select-Object -ExpandProperty ProcessId -Unique
)

$stopped = @()
foreach ($processId in $targets) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    $stopped += $processId
}

if (Test-Path -LiteralPath $pidFile) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

[pscustomobject]@{
    Service = 'local-control'
    StoppedPids = if ($stopped.Count) { $stopped -join ',' } else { '' }
}

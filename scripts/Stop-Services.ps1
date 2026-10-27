[CmdletBinding()]
param(
    [int]$TranslationPort = 8013,
    [int]$WlkPort = 8010
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$research = Join-Path $root '.research'

function Stop-ScopedProcesses {
    param(
        [string]$Label,
        [scriptblock]$Filter
    )

    $processes = @(
        Get-CimInstance Win32_Process |
            Where-Object $Filter
    )
    $processIds = @($processes | Select-Object -ExpandProperty ProcessId -Unique)
    foreach ($processId in $processIds) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    [pscustomobject]@{
        Service = $Label
        StoppedPids = if ($processIds.Count) { $processIds -join ',' } else { '' }
    }
}

$translationPattern = '--port\s+' + [regex]::Escape($TranslationPort.ToString()) + '\b'
$translationRootPattern = [regex]::Escape($research)
Stop-ScopedProcesses -Label 'translation' -Filter {
    $_.Name -eq 'llama-server.exe' -and
    $_.CommandLine -match $translationRootPattern -and
    $_.CommandLine -match $translationPattern
}

$wlkPortPattern = '--port\s+' + [regex]::Escape($WlkPort.ToString()) + '\b'
Stop-ScopedProcesses -Label 'whisperlivekit' -Filter {
    $_.Name -in @('python.exe', 'pythonw.exe', 'whisperlivekit-server.exe') -and
    $_.CommandLine -match $translationRootPattern -and
    $_.CommandLine -match 'whisperlivekit-server' -and
    $_.CommandLine -match $wlkPortPattern
}

Start-Sleep -Seconds 1
foreach ($port in @($TranslationPort, $WlkPort)) {
    $remaining = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Warning "Port $port is still listening by PID $(($remaining.OwningProcess | Select-Object -Unique) -join ','). It was not stopped because it did not match this project's command line."
    }
}

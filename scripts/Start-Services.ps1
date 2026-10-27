[CmdletBinding()]
param(
    [int]$TranslationPort = 8013,
    [int]$WlkPort = 8010,
    [switch]$Restart,
    [switch]$AsrOnly,
    [switch]$TranslateOnComplete,
    [double]$PauseSegmentationSeconds = 1.0,
    [double]$TranslationMaxSegmentSeconds = 2.5,
    [string]$Glossary = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$research = Join-Path $root '.research'
$logs = Join-Path $root 'logs'
$translationScript = Join-Path $research 'start_translation_server.ps1'
$wlkServer = Join-Path $research 'wlk-venv\Scripts\whisperlivekit-server.exe'
$wlkWorkdir = Join-Path $research 'WhisperLiveKit'
$translationAlias = 'Index-Translate-9B'

New-Item -ItemType Directory -Path $logs -Force | Out-Null

function Get-PortListeners([int]$Port) {
    @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
}

function Wait-ForHealth([string]$Uri, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $health = Invoke-RestMethod -Uri $Uri -TimeoutSec 3
            if ($health.status -eq 'ok') {
                return $health
            }
        } catch {
        }
        Start-Sleep -Seconds 2
    } until ((Get-Date) -gt $deadline)
    return $null
}

function ConvertTo-ProcessArgument([string]$Value) {
    if ($Value.Length -eq 0) {
        return '""'
    }
    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    $builder = [Text.StringBuilder]::new()
    [void]$builder.Append('"')
    $backslashes = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq '\') {
            $backslashes += 1
            continue
        }
        if ($character -eq '"') {
            [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
            [void]$builder.Append('"')
            $backslashes = 0
            continue
        }
        if ($backslashes -gt 0) {
            [void]$builder.Append(('\' * $backslashes))
            $backslashes = 0
        }
        [void]$builder.Append($character)
    }
    if ($backslashes -gt 0) {
        [void]$builder.Append(('\' * ($backslashes * 2)))
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

if (-not $AsrOnly -and -not (Test-Path -LiteralPath $translationScript)) {
    throw "Translation launcher not found: $translationScript"
}
if (-not (Test-Path -LiteralPath $wlkServer)) {
    throw "WhisperLiveKit launcher not found: $wlkServer"
}

if ($Restart) {
    & (Join-Path $PSScriptRoot 'Stop-Services.ps1') `
        -TranslationPort $TranslationPort `
        -WlkPort $WlkPort
}

if ($AsrOnly) {
    $translationStart = [pscustomobject]@{
        Status = 'skipped'
        Port = $TranslationPort
        Model = 'ASR only'
        Pid = ''
    }
    $leftoverTranslation = @(Get-PortListeners $TranslationPort)
    if ($leftoverTranslation.Count -gt 0) {
        Write-Warning "Port $TranslationPort is still serving a translation model. Stop it (or use -Restart) to free GPU memory."
    }
} else {
    $translationListeners = Get-PortListeners $TranslationPort
    if ($translationListeners.Count -eq 0) {
        $translationStart = & $translationScript `
            -Port $TranslationPort `
            -Alias $translationAlias `
            -ContextSize 2048
    } else {
        try {
            $models = Invoke-RestMethod "http://127.0.0.1:$TranslationPort/v1/models" -TimeoutSec 5
            $loadedAliases = @(
                $models.data |
                    Select-Object -ExpandProperty id -Unique
            )
            if ($loadedAliases -notcontains $translationAlias) {
                throw "Port $TranslationPort is serving: $($loadedAliases -join ', ')"
            }
        } catch {
            throw "Port $TranslationPort is occupied but does not expose $translationAlias. Use -Restart only after confirming the process is yours. $($_.Exception.Message)"
        }
        $translationStart = [pscustomobject]@{
            Status = 'running'
            Port = $TranslationPort
            Model = $translationAlias
            Pid = $translationListeners -join ','
        }
    }

    $translationHealth = Wait-ForHealth "http://127.0.0.1:$TranslationPort/health" 120
    if (-not $translationHealth) {
        throw "Translation server did not become ready on port $TranslationPort."
    }
}

$wlkListeners = Get-PortListeners $WlkPort
if ($wlkListeners.Count -gt 0) {
    $wlkHealth = Wait-ForHealth "http://127.0.0.1:$WlkPort/health" 10
    if (-not $wlkHealth) {
        throw "Port $WlkPort is occupied but WhisperLiveKit health check failed. Use -Restart to replace this project's service."
    }
    $wlkStatus = 'running'
    if ($AsrOnly) {
        throw "WhisperLiveKit is already running on port $WlkPort and may still translate. Use -Restart to apply ASR-only mode."
    }
} else {
    $wlkArgs = @(
        '--host', '127.0.0.1',
        '--port', $WlkPort.ToString(),
        '--backend', 'faster-whisper',
        '--model', 'large-v3-turbo',
        '--lan', 'en',
        '--pause-segmentation-seconds', $PauseSegmentationSeconds.ToString(
            [Globalization.CultureInfo]::InvariantCulture
        ),
        '--pcm-input',
        '--backend-policy', 'localagreement',
        '--asr-coalesce-min-s', '0.5',
        '--localagreement-beam-size', '1',
        '--retention-seconds', '300',
        '--buffer_trimming', 'segment',
        '--buffer_trimming_sec', '4',
        '--log-level', 'INFO'
    )
    if (-not $AsrOnly) {
        $wlkArgs += @(
            '--target-language', 'zh',
            '--translation-backend', 'openai',
            '--openai-translation-url', "http://127.0.0.1:$TranslationPort/v1",
            '--openai-translation-model', $translationAlias,
            '--openai-translation-max-tokens', '768',
            '--openai-translation-max-segment-seconds', $TranslationMaxSegmentSeconds.ToString(
                [Globalization.CultureInfo]::InvariantCulture
            )
        )
    }
    if ($TranslateOnComplete -and -not $AsrOnly) {
        $wlkArgs += '--translate-on-complete'
    }
    if ($Glossary -and -not $AsrOnly) {
        $wlkArgs += @('--openai-translation-glossary', $Glossary)
    }

    $stdoutLog = Join-Path $logs 'wlk.stdout.log'
    $stderrLog = Join-Path $logs 'wlk.stderr.log'
    $wlk = Start-Process `
        -FilePath $wlkServer `
        -ArgumentList (($wlkArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ') `
        -WorkingDirectory $wlkWorkdir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    $wlkHealth = Wait-ForHealth "http://127.0.0.1:$WlkPort/health" 180
    if (-not $wlkHealth) {
        if (Test-Path -LiteralPath $stderrLog) {
            Get-Content -LiteralPath $stderrLog -Encoding utf8 |
                Select-Object -Last 80
        }
        throw "WhisperLiveKit did not become ready on port $WlkPort."
    }
    $wlkStatus = 'started'
}

[pscustomobject]@{
    Translation = $translationStart.Status
    TranslationPort = if ($AsrOnly) { 'disabled' } else { $TranslationPort }
    TranslationModel = if ($AsrOnly) { 'ASR only' } else { $translationAlias }
    Wlk = $wlkStatus
    WlkPort = $WlkPort
    WlkBackend = 'faster-whisper'
    WlkModel = 'large-v3-turbo'
    TranslateOnComplete = if ($AsrOnly) { $false } else { [bool]$TranslateOnComplete }
    PauseSegmentationSeconds = $PauseSegmentationSeconds
    TranslationMaxSegmentSeconds = $TranslationMaxSegmentSeconds
    Glossary = if ($AsrOnly) { '' } else { $Glossary }
} | Format-List

[CmdletBinding()]
param(
    [int]$TranslationPort = 8013,
    [int]$WlkPort = 8010,
    [switch]$Restart,
    [switch]$AsrOnly,
    [switch]$TranslateOnComplete,
    [double]$PauseSegmentationSeconds = 1.0,
    [double]$TranslationMaxSegmentSeconds = 2.5,
    [string]$Glossary = '',
    [string]$TranslationModel = '9b-q4km',
    [string]$TranslationModelPath = '',
    [string]$AsrModel = 'large-v3-turbo'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$research = Join-Path $root '.research'
$logs = Join-Path $root 'logs'
$translationScript = Join-Path $research 'start_translation_server.ps1'
$wlkServer = Join-Path $research 'wlk-venv\Scripts\whisperlivekit-server.exe'
$wlkWorkdir = Join-Path $research 'WhisperLiveKit'

New-Item -ItemType Directory -Path $logs -Force | Out-Null

# Local translation presets. The popup offers the same ids through the local
# control service, so keep the mapping here as the single source of truth.
$translationPresets = @{
    '9b-q4km' = @{
        Alias = 'Index-Translate-9B'
        Path = (Join-Path $research 'models\index-translate-9b\Index-Translate-9B.Q4_K_M.gguf')
        Label = 'Index-Translate-9B Q4_K_M'
    }
    '2b-iq4xs' = @{
        Alias = 'Index-Translate-2B'
        Path = (Join-Path $research 'models\index-translate-2b\Index-Translate-2B.IQ4_XS.gguf')
        Label = 'Index-Translate-2B IQ4_XS'
    }
}

$asrModels = @('large-v3-turbo', 'medium', 'small', 'base')

if ($TranslationModelPath) {
    $translationModelPath = $TranslationModelPath
    $translationAlias = [IO.Path]::GetFileNameWithoutExtension($translationModelPath)
    $translationLabel = $translationAlias
} else {
    if (-not $translationPresets.ContainsKey($TranslationModel)) {
        throw "Unknown translation model '$TranslationModel'. Known: $($translationPresets.Keys -join ', ')"
    }
    $preset = $translationPresets[$TranslationModel]
    $translationModelPath = $preset.Path
    $translationAlias = $preset.Alias
    $translationLabel = $preset.Label
}
$translationModelPath = [IO.Path]::GetFullPath($translationModelPath)
if (-not $AsrOnly -and -not (Test-Path -LiteralPath $translationModelPath)) {
    throw "Translation model file not found: $translationModelPath. Download $translationLabel from https://huggingface.co/IndexTeam first."
}
if ($asrModels -notcontains $AsrModel) {
    throw "Unknown ASR model '$AsrModel'. Known: $($asrModels -join ', ')"
}

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
            -ModelPath $translationModelPath `
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
        '--model', $AsrModel,
        '--lan', 'en',
        '--pause-segmentation-seconds', $PauseSegmentationSeconds.ToString(
            [Globalization.CultureInfo]::InvariantCulture
        ),
        '--pcm-input',
        '--backend-policy', 'localagreement',
        # Kept at 0.5 s on purpose: dropping it to 0.3 produced a decode pass
        # twice as often, which turned 54% of the lines into fragments such as
        # "The." / "现在。" on the 120 s quality sample.
        '--asr-coalesce-min-s', '0.5',
        # Beam 3 instead of greedy: fast speech needs the second opinion, and
        # two decodes that never agree are what force a buffer reset.
        '--localagreement-beam-size', '3',
        '--retention-seconds', '300',
        # 10 s (upstream default 15) instead of 4: a sentence that fails to
        # commit is trimmed instead of being thrown away wholesale.
        '--buffer_trimming', 'segment',
        '--buffer_trimming_sec', '10',
        # Commit words with probability > 0.95 without waiting for a second
        # agreeing pass: CJK subtitles land ~0.5 s earlier per line.
        '--confidence-validation',
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

    # Whisper model downloads go through huggingface_hub. Its Xet transfer
    # protocol stalls behind the local proxy on this machine, while the plain
    # HTTP path completes normally. Set it only when the caller is neutral.
    if (-not $env:HF_HUB_DISABLE_XET) { $env:HF_HUB_DISABLE_XET = '1' }
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

    # A first run with an uncached ASR model has to download ~1.5 GB from
    # Hugging Face before /health answers, which can exceed three minutes.
    $wlkHealth = Wait-ForHealth "http://127.0.0.1:$WlkPort/health" 600
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
    WlkModel = $AsrModel
    TranslationLabel = if ($AsrOnly) { 'ASR only' } else { $translationLabel }
    TranslationModelPath = if ($AsrOnly) { '' } else { $translationModelPath }
    TranslateOnComplete = if ($AsrOnly) { $false } else { [bool]$TranslateOnComplete }
    PauseSegmentationSeconds = $PauseSegmentationSeconds
    TranslationMaxSegmentSeconds = $TranslationMaxSegmentSeconds
    Glossary = if ($AsrOnly) { '' } else { $Glossary }
} | Format-List

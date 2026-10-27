[CmdletBinding()]
param(
    [int]$Port = 9223,
    [string]$ExtensionPath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $ExtensionPath) {
    $ExtensionPath = Join-Path $root 'extension'
}
$ExtensionPath = (Resolve-Path -LiteralPath $ExtensionPath).Path

try {
    $version = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 5
} catch {
    throw "Chrome DevTools endpoint is unavailable on port $Port. Start Chrome with remote debugging first."
}

$node = (Get-Command node -ErrorAction Stop).Source
$loader = Join-Path $PSScriptRoot 'load-extension.mjs'
$result = & $node $loader $version.webSocketDebuggerUrl $ExtensionPath
if ($LASTEXITCODE -ne 0) {
    throw "Chrome rejected the unpacked extension."
}
$result

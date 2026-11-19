$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$botPath = Join-Path $projectRoot 'bot.js'
$launcherStatusPath = Join-Path $projectRoot 'launcher-status.json'

function Set-LauncherStatus([string]$state) {
  # Deliberately no credentials, command arguments, or raw exception details.
  @{ state = $state; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $launcherStatusPath -Encoding utf8
}

Set-LauncherStatus 'awaiting_app_id'
Write-Host 'VGRO AI Education Operations Director V1.0 - Secure Lark Bot Start' -ForegroundColor Cyan
Write-Host 'Credentials stay in this process only and are never written to files or logs.'
Write-Host ''

$appId = (Read-Host 'Enter Lark App ID (cli_...)').Trim()
if ($appId -notmatch '^cli_[A-Za-z0-9]+$') {
  Set-LauncherStatus 'invalid_app_id_format'
  Write-Host 'Invalid App ID format. It must start with cli_.' -ForegroundColor Red
  exit 1
}
Set-LauncherStatus 'awaiting_app_secret'

$secureSecret = Read-Host 'Enter Lark App Secret (input is hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)

$env:LARK_APP_ID = $appId
$env:LARK_APP_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
Set-LauncherStatus 'starting_node'

Set-Location -LiteralPath $projectRoot
Write-Host ''
Write-Host 'Connecting by Lark Persistent Connection. Keep this window open.' -ForegroundColor Yellow
& node $botPath

[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
Remove-Item Env:LARK_APP_ID -ErrorAction SilentlyContinue
Remove-Item Env:LARK_APP_SECRET -ErrorAction SilentlyContinue


$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$botPath = Join-Path $projectRoot 'bot.js'
$nodePath = Join-Path $projectRoot '.runtime\node-v26.13.1-win-x64\node.exe'
$appId = 'cli_aac258937bf8ded0'

Write-Host 'VGRO AI Education Operations Director V1.0 - Secure Lark Bot Start' -ForegroundColor Cyan
Write-Host 'Paste the Lark App Secret only. It is hidden, never saved, and never logged.'
Write-Host ''

$secureSecret = Read-Host 'Enter Lark App Secret' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)
try {
  $env:LARK_APP_ID = $appId
  $env:LARK_APP_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  Set-Location -LiteralPath $projectRoot
  Write-Host ''
  Write-Host 'Starting Lark Bot in the background...' -ForegroundColor Yellow
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Bundled Node runtime is missing.' }
  # Detached child inherits credentials only in memory; this launcher can be closed afterward.
  Start-Process -FilePath $nodePath -ArgumentList ('"' + $botPath + '"') -WindowStyle Hidden
  Write-Host 'Bot started in the background. You may close this PowerShell window.' -ForegroundColor Green
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  Remove-Item Env:LARK_APP_ID -ErrorAction SilentlyContinue
  Remove-Item Env:LARK_APP_SECRET -ErrorAction SilentlyContinue
}

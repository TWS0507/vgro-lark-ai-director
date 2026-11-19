param(
  [Parameter(Mandatory = $true)]
  [string]$AppId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$botPath = Join-Path $projectRoot 'bot.js'
$nodePath = Join-Path $projectRoot '.runtime\node-v26.13.1-win-x64\node.exe'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'VGRO AI Education Operations Director V1.0 - Lark Bot'
$form.Size = New-Object System.Drawing.Size(520, 245)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$intro = New-Object System.Windows.Forms.Label
$intro.Text = 'Paste the Lark App Secret, then click Connect Lark. It is never saved, displayed, or logged.'
$intro.Location = New-Object System.Drawing.Point(24, 22)
$intro.Size = New-Object System.Drawing.Size(455, 42)
$form.Controls.Add($intro)

$appLabel = New-Object System.Windows.Forms.Label
$appLabel.Text = 'App ID'
$appLabel.Location = New-Object System.Drawing.Point(24, 80)
$appLabel.AutoSize = $true
$form.Controls.Add($appLabel)

$appText = New-Object System.Windows.Forms.TextBox
$appText.Text = $AppId
$appText.ReadOnly = $true
$appText.Location = New-Object System.Drawing.Point(130, 76)
$appText.Size = New-Object System.Drawing.Size(350, 26)
$form.Controls.Add($appText)

$secretLabel = New-Object System.Windows.Forms.Label
$secretLabel.Text = 'App Secret'
$secretLabel.Location = New-Object System.Drawing.Point(24, 120)
$secretLabel.AutoSize = $true
$form.Controls.Add($secretLabel)

$secretText = New-Object System.Windows.Forms.TextBox
$secretText.UseSystemPasswordChar = $true
$secretText.Location = New-Object System.Drawing.Point(130, 116)
$secretText.Size = New-Object System.Drawing.Size(350, 26)
$form.Controls.Add($secretText)

$connectButton = New-Object System.Windows.Forms.Button
$connectButton.Text = 'Connect Lark'
$connectButton.Location = New-Object System.Drawing.Point(350, 165)
$connectButton.Size = New-Object System.Drawing.Size(130, 34)
$connectButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($secretText.Text)) {
    [System.Windows.Forms.MessageBox]::Show('Enter the App Secret.', 'Missing credential') | Out-Null
    return
  }
  $env:LARK_APP_ID = $AppId
  $env:LARK_APP_SECRET = $secretText.Text
  $secretText.Clear()
  $form.Hide()
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Bundled Node runtime is missing.' }
  Start-Process -FilePath $nodePath -ArgumentList ('"' + $botPath + '"') -WindowStyle Hidden
  Remove-Item Env:LARK_APP_ID -ErrorAction SilentlyContinue
  Remove-Item Env:LARK_APP_SECRET -ErrorAction SilentlyContinue
  $form.Close()
})
$form.Controls.Add($connectButton)
$form.AcceptButton = $connectButton
$form.Add_Shown({ $secretText.Focus() })
[void]$form.ShowDialog()

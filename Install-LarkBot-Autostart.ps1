$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startupScript = Join-Path $projectRoot 'Start-BackgroundLarkBot.ps1'
$credentialTarget = 'VGRO.LarkBot.AppSecret'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VgroCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CREDENTIAL {
    public uint Flags, Type; public string TargetName, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount; public IntPtr Attributes; public string TargetAlias, UserName;
  }
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
}
'@

Write-Host 'VGRO Lark Bot automatic startup setup' -ForegroundColor Cyan
Write-Host 'Enter the App Secret once. It will be encrypted in Windows Credential Manager for this Windows account only.'
$secure = Read-Host 'Lark App Secret' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $blob = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($secret)
  try {
    $credential = New-Object VgroCredentialWriter+CREDENTIAL
    $credential.Type = 1; $credential.TargetName = $credentialTarget; $credential.Persist = 2; $credential.UserName = 'VGRO Lark Bot'
    $credential.CredentialBlob = $blob; $credential.CredentialBlobSize = [uint32]($secret.Length * 2)
    if (-not [VgroCredentialWriter]::CredWrite([ref]$credential, 0)) { throw 'Windows Credential Manager could not save the credential.' }
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($blob) }
} finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

$taskName = 'VGRO Lark Bot AutoStart'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startupScript`""
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Description 'Starts the VGRO Lark Bot after this Windows user logs in.' -Force | Out-Null
& $startupScript
Write-Host 'Automatic startup is enabled. You may close this window.' -ForegroundColor Green

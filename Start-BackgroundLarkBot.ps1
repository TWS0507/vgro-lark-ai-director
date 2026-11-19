$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$botPath = Join-Path $projectRoot 'bot.js'
$nodePath = Join-Path $projectRoot '.runtime\node-v26.13.1-win-x64\node.exe'
$appId = 'cli_aac258937bf8ded0'
$credentialTarget = 'VGRO.LarkBot.AppSecret'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class VgroCredentialReader {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct CREDENTIAL {
    public uint Flags, Type; public string TargetName, Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist, AttributeCount; public IntPtr Attributes; public string TargetAlias, UserName;
  }
  [DllImport("Advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("Advapi32.dll")] public static extern void CredFree(IntPtr buffer);
}
'@

function Get-Secret([string]$target) {
  $pointer = [IntPtr]::Zero
  if (-not [VgroCredentialReader]::CredRead($target, 1, 0, [ref]$pointer)) { throw 'Saved Lark credential was not found. Run Install-LarkBot-Autostart.ps1 again.' }
  try {
    $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][VgroCredentialReader+CREDENTIAL])
    return [Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, [int]($credential.CredentialBlobSize / 2))
  } finally { if ($pointer -ne [IntPtr]::Zero) { [VgroCredentialReader]::CredFree($pointer) } }
}

if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Bundled Node runtime is missing.' }
$alreadyRunning = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*$botPath*" }
if ($alreadyRunning) { exit 0 }

$env:LARK_APP_ID = $appId
$env:LARK_APP_SECRET = Get-Secret $credentialTarget
try { Start-Process -FilePath $nodePath -ArgumentList ('"' + $botPath + '"') -WindowStyle Hidden }
finally { Remove-Item Env:LARK_APP_ID -ErrorAction SilentlyContinue; Remove-Item Env:LARK_APP_SECRET -ErrorAction SilentlyContinue }

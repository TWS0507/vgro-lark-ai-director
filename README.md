# VGRO AI 教育运营总监 V1.0 — Lark Bot test

## 24/7 Railway service

Deploy this repository as a Railway service. In Railway Variables, set `RUN_MODE=cloud`, `LARK_APP_ID`, `LARK_APP_SECRET`, `LARK_BASE_APP_TOKEN`, and `LARK_QC_WEEKLY_TABLE_ID`. Never commit those values. Cloud mode reads Lark Base and does not access the computer's Excel file.

This is an isolated local test client for Lark Persistent Connection. It does not read QC Excel files, Lark Base, or teacher data.

## Recommended secure start

Right-click `Start-LarkBot.ps1` and choose **Run with PowerShell**, or run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\Start-LarkBot.ps1
```

The launcher asks for the App ID and hides App Secret input. Credentials stay in process memory only and are removed when the bot stops.

`Launch-LarkBot-GUI.ps1` provides an equivalent password-field dialog for a simpler local test flow.

## Alternative: set variables manually

```powershell
$env:LARK_APP_ID = 'cli_your_app_id'
$env:LARK_APP_SECRET = 'your_app_secret'
npm start
```

The two variables exist only in that PowerShell process. Closing the window clears them. Do not paste real credentials into source files, chat, Git, screenshots, or logs.

When the console reports that the WebSocket client is ready, return to Lark Developer Console and click **Verify**. Then send the bot a private text message containing exactly `Hello`.

For safe diagnosis, `status.json` records only the current connection state and time. It never contains credentials, message content, identifiers, or raw errors.

Expected reply:

```text
VGRO AI 教育运营总监 V1.0 已成功连接！
```

Keep this process running during the test. Closing PowerShell, stopping Node, sleeping/shutting down the computer, or losing the network will interrupt the connection.

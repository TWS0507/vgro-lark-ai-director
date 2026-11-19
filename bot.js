'use strict';

const Lark = require('@larksuiteoapi/node-sdk');
const fs = require('fs');
const path = require('path');
const { readRows, answerQuestion } = require('./qc-data');
const { syncSample, readCurrentWeek } = require('./base-sync');
const { state: alertState, save: saveAlertState, notify, buildAlerts, formatAlertSummary } = require('./alerts');
const { report } = require('./report');
const { qcChart } = require('./charts');
const { createGuard, watchExcel } = require('./sync-guard');
const { answerManagementQuestion } = require('./query-engine');

const APP_ID = process.env.LARK_APP_ID;
const APP_SECRET = process.env.LARK_APP_SECRET;
const RUN_MODE = process.env.RUN_MODE || 'local';
const SUCCESS_REPLY = 'VGRO AI 教育运营总监 V1.0 已成功连接！';
const DEDUP_TTL_MS = 10 * 60 * 1000;
const processedMessageIds = new Map();
const chartSessions = new Map();
const CHART_SESSION_TTL_MS = 10 * 60 * 1000;
const STATUS_FILE = path.join(__dirname, 'status.json');

function setStatus(state) {
  // Keep this intentionally credential-free: no IDs, secrets, messages, or raw errors.
  fs.writeFileSync(STATUS_FILE, JSON.stringify({ state, updatedAt: new Date().toISOString() }, null, 2));
}

function requireCredentials() {
  const missing = [];
  if (!APP_ID) missing.push('LARK_APP_ID');
  if (!APP_SECRET) missing.push('LARK_APP_SECRET');

  if (missing.length > 0) {
    setStatus('missing_credentials');
    console.error(`[startup] Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('[startup] No credential values were logged. Set them in this PowerShell process, then run npm start again.');
    process.exit(1);
  }

  if (!/^cli_[A-Za-z0-9]+$/.test(APP_ID)) {
    setStatus('invalid_app_id_format');
    console.error('[startup] LARK_APP_ID does not match the expected cli_... format.');
    process.exit(1);
  }
}

function pruneDedupCache(now = Date.now()) {
  for (const [messageId, expiresAt] of processedMessageIds) {
    if (expiresAt <= now) processedMessageIds.delete(messageId);
  }
}

function markMessageOnce(messageId) {
  const now = Date.now();
  pruneDedupCache(now);
  if (!messageId || processedMessageIds.has(messageId)) return false;
  processedMessageIds.set(messageId, now + DEDUP_TTL_MS);
  return true;
}

function parseTextContent(content) {
  if (typeof content !== 'string') return '';
  try {
    const parsed = JSON.parse(content);
    return typeof parsed.text === 'string' ? parsed.text.trim() : '';
  } catch {
    return '';
  }
}

function chartMenu() {
  return '请选择要查看的图表：\n1. QC 图表\n2. 运营图表\n\n请直接回复数字 1 或 2。';
}

function qcChartMenu() {
  return '请选择 QC 图表类型：\n1. 出席率\n2. 功课完成率\n3. 听写\n4. 测验完成率\n5. 测验正确率\n0. 返回上一级\n\n请直接回复数字。';
}

function setChartSession(chatId, stage) {
  if (chatId) chartSessions.set(chatId, { stage, expiresAt: Date.now() + CHART_SESSION_TTL_MS });
}

function chartNumberChoice(chatId, text) {
  if (!/^\d+$/.test(text.trim()) || !chatId) return null;
  const session = chartSessions.get(chatId);
  if (!session || session.expiresAt < Date.now()) { chartSessions.delete(chatId); return null; }
  const choice = text.trim();
  session.expiresAt = Date.now() + CHART_SESSION_TTL_MS;
  if (session.stage === 'root') {
    if (choice === '1') { setChartSession(chatId, 'qc'); return { type: 'qc_menu' }; }
    if (choice === '2') { chartSessions.delete(chatId); return { type: 'operations' }; }
    return { type: 'invalid_root' };
  }
  if (session.stage === 'qc') {
    if (choice === '0') { setChartSession(chatId, 'root'); return { type: 'root_menu' }; }
    chartSessions.delete(chatId);
    const metrics = {
      '1': { type: 'qc', metric: 'attendance', label: '出席率' },
      '2': { type: 'qc', metric: 'homework', label: '功课完成率' },
      '3': { type: 'dictation' },
      '4': { type: 'qc', metric: 'quizCompletion', label: '测验完成率' },
      '5': { type: 'qc', metric: 'quizAccuracy', label: '测验正确率' },
    };
    return metrics[choice] || { type: 'invalid_qc' };
  }
  return null;
}

function chartRequest(text) {
  const value = text.toLowerCase();
  const selectionOnly = /^(qc|运营|出席|功课|听写|测验|测验完成率|测验正确率)$/i.test(text.trim());
  const asksChart = /图表|chart/.test(value) || selectionOnly;
  if (!asksChart) return null;
  if (/运营|operation/.test(value)) return { type: 'operations' };
  if (/听写|dictation/.test(value)) return { type: 'dictation' };
  if (/出席|attendance/.test(value)) return { type: 'qc', metric: 'attendance', label: '出席率' };
  if (/功课|homework/.test(value)) return { type: 'qc', metric: 'homework', label: '功课完成率' };
  if (/测验|quiz/.test(value) && /正确|accuracy|correct/.test(value)) return { type: 'qc', metric: 'quizAccuracy', label: '测验正确率' };
  if (/测验|quiz/.test(value)) return { type: 'qc', metric: 'quizCompletion', label: '测验完成率' };
  if (/图表|chart|qc/.test(value)) return { type: 'menu' };
  return null;
}

async function main() {
  setStatus('starting');
  requireCredentials();

  const clientOptions = {
    appId: APP_ID,
    appSecret: APP_SECRET,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Lark,
  };

  const apiClient = new Lark.Client(clientOptions);
  const wsClient = new Lark.WSClient(clientOptions);

  const eventDispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const message = data && data.message;
      const sender = data && data.sender;
      const messageId = message && message.message_id;
      if (message && message.chat_id) saveAlertState({ ...alertState(), chatId: message.chat_id });

      if (!markMessageOnce(messageId)) {
        console.log('[event] Duplicate or invalid message ignored.');
        return;
      }

      if (sender && sender.sender_type === 'app') return;
      if (!message || message.message_type !== 'text') return;
      const incomingText = parseTextContent(message.content);
      const isHello = incomingText.toLowerCase() === 'hello';
      let replyText = isHello ? SUCCESS_REPLY : null;
      if (!replyText && /异常摘要|异常提醒|风险摘要/.test(incomingText)) {
        try { replyText = formatAlertSummary(buildAlerts(readRows())); }
        catch { replyText = 'QC 主档目前无法读取，因此不能生成异常摘要。'; }
      }
      if (!replyText) replyText = answerManagementQuestion(incomingText);
      if (!replyText && /准备.*老师.*报告|教师.*报告|teacher.*report/i.test(incomingText)) replyText = report();
      let requestedChart = chartRequest(incomingText);
      const numberChoice = chartNumberChoice(message.chat_id, incomingText);
      if (numberChoice) requestedChart = numberChoice;
      if (!replyText && requestedChart?.type === 'menu') { setChartSession(message.chat_id, 'root'); replyText = chartMenu(); }
      if (!replyText && requestedChart?.type === 'root_menu') replyText = chartMenu();
      if (!replyText && requestedChart?.type === 'qc_menu') replyText = qcChartMenu();
      if (!replyText && requestedChart?.type === 'invalid_root') replyText = '请输入 1（QC 图表）或 2（运营图表）。';
      if (!replyText && requestedChart?.type === 'invalid_qc') replyText = '请输入 1 至 5，或输入 0 返回上一级。';
      if (!replyText && requestedChart?.type === 'operations') replyText = '运营图表尚未建立可验证的数据来源，因此我不能生成数字或图表。连接运营数据后，这个选项会自动启用。';
      if (!replyText && requestedChart?.type === 'dictation') replyText = '目前 QC 主档没有「听写」的完成／正确分子与分母，无法生成真实听写图表。请先在主档加入该数据字段后再使用此选项。';
      if (!replyText && requestedChart?.type === 'qc') {
        try { const chart = await qcChart(requestedChart.metric); const image = await apiClient.im.image.create({ data: { image_type: 'message', image: fs.createReadStream(chart) } }); if(image?.image_key){ await apiClient.im.message.create({params:{receive_id_type:'chat_id'},data:{receive_id:message.chat_id,content:JSON.stringify({image_key:image.image_key}),msg_type:'image'}}); replyText=`本周 QC ${requestedChart.label}图表已发送。`; } else replyText='图表上传失败。'; } catch (error) { replyText = error?.message === 'No valid numerator and denominator for this QC chart' ? `本周 QC 主档没有有效的${requestedChart.label}分子与分母，因此无法生成真实图表。` : '图表生成或发送失败，现有数据未受影响。'; }
      }
      if (!replyText && incomingText.trim() === '同步 QC 测试') { try { const r=await syncSample(apiClient); replyText=`QC_WEEKLY 同步成功：${r.count} 条（新增 ${r.created}，更新 ${r.updated}）。`; } catch { replyText='QC Base 同步失败：请确认 bitable:app 已发布且应用拥有 Base 权限。'; } }
      if (!replyText) {
        try { replyText = answerQuestion(incomingText, await readCurrentWeek(apiClient)); if(replyText) replyText += '\n来源：Lark Base QC_WEEKLY'; }
        catch { try { replyText = answerQuestion(incomingText, readRows()); if(replyText) replyText += '\n来源：QC Excel（Base 暂不可读）'; } catch { replyText = 'QC 数据目前无法读取，因此不能生成数字。请先确认主档已成功更新。'; } }
      }
      if (!replyText) replyText = '我目前可回答：本周/上周整体出席率、平均班级出席率、最低三班、Mathematics 与 Science 出席率比较，以及本周较上周变化。请换一种问法。';

      try {
        const response = await apiClient.im.message.reply({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify({ text: replyText }),
            msg_type: 'text',
          },
        });

        if (response.code === 0) {
          console.log('[reply] Sent the Hello test reply successfully.');
        } else {
          console.error(`[reply] Lark API rejected the reply (code ${response.code}; message omitted if sensitive).`);
        }
      } catch (error) {
        console.error(`[reply] Failed to send reply: ${error && error.message ? error.message : 'unknown error'}`);
      }
    },
  });

  const stop = async (signal) => {
    console.log(`[shutdown] ${signal} received; closing the WebSocket client.`);
    try {
      wsClient.close();
    } finally {
      setStatus('stopped');
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));

  console.log('[startup] Credentials are present; values will never be logged.');
  console.log('[startup] Connecting to Lark by Persistent Connection...');
  await wsClient.start({ eventDispatcher });
  setStatus('connected');
  console.log('[startup] WebSocket connected and ready to receive im.message.receive_v1.');
  if (RUN_MODE === 'local') {
    try {
      await syncSample(apiClient);
      // After an offline period, notify only after the freshly read workbook has verified into Base.
      await notify(apiClient, alertState().chatId, readRows());
      console.log('[sync] Initial current-week QC sync completed.');
    }
    catch { console.error('[sync] Initial QC sync failed; existing verified Base data was left unchanged.'); }
  }
  const qcFile = process.env.QC_MASTER_PATH || 'C:/Users/Tee Wen Sheng/OneDrive/桌面/VGRO_Weekly_Subject_QC_Master.xlsx';
  const guardedSync = createGuard();
  const syncAfterStableChange = async () => {
    try {
      const result = await guardedSync(qcFile, () => syncSample(apiClient));
      // Alerts are derived only from the newly stable file, and only after Base upsert succeeds.
      if (!result.skipped) await notify(apiClient, alertState().chatId, readRows(qcFile));
    } catch {
      // Preserve the last verified Base data and never send a new alert after a failed sync.
      console.error('[sync] File change was not synced; existing verified Base data was left unchanged.');
    }
  };
  if (RUN_MODE === 'local') {
    try { watchExcel(qcFile, syncAfterStableChange); console.log('[watch] Monitoring the QC workbook for stable content changes.'); }
    catch { console.error('[watch] Workbook monitor could not start; manual sync remains available.'); }
  } else console.log('[cloud] Cloud mode: Lark Base is the source of truth; local Excel access is disabled.');
  // Keep the local test process alive even when the SDK has no referenced timers.
  setInterval(() => {}, 60 * 60 * 1000);
}

main().catch((error) => {
  setStatus('failed');
  console.error('[fatal] Bot stopped before establishing a connection. Check the App ID/App Secret and Lark app configuration.');
  process.exit(1);
});


'use strict';

const fs = require('fs');
const path = require('path');
const { readRows } = require('./qc-data');
const STATE_FILE = path.join(__dirname, 'alert-state.json');

function state() {
  try { return { sentAlertKeys: [], ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
  catch { return { sentAlertKeys: [] }; }
}
function save(value) { fs.writeFileSync(STATE_FILE, JSON.stringify(value, null, 2)); }
function rateOf(row) {
  if (!row || !Number.isFinite(row.attendanceDenominator) || row.attendanceDenominator <= 0) return null;
  return Number.isFinite(row.attendanceRate) ? row.attendanceRate : row.present / row.attendanceDenominator;
}
function previousValidRow(history, current) {
  return history.filter(row => row.className === current.className && row.subject === current.subject && row.week !== current.week && rateOf(row) !== null)
    .sort((a, b) => String(a.week).localeCompare(String(b.week))).at(-1) || null;
}
function buildAlerts(data = readRows()) {
  const alerts = [];
  for (const row of data.current) {
    const rate = rateOf(row); if (rate === null) continue;
    const base = { week: row.week, className: row.className, subject: row.subject, rate, previousRate: null, deltaPp: null, sourceTimestamp: data.sourceTimestamp };
    if (rate < 0.8) alerts.push({ ...base, type: '出席率低于 80%' });
    const previous = previousValidRow(data.history, row), previousRate = rateOf(previous);
    const deltaPp = previousRate === null ? null : (rate - previousRate) * 100;
    if (deltaPp !== null && deltaPp <= -5) alerts.push({ ...base, previousRate, deltaPp, type: '较上一个有效统计周下降至少 5pp' });
  }
  return alerts;
}
function keyOf(alert) { return [alert.week, alert.className, alert.subject, alert.type].join('|'); }
function groupedAlerts(alerts) {
  const groups = new Map();
  for (const alert of alerts) {
    const key = [alert.week, alert.className, alert.subject].join('|');
    const existing = groups.get(key) || { ...alert, types: [] };
    existing.types.push(alert.type);
    if (alert.previousRate !== null) { existing.previousRate = alert.previousRate; existing.deltaPp = alert.deltaPp; }
    groups.set(key, existing);
  }
  return [...groups.values()].sort((a, b) => a.rate - b.rate || (a.deltaPp ?? 0) - (b.deltaPp ?? 0));
}
function formatAlertSummary(alerts, limit = 3) {
  if (!alerts.length) return '✅ QC 出席异常摘要\n目前没有触发提醒规则的班级。';
  const groups = groupedAlerts(alerts), low = groups.filter(a => a.rate < 0.8).length, drop = groups.filter(a => a.types.some(type => type.includes('下降'))).length, critical = groups.filter(a => a.rate < 0.5 || (a.deltaPp !== null && a.deltaPp <= -20)).length;
  const shown = groups.slice(0, limit).map((a, index) => {
    const previous = a.previousRate === null ? '' : `｜上期 ${(a.previousRate * 100).toFixed(1)}%｜${a.deltaPp.toFixed(1)}pp`;
    const reasons = a.types.some(type => type.includes('低于')) && a.types.some(type => type.includes('下降')) ? '低出席＋明显下降' : a.types.some(type => type.includes('低于')) ? '低出席' : '明显下降';
    return `${index + 1}. ${a.className} · ${a.subject}｜${(a.rate * 100).toFixed(1)}%${previous}\n   ${reasons}${a.rate === 0 ? '｜请先核对是否已完成填报' : ''}`;
  });
  const remainder = groups.length > limit ? `\n其余 ${groups.length - limit} 项已记录，不重复推送。` : '';
  return `⚠️ QC 出席风险摘要｜${alerts[0].week}\n需跟进 ${groups.length} 项｜严重 ${critical} 项\n低于 80%：${low}｜下降 ≥5pp：${drop}\n\n【先处理这 ${shown.length} 项】\n${shown.join('\n\n')}${remainder}\n\n数据更新：${alerts[0].sourceTimestamp}`;
}
async function notify(client, chatId, data) {
  const saved = state(), known = new Set(saved.sentAlertKeys || []);
  const pending = buildAlerts(data).filter(alert => !known.has(keyOf(alert)));
  if (!chatId || pending.length === 0) return { sent: 0, pending: pending.length };
  const response = await client.im.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, content: JSON.stringify({ text: formatAlertSummary(pending) }), msg_type: 'text' } });
  if (response.code !== 0) throw new Error('Lark failed to send QC alert');
  save({ ...saved, sentAlertKeys: [...known, ...pending.map(keyOf)] });
  return { sent: pending.length, pending: pending.length };
}
module.exports = { state, save, buildAlerts, groupedAlerts, formatAlertSummary, notify, rateOf, previousValidRow };

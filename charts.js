'use strict';

const path = require('path');
const sharp = require('sharp');
const { readRows } = require('./qc-data');

const escapeXml = value => String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
const METRICS = {
  attendance: { title: '班级出席率', numerator: 'present', denominator: 'attendanceDenominator', low: 0.8, color: '#2563eb' },
  homework: { title: '功课完成率', numerator: 'homeworkCompleted', denominator: 'homeworkRequired', low: 0.8, color: '#7c3aed' },
  quizCompletion: { title: '测验完成率', numerator: 'quizCompleted', denominator: 'quizRequired', low: 0.8, color: '#0891b2' },
  quizAccuracy: { title: '测验正确率', numerator: 'quizCorrect', denominator: 'quizAnswered', low: 0.7, color: '#16a34a' },
};

async function qcChart(metricName) {
  const metric = METRICS[metricName];
  if (!metric) throw new Error('QC chart metric is unavailable');
  const data = readRows();
  const rows = data.current.map(row => {
    const numerator = row[metric.numerator], denominator = row[metric.denominator];
    return { ...row, rate: Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null };
  }).filter(row => row.rate !== null).sort((a, b) => a.rate - b.rate);
  if (rows.length === 0) throw new Error('No valid numerator and denominator for this QC chart');

  const width = 1440, left = 420, maxBar = 860, rowHeight = 42, height = 145 + rows.length * rowHeight;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="40" y="45" font-size="29" font-family="Arial, sans-serif" font-weight="bold" fill="#172554">VGRO QC ${escapeXml(metric.title)} — ${escapeXml(rows[0].week)}</text><text x="40" y="74" font-size="15" font-family="Arial, sans-serif" fill="#475569">数据更新时间：${escapeXml(data.sourceTimestamp)}　红色表示低于参考线 ${(metric.low * 100).toFixed(0)}%</text>`;
  rows.forEach((row, index) => {
    const y = 100 + index * rowHeight, bar = Math.round(row.rate * maxBar), color = row.rate < metric.low ? '#dc2626' : metric.color;
    const label = `${row.className} (${row.subject})`.slice(0, 42);
    svg += `<text x="40" y="${y + 20}" font-size="15" font-family="Arial, sans-serif" fill="#0f172a">${escapeXml(label)}</text><rect x="${left}" y="${y}" width="${maxBar}" height="24" rx="4" fill="#e2e8f0"/><rect x="${left}" y="${y}" width="${bar}" height="24" rx="4" fill="${color}"/><text x="${left + maxBar + 12}" y="${y + 19}" font-size="15" font-family="Arial, sans-serif" fill="#0f172a">${(row.rate * 100).toFixed(1)}%</text>`;
  });
  svg += '</svg>';
  const output = path.join(__dirname, `qc-${metricName}.png`);
  await sharp(Buffer.from(svg)).png().toFile(output);
  return output;
}

// Kept for compatibility with the existing image-send route.
const attendanceChart = () => qcChart('attendance');
module.exports = { qcChart, attendanceChart, METRICS };

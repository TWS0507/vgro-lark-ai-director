'use strict';
const fs = require('fs');
const XLSX = require('xlsx');
const DEFAULT_QC_FILE = 'C:/Users/Tee Wen Sheng/OneDrive/桌面/VGRO_Weekly_Subject_QC_Master.xlsx';
const na = v => v === null || v === undefined || v === '' || v === 'N/A' ? null : v;
const n = v => Number.isFinite(Number(na(v))) ? Number(v) : null;
function readRows(file = process.env.QC_MASTER_PATH || DEFAULT_QC_FILE) {
  const wb = XLSX.readFile(file, { cellFormula: false, cellDates: true });
  if (!wb.SheetNames.includes('本周班级数据') || !wb.SheetNames.includes('历史数据')) throw new Error('Required QC sheets are missing.');
  const sourceTimestamp = fs.statSync(file).mtime.toISOString();
  const parse = (sheet, headerRow) => XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: null, raw: true, range: headerRow })
    .map(r => ({ week: r['统计周'], className: r['班级名称'], subject: r['科目'], none:n(r.NONE), present:n(r.Present), absent:n(r.Absent), attendanceDenominator:n(r['出席有效分母']), attendanceRate:n(r['出席率']), homeworkCompleted:n(r['总功课完成分子']), homeworkRequired:n(r['总功课完成分母']), homeworkCorrect:n(r['总功课正确题数']), homeworkAnswered:n(r['总功课已作答题数']), quizCompleted:n(r['测验完成分子']), quizRequired:n(r['测验完成分母']), quizCorrect:n(r['测验正确题数']), quizAnswered:n(r['测验已作答题数']), sourceTimestamp }))
    .filter(r => r.week && r.className && r.subject && r.attendanceDenominator !== null);
  return { current: parse('本周班级数据', 3), history: parse('历史数据', 1), sourceTimestamp };
}
function attendanceSummary(rows) { const valid=rows.filter(r=>r.present!==null&&r.attendanceDenominator>0); const p=valid.reduce((a,r)=>a+r.present,0), d=valid.reduce((a,r)=>a+r.attendanceDenominator,0); return { rows:valid, overall:d?p/d:null, average:valid.length?valid.reduce((a,r)=>a+(r.attendanceRate ?? r.present/r.attendanceDenominator),0)/valid.length:null }; }
function answerQuestion(text, data) { const current=attendanceSummary(data.current); const week=data.current[0]?.week || 'N/A'; const t=text.toLowerCase(); let result;
  const wantsPrevious=/上(个|一)?星期|上周|last week|previous week/.test(t); const allWeeks=[...new Set(data.history.map(r=>r.week))].sort(); const previousWeek=allWeeks.filter(w=>w!==week).at(-1); const previousRows=wantsPrevious?data.history.filter(r=>r.week===previousWeek):null; const target=wantsPrevious?attendanceSummary(previousRows):current; const targetWeek=wantsPrevious?(previousWeek||'N/A'):week;
  if (/整体.*出席|overall.*attendance|出席率.*多少|出席率/.test(t) && !/班级|class|最低|bottom|mathematics|science/.test(t)) result=`整体出席率：${target.overall===null?'N/A':(target.overall*100).toFixed(1)+'%'}`;
  else if (/平均.*班级|average.*class/.test(t)) result=`平均班级出席率：${target.average===null?'N/A':(target.average*100).toFixed(1)+'%'}`;
  else if (/最低|bottom/.test(t)) result='出席率最低三班：'+[...target.rows].sort((a,b)=>a.attendanceRate-b.attendanceRate).slice(0,3).map(r=>`${r.className} ${(r.attendanceRate*100).toFixed(1)}%`).join('；');
  else if (/mathematics.*science|science.*mathematics|科目.*出席/.test(t)) result=['MATHEMATICS','SCIENCE'].map(s=>{const x=attendanceSummary(current.rows.filter(r=>r.subject===s));return `${s} ${x.overall===null?'N/A':(x.overall*100).toFixed(1)+'%'}`}).join('；');
  else return null; return `${result}\n统计周期：${targetWeek}\n数据更新时间：${data.sourceTimestamp}`; }
module.exports={readRows,answerQuestion};

'use strict';
const fs = require('fs');
const XLSX = require('xlsx');
const { readRows } = require('./qc-data');
const DEFAULT_FILE = 'C:/Users/Tee Wen Sheng/OneDrive/桌面/VGRO_Weekly_Subject_QC_Master.xlsx';
const empty = value => value === null || value === undefined || value === '' || value === 'N/A';
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;

function rows(sheet, headerRow) {
  return XLSX.utils.sheet_to_json(sheet, { range: headerRow, defval: null, raw: true })
    .filter(row => Object.values(row).some(value => !empty(value)));
}
function load(file = process.env.QC_MASTER_PATH || DEFAULT_FILE) {
  const workbook = XLSX.readFile(file, { cellFormula: false, cellDates: true });
  const need = (name, headerRow) => workbook.Sheets[name] ? rows(workbook.Sheets[name], headerRow) : [];
  return {
    qc: readRows(file),
    classDetails: need('班级明细', 3).filter(row => !empty(row['Record ID']) || !empty(row['Class'])),
    scores: need('成绩明细', 3).filter(row => !empty(row['Assessment ID']) || !empty(row['Class'])),
    enrollments: need('学生报读明细', 3).filter(row => !empty(row['匿名 Student ID']) || !empty(row['Enrollment ID'])),
    teachers: need('班级与老师对应表', 3).filter(row => !empty(row['Class'])),
    operations: need('运营总览', 3),
    intelligence: need('数据智能分析', 0),
    sourceTimestamp: fs.statSync(file).mtime.toISOString(),
  };
}
function formOf(row) { return row.Form || (String(row.className || row.Class || '').match(/\b([FY]\d)\b/) || [])[1] || 'N/A'; }
function validRate(numerator, denominator) { const n = number(numerator), d = number(denominator); return n !== null && d !== null && d > 0 ? n / d : null; }
function sum(values) { return values.reduce((total, value) => total + (number(value) || 0), 0); }
function metric(rowsToUse, numerator, denominator) {
  const valid = rowsToUse.map(row => ({ row, rate: validRate(row[numerator], row[denominator]) })).filter(item => item.rate !== null);
  const n = sum(valid.map(item => item.row[numerator])), d = sum(valid.map(item => item.row[denominator]));
  return { rate: d > 0 ? n / d : null, numerator: n, denominator: d, count: valid.length, rows: valid };
}
function display(value) { return value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`; }
module.exports = { load, formOf, validRate, metric, display, number, empty };

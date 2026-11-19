'use strict';
const { load, formOf, metric, display, number, empty } = require('./management-data');
const period = data => data.qc.current[0]?.week || 'N/A';
const footer = (data, source = 'QC Excel 主档') => `\n统计周期：${period(data)}\n数据更新时间：${data.sourceTimestamp}\n来源：${source}`;
const na = (title, data, reason = '尚未导入可核查的真实记录') => `${title}：N/A\n原因：${reason}${footer(data)}`;

function capabilityMenu() {
  return `【VGRO AI 教育运营总监｜可问范围】\n1. 运营总览／数据完整度\n2. 出席：整体、科目、Form、班级、趋势、排名、风险\n3. 功课：纸质、数字、总完成率、正确率\n4. 测验／听写：完成率、正确率、趋势\n5. 班级活动：Before／During／After、活动类型\n6. 成绩：平均分、进步率、退步率\n7. 报读：匿名学生数、有效报读、科目结构\n8. 老师／班级：负责班级、表现 Drill-down\n9. 管理报告、风险摘要、图表\n\n示例：本周运营总览、F2 出席率、Science 近六周趋势、某班本周表现、数据完整度。`;
}
function availability(data) {
  const lines = [
    `出席 QC：${data.qc.current.length} 条当前记录、${data.qc.history.length} 条历史记录`,
    `班级活动：${data.classDetails.length ? `${data.classDetails.length} 条` : '等待导入'}`,
    `成绩：${data.scores.length ? `${data.scores.length} 条` : '等待导入'}`,
    `匿名报读：${data.enrollments.length ? `${data.enrollments.length} 条` : '等待导入'}`,
    `班级／老师映射：${data.teachers.length} 条（待官方审核）`,
  ];
  return `【数据完整度】\n${lines.join('\n')}${footer(data)}`;
}
function filterCurrent(data, text) {
  let rows = data.qc.current;
  const form = text.match(/\b([FY]\d)\b/i)?.[1]?.toUpperCase();
  const subject = /science|科学/.test(text.toLowerCase()) ? 'SCIENCE' : /mathematics|math|数学/.test(text.toLowerCase()) ? 'MATHEMATICS' : null;
  if (form) rows = rows.filter(row => formOf(row) === form);
  if (subject) rows = rows.filter(row => row.subject === subject);
  return rows;
}
function attendance(text, data) {
  const rows = filterCurrent(data, text), overall = metric(rows, 'present', 'attendanceDenominator');
  const named = rows.find(row => text.includes(row.className));
  if (named) return `【班级 QC】\n${named.className}｜${named.subject}\n出席率：${display(named.present / named.attendanceDenominator)}（${named.present}/${named.attendanceDenominator}）\nNONE：${named.none ?? 'N/A'}｜Absent：${named.absent ?? 'N/A'}\n状态：${named.status || 'N/A'}\n改善建议：${named.improvement || 'N/A'}${footer(data)}`;
  const label = rows.length === data.qc.current.length ? '整体' : '筛选范围';
  if (/最低|bottom|排名|top|最佳/.test(text.toLowerCase())) {
    const order = [...rows].filter(row => number(row.attendanceDenominator) > 0).map(row => ({ ...row, rate: row.present / row.attendanceDenominator })).sort((a, b) => a.rate - b.rate);
    const best = /最佳|top/.test(text.toLowerCase()); const result = best ? order.reverse().slice(0, 3) : order.slice(0, 3);
    return `${best ? '最佳' : '最低'}出席率班级：\n${result.map((row, i) => `${i + 1}. ${row.className}｜${row.subject}｜${display(row.rate)}（${row.present}/${row.attendanceDenominator}）`).join('\n')}${footer(data)}`;
  }
  const validClassRates = rows.map(row => number(row.attendanceDenominator) > 0 ? row.present / row.attendanceDenominator : null).filter(rate => rate !== null);
  const average = validClassRates.length ? validClassRates.reduce((total, rate) => total + rate, 0) / validClassRates.length : null;
  return `${label}出席率：${display(overall.rate)}（Present ${overall.numerator} / 有效分母 ${overall.denominator}）\n平均班级出席率：${display(average)}\nNONE：${sumField(rows, 'none')}｜Absent：${sumField(rows, 'absent')}${footer(data)}`;
}
function sumField(rows, field) { return rows.reduce((total, row) => total + (number(row[field]) || 0), 0); }
function learningMetric(text, data) {
  const t = text.toLowerCase();
  const rows = filterCurrent(data, text);
  let title, numerator, denominator;
  if (/听写|dictation/.test(t)) return na('听写数据', data, '班级活动明细尚未导入听写分子与分母');
  if (/测验.*正确|quiz.*accuracy|测验.*正确率/.test(t)) { title = '测验正确率'; numerator = 'quizCorrect'; denominator = 'quizAnswered'; }
  else if (/测验|quiz/.test(t)) { title = '测验完成率'; numerator = 'quizCompleted'; denominator = 'quizRequired'; }
  else if (/数字.*功课|digital.*homework/.test(t)) return na('数字功课指标', data, '本周没有有效数字功课分子与分母');
  else if (/纸质.*功课|paper.*homework/.test(t)) return na('纸质功课指标', data, '本周没有有效纸质功课分子与分母');
  else { title = /正确/.test(t) ? '总功课正确率' : '总功课完成率'; numerator = /正确/.test(t) ? 'homeworkCorrect' : 'homeworkCompleted'; denominator = /正确/.test(t) ? 'homeworkAnswered' : 'homeworkRequired'; }
  const value = metric(rows, numerator, denominator);
  return value.rate === null ? na(title, data, '当前范围没有有效分子与分母') : `${title}：${display(value.rate)}（${value.numerator}/${value.denominator}）${footer(data)}`;
}
function trend(text, data) {
  const subject = /science|科学/.test(text.toLowerCase()) ? 'SCIENCE' : /mathematics|math|数学/.test(text.toLowerCase()) ? 'MATHEMATICS' : null;
  const dedup = new Map();
  for (const row of data.qc.history) dedup.set(`${row.week}|${row.className}|${row.subject}`, row);
  for (const row of data.qc.current) dedup.set(`${row.week}|${row.className}|${row.subject}`, row); // Current verified values win.
  const records = [...dedup.values()].filter(row => !subject || row.subject === subject);
  const weeks = [...new Set(records.map(row => row.week))].sort();
  const lines = weeks.map(week => { const value = metric(records.filter(row => row.week === week), 'present', 'attendanceDenominator'); return `${week}：${display(value.rate)}（${value.numerator}/${value.denominator}）`; });
  return `${subject || '整体'}出席率趋势：\n${lines.join('\n')}${footer(data)}`;
}
function risk(data) {
  const rows = data.qc.current.filter(row => number(row.attendanceDenominator) > 0).map(row => ({ ...row, rate: row.present / row.attendanceDenominator })).filter(row => row.rate < 0.8).sort((a, b) => a.rate - b.rate);
  return rows.length ? `【优先跟进班级】\n${rows.slice(0, 5).map((row, i) => `${i + 1}. ${row.className}｜${row.subject}｜${display(row.rate)}${row.rate === 0 ? '｜请核对是否已完成填报' : ''}`).join('\n')}${footer(data)}` : `目前没有低于 80% 的有效班级记录。${footer(data)}`;
}
function operations(data) {
  const attendanceValue = metric(data.qc.current, 'present', 'attendanceDenominator');
  return `【本周运营总览】\nQC 观察班级：${data.qc.current.length}\nQC 覆盖科目：Mathematics / Science\n整体出席率：${display(attendanceValue.rate)}\n唯一学生数：${data.enrollments.length ? new Set(data.enrollments.map(row => row['匿名 Student ID']).filter(Boolean)).size : 'N/A'}\n有效报读记录：${data.enrollments.length || 'N/A'}\n成绩记录：${data.scores.length || 'N/A'}\n班级活动记录：${data.classDetails.length || 'N/A'}${footer(data)}`;
}
function teacher(text, data) {
  const rows = data.teachers.filter(row => /老师|teacher/.test(text.toLowerCase()) ? true : true);
  return rows.length ? `【班级／老师映射】\n${rows.slice(0, 12).map(row => `${row.Class}｜${row.Subject}｜${row['Teacher Scope']}｜${row['Verification Status']}`).join('\n')}\n注：此映射仍须官方排课资料确认。${footer(data, '班级与老师对应表')}` : na('班级／老师映射', data);
}
function activity(data) {
  if (!data.classDetails.length) return na('班级活动分析', data, '班级明细尚未导入真实活动记录');
  const types = [...new Set(data.classDetails.map(row => row['活动类型']).filter(value => !empty(value)))];
  const phases = [...new Set(data.classDetails.map(row => row['活动阶段']).filter(value => !empty(value) && value !== 'Unclassified'))];
  return `【班级活动分析】\n记录：${data.classDetails.length}\n活动类型：${types.join('、') || 'N/A'}\n活动阶段：${phases.join('、') || '等待分类'}${footer(data, '班级明细')}`;
}
function scores(data) {
  if (!data.scores.length) return na('成绩分析', data, '成绩明细尚未导入真实班级评估记录');
  const average = data.scores.map(row => number(row['本次平均分'])).filter(value => value !== null);
  const comparable = data.scores.map(row => number(row['可比较人数']) || 0).reduce((a, b) => a + b, 0);
  const improved = data.scores.map(row => number(row['进步学生数']) || 0).reduce((a, b) => a + b, 0);
  const declined = data.scores.map(row => number(row['退步学生数']) || 0).reduce((a, b) => a + b, 0);
  return `【成绩分析】\n评估记录：${data.scores.length}\n本次平均分：${average.length ? (average.reduce((a, b) => a + b, 0) / average.length).toFixed(1) : 'N/A'}\n可比较人数：${comparable || 'N/A'}\n进步率：${comparable ? display(improved / comparable) : 'N/A'}｜退步率：${comparable ? display(declined / comparable) : 'N/A'}${footer(data, '成绩明细')}`;
}
function enrollment(data) {
  if (!data.enrollments.length) return na('报读结构', data, '学生报读明细尚未导入匿名 Student ID 与 Enrollment ID');
  const students = new Set(data.enrollments.map(row => row['匿名 Student ID']).filter(Boolean));
  const active = data.enrollments.filter(row => String(row['状态']).toLowerCase() === 'active').length;
  return `【报读结构】\n匿名学生：${students.size}\n报读记录：${data.enrollments.length}\n有效报读：${active}\n平均每学生科目数：${students.size ? (data.enrollments.length / students.size).toFixed(1) : 'N/A'}${footer(data, '学生报读明细')}`;
}

function answerManagementQuestion(text) {
  let data; try { data = load(); } catch { return null; }
  const t = text.toLowerCase();
  if (/图表|chart/.test(t)) return null; // The existing image route owns chart requests.
  if (/功能|帮助|可以问|能问|menu/.test(t)) return capabilityMenu();
  if (/数据完整|数据状态|资料完整|什么数据/.test(t)) return availability(data);
  if (/运营总览|运营摘要|管理总览/.test(t)) return operations(data);
  if (/活动|课堂|before|during|after/.test(t)) return activity(data);
  if (/报读|学生数|enrollment/.test(t)) return enrollment(data);
  if (/成绩|平均分|进步率|退步率/.test(t)) return scores(data);
  if (/老师|teacher|班级.*对应|负责.*班/.test(t)) return teacher(text, data);
  if (/趋势|近.*周|过去.*周|走势/.test(t)) return trend(text, data);
  if (/风险|异常|跟进|低于.*80|低于.*60/.test(t)) return risk(data);
  if (/功课|作业|homework|测验|quiz|听写|dictation/.test(t)) return learningMetric(text, data);
  if (/出席|attendance|present|absent|none|班级.*率|form|\b[fFyY]\d\b/.test(text)) return attendance(text, data);
  if (/报告|report/.test(t)) return operations(data) + '\n\n' + risk(data);
  return null;
}
module.exports = { answerManagementQuestion, capabilityMenu };

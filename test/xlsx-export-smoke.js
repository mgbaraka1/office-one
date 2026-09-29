'use strict';

const assert = require('node:assert/strict');
const { createTimesheetWorkbook, createPfmWorkbook, createOutsStatementWorkbook } = require('../xlsx');

function readStoredZip(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034B50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    assert.equal(method, 0, 'test reader expects stored ZIP entries');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    entries.set(name, buffer.subarray(dataStart, dataStart + size).toString('utf8'));
    offset = dataStart + size;
  }
  return entries;
}

const workbook = createTimesheetWorkbook({
  title: 'Weekly Work Report — تقرير أسبوعي',
  sheetName: 'Timesheet / invalid name',
  employeeLabel: 'Employee', employee: 'Test User', periodLabel: 'Period', period: '3–9 August 2026',
  totalHoursLabel: 'Total Hours', workTimeLabel: 'Work Time', overtimeLabel: 'Over Time',
  activeDaysLabel: 'Active Days', totalLabel: 'Total', activeDays: 2, rtl: true,
  headers: ['Date', 'Client / Organisation', 'System / Department', 'Task', 'Time Type', 'Activity Type', 'Description', 'Minutes', 'Hours', 'Sources'],
  rows: [
    { date: '2026-08-03', company: 'Client A', container: 'System A', task: 'First task', time: 'Work Time', timeCode: 'WORK_TIME', activity: 'Task', description: 'Completed work', minutes: 90, hours: 1.5, sources: 'Jira — https://example.test/1' },
    { date: '2026-08-04', company: 'المؤسسة', container: 'القسم', task: 'مهمة', time: 'وقت إضافي', timeCode: 'OVERTIME', activity: 'اجتماع', description: 'مراجعة', minutes: 30, hours: 0.5, sources: '' },
  ],
});

assert.ok(Buffer.isBuffer(workbook) && workbook.length > 5000, 'writer returns a non-trivial workbook buffer');
assert.equal(workbook.readUInt32LE(0), 0x04034B50, 'workbook starts with a ZIP local-file signature');
const entries = readStoredZip(workbook);
for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
  assert.ok(entries.has(name), `workbook contains ${name}`);
}

const sheet = entries.get('xl/worksheets/sheet1.xml');
assert.match(sheet, /rightToLeft="1"/, 'Arabic workbooks opt into RTL sheet direction');
assert.match(sheet, /state="frozen"/, 'column headers are frozen');
assert.match(sheet, /<autoFilter ref="A6:J8"\/>/, 'session columns have an Excel filter');
assert.ok(sheet.indexOf('<autoFilter ') < sheet.indexOf('<mergeCells '), 'worksheet elements follow Excel schema order');
assert.match(sheet, /<c r="A7" s="5"><v>46237<\/v><\/c>/, 'session dates are typed Excel date serials');
assert.match(sheet, /<c r="H7" s="6"><v>90<\/v><\/c>/, 'minutes are typed numeric cells');
assert.match(sheet, /SUMIF\(K7:K8,&quot;OVERTIME&quot;,I7:I8\)/, 'Over-Time summary remains formula-driven');
assert.match(sheet, /المؤسسة/, 'Unicode/Arabic cell content is preserved');
assert.match(sheet, /<col min="11" max="11" hidden="1"/, 'stable time codes used by formulas are hidden');

const workbookXml = entries.get('xl/workbook.xml');
assert.match(workbookXml, /name="Timesheet invalid name"/, 'invalid worksheet-name characters are sanitized');
assert.throws(() => createTimesheetWorkbook(null), /Invalid Excel report data/);

console.log('PASS  Excel export produces a genuine structured OpenXML workbook');
console.log('PASS  dates/numbers are typed, summaries are formula-driven, and Arabic/RTL content is preserved');

// Project & Finance list export (plan E8): same package, its own sheet.
const pfmBook = createPfmWorkbook({
  title: 'Offers & CRs', sheetName: 'Offers & CRs', filtersLabel: 'Filters', filters: 'Offers · Sent', rtl: false,
  headers: { reference: 'Reference', fees: 'Fees' },
  rows: [
    { reference: 'OFF-001', kind: 'Offer', title: 'Generic offer', client: 'Client A', status: 'Sent',
      fees: 12500.5, currency: 'SAR', version: 'v2', person: 'Person A', validUntil: '2026-08-03', updated: '2026-08-04' },
    { reference: 'CR-001', kind: 'CR', title: 'عرض عام', client: 'المؤسسة', status: 'Prepare',
      fees: null, currency: '', version: '', person: '', validUntil: '', updated: '2026-08-04' },
  ],
});
const pfmEntries = readStoredZip(pfmBook);
const pfmSheet = pfmEntries.get('xl/worksheets/sheet1.xml');
assert.ok(pfmEntries.has('xl/styles.xml') && pfmEntries.has('[Content_Types].xml'), 'PFM export is a full workbook package');
assert.match(pfmSheet, /<c r="F5" s="13"><v>12500.5<\/v><\/c>/, 'fees are numeric cells with a #,##0.00 format, not text');
assert.match(pfmSheet, /<c r="F6" s="0" t="inlineStr"><is><t><\/t><\/is><\/c>/, 'a version with no fees exports an empty cell');
assert.match(pfmSheet, /<c r="J5" s="5"><v>46237<\/v><\/c>/, 'valid-until is a typed Excel date');
assert.match(pfmSheet, /<autoFilter ref="A4:K6"\/>/, 'the exported rows carry an Excel filter');
assert.match(pfmSheet, /state="frozen"/, 'PFM headers are frozen');
assert.doesNotMatch(pfmSheet, /rightToLeft/, 'an English export stays left-to-right');
assert.match(pfmSheet, /المؤسسة/, 'Arabic client names are preserved');
assert.match(pfmEntries.get('xl/workbook.xml'), /name="Offers &amp; CRs"/, 'the sheet is named after the list');
assert.match(pfmEntries.get('xl/styles.xml'), /<cellXfs count="14">/, 'the style count matches the number of cell formats');
assert.throws(() => createPfmWorkbook({}), /Invalid Excel export data/);
console.log('PASS  Project & Finance export writes typed fees and dates for the filtered rows');

// Outsource statement (Phase 5): the old sheet's columns grouped by project,
// live SUM formulas for minutes/hours, the issued amounts as numbers.
const outsBook = createOutsStatementWorkbook({
  title: 'Statement ST-001', sheetName: 'ST-001', rtl: true, currency: 'SAR',
  info: [['Resource', 'Consultant A'], ['Period', '2090-06-01 → 2090-06-30']],
  headers: { day: 'Day', date: 'Date', minutes: 'Minutes', hours: 'Hours', description: 'Description', project: 'Project' },
  groups: [
    { project: 'Project One', subtotalLabel: 'Subtotal — Project One', rows: [
      { day: 'Monday', date: '2090-06-05', minutes: 90, description: 'Generic work' },
      { day: 'Tuesday', date: '2090-06-06', minutes: 20, description: 'عمل عام' },
    ] },
    { project: 'Project Two', subtotalLabel: 'Subtotal — Project Two', rows: [
      { day: 'Friday', date: '2090-06-09', minutes: 45, description: 'Generic review' },
    ] },
  ],
  totalLabel: 'Total',
  lineHeaders: { project: 'Project', hours: 'Hours', rate: 'Rate / Hour', amount: 'Amount' },
  lines: [
    { project: 'Project One', hours: 1.83, rate: 200, amount: 366.67 },
    { project: 'Project Two', hours: 0.75, rate: 200, amount: 150 },
  ],
  amountLabel: 'Total Fee', totalAmount: 516.67,
});
const outsSheet = readStoredZip(outsBook).get('xl/worksheets/sheet1.xml');
assert.match(outsSheet, /<c r="B6" s="5"><v>\d+<\/v><\/c>/, 'entry dates are typed Excel dates');
assert.match(outsSheet, /<c r="D6" s="7"><f>C6\/60<\/f>/, 'hours are a live formula of the minutes');
assert.match(outsSheet, /<c r="C8" s="9"><f>SUM\(C6:C7\)<\/f><v>110<\/v>/, 'each project has a minutes subtotal');
assert.match(outsSheet, /<f>SUM\(C8,C10\)<\/f><v>155<\/v>/, 'the grand total adds the subtotals');
assert.match(outsSheet, /<v>366.67<\/v>/, 'line amounts are the statement\'s own numbers');
assert.match(outsSheet, /Total Fee \(SAR\)/, 'the fee total names its currency');
assert.match(outsSheet, /<c r="D\d+" s="10"><v>516.67<\/v>/, 'the fee total is numeric');
assert.match(outsSheet, /rightToLeft="1"/, 'an Arabic export is right-to-left');
assert.match(outsSheet, /عمل عام/, 'Arabic descriptions are preserved');
assert.throws(() => createOutsStatementWorkbook({}), /Invalid Excel export data/);
console.log('PASS  Outsource statement export groups entries by project with subtotals, totals and the fee lines');


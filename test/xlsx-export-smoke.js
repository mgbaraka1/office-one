'use strict';

const assert = require('node:assert/strict');
const { createTimesheetWorkbook } = require('../xlsx');

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

'use strict';

const APP_VERSION = require('./package.json').version;

// Minimal dependency-free OpenXML workbook writer for the Timesheet report.
// It intentionally supports one polished worksheet only; keeping the surface
// small makes the offline export auditable and avoids adding a large runtime
// spreadsheet dependency to the packaged app.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function xml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function safeText(value) {
  // Excel's cell text limit is 32,767 characters. XML 1.0 also rejects most
  // ASCII control characters, so remove those before writing inline strings.
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 32767);
}

function safeSheetName(value) {
  const name = safeText(value || 'Timesheet').replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
  return name || 'Timesheet';
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);      // stored (no compression)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

function excelDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(time)) return null;
  return Math.round((time - Date.UTC(1899, 11, 30)) / 86400000);
}

function textCell(ref, value, style = 0) {
  const text = safeText(value);
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t${preserve}>${xml(text)}</t></is></c>`;
}

function numberCell(ref, value, style = 0) {
  const number = Number(value);
  return `<c r="${ref}" s="${style}"><v>${Number.isFinite(number) ? number : 0}</v></c>`;
}

function formulaCell(ref, formula, cachedValue, style = 0) {
  return `<c r="${ref}" s="${style}"><f>${xml(formula)}</f><v>${Number(cachedValue) || 0}</v></c>`;
}

function createTimesheetWorkbook(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.rows)) throw new Error('Invalid Excel report data');
  if (input.rows.length > 100000) throw new Error('Excel report has too many rows');

  const rows = input.rows.map(row => ({
    date: safeText(row?.date), company: safeText(row?.company), container: safeText(row?.container),
    task: safeText(row?.task), time: safeText(row?.time), activity: safeText(row?.activity),
    description: safeText(row?.description), minutes: Math.max(0, Number(row?.minutes) || 0),
    hours: Math.max(0, Number(row?.hours) || 0), sources: safeText(row?.sources),
    timeCode: safeText(row?.timeCode),
  }));
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0);
  const totalHours = rows.reduce((sum, row) => sum + row.hours, 0);
  const workHours = rows.reduce((sum, row) => sum + (row.timeCode === 'WORK_TIME' ? row.hours : 0), 0);
  const overtimeHours = rows.reduce((sum, row) => sum + (row.timeCode === 'OVERTIME' ? row.hours : 0), 0);
  const firstDataRow = 7;
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRow = Math.max(firstDataRow, lastDataRow + 1);
  const formulaRange = rows.length ? `${firstDataRow}:${lastDataRow}` : null;

  const sheetRows = [];
  sheetRows.push(`<row r="1" ht="28" customHeight="1">${textCell('A1', input.title || 'Timesheet Report', 1)}</row>`);
  sheetRows.push(`<row r="2">${textCell('A2', input.employeeLabel || 'Employee', 11)}${textCell('B2', input.employee || '', 12)}${textCell('E2', input.periodLabel || 'Period', 11)}${textCell('F2', input.period || '', 12)}</row>`);
  sheetRows.push('<row r="3"></row>');
  sheetRows.push(`<row r="4" ht="24" customHeight="1">${textCell('A4', input.totalHoursLabel || 'Total Hours', 2)}${formulaRange ? formulaCell('B4', `SUM(I${firstDataRow}:I${lastDataRow})`, totalHours, 3) : numberCell('B4', 0, 3)}${textCell('C4', input.workTimeLabel || 'Work Time', 2)}${formulaRange ? formulaCell('D4', `SUMIF(K${firstDataRow}:K${lastDataRow},"WORK_TIME",I${firstDataRow}:I${lastDataRow})`, workHours, 3) : numberCell('D4', 0, 3)}${textCell('E4', input.overtimeLabel || 'Over Time', 2)}${formulaRange ? formulaCell('F4', `SUMIF(K${firstDataRow}:K${lastDataRow},"OVERTIME",I${firstDataRow}:I${lastDataRow})`, overtimeHours, 3) : numberCell('F4', 0, 3)}${textCell('G4', input.activeDaysLabel || 'Active Days', 2)}${numberCell('H4', input.activeDays || 0, 3)}</row>`);
  sheetRows.push('<row r="5"></row>');
  const headers = input.headers || ['Date', 'Client / Organisation', 'System / Department', 'Task', 'Time Type', 'Activity Type', 'Description', 'Minutes', 'Hours', 'Sources'];
  sheetRows.push(`<row r="6" ht="25" customHeight="1">${headers.slice(0, 10).map((header, index) => textCell(`${String.fromCharCode(65 + index)}6`, header, 4)).join('')}${textCell('K6', 'Time Code', 4)}</row>`);

  rows.forEach((row, index) => {
    const r = firstDataRow + index;
    const serial = excelDate(row.date);
    sheetRows.push(`<row r="${r}">${serial == null ? textCell(`A${r}`, row.date) : numberCell(`A${r}`, serial, 5)}${textCell(`B${r}`, row.company)}${textCell(`C${r}`, row.container)}${textCell(`D${r}`, row.task)}${textCell(`E${r}`, row.time)}${textCell(`F${r}`, row.activity)}${textCell(`G${r}`, row.description)}${numberCell(`H${r}`, row.minutes, 6)}${numberCell(`I${r}`, row.hours, 7)}${textCell(`J${r}`, row.sources)}${textCell(`K${r}`, row.timeCode)}</row>`);
  });
  sheetRows.push(`<row r="${totalRow}" ht="24" customHeight="1">${textCell(`A${totalRow}`, input.totalLabel || 'Total', 8)}${textCell(`B${totalRow}`, '', 8)}${textCell(`C${totalRow}`, '', 8)}${textCell(`D${totalRow}`, '', 8)}${textCell(`E${totalRow}`, '', 8)}${textCell(`F${totalRow}`, '', 8)}${textCell(`G${totalRow}`, '', 8)}${formulaRange ? formulaCell(`H${totalRow}`, `SUM(H${firstDataRow}:H${lastDataRow})`, totalMinutes, 9) : numberCell(`H${totalRow}`, 0, 9)}${formulaRange ? formulaCell(`I${totalRow}`, `SUM(I${firstDataRow}:I${lastDataRow})`, totalHours, 10) : numberCell(`I${totalRow}`, 0, 10)}${textCell(`J${totalRow}`, '', 8)}</row>`);

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:K${totalRow}"/><sheetViews><sheetView workbookViewId="0"${input.rtl ? ' rightToLeft="1"' : ''}><pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="3" width="23" customWidth="1"/><col min="4" max="4" width="32" customWidth="1"/><col min="5" max="6" width="18" customWidth="1"/><col min="7" max="7" width="48" customWidth="1"/><col min="8" max="9" width="12" customWidth="1"/><col min="10" max="10" width="38" customWidth="1"/><col min="11" max="11" hidden="1" width="12" customWidth="1"/></cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  <autoFilter ref="A6:J${Math.max(6, lastDataRow)}"/><mergeCells count="3"><mergeCell ref="A1:J1"/><mergeCell ref="B2:D2"/><mergeCell ref="F2:J2"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Segoe UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Segoe UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Segoe UI"/></font><font><b/><sz val="10"/><name val="Segoe UI"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC9644A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E4DC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="13"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="2" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="3" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="2" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(safeSheetName(input.sheetName))}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Office ONE</dc:creator><cp:lastModifiedBy>Office ONE</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Office ONE</Application><AppVersion>${xml(APP_VERSION)}</AppVersion></Properties>`;

  return zip([
    ['[Content_Types].xml', contentTypes], ['_rels/.rels', rels], ['docProps/app.xml', app],
    ['docProps/core.xml', core], ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', workbookRels],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', worksheet],
  ]);
}

// ── Finance client report ─────────────────────────────────────────────────
// A second, independent report shape sharing this file's OpenXML primitives
// (zip/xml/textCell/numberCell/safeSheetName/etc.) — the "reusable xlsx.js
// writer" Finance's original isolation rules called out by name. Row shaping (which
// contracts/CRs/invoices, in what order) happens in renderer/features/
// finance.js, exactly like createTimesheetWorkbook's reportData is shaped in
// renderer/features/reports.js; this function only lays cells out. One
// worksheet with stacked sections, not one sheet per section — same "keep
// the surface small" philosophy as the timesheet writer above.
function financeSectionHeaderRow(r, label, span) {
  const cells = [textCell(`A${r}`, label, 2)];
  for (let i = 1; i < span; i++) cells.push(textCell(`${String.fromCharCode(65 + i)}${r}`, '', 2));
  return `<row r="${r}" ht="22" customHeight="1">${cells.join('')}</row>`;
}
function financeTableHeaderRow(r, headers) {
  return `<row r="${r}">${headers.map((h, i) => textCell(`${String.fromCharCode(65 + i)}${r}`, h, 4)).join('')}</row>`;
}
function financeMoney(minor) { return Math.round((Number(minor) || 0)) / 100; }

function createFinanceReportWorkbook(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid Excel report data');
  const s = input.summary || {};
  const contracts = Array.isArray(input.contracts) ? input.contracts.slice(0, 5000) : [];
  const changeRequests = Array.isArray(input.changeRequests) ? input.changeRequests.slice(0, 5000) : [];
  const invoices = Array.isArray(input.invoices) ? input.invoices.slice(0, 5000) : [];

  const sheetRows = [];
  let r = 1;
  sheetRows.push(`<row r="${r}" ht="28" customHeight="1">${textCell(`A${r}`, input.title || 'Office ONE — Client Report', 1)}</row>`); r++;
  sheetRows.push(`<row r="${r}">${textCell(`A${r}`, 'Client', 11)}${textCell(`B${r}`, input.clientName || '', 0)}${textCell(`D${r}`, 'Generated', 11)}${textCell(`E${r}`, input.generatedAt || '', 0)}</row>`); r++;
  r++; // blank

  sheetRows.push(financeTableHeaderRow(r, ['Contracts', 'Active', 'Final Value', 'Invoiced', 'Paid', 'Outstanding', 'Change Requests'])); r++;
  sheetRows.push(`<row r="${r}">${numberCell(`A${r}`, s.contractCount || 0, 6)}${numberCell(`B${r}`, s.activeContractCount || 0, 6)}${numberCell(`C${r}`, financeMoney(s.finalContractValueMinor), 7)}${numberCell(`D${r}`, financeMoney(s.invoicedMinor), 7)}${numberCell(`E${r}`, financeMoney(s.paidMinor), 7)}${numberCell(`F${r}`, financeMoney(s.outstandingMinor), 7)}${numberCell(`G${r}`, s.changeRequestCount || 0, 6)}</row>`); r++;
  r++; // blank

  sheetRows.push(financeSectionHeaderRow(r, `Contracts (${contracts.length})`, 7)); r++;
  sheetRows.push(financeTableHeaderRow(r, ['Ref', 'Title', 'Status', 'Currency', 'Final Value', 'Start', 'End'])); r++;
  if (!contracts.length) { sheetRows.push(`<row r="${r}">${textCell(`A${r}`, 'No contracts.')}</row>`); r++; }
  for (const k of contracts) {
    sheetRows.push(`<row r="${r}">${textCell(`A${r}`, k.ref)}${textCell(`B${r}`, k.title)}${textCell(`C${r}`, k.status)}${textCell(`D${r}`, k.currencyCode)}${numberCell(`E${r}`, financeMoney(k.finalValueMinor), 7)}${textCell(`F${r}`, k.startDate)}${textCell(`G${r}`, k.endDate)}</row>`);
    r++;
  }
  r++; // blank

  sheetRows.push(financeSectionHeaderRow(r, `Change Requests (${changeRequests.length})`, 6)); r++;
  sheetRows.push(financeTableHeaderRow(r, ['Ref', 'Title', 'Status', 'Amount', 'Currency', 'Contract'])); r++;
  if (!changeRequests.length) { sheetRows.push(`<row r="${r}">${textCell(`A${r}`, 'No change requests.')}</row>`); r++; }
  for (const cr of changeRequests) {
    sheetRows.push(`<row r="${r}">${textCell(`A${r}`, cr.ref)}${textCell(`B${r}`, cr.title)}${textCell(`C${r}`, cr.status)}${numberCell(`D${r}`, financeMoney(cr.amountMinor), 7)}${textCell(`E${r}`, cr.currencyCode)}${textCell(`F${r}`, cr.contractLabel)}</row>`);
    r++;
  }
  r++; // blank

  sheetRows.push(financeSectionHeaderRow(r, `Invoices (${invoices.length})`, 8)); r++;
  sheetRows.push(financeTableHeaderRow(r, ['Number', 'Status', 'Currency', 'Total', 'Paid', 'Outstanding', 'Issue Date', 'Due Date'])); r++;
  if (!invoices.length) { sheetRows.push(`<row r="${r}">${textCell(`A${r}`, 'No invoices.')}</row>`); r++; }
  for (const inv of invoices) {
    sheetRows.push(`<row r="${r}">${textCell(`A${r}`, inv.number)}${textCell(`B${r}`, inv.status)}${textCell(`C${r}`, inv.currencyCode)}${numberCell(`D${r}`, financeMoney(inv.totalMinor), 7)}${numberCell(`E${r}`, financeMoney(inv.paidMinor), 7)}${numberCell(`F${r}`, financeMoney(inv.outstandingMinor), 7)}${textCell(`G${r}`, inv.issueDate)}${textCell(`H${r}`, inv.dueDate)}</row>`);
    r++;
  }
  const lastRow = Math.max(r - 1, 1);

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:H${lastRow}"/><sheetViews><sheetView workbookViewId="0"${input.rtl ? ' rightToLeft="1"' : ''}/></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="30" customWidth="1"/><col min="3" max="3" width="14" customWidth="1"/><col min="4" max="8" width="16" customWidth="1"/></cols>
  <sheetData>${sheetRows.join('')}</sheetData>
  <mergeCells count="1"><mergeCell ref="A1:H1"/></mergeCells>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="4"><font><sz val="10"/><name val="Segoe UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="16"/><name val="Segoe UI"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Segoe UI"/></font><font><b/><sz val="10"/><name val="Segoe UI"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC9644A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E4DC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(safeSheetName(input.sheetName || 'Finance Report'))}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const now = new Date().toISOString();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Office ONE</dc:creator><cp:lastModifiedBy>Office ONE</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Office ONE</Application><AppVersion>${xml(APP_VERSION)}</AppVersion></Properties>`;

  return zip([
    ['[Content_Types].xml', contentTypes], ['_rels/.rels', rels], ['docProps/app.xml', app],
    ['docProps/core.xml', core], ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', workbookRels],
    ['xl/styles.xml', styles], ['xl/worksheets/sheet1.xml', worksheet],
  ]);
}

module.exports = { createTimesheetWorkbook, createFinanceReportWorkbook };

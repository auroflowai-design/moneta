const fs = require('node:fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const core = require('../js/core.js');

const wb = XLSX.read(fs.readFileSync('D:/Account Journal.xlsx'), { type: 'buffer', cellDates: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
const headerRow = core.detectHeaderRow(rows);
const mapping = core.suggestMapping(rows[headerRow] || []);
console.log({ headerRow, header: rows[headerRow], mapping });
const analysis = core.analyzeImportRows({
  rows,
  headerRow,
  mapping,
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: new Set()
});
console.log('summary', analysis.summary);
console.log('summaryRows', analysis.summaryRows);
console.log('reconciliation', analysis.reconciliation);
console.log('invalid', analysis.invalidRows.slice(0, 10).map((row) => ({ n: row.rowNumber, p: row.particulars, d: row.debit, c: row.credit, e: row.errors })));
console.log('first rows', analysis.rows.slice(0, 5).map((row) => ({ n: row.rowNumber, date: row.date, p: row.particulars, d: row.debit, c: row.credit, cat: row.category })));
console.log('last rows', analysis.rows.slice(-4).map((row) => ({ n: row.rowNumber, date: row.date, p: row.particulars, d: row.debit, c: row.credit, cat: row.category })));
console.log('date of row 3', analysis.rows[0].date);

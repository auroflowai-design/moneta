/*
 * Inspect the user's workbook through the same rules as the browser importer.
 * Run: node scripts/inspect-journal.cjs "D:\Account Journal.xlsx"
 */
const path = require('node:path');
const XLSX = require('xlsx');
const C = require('../js/core.js');

const file = process.argv[2] || path.join(__dirname, '..', 'Account Journal.xlsx');
const wb = XLSX.readFile(file, { cellDates: true, raw: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
while (rows.length && rows[rows.length - 1].every((cell) => !C.normalizeText(cell))) rows.pop();

const headerRow = C.detectHeaderRow(rows);
const mapping = headerRow >= 0
  ? C.suggestMapping(rows[headerRow] || [])
  : { date: 0, particulars: 1, debit: 2, credit: 3, category: null };
const a = C.analyzeImportRows({
  rows,
  headerRow,
  mapping,
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: []
});

const replacer = (key, value) => (typeof value === 'bigint' ? value.toString() : value);
console.log(JSON.stringify({
  rows: rows.length,
  headerRow,
  header: rows[headerRow],
  mapping,
  summary: a.summary,
  reconciliation: a.reconciliation,
  summaryRows: a.summaryRows.slice(0, 3),
  invalid: a.invalidRows.slice(0, 8).map((r) => ({
    row: r.rowNumber, date: r.date, particulars: r.particulars, debit: r.debit, credit: r.credit, errors: r.errors
  })),
  firstAccepted: a.acceptedRows.slice(0, 4).map((r) => ({
    row: r.rowNumber, date: r.date, particulars: r.particulars, debit: r.debit, credit: r.credit, category: r.category
  })),
  lastAccepted: a.acceptedRows.slice(-4).map((r) => ({
    row: r.rowNumber, date: r.date, particulars: r.particulars, debit: r.debit, credit: r.credit, category: r.category
  })),
  balanceAtZero: C.accountBalance(a.acceptedRows, { openingBalance: '0.00', openingBalanceSide: 'credit' })
}, replacer, 2));

const categoryTotals = {};
for (const row of a.acceptedRows) {
  categoryTotals[row.category] = categoryTotals[row.category] || { count: 0, debit: 0, credit: 0 };
  categoryTotals[row.category].count += 1;
  categoryTotals[row.category].debit += Number(row.debit);
  categoryTotals[row.category].credit += Number(row.credit);
}
console.log('\nCategories:');
for (const [category, value] of Object.entries(categoryTotals).sort((x, y) => (y[1].debit + y[1].credit) - (x[1].debit + x[1].credit))) {
  console.log(category.padEnd(20), String(value.count).padStart(4), value.debit.toFixed(2).padStart(12), value.credit.toFixed(2).padStart(12));
}

const uncategorised = a.acceptedRows.filter((row) => row.category === 'Uncategorised');
console.log('\nUncategorised:', uncategorised.length);
for (const row of uncategorised.slice(0, 40)) console.log(row.particulars);

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../js/core.js');

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  return lines.map((line) => line.split(','));
}

const bankRows = readCsv(path.join(__dirname, '..', 'test-data', 'bank-statement.csv'));
const analysis = C.analyzeImportRows({
  rows: bankRows,
  headerRow: 0,
  mapping: { date: 0, particulars: 1, debit: 2, credit: 3, category: null },
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: []
});
assert.equal(analysis.summary.accepted, 86, 'accepted count');
assert.equal(analysis.summary.debit, '104040.75', 'debit total');
assert.equal(analysis.summary.credit, '126477.50', 'credit total');
assert.equal(C.accountBalance(analysis.acceptedRows, { openingBalance: '10000.00', openingBalanceSide: 'credit' }), '32436.75', 'account balance');

// repeated identical rows inside one file must both be accepted
const swiggy = bankRows.filter((row) => row[1] === 'SWIGGY ORDER 8821');
assert.equal(swiggy.length, 3, 'fixture has three identical Swiggy rows');

// re-importing the same file skips exactly the saved rows, preserving multiplicity
const keys = C.transactionKeyCounts(analysis.acceptedRows);
const second = C.analyzeImportRows({
  rows: bankRows,
  headerRow: 0,
  mapping: { date: 0, particulars: 1, debit: 2, credit: 3, category: null },
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: keys
});
assert.equal(second.summary.accepted, 0, 'all rows skipped on re-import');
assert.equal(second.summary.duplicates, 86, 'duplicates preserved');

// headerless files import without a header row
const headerlessRows = readCsv(path.join(__dirname, '..', 'test-data', 'headerless.csv'));
const headerless = C.analyzeImportRows({
  rows: headerlessRows,
  headerRow: -1,
  mapping: { date: 0, particulars: 1, debit: 2, credit: 3, category: null },
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: []
});
assert.equal(headerless.summary.accepted, 8, 'headerless count');

// preamble files detect a header row after several lines
const preambleRows = readCsv(path.join(__dirname, '..', 'test-data', 'preamble.csv'));
const preambleHeader = C.detectHeaderRow(preambleRows);
assert.equal(preambleHeader, 5, 'preamble header row');
const preamble = C.analyzeImportRows({
  rows: preambleRows,
  headerRow: preambleHeader,
  mapping: C.suggestMapping(preambleRows[preambleHeader]),
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: []
});
assert.equal(preamble.summary.accepted, 6, 'preamble count');

// money is decimal-safe
assert.equal(C.moneyMinor('100040.75'), 10004075n, 'money minor');
assert.equal(C.addMoney('0.10', '0.20'), '0.30', 'decimal addition');

// account balance formula
assert.equal(C.accountBalance([], { openingBalance: '100.00', openingBalanceSide: 'debit' }), '-100.00', 'debit opening');
assert.equal(C.moneyMinor('-13052.44'), -1305244n, 'signed minor units');
assert.ok(C.formatMoney('-13052.44').includes('13,052.44'), 'signed money keeps its amount');
assert.ok(C.formatMoney('-13052.44').includes('-'), 'signed money keeps its sign');
assert.equal(C.moneyMinor('0.00'), 0n, 'zero minor units');

// real workbook reconciliation
const XLSX = require('xlsx');
const wb = XLSX.readFile(path.join(__dirname, '..', 'test-data', 'Account Journal.xlsx'), { cellDates: true, raw: true });
const ws = wb.Sheets[wb.SheetNames[0]];
const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', blankrows: true });
while (sheetRows.length && sheetRows[sheetRows.length - 1].every((cell) => !C.normalizeText(cell))) sheetRows.pop();
const workbook = C.analyzeImportRows({
  rows: sheetRows,
  headerRow: C.detectHeaderRow(sheetRows),
  mapping: C.suggestMapping(sheetRows[C.detectHeaderRow(sheetRows)]),
  dateMode: 'dmy',
  duplicateMode: 'skip',
  existingKeys: []
});
assert.equal(workbook.summary.accepted, 248, 'workbook accepted');
assert.equal(workbook.summary.debit, '107154.85', 'workbook debit');
assert.equal(workbook.summary.credit, '127977.04', 'workbook credit');
assert.equal(workbook.reconciliation.sheetBalance, '20822.19', 'workbook sheet balance');
assert.equal(workbook.reconciliation.openingBalance, '0.00', 'workbook opening');
assert.equal(C.accountBalance(workbook.acceptedRows, { openingBalance: '0.00', openingBalanceSide: 'credit' }), '20822.19', 'workbook account balance');

// categories stay inside the 5–7 register
const categories = C.DEFAULT_CATEGORIES.map((category) => category.name);
assert.ok(categories.length >= 5 && categories.length <= 7, 'default category count');
assert.equal(new Set(workbook.acceptedRows.map((row) => row.category)).size <= 7, true, 'workbook categories stay capped');
assert.equal(C.resolveCategory('Groceries', '', categories), 'Food & Dining', 'legacy category folds into Food');
assert.equal(C.resolveCategory('an invented label', 'UBER TRIP', categories), 'Transport', 'unknown category falls back to particulars');
assert.equal(C.normalizeCategoryList(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight']).length, 7, 'category cap');
assert.ok(C.normalizeCategoryList(['One', 'Two', 'Three']).length >= 5, 'category floor');

// complete backups keep goals, budgets, account identity and the category register
const customCategories = [
  { id: 'food', name: 'Kitchen' },
  { id: 'shopping', name: 'Lifestyle' },
  { id: 'transport', name: 'Commute' },
  { id: 'bills', name: 'Home bills' },
  { id: 'income', name: 'Earnings' },
  { id: 'other', name: 'Everything else' }
];
const backupTx = C.normalizeTransaction({
  id: 'backup-tx-1',
  date: '2026-10-01',
  particulars: 'Groceries',
  category: 'Kitchen',
  debit: '250.00',
  credit: '',
  source: 'manual'
}, { requireId: true, categories: customCategories }).value;
const completeBackup = C.createBackup({
  settings: {
    ...C.DEFAULT_SETTINGS,
    goalName: 'Trip fund',
    goalTarget: '250000.00',
    monthlyBudget: '40000.00',
    accountName: 'HDFC Savings',
    accountType: 'Bank',
    categories: customCategories
  },
  transactions: [backupTx],
  imports: [{ id: 'imp-1', fileName: 'journal.xlsx', at: '2026-10-05T08:00:00.000Z', imported: 1, skipped: 0 }]
});
assert.equal(completeBackup.formatVersion, 3, 'backup format version');
assert.equal(completeBackup.settings.goalName, 'Trip fund', 'backup keeps goal');
assert.equal(completeBackup.settings.monthlyBudget, '40000.00', 'backup keeps budget');
assert.equal(completeBackup.settings.accountName, 'HDFC Savings', 'backup keeps account name');
assert.equal(completeBackup.settings.categories.length, 6, 'backup keeps categories');
const restored = C.validateBackup(JSON.stringify(completeBackup));
assert.equal(restored.ok, true, 'complete backup validates');
assert.equal(restored.data.settings.goalTarget, '250000.00', 'restored goal');
assert.equal(restored.data.settings.categories[0].name, 'Kitchen', 'restored category name');
assert.equal(restored.data.transactions[0].category, 'Kitchen', 'restored transaction category');
const damaged = JSON.parse(JSON.stringify(completeBackup));
damaged.settings.monthlyBudget = '999.00';
assert.equal(C.validateBackup(JSON.stringify(damaged)).ok, false, 'settings tampering breaks integrity');
const damagedTotal = JSON.parse(JSON.stringify(completeBackup));
damagedTotal.transactions[0].debit = '251.00';
assert.equal(C.validateBackup(JSON.stringify(damagedTotal)).ok, false, 'total tampering breaks integrity');

console.log('All core tests passed.');
console.log(JSON.stringify({
  fixture: analysis.summary,
  workbook: workbook.summary,
  reconciliation: workbook.reconciliation
}, null, 2));

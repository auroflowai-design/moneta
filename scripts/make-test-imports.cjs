/*
 * Generates deterministic spreadsheets used while verifying the importer.
 * Run: node scripts/make-test-imports.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const core = require('../js/core.js');

const outDir = path.join(__dirname, '..', 'test-data');
fs.mkdirSync(outDir, { recursive: true });

const fixed = [
  ['01/10/2026', 'SALARY OCTOBER 2026', '', '50000.00'],
  ['02/10/2026', 'SWIGGY ORDER 8821', '450.50', ''],
  ['02/10/2026', 'SWIGGY ORDER 8821', '450.50', ''],
  ['03/10/2026', 'AMAZON PURCHASE', '1299.00', ''],
  ['04/10/2026', 'UPI/AMAN KUMAR', '2000.00', ''],
  ['05/10/2026', 'ELECTRICITY BILL OCT', '850.25', ''],
  ['06/10/2026', 'ATM CASH WITHDRAWAL', '3000.00', ''],
  ['07/10/2026', 'SELF TRANSFER TO SAVINGS', '1500.00', ''],
  ['08/10/2026', 'BIGBASKET ORDER', '2200.75', ''],
  ['09/10/2026', 'INTEREST CREDIT', '', '86.40'],
  ['10/10/2026', 'APOLLO PHARMACY', '312.00', ''],
  ['11/10/2026', 'AIRTEEL POSTPAID BILL', '699.00', ''],
  ['12/10/2026', 'NETFLIX SUBSCRIPTION', '649.00', ''],
  ['13/10/2026', 'METRO CARD RECHARGE', '500.00', ''],
  ['14/10/2026', 'ZERODHA FUND TRANSFER', '5000.00', ''],
  ['15/10/2026', 'RENT PAYMENT OCTOBER', '18000.00', ''],
  ['16/10/2026', 'AMAZON REFUND', '', '349.00'],
  ['17/10/2026', 'SWIGGY ORDER 8821', '450.50', ''],
  ['18/10/2026', 'BANK CHARGES', '59.00', ''],
  ['19/10/2026', 'MAKEMYTRIP FLIGHT', '8420.00', ''],
  ['20/10/2026', 'SCHOOL FEE TERM 2', '12500.00', ''],
  ['21/10/2026', 'CLIENT PAYMENT INVOICE 44', '', '18500.00'],
  ['22/10/2026', 'HP PETROL PUMP', '1200.00', ''],
  ['23/10/2026', 'MYNTRA ORDER', '1899.00', ''],
  ['24/10/2026', 'JIO RECHARGE', '299.00', ''],
  ['25/10/2026', 'CASH DEPOSIT', '', '7500.00'],
  ['26/10/2026', 'UBER RIDE', '248.00', ''],
  ['27/10/2026', 'DOMINOS PIZZA', '799.00', ''],
  ['28/10/2026', 'LIC PREMIUM', '1650.00', ''],
  ['29/10/2026', 'SAVINGS INTEREST', '', '42.10'],
  ['30/10/2026', 'GROCERY KIRANA STORE', '631.25', ''],
  ['31/10/2026', 'AIRTEL BROADBAND', '799.00', '']
];

const generated = [];
for (let index = 1; index <= 52; index += 1) {
  const day = String((index % 28) + 1).padStart(2, '0');
  const month = index % 2 === 0 ? '09' : '10';
  const amount = (index * 17 + 43.25).toFixed(2);
  const particulars = index % 5 === 0
    ? `UPI PAYMENT ${index}`
    : index % 4 === 0
      ? `AMAZON ORDER ${index}`
      : index % 3 === 0
        ? `BIGBASKET ORDER ${index}`
        : `MERCHANT PAYMENT ${index}`;
  generated.push([`${day}/${month}/2026`, particulars, amount, '']);
}
generated.push(['30/09/2026', 'SALARY SEPTEMBER 2026', '', '50000.00']);
generated.push(['29/09/2026', 'CREDIT CARD PAYMENT', '12500.00', '']);

const rows = [...fixed, ...generated];
const header = ['Date', 'Particulars', 'Debit', 'Credit'];

function quote(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function csv(matrix) {
  return matrix.map((row) => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

fs.writeFileSync(path.join(outDir, 'bank-statement.csv'), '\ufeff' + csv([header, ...rows]), 'utf8');

// Headerless file: date, particulars, debit, credit, no labels anywhere.
const headerlessRows = [
  ['03/10/2026', 'SWIGGY ORDER 1001', '275.00', ''],
  ['04/10/2026', 'AMAZON PURCHASE 1002', '1499.00', ''],
  ['05/10/2026', 'SALARY CREDIT 1003', '', '25000.00'],
  ['06/10/2026', 'BIGBASKET ORDER 1004', '887.50', ''],
  ['07/10/2026', 'UBER RIDE 1005', '310.00', ''],
  ['08/10/2026', 'ATM CASH WITHDRAWAL 1006', '2000.00', ''],
  ['09/10/2026', 'NETFLIX SUBSCRIPTION 1007', '649.00', ''],
  ['10/10/2026', 'ELECTRICITY BILL 1008', '912.00', '']
];
fs.writeFileSync(path.join(outDir, 'headerless.csv'), '\ufeff' + csv(headerlessRows), 'utf8');

// A statement with preamble lines, header on row 6.
const preamble = [
  ['HDFC BANK — STATEMENT OF ACCOUNT'],
  ['Account number', 'XXXXXX4412'],
  ['Period', '01/10/2026 to 31/10/2026'],
  [],
  ['Some banks put legal text here. This row must not be imported.'],
  header,
  ['01/10/2026', 'UPI/SWIGGY', '199.00', ''],
  ['02/10/2026', 'SALARY CREDIT', '', '30000.00'],
  ['03/10/2026', 'AMAZON', '999.00', ''],
  ['04/10/2026', 'BIGBASKET', '1200.00', ''],
  ['05/10/2026', 'ATM CASH', '500.00', ''],
  ['06/10/2026', 'BANK CHARGES', '25.00', '']
];
fs.writeFileSync(path.join(outDir, 'preamble.csv'), '\ufeff' + csv(preamble), 'utf8');

// Expected values derived from the same engine the app uses.
const mapped = rows.map((row, index) => {
  const date = core.parseImportDate(row[0], 'dmy');
  const debit = core.parseMoney(row[2]);
  const credit = core.parseMoney(row[3]);
  return {
    rowNumber: index + 2,
    date: date.date,
    particulars: row[1],
    debit: debit.value,
    credit: credit.value,
    category: core.inferCategory(row[1])
  };
});
const summary = core.summarize(mapped);
const expected = {
  count: mapped.length,
  debit: summary.debit,
  credit: summary.credit,
  net: summary.net,
  openingBalance: '10000.00',
  accountBalance: core.accountBalance(mapped, { openingBalance: '10000.00', openingBalanceSide: 'credit' }),
  categories: Object.fromEntries(core.categoryBreakdown(mapped, 'debit', 50).map((item) => [item.category, item.amount]))
};
fs.writeFileSync(path.join(outDir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(expected, null, 2));

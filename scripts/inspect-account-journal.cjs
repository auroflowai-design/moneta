const fs = require('node:fs');
const XLSX = require('../vendor/xlsx.full.min.js');
const buf = fs.readFileSync('D:/Account Journal.xlsx');
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
console.log('sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log('---', name, ws['!ref']);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  console.log('rows:', rows.length);
  rows.forEach((row, i) => {
    if (i < 20 || i > rows.length - 15) console.log(String(i + 1).padStart(3), JSON.stringify(row));
  });
}

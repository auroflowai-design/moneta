const fs = require('fs');
let s = fs.readFileSync('index.html', 'utf8') + fs.readFileSync('app.js', 'utf8');
const set = new Set();
for (const m of s.matchAll(/class="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => {
    c = c.replace(/\$\{.*$/, '');
    if (/^[a-zA-Z][\w-]*$/.test(c)) set.add(c);
  });
}
for (const m of s.matchAll(/class='([^']+)'/g)) {
  m[1].split(/\s+/).forEach((c) => {
    if (/^[a-zA-Z][\w-]*$/.test(c)) set.add(c);
  });
}
console.log([...set].sort().join('\n'));

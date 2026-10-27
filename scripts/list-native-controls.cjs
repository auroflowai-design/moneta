const fs = require('node:fs');
const s = fs.readFileSync('index.html', 'utf8');
const re = /<(select|input)[^>]*>/g;
let m;
while ((m = re.exec(s))) {
  const tag = m[0];
  if (/type="date"|type="month"|^<select/i.test(tag)) {
    const line = s.slice(0, m.index).split('\n').length;
    console.log(line, tag);
  }
}

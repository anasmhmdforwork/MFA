const fs = require('fs');

const files = ['public/dashboard.html', 'public/profile.html', 'public/login.html'];

files.forEach(f => {
  const c = fs.readFileSync(f, 'utf8');
  const matches = [...c.matchAll(/class=["'][^"']*w-\[(\d+)px\][^"']*["']/g)];
  const large = matches
    .map(m => ({ full: m[0], width: parseInt(m[1], 10) }))
    .filter(x => x.width > 360);
  console.log(`${f}: found ${large.length} fixed widths > 360px:`, large.map(x => x.width));
});

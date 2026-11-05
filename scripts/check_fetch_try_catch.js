const fs = require('fs');

['public/dashboard.html', 'public/profile.html'].forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  const bareFetches = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('fetch(') && !lines[i].includes('//')) {
      // Check surrounding 20 lines upwards for 'try {'
      let hasTry = false;
      for (let j = Math.max(0, i - 25); j <= i; j++) {
        if (lines[j].includes('try {')) {
          hasTry = true;
          break;
        }
      }
      if (!hasTry) {
        bareFetches.push({ line: i + 1, text: lines[i].trim() });
      }
    }
  }

  console.log(`${f}: ${bareFetches.length} fetches without immediate try/catch:`, bareFetches);
});

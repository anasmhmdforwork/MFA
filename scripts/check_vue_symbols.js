const fs = require('fs');

function testVueFile(filePath) {
  console.log(`\n======================================================`);
  console.log(`Analyzing Vue symbols in ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');

  // Extract setup return block (it's the last return { in the script)
  const returnIdx = content.lastIndexOf('return {');
  if (returnIdx === -1) {
    console.error('No return { found!');
    return;
  }

  // Find matching closing brace for return {
  let depth = 0;
  let returnEnd = -1;
  for (let i = returnIdx + 7; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      if (depth === 0) {
        returnEnd = i;
        break;
      }
      depth--;
    }
  }

  const returnBlock = content.substring(returnIdx + 8, returnEnd);
  const returnedSymbols = new Set(
    returnBlock
      .split(',')
      .map(s => s.trim().split(':')[0].trim())
      .filter(s => s && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s))
  );

  console.log(`Extracted ${returnedSymbols.size} returned symbols from setup().`);

  const setupIdx = content.indexOf('setup()');
  const templateHtml = content.substring(0, setupIdx);
  
  // Handlers @click="fn(...)"
  const handlers = [...templateHtml.matchAll(/@(?:click|change|submit|input)(?:\.[a-z]+)*=["']([a-zA-Z0-9_$]+)(?:\([^)]*\))?["']/g)];
  // Mustaches {{ expr }}
  const mustaches = [...templateHtml.matchAll(/\{\{\s*([a-zA-Z0-9_$]+)[^}]*\}\}/g)];

  const usedSymbols = new Set();
  handlers.forEach(m => usedSymbols.add(m[1]));
  mustaches.forEach(m => usedSymbols.add(m[1]));

  const standardBuiltins = new Set(['Math', 'window', 'document', 'console', 'JSON', 'Array', 'String', 'Number', 'Date', 'Boolean', 'encodeURIComponent', 'parseInt', 'parseFloat']);

  // Variables defined in v-for="item in items"
  const vFors = [...templateHtml.matchAll(/v-for=["'](?:\(([^)]+)\)|([a-zA-Z0-9_$]+))\s+in/g)];
  const loopVars = new Set();
  vFors.forEach(m => {
    const raw = m[1] || m[2];
    raw.split(',').forEach(v => loopVars.add(v.trim()));
  });

  const missing = [];
  usedSymbols.forEach(sym => {
    if (!returnedSymbols.has(sym) && !standardBuiltins.has(sym) && !loopVars.has(sym)) {
      missing.push(sym);
    }
  });

  if (missing.length === 0) {
    console.log(`✅ All ${usedSymbols.size} direct template symbols are properly exported in setup()!`);
  } else {
    console.warn(`⚠️ Potentially unexported symbols in template:`, missing);
  }
}

testVueFile('public/dashboard.html');
testVueFile('public/profile.html');

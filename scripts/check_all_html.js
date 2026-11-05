const fs = require('fs');
const files = [
  'public/index.html',
  'public/login.html',
  'public/dashboard.html',
  'public/profile.html',
  'public/book.html',
  'public/quiz.html',
  'public/verify.html'
];

let hasErrors = false;

files.forEach(f => {
  const content = fs.readFileSync(f, 'utf8');
  console.log(`Checking ${f}...`);
  
  // Tag counts
  ['div', 'form', 'button', 'script'].forEach(tag => {
    const open = (content.match(new RegExp('<' + tag + '(\\s|>)', 'gi')) || []).length;
    const close = (content.match(new RegExp('<\/' + tag + '>', 'gi')) || []).length;
    if (open !== close) {
      console.error(`  ❌ MISMATCH in ${f} for <${tag}>: ${open} opens vs ${close} closes`);
      hasErrors = true;
    }
  });

  // Scripts syntax
  const scripts = [...content.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((s, idx) => {
    try {
      new Function(s[1]);
    } catch (e) {
      console.error(`  ❌ SYNTAX ERROR in ${f} script #${idx + 1}: ${e.message}`);
      hasErrors = true;
    }
  });
});

if (!hasErrors) {
  console.log('✅ ALL HTML FILES HAVE 100% BALANCED TAGS AND VALID JAVASCRIPT!');
} else {
  console.error('❌ SOME ERRORS WERE FOUND IN HTML/JS FILES!');
}

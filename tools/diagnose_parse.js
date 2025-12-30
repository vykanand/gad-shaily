#!/usr/bin/env node
// Consolidated diagnostic script for inline scripts in index.html
// Reports parse errors (via acorn if available) and maps error locations to index.html lines.

const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'index.html');

// Extract inline scripts and capture their start index in the HTML
function extractInlineScriptsWithPos(html) {
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    scripts.push({ code: m[1], startIndex: m.index, match: m[0] });
  }
  return scripts;
}

function shortPreview(code, lines = 8) {
  return code.split(/\r?\n/).slice(0, lines).map((l, i) => `${i+1}: ${l}`).join('\n');
}

function braceBalance(code) {
  const counts = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 };
  for (const ch of code) {
    if (counts.hasOwnProperty(ch)) counts[ch]++;
  }
  return counts;
}

function lineNumberAt(html, index) {
  return html.slice(0, index).split(/\r?\n/).length; // 1-based
}

function showFileContext(html, line, context = 6) {
  const lines = html.split(/\r?\n/);
  const start = Math.max(0, line - context - 1);
  const end = Math.min(lines.length, line + context);
  return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
}

async function main() {
  if (!fs.existsSync(INDEX)) {
    console.error('index.html not found at', INDEX);
    process.exit(2);
  }
  const html = fs.readFileSync(INDEX, 'utf8');
  const scripts = extractInlineScriptsWithPos(html);
  console.log(`Found ${scripts.length} inline <script> blocks in index.html`);

  let acorn = null;
  try {
    acorn = require('acorn');
    console.log('Using acorn', acorn.version || '(version unknown)');
  } catch (e) {
    console.log('acorn not installed, falling back to Function() parse test (no location info)');
  }

  let anyError = false;
  for (let i = 0; i < scripts.length; i++) {
    const { code, startIndex } = scripts[i];
    const scriptStartLine = lineNumberAt(html, startIndex);
    console.log('\n---- Script #' + (i+1) + ` (starts at index ${startIndex}, html line ${scriptStartLine}) ----`);
    console.log(shortPreview(code, 6));

    const counts = braceBalance(code);
    console.log('Brace counts:', counts);

    try {
      if (acorn) {
        acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
      } else {
        new Function(code);
      }
      console.log('Parse: OK');
    } catch (err) {
      anyError = true;
      console.error('Parse: FAILED');
      console.error(err && err.message ? err.message : String(err));
      if (err.loc && typeof err.loc.line === 'number') {
        const scriptLine = err.loc.line;
        const scriptCol = err.loc.column || 0;
        const globalLine = scriptStartLine + scriptLine - 1;
        console.error(`Error in script at script-line ${scriptLine}, column ${scriptCol}`);
        console.error(`Corresponding to file: index.html line ${globalLine}`);
        console.error('\n--- File context ---');
        console.error(showFileContext(html, globalLine, 6));
        console.error('--- End context ---\n');
      } else {
        console.error('No location available for this parse error.');
      }
    }
  }

  if (anyError) {
    console.error('\nOne or more inline scripts failed to parse.');
    process.exit(1);
  }
  console.log('\nAll inline scripts parsed successfully');
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(3); });

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const backend = join(root, 'backend');
const skipDirs = new Set(['node_modules', '.git', 'data']);
let failures = 0;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (path.endsWith('.js')) out.push(path);
  }
  return out;
}

for (const file of walk(backend)) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failures++;
    console.error(`Syntax check failed: ${relative(root, file)}`);
    console.error(r.stderr || r.stdout);
  }
}

function walkHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name) || name === 'backend') continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walkHtml(path, out);
    else if (path.endsWith('.html')) out.push(path);
  }
  return out;
}

for (const file of walkHtml(root)) {
  const html = readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*type=["']importmap["'])(?:[^>]*)>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .filter(s => s.trim());
  for (let i = 0; i < scripts.length; i++) {
    try {
      new Function(scripts[i]);
    } catch (err) {
      failures++;
      console.error(`Inline script parse failed: ${relative(root, file)} script ${i + 1}`);
      console.error(err.message);
    }
  }
}

if (failures) process.exit(1);
console.log('Syntax checks passed.');

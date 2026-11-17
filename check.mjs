// Quick safety checks used by GitHub Actions (and runnable locally: npm run check).
import fs from 'node:fs';
const html = fs.readFileSync('index.html', 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/); if (!m) throw new Error('inline script not found');
new Function(m[1]); new Function(fs.readFileSync('backend.js', 'utf8'));
const bad = ['service_role', 'sb_secret_'];
for (const f of ['index.html', 'backend.js', 'config.example.js']) for (const b of bad) if (fs.readFileSync(f, 'utf8').includes(b)) throw new Error(`${f} mentions ${b}`);
console.log('checks passed');

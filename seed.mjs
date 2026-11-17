// Optional command-line loader for the opening data (alternative to the "Load opening data" card in the app).
// Usage:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs <folder-with-json> [--demo]
// --demo replaces rider names and mobile numbers with placeholders, for a trial that contains no personal data.
// The service-role key bypasses the access rules: use it on your own computer only, never in Vercel or GitHub.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dir = process.argv[2], demo = process.argv.includes('--demo');
if (!url || !key || !dir) { console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed.mjs <folder> [--demo]'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });
for (const f of ['riders', 'fleet', 'hist1', 'hist2', 'hist3', 'hist4']) {
  const p = path.join(dir, f + '.json'); if (!fs.existsSync(p)) { console.log('skip', f); continue; }
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (demo && f === 'riders') data.items.forEach(r => { r[1] = 'Rider ' + r[0].slice(-5); r[2] = ''; });
  const { error } = await sb.from('kv').upsert({ col: 'masters', id: f, data }, { onConflict: 'col,id' });
  console.log(error ? 'FAILED ' + f + ': ' + error.message : 'loaded masters/' + f);
}

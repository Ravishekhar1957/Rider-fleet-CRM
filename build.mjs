// Vercel build: copies the site into dist/ and writes config.js from environment variables.
// Production and Preview deployments can use different Supabase projects (set the variables per environment in Vercel).
import fs from 'node:fs';
import path from 'node:path';
const url = (process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
const key = (process.env.SUPABASE_ANON_KEY || '').trim();
const vercelEnv = process.env.VERCEL_ENV || process.env.APP_ENV || 'local';
const fail = m => { console.error('\nBUILD STOPPED: ' + m + '\n'); process.exit(1); };
if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url)) fail('SUPABASE_URL is missing or not like https://xxxx.supabase.co (set it in Vercel → Settings → Environment Variables).');
if (key.length < 20) fail('SUPABASE_ANON_KEY is missing.');
if (key.startsWith('sb_secret_')) fail('That is a SECRET key. Use the anon / publishable key.');
try { if (/service_role/.test(Buffer.from(key.split('.')[1] || '', 'base64').toString())) fail('That is the service_role key. Use the anon key.'); } catch (e) {}
const out = 'dist';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
for (const f of ['index.html', 'backend.js']) fs.copyFileSync(f, path.join(out, f));
fs.writeFileSync(path.join(out, 'config.js'),
  `window.SUPABASE_URL=${JSON.stringify(url)};\nwindow.SUPABASE_ANON_KEY=${JSON.stringify(key)};\nwindow.APP_ENV=${JSON.stringify(vercelEnv === 'production' ? 'production' : 'trial')};\n`);
console.log(`Built dist/ for "${vercelEnv}" using ${url}`);

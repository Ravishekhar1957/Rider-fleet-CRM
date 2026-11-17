# Fleet & Rider CRM (Supabase + Vercel)

Static web app (`index.html` + `backend.js`) backed by Supabase (auth, database, storage), deployed by Vercel from GitHub.

## Branches
- `main` → Vercel **Production**
- any other branch / pull request → Vercel **Preview** (shows an orange TRIAL ribbon)

## Environment variables (Vercel → Settings → Environment Variables)
| Name | Value |
|---|---|
| `SUPABASE_URL` | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | the **anon / publishable** key only |

Never use the `service_role` / secret key here. The build refuses it.

## Database
Run `supabase/migrations/20261117000000_init.sql` once in the Supabase SQL editor. The first account that signs up becomes **owner**.

Promote staff after they sign up:
```sql
update public.profiles set role='contributor' where email='staff@example.com';
update public.profiles set role='editor'      where email='manager@example.com';
```

## Opening data
Keep `riders.json`, `fleet.json`, `hist*.json` OUT of this repo. Sign in as owner → Staff tab → **Load opening data**.

## Local
Copy `config.example.js` to `config.js`, fill in URL and anon key, then `npm run dev` (http://localhost:3000). Add that address under Supabase → Authentication → URL Configuration.

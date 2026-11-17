/* Supabase backend for Fleet & Rider CRM.
   Implements the small "claude.use(...)" interface the dashboard expects: db, user, downloads, assets.
   Needs config.js (SUPABASE_URL, SUPABASE_ANON_KEY) and the supabase-js script before this file. */
(() => {
  const URL_ = window.SUPABASE_URL || '', KEY = window.SUPABASE_ANON_KEY || '', BUCKET = 'rider-docs';
  const configured = /^https:\/\/.+\.supabase\.(co|in)/.test(URL_) && KEY.length > 20;
  const sb = configured && window.supabase ? window.supabase.createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  const LEVEL = { viewer: 1, contributor: 2, editor: 3, owner: 4 };
  let ME = null, meP = null;
  const rid = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36).slice(-4);
  const clone = d => JSON.parse(JSON.stringify(d));
  const wrap = e => { const m = (e && e.message) || String(e); return { code: (e && e.code === '42501') || /row-level security|permission denied/i.test(m) ? 'not_granted' : (e && e.code) || 'error', message: m } };

  // ---------- login screen ----------
  function overlay(inner) {
    if (document.getElementById('sbLogin')) return null;
    const o = document.createElement('div'); o.id = 'sbLogin';
    o.style.cssText = 'position:fixed;inset:0;z-index:50;background:var(--bg,#f3f5f8);color:var(--ink,#14213d);display:flex;align-items:center;justify-content:center;padding:16px;font:14px system-ui,sans-serif';
    o.innerHTML = '<div class="card" style="max-width:380px;width:100%">' + inner + '</div>'; document.body.appendChild(o); return o;
  }
  function showConfig() { overlay('<h2>Backend not configured</h2><p class="note">Open <b>config.js</b> and set SUPABASE_URL and SUPABASE_ANON_KEY (Supabase → Project Settings → API). See README.md.</p>') }
  function showLogin() {
    const o = overlay('<h2 style="font-size:18px">⚡ Fleet &amp; Rider CRM</h2><p class="note" id="sbT">Sign in to continue</p><label>Email</label><input id="sbE" type="email" autocomplete="username"><label>Password</label><input id="sbP" type="password" autocomplete="current-password"><div id="sbN" hidden><label>Your name</label><input id="sbName"></div><p id="sbM" class="note" style="min-height:18px"></p><p><button class="p" id="sbGo">Sign in</button> <button id="sbSw">Create account</button> <button id="sbLk">Email me a login link</button></p>');
    if (!o) return; const q = s => o.querySelector(s); let up = false;
    const say = t => q('#sbM').textContent = t;
    q('#sbSw').onclick = () => { up = !up; q('#sbN').hidden = !up; q('#sbGo').textContent = up ? 'Create account' : 'Sign in'; q('#sbSw').textContent = up ? 'I have an account' : 'Create account' };
    q('#sbGo').onclick = async () => {
      const email = q('#sbE').value.trim(), password = q('#sbP').value; if (!email || password.length < 6) return say('Enter your email and a password of at least 6 characters');
      say('Please wait…');
      const r = up ? await sb.auth.signUp({ email, password, options: { data: { name: q('#sbName').value.trim() } } }) : await sb.auth.signInWithPassword({ email, password });
      if (r.error) return say(r.error.message);
      if (r.data && r.data.session) return location.reload();
      say('Account created. Check your email to confirm it, then sign in.');
    };
    q('#sbLk').onclick = async () => {
      const email = q('#sbE').value.trim(); if (!email) return say('Enter your email first');
      const r = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href } }); say(r.error ? r.error.message : 'Login link sent — check your email.');
    };
  }
  function signOutButton(email) {
    if (document.getElementById('sbOut')) return; const b = document.createElement('button');
    b.id = 'sbOut'; b.textContent = 'Sign out'; b.title = email || ''; b.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:40;opacity:.85;padding:5px 10px;font-size:12px';
    b.onclick = async () => { await sb.auth.signOut(); location.reload() }; document.body.appendChild(b);
  }

  // ---------- session / profile ----------
  async function profile() {
    if (meP) return meP;
    meP = (async () => {
      const { data: { session } } = await sb.auth.getSession(); if (!session) return null;
      const { data } = await sb.from('profiles').select('id,name,role').eq('id', session.user.id).maybeSingle();
      ME = { id: session.user.id, email: session.user.email, name: (data && data.name) || session.user.email, role: (data && data.role) || 'viewer' };
      signOutButton(ME.email); return ME;
    })(); return meP;
  }

  // ---------- document store on table kv(col,id,data) ----------
  const caches = {};
  const fire = c => c.subs.forEach(f => f());
  function ensure(col) {
    if (caches[col]) return caches[col];
    const c = caches[col] = { map: new Map(), subs: new Set(), ready: null };
    c.ready = (async () => {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('kv').select('id,data').eq('col', col).order('created_at').range(from, from + 999);
        if (error) throw wrap(error); data.forEach(r => c.map.set(r.id, r.data)); if (data.length < 1000) break;
      }
    })();
    sb.channel('kv-' + col + '-' + rid()).on('postgres_changes', { event: '*', schema: 'public', table: 'kv', filter: 'col=eq.' + col }, p => {
      const id = (p.new && p.new.id) || (p.old && p.old.id); if (!id) return;
      if (p.eventType === 'DELETE') c.map.delete(id); else c.map.set(id, p.new.data); fire(c);
    }).subscribe();
    return c;
  }
  const split = p => { const i = p.indexOf('/'); return [p.slice(0, i), p.slice(i + 1)] };
  const snapDoc = (id, d) => ({ id, exists: d !== undefined, data: () => d });
  async function put(col, id, data, mode) {
    const c = ensure(col), body = { col, id, data };
    const r = mode === 'insert' ? await sb.from('kv').insert(body) : await sb.from('kv').upsert(body, { onConflict: 'col,id' });
    if (r.error) throw wrap(r.error); c.map.set(id, data); fire(c);
  }
  function doc(path) {
    const [col, id] = split(path);
    return {
      get: async () => { const c = ensure(col); await c.ready; return snapDoc(id, c.map.get(id)) },
      set: async d => put(col, id, clone(d)),
      update: async d => { const c = ensure(col); await c.ready; const cur = c.map.get(id); if (cur === undefined) throw { code: 'not_found', message: 'Document does not exist' }; await put(col, id, { ...cur, ...clone(d) }) },
      delete: async () => { const c = ensure(col); const r = await sb.from('kv').delete().eq('col', col).eq('id', id); if (r.error) throw wrap(r.error); c.map.delete(id); fire(c) },
      onSnapshot(cb, err) { const c = ensure(col), f = () => cb(snapDoc(id, c.map.get(id))); c.subs.add(f); c.ready.then(f).catch(e => err && err(e)); return () => c.subs.delete(f) }
    };
  }
  function collection(col) {
    return {
      add: async d => { const id = rid(); await put(col, id, clone(d), 'insert'); return doc(col + '/' + id) },
      doc: id => doc(col + '/' + id),
      onSnapshot(cb, err) { const c = ensure(col), f = () => cb({ docs: [...c.map].map(([id, d]) => ({ id, exists: true, data: () => d })) }); c.subs.add(f); c.ready.then(f).catch(e => err && err(e)); return () => c.subs.delete(f) }
    };
  }
  const db = { doc, collection };

  // ---------- user ----------
  const user = {
    isOwner: () => ME.role === 'owner', canEdit: () => LEVEL[ME.role] >= 3, can: n => n === 'data.write' ? LEVEL[ME.role] >= 2 : null,
    id: async () => ME.id, me: async () => ({ id: ME.id, name: ME.name, email: ME.email }),
    profiles: async ids => { const out = {}; if (!ids.length) return out; const { data } = await sb.from('profiles').select('id,name').in('id', ids); (data || []).forEach(p => out[p.id] = { id: p.id, name: p.name || '' }); return out },
    search: async q => { q = (q || '').replace(/[%,()]/g, ''); let r = sb.from('profiles').select('id,name,email').limit(10); if (q) r = r.or('name.ilike.%' + q + '%,email.ilike.%' + q + '%'); const { data } = await r; return (data || []).map(p => ({ id: p.id, name: p.name || p.email })) }
  };

  // ---------- downloads and assets ----------
  const downloads = { save: async ({ filename, data }) => { const b = data instanceof Blob ? data : new Blob([data]); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename; document.body.appendChild(a); a.click(); a.remove() } };
  const assets = {
    upload: async file => {
      const path = ME.id + '/' + rid() + '-' + file.name.replace(/[^A-Za-z0-9._-]/g, '_');
      const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' }); if (error) throw wrap(error);
      return { id: path, url: '/_blob/' + path, sizeBytes: file.size, contentType: file.type };
    },
    delete: async id => { const { error } = await sb.storage.from(BUCKET).remove([id]); if (error) throw wrap(error) },
    list: async () => ({ assets: [], usage: {} })
  };
  document.addEventListener('click', async e => {
    const a = e.target.closest && e.target.closest('a[href^="/_blob/"]'); if (!a || !sb) return; e.preventDefault();
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(decodeURIComponent(a.getAttribute('href').slice(7)), 120);
    if (error || !data) return alert('Could not open the file'); window.open(data.signedUrl, '_blank', 'noopener');
  });

if (window.APP_ENV && window.APP_ENV !== 'production') document.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('div'); b.textContent = 'TRIAL';
  b.style.cssText = 'position:fixed;left:0;top:0;z-index:60;background:#d97706;color:#fff;font:700 11px system-ui,sans-serif;padding:2px 10px;border-radius:0 0 8px 0;letter-spacing:.08em;pointer-events:none';
  document.body.appendChild(b); });
  window.claude = {
    use: async name => {
      if (!sb) { showConfig(); return null }
      const me = await profile(); if (!me) { showLogin(); return null }
      return ({ db, user, downloads, assets: LEVEL[me.role] >= 2 ? assets : null })[name] || null;
    }
  };
})();

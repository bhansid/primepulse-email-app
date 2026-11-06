(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_TOTAL = 4 * 1024 * 1024;
  const ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'txt'];
  const picked = new Map(); // id -> name
  let files = [];
  let timer = null;

  const show = (id, on = true) => { $(id).hidden = !on; };
  const msg = (text, ok) => { const m = $('msg'); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err'); m.hidden = false; };
  // Session token: kept in memory and in this tab's sessionStorage (cleared when the tab closes).
  let token = '';
  try { token = sessionStorage.getItem('pp_session') || ''; } catch { /* storage blocked */ }
  const setToken = (t) => { token = t || ''; try { t ? sessionStorage.setItem('pp_session', t) : sessionStorage.removeItem('pp_session'); } catch { /* ignore */ } };
  const authHeaders = () => (token ? { 'x-pp-session': token } : {});

  const api = async (path, opts = {}) => {
    const r = await fetch(path, { credentials: 'same-origin', ...opts,
      headers: { 'content-type': 'application/json', ...authHeaders(), ...(opts.headers || {}) } });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/api/login') { setToken(''); boot(); throw new Error('Session expired. Please log in again.'); }
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const loginError = (text) => { $('login-msg').textContent = text; show('login-msg'); };

  /* ---------- boot / auth ---------- */
  async function getMe() {
    const r = await fetch('/api/me', { credentials: 'same-origin', headers: authHeaders() });
    if (!r.ok) throw new Error(`The server isn't responding correctly (error ${r.status}). Check that the latest deploy finished in Netlify.`);
    return r.json();
  }

  async function boot(justLoggedIn = false) {
    let me;
    try { me = await getMe(); } catch (err) { me = { authed: false, error: err.message }; }
    show('boot', false);
    if (!me.authed) {
      show('panel', false); show('logout', false); show('login');
      if (me.error) loginError(me.error);
      else if (me.missingSettings?.length) loginError('Netlify is missing these settings: ' + me.missingSettings.join(', ') + '. Add them, then redeploy.');
      else if (justLoggedIn) loginError("Password accepted, but the session wasn't kept. Make sure you're on the https:// address, then try again.");
      $('password').focus();
      return;
    }
    show('login-msg', false);
    show('login', false); show('panel'); show('logout');
    const sel = $('nurse');
    sel.length = 1;
    (me.nurses || []).forEach((n) => sel.add(new Option(n.name, n.id)));
    if (!me.nurses?.length) msg('No nurses configured yet. Add the NURSES variable in Netlify.', false);
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    show('login-msg', false);
    const btn = e.submitter || $('login-form').querySelector('button');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value.trim() }) });
      setToken(res.token);
      $('password').value = '';
      await boot(true);
    } catch (err) { loginError(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Log in'; }
  });

  $('logout').addEventListener('click', async () => {
    await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    setToken('');
    location.reload();
  });

  /* ---------- patient search ---------- */
  function renderChips() {
    const box = $('chips'); box.replaceChildren();
    picked.forEach((name, id) => {
      const c = el('span', 'chip', name);
      const x = el('button', '', '×'); x.title = 'Remove'; x.type = 'button';
      x.onclick = () => { picked.delete(id); renderChips(); refresh(); };
      c.append(x); box.append(c);
    });
  }

  function choose(p) {
    picked.set(p.id, p.name);
    renderChips(); refresh();
    $('search').value = ''; show('results', false); $('search').focus();
  }

  $('search').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    const box = $('results');
    if (q.length < 2) { show('results', false); return; }
    timer = setTimeout(async () => {
      box.replaceChildren(el('div', 'row', 'Searching…')); show('results');
      try {
        const { patients } = await api('/api/patients?q=' + encodeURIComponent(q));
        box.replaceChildren();
        if (!patients.length) { box.append(el('div', 'row muted', 'No patients found')); return; }
        patients.forEach((p) => {
          const row = el('div', 'row' + (p.hasEmail ? '' : ' off'));
          const left = el('span', '', p.name);
          if (p.dob) left.append(el('small', '', '  ·  ' + p.dob));
          row.append(left, el('small', '', p.hasEmail ? p.email : 'no email on file'));
          if (picked.has(p.id)) row.append(el('small', '', '✓'));
          if (p.hasEmail) row.onclick = () => choose(p);
          box.append(row);
        });
      } catch (err) { box.replaceChildren(el('div', 'row muted', err.message)); }
    }, 300);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) show('results', false);
  });

  /* ---------- attachments ---------- */
  const totalSize = () => files.reduce((a, f) => a + f.size, 0);
  function addFiles(list) {
    for (const f of list) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!ALLOWED.includes(ext)) { msg('File type not allowed: ' + f.name, false); continue; }
      if (totalSize() + f.size > MAX_TOTAL) { msg('Attachments can be 4 MB in total. ' + f.name + ' was not added.', false); continue; }
      files.push(f);
    }
    renderFiles();
  }
  function renderFiles() {
    const box = $('filelist'); box.replaceChildren();
    files.forEach((f, i) => {
      const row = el('div', 'file');
      row.append(el('span', '', `📎 ${f.name}  (${(f.size / 1048576).toFixed(2)} MB)`));
      const x = el('button', '', '×'); x.type = 'button'; x.title = 'Remove';
      x.onclick = () => { files.splice(i, 1); renderFiles(); };
      row.append(x); box.append(row);
    });
  }
  const drop = $('drop');
  drop.onclick = () => $('files').click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('files').click(); } };
  $('files').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  const toBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  /* ---------- send ---------- */
  function refresh() {
    $('send').disabled = !($('nurse').value !== '' && picked.size && $('subject').value.trim() && $('message').value.trim());
  }
  ['nurse', 'subject', 'message'].forEach((id) => $(id).addEventListener('input', refresh));
  $('nurse').addEventListener('change', refresh);

  $('send').addEventListener('click', async () => {
    const n = picked.size;
    const nurseName = $('nurse').selectedOptions[0].text;
    if (!confirm(`Send this email to ${n} patient${n > 1 ? 's' : ''} as ${nurseName}?\nEach patient gets a separate email.`)) return;

    $('send').disabled = true; $('msg').hidden = true;
    const bar = $('progress'); bar.hidden = false; bar.firstElementChild.style.width = '0';

    let attachments;
    try {
      attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await toBase64(f) })));
    } catch { msg('Could not read the attachments.', false); bar.hidden = true; refresh(); return; }

    const base = { nurseId: $('nurse').value, subject: $('subject').value, message: $('message').value, attachments };
    const ok = [], failed = [];
    let i = 0;
    for (const [id, name] of picked) {
      $('send').textContent = `Sending ${++i} of ${n}…`;
      try { await api('/api/send', { method: 'POST', body: JSON.stringify({ ...base, patientId: id, patientName: name }) }); ok.push(id); }
      catch (err) { failed.push(`${name}: ${err.message}`); }
      bar.firstElementChild.style.width = `${(i / n) * 100}%`;
    }

    ok.forEach((id) => picked.delete(id));
    renderChips();
    if (!failed.length) {
      msg(`Sent to ${ok.length} patient${ok.length === 1 ? '' : 's'}.`, true);
      $('subject').value = ''; $('message').value = ''; files = []; renderFiles();
    } else {
      msg(`Sent: ${ok.length}. Not sent: ${failed.length}\n${failed.join('\n')}\n\nThe patients who failed are still selected so you can retry.`, false);
    }
    $('send').textContent = 'Send email';
    setTimeout(() => { bar.hidden = true; }, 800);
    refresh();
  });

  boot();
})();

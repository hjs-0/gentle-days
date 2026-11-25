// Gentle Days frontend: every change goes to the API; nothing is kept only in the browser.
const MOODS = ['rough', 'low', 'okay', 'good', 'great'];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const now = new Date();
let view = new Date(now.getFullYear(), now.getMonth(), 1), sel = key(now);
let U = null, SY = [], E = {}, TD = []; // user, symptoms, entries by date, todos

let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (t.style.opacity = 0), 3500); }

async function api(method, path, body) {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { if (r.status === 401 && !path.startsWith('/auth/')) showAuth(); throw new Error((j && j.error) || 'Something went wrong'); }
  return j;
}

// ----- entries -----
const sym = id => SY.find(s => s.id === id);
const fromSrv = e => ({ date: e.date, mood: e.mood || 0, note: e.note || '', isSaved: e.isSaved, exists: true,
  symptoms: Object.fromEntries(e.symptoms.map(s => [s.symptomId, s.severity])) });
const ent = k => E[k] || (E[k] = { date: k, mood: 0, note: '', isSaved: false, exists: false, symptoms: {} });
const has = e => e && (Object.keys(e.symptoms).length || e.mood || e.note);

const timers = {}, Q = {};
function persist(k, delay = 0) { // debounce, then save one day at a time
  clearTimeout(timers[k]);
  timers[k] = setTimeout(() => { Q[k] = (Q[k] || Promise.resolve()).then(() => push(k)).catch(e => toast(e.message)); }, delay);
}
async function push(k) {
  const e = E[k]; if (!e || (!e.exists && !has(e))) return;
  if (e.exists && !has(e) && !e.isSaved) { await api('DELETE', '/entries/' + k); e.exists = false; return; }
  const body = { date: k, mood: e.mood || null, note: e.note, isSaved: e.isSaved,
    symptoms: Object.entries(e.symptoms).map(([symptomId, severity]) => ({ symptomId, severity })) };
  if (e.exists) await api('PUT', '/entries/' + k, body); else { await api('POST', '/entries', body); e.exists = true; }
}
async function removeEntry(k) {
  clearTimeout(timers[k]); const e = E[k];
  if (e && e.exists) { try { await api('DELETE', '/entries/' + k); } catch (x) { toast(x.message); return; } }
  delete E[k];
}
async function loadRange() {
  const s = new Date(view); s.setDate(1 - view.getDay());
  const e = new Date(s); e.setDate(s.getDate() + 41);
  (await api('GET', `/entries?from=${key(s)}&to=${key(e)}`)).forEach(x => { E[x.date] = fromSrv(x); });
  cal(); log();
}

// ----- calendar -----
function cal() {
  $('mlabel').textContent = view.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const start = new Date(view); start.setDate(1 - view.getDay()); let h = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i); const k = key(d), e = E[k];
    const list = e ? Object.entries(e.symptoms).sort((a, b) => b[1] - a[1]) : [];
    const dots = list.slice(0, 8).map(([id, v]) => { const s = sym(id); return s ? `<span class="dot" title="${esc(s.name)} ${v}/5" style="background:${s.color};width:${.55 + .1 * v}cqw;height:${.55 + .1 * v}cqw"></span>` : ''; }).join('')
      + (list.length > 8 ? `<small>+${list.length - 8}</small>` : '');
    h += `<button class="day${d.getMonth() !== view.getMonth() ? ' out' : ''}${k === key(now) ? ' today' : ''}${k === sel ? ' sel' : ''}" data-k="${k}"><span>${d.getDate()}</span><span class="dots">${dots}</span></button>`;
  }
  $('grid').innerHTML = h;
}

// ----- symptom panel -----
function form(host) {
  const e = ent(sel), d = new Date(sel + 'T00:00');
  host.innerHTML = `<h2>${d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
 <div class="syms">${SY.map(s => `<div class="sym"><span class="lbl"><i class="sw" style="background:${s.color}"></i><span class="sname" data-id="${s.id}" title="Click to rename">${esc(s.name)}</span></span><span class="sev" data-id="${s.id}">${[1, 2, 3, 4, 5].map(i => `<button data-v="${i}" aria-label="${esc(s.name)} severity ${i}" style="border-color:${s.color};${(e.symptoms[s.id] || 0) >= i ? 'background:' + s.color : ''}"></button>`).join('')}</span></div>`).join('')}</div>
 <div class="row"><input type="text" id="cs" maxlength="40" placeholder="add a symptom (click a name to rename)" style="flex:1"></div>
 <div class="row mood"><span>mood</span>${MOODS.map((m, i) => `<button data-m="${i + 1}" class="${e.mood === i + 1 ? 'on' : ''}" aria-label="mood ${i + 1}">${m}</button>`).join('')}</div>
 <textarea class="note" id="nt" maxlength="2000" placeholder="notes: triggers, meds, sleep, how the day felt…">${esc(e.note)}</textarea>
 <div class="row"><button class="save" data-save="1">${host.id === 'log' ? 'Save entry' : 'Save changes'}</button>${host.id === 'mbody' ? '<button class="save" data-del="1">Delete entry</button>' : ''}</div>`;
  $('nt').oninput = ev => { ent(sel).note = ev.target.value; cal(); persist(sel, 700); };
  $('cs').onkeydown = async ev => {
    const v = ev.target.value.trim(); if (ev.key !== 'Enter' || !v) return;
    try {
      let s = SY.find(x => x.name.toLowerCase() === v.toLowerCase());
      if (!s) { s = await api('POST', '/symptoms', { name: v }); SY.push(s); }
      ent(sel).symptoms[s.id] = ent(sel).symptoms[s.id] || 1; persist(sel); log(); cal();
    } catch (x) { toast(x.message); }
  };
}
function summary() {
  const e = E[sel], d = new Date(sel + 'T00:00'), sy = Object.entries(e.symptoms).filter(([id]) => sym(id));
  $('log').innerHTML = `<h2>${d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}</h2><div class="sub">saved entry</div>
 <div class="syms">${sy.map(([id, v]) => `<div class="sym"><span class="lbl"><i class="sw" style="background:${sym(id).color}"></i><span class="sname2">${esc(sym(id).name)}</span></span><b>${v}/5</b></div>`).join('') || '<span class="sub">no symptoms logged</span>'}</div>
 ${e.mood ? `<div class="row">mood: ${MOODS[e.mood - 1]}</div>` : ''}
 ${e.note ? `<div class="row" style="display:block;flex:1;min-height:0;overflow:auto;overflow-wrap:anywhere;white-space:pre-wrap">${esc(e.note)}</div>` : '<div style="flex:1"></div>'}
 <div class="row"><button class="save" data-edit="1">Edit entry</button></div>`;
}
function log() {
  const e = E[sel];
  if (e && e.isSaved) { summary(); if ($('modal').style.display === 'flex') form($('mbody')); } else form($('log'));
}
function openM() { $('modal').style.display = 'flex'; form($('mbody')); }
function closeM() { $('modal').style.display = 'none'; log(); cal(); }

async function fclick(e) {
  const b = e.target.closest('button'); if (!b) return; const en = ent(sel);
  if (b.dataset.v) { const id = b.parentNode.dataset.id, v = +b.dataset.v; if (en.symptoms[id] === v) delete en.symptoms[id]; else en.symptoms[id] = v; persist(sel); }
  else if (b.dataset.m) { const m = +b.dataset.m; en.mood = en.mood === m ? 0 : m; persist(sel); }
  else if (b.dataset.save) { en.isSaved = !!has(en); persist(sel); closeM(); return; }
  else if (b.dataset.del) { await removeEntry(sel); closeM(); return; }
  else if (b.dataset.edit) { openM(); return; }
  else return;
  log(); cal();
}
function rename(el) {
  const s = sym(el.dataset.id), i = document.createElement('input');
  i.type = 'text'; i.value = s.name; i.className = 'ren'; i.maxLength = 40; el.replaceWith(i); i.focus(); i.select();
  let done = 0;
  const fin = async ok => {
    if (done) return; done = 1; const v = i.value.trim();
    if (ok && v !== s.name) {
      try {
        if (!v) { // empty name = delete the symptom
          if (confirm(`Delete "${s.name}" and all its past entries?`)) {
            await api('DELETE', '/symptoms/' + s.id); SY = SY.filter(x => x.id !== s.id); Object.values(E).forEach(en => delete en.symptoms[s.id]);
          }
        } else s.name = (await api('PUT', '/symptoms/' + s.id, { name: v })).name; // one row changes, every past entry follows
      } catch (x) { toast(x.message.includes('exists') ? 'You already have a symptom with that name' : x.message); }
    }
    log(); cal();
  };
  i.onkeydown = ev => { if (ev.key === 'Enter') fin(1); if (ev.key === 'Escape') fin(0); };
  i.onblur = () => fin(1);
}

// ----- last 30 days -----
async function openIns() {
  $('imodal').style.display = 'flex'; $('ibody').innerHTML = '<div class="sub">loading…</div>';
  try {
    const p = await api('GET', '/patterns?days=30'), top = p.symptoms.slice(0, 8), mx = top[0] ? top[0].days : 1;
    $('ibody').innerHTML = `<h2>Last 30 Days</h2><div class="sub">${p.daysLogged} day${p.daysLogged === 1 ? '' : 's'} logged</div>` +
      (top.length ? top.map(s => `<div class="bar"><span style="width:9cqw">${esc(s.name)}</span><i style="width:${s.days / mx * 10}cqw;background:${s.color}"></i><span>${s.days}d · avg ${s.avgSeverity.toFixed(1)}</span></div>`).join('') : '<div class="sub">patterns will appear here as you log symptoms.</div>');
  } catch (e) { $('ibody').innerHTML = '<div class="sub">' + esc(e.message) + '</div>'; }
}

// ----- to-dos and sticky notes -----
function todo() {
  $('tl').innerHTML = TD.map(t => `<div class="ti${t.isDone ? ' done' : ''}"><input type="checkbox" data-id="${t.id}" ${t.isDone ? 'checked' : ''}><span>${esc(t.text)}</span><button data-x="${t.id}" aria-label="Delete">×</button></div>`).join('');
}
$('tin').onkeydown = async e => {
  const v = e.target.value.trim(); if (e.key !== 'Enter' || !v) return;
  try { TD.push(await api('POST', '/todos', { text: v })); e.target.value = ''; todo(); } catch (x) { toast(x.message); }
};
$('tl').onclick = async e => {
  const id = e.target.dataset.id, x = e.target.dataset.x;
  try {
    if (id) Object.assign(TD.find(t => t.id === id), await api('PUT', '/todos/' + id, { isDone: e.target.checked }));
    else if (x) { await api('DELETE', '/todos/' + x); TD = TD.filter(t => t.id !== x); } else return;
  } catch (err) { toast(err.message); }
  todo();
};
[0, 1, 2].forEach(i => { const t = $('n' + i); let h; t.oninput = () => { clearTimeout(h); h = setTimeout(() => api('PUT', '/notes/' + i, { text: t.value }).catch(e => toast(e.message)), 700); }; });

// ----- wiring -----
$('grid').onclick = e => { const b = e.target.closest('.day'); if (!b) return; sel = b.dataset.k; const d = new Date(sel + 'T00:00'); if (d.getMonth() !== view.getMonth()) { view = new Date(d.getFullYear(), d.getMonth(), 1); loadRange().catch(x => toast(x.message)); } cal(); log(); };
$('prev').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); cal(); loadRange().catch(x => toast(x.message)); };
$('next').onclick = () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); cal(); loadRange().catch(x => toast(x.message)); };
$('log').onclick = fclick;
$('modal').onclick = e => { if (e.target.id === 'modal' || e.target.id === 'mx') { closeM(); return; } fclick(e); };
[$('log'), $('modal')].forEach(el => el.addEventListener('click', e => { const s = e.target.closest('.sname'); if (s) rename(s); }));
$('ibtn').onclick = openIns;
$('imodal').onclick = e => { if (e.target.id === 'imodal' || e.target.id === 'ix') $('imodal').style.display = 'none'; };
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return; $('imodal').style.display = 'none';
  if (e.target.tagName !== 'INPUT' && $('modal').style.display === 'flex') closeM();
});

// ----- sign in / sign up -----
function showAuth() { $('auth').style.display = 'flex'; }
async function authGo(kind) {
  const body = { email: $('ae').value.trim(), password: $('ap').value };
  if (kind === 'register' && $('an').value.trim()) body.displayName = $('an').value.trim();
  try { U = await api('POST', '/auth/' + kind, body); $('ap').value = ''; $('aerr').textContent = ''; await start(); }
  catch (e) { $('aerr').textContent = e.message; }
}
$('ali').onclick = () => authGo('login');
$('asu').onclick = () => authGo('register');
$('ap').onkeydown = e => { if (e.key === 'Enter') authGo('login'); };
$('out').onclick = async () => { try { await api('POST', '/auth/logout'); } catch (e) {} U = null; SY = []; E = {}; TD = []; $('out').style.display = 'none'; showAuth(); };

async function start() {
  $('auth').style.display = 'none';
  try {
    const [s, t, n] = await Promise.all([api('GET', '/symptoms'), api('GET', '/todos'), api('GET', '/notes')]);
    SY = s; TD = t; [0, 1, 2].forEach(i => { const r = n.find(x => x.slot === i); $('n' + i).value = r ? r.text : ''; });
    await loadRange(); todo();
    $('out').textContent = 'Hi' + (U.displayName ? ', ' + U.displayName : '') + ' · log out'; $('out').style.display = 'block';
  } catch (e) { toast(e.message); }
}
(async () => { try { U = await api('GET', '/auth/me'); await start(); } catch (e) { showAuth(); } })();

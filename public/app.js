'use strict';

// ================= Helfer =================
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('#app');

let meta = null;
let auth = null;   // { user, allowRegistration }
let cleanup = null; // Event-Listener der aktuellen Ansicht
const state = {
  q: '',
  sort: 'titel',
  view: lsGet('view') || 'stapel',
  scope: lsGet('scope') || 'mine', // 'mine' oder Gruppen-ID
  f: { gang: new Set(), zeit: new Set(), preis: new Set(), aufwand: new Set(), kueche: new Set(), tags: new Set() },
  ids: [],          // aktuelle Trefferliste (zum Blättern)
  random: false,    // kam man über "Zufall" zum Rezept?
  randomFiltered: false,
  listScroll: 0,
};

function ssTake(k) {
  try { const v = sessionStorage.getItem('kochbuch.' + k); sessionStorage.removeItem('kochbuch.' + k); return v; } catch { return null; }
}
function ssSet(k, v) { try { sessionStorage.setItem('kochbuch.' + k, v); } catch {} }
function ssGet(k) { try { return sessionStorage.getItem('kochbuch.' + k); } catch { return null; } }
function lsGet(k) { try { return localStorage.getItem('kochbuch.' + k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem('kochbuch.' + k, v); } catch {} }

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    // Session abgelaufen → zurück zum Login
    auth = { ...auth, user: null };
    meta = null;
    renderLogin();
    throw new Error('Bitte einloggen');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}

function filterParams() {
  const p = new URLSearchParams();
  if (state.scope !== 'mine') p.set('scope', state.scope);
  if (state.q) p.set('q', state.q);
  for (const [k, set] of Object.entries(state.f)) for (const v of set) p.append(k, v);
  p.set('sort', state.sort);
  return p;
}
const anyFilter = () => state.q || Object.values(state.f).some((s) => s.size);

// ================= Icons =================
const ICON = {
  dice: document.querySelector('#btn-random .ic-dice').outerHTML, // Würfel aus index.html wiederverwenden
  clock: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chef: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 14a4 4 0 1 1 1.6-7.7A4.5 4.5 0 0 1 16.4 6.3 4 4 0 1 1 18 14v6H6z"/><path d="M6 17h12"/></svg>',
  euro: '<svg viewBox="0 0 24 24" class="ic"><path d="M17 6.5A7 7 0 1 0 17 17.5"/><path d="M4 10h9M4 14h9"/></svg>',
  globe: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>',
  fire: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5 1-8.5z"/></svg>',
  people: '<svg viewBox="0 0 24 24" class="ic"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></svg>',
  left: '<svg viewBox="0 0 24 24" class="ic"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" class="ic"><path d="M9 5l7 7-7 7"/></svg>',
  stack: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="9" rx="1"/></svg>',
  plate: '<svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="13" r="7"/><circle cx="12" cy="13" r="3.5"/><path d="M3 4v5M3 9v11M21 4c-1.5 1-2 3-2 5h2v11"/></svg>',
  share: '<svg viewBox="0 0 24 24" class="ic"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.9l7.6-4.6M8.2 13.1l7.6 4.6"/></svg>',
  cart: '<svg viewBox="0 0 24 24" class="ic"><path d="M3 4h2.5l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L21 8H6.3"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
  grid: '<svg viewBox="0 0 24 24" class="ic"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
};

// Farbige Kreise für Zutaten: gleiche Zutat → immer gleiche Farbe
const DOT_COLORS = ['#e8705f', '#f2a541', '#7cb342', '#4f8a3c', '#6f9aa6', '#b4874a', '#c94f4f', '#7a5c99', '#d9822b', '#3f7f8c'];
const recipeColor = (id) => DOT_COLORS[(Number(id) * 3) % DOT_COLORS.length];
function dotColor(name) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
}

// Badge-Farben (wie die farbigen Nummernfelder auf den Karten)
const BADGE_COLORS = ['#c94f4f', '#3b3b3b', '#6f9aa6', '#a63d3d', '#e8705f', '#4f8a3c', '#22304a', '#b4874a', '#7a5c99', '#d9822b'];
const badgeColor = (id) => BADGE_COLORS[id % BADGE_COLORS.length];

// ================= Zutaten-Parser =================
const UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'cl', 'dl', 'el', 'tl', 'msp', 'prise', 'prisen', 'stück', 'stk', 'bund', 'dose', 'dosen',
  'zehe', 'zehen', 'pck', 'päckchen', 'packung', 'becher', 'scheibe', 'scheiben', 'tasse', 'tassen', 'handvoll', 'zweig', 'zweige',
  'blatt', 'blätter', 'glas', 'gläser', 'cm', 'beutel', 'knolle', 'knollen', 'kopf', 'stange', 'stangen', 'schuss', 'spritzer'];
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseAmount(s) {
  s = s.replace(/\s+/g, '');
  let m;
  if ((m = s.match(/^(\d+)([½¼¾⅓⅔])$/))) return Number(m[1]) + FRAC[m[2]];
  if (FRAC[s] !== undefined) return FRAC[s];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return Number(m[1]) / Number(m[2]);
  return Number(s.replace(',', '.'));
}

function fmtAmount(n) {
  if (!isFinite(n)) return '';
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  const fr = [[0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾']].find(([v]) => Math.abs(rest - v) < 0.04);
  if (rest < 0.04) return String(whole);
  if (rest > 0.96) return String(whole + 1);
  if (fr && n < 10) return (whole || '') + fr[1];
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function parseIngredient(line) {
  const raw = line.trim();
  if (!raw) return null;
  if (/:$/.test(raw)) return { heading: raw.slice(0, -1) };
  const m = raw.match(/^(\d+\s*[½¼¾⅓⅔]|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/);
  if (!m) return { amount: null, unit: '', name: raw };
  let rest = m[3];
  let unit = '';
  const um = rest.match(/^([A-Za-zÄÖÜäöüß]+)\.?(?=\s|$)\s*(.*)$/);
  if (um && UNITS.includes(um[1].toLowerCase()) && um[2]) {
    unit = um[1];
    rest = um[2];
  }
  return { amount: parseAmount(m[1]), amountTo: m[2] ? parseAmount(m[2]) : null, unit, name: rest || raw };
}

const parseIngredients = (text) => String(text || '').split('\n').map(parseIngredient).filter(Boolean);

function qtyText(ing, factor) {
  if (ing.amount == null || !isFinite(ing.amount)) return '';
  let s = fmtAmount(ing.amount * factor);
  if (ing.amountTo) s += '–' + fmtAmount(ing.amountTo * factor);
  return ing.unit ? `${s} ${ing.unit}` : s;
}

// Schritte: durch Leerzeilen getrennt, sonst eine Zeile = ein Schritt
function parseSteps(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const blocks = /\n\s*\n/.test(t) ? t.split(/\n\s*\n/) : t.split('\n');
  return blocks.map((b) => b.trim().replace(/^(\d+[.)]|schritt\s*\d+:?)\s*/i, '')).filter(Boolean);
}

// Zutatennamen im Schritttext fett markieren (+ **manuell** fett)
function highlightStep(text, ingredients) {
  let html = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const words = new Set();
  for (const ing of ingredients) {
    if (!ing.name) continue;
    const base = ing.name.replace(/\(.*?\)/g, '').split(/[,;]| oder | und /)[0].trim();
    for (const w of base.split(/\s+/)) {
      const clean = w.replace(/[^A-Za-zÄÖÜäöüß-]/g, '');
      if (clean.length >= 4 && /^[A-ZÄÖÜ]/.test(clean)) words.add(clean);
    }
  }
  if (!words.size) return html;
  // Wortstamm (ohne Plural-Endung) matchen, z. B. "Karotten" ↔ "Karotte"
  const stems = [...words].map((w) => w.replace(/(en|n|e|s)$/i, '')).filter((w) => w.length >= 3)
    .sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(?<![\\wÄÖÜäöüß>])((?:${stems.join('|')})[a-zäöüß]*)(?![^<]*</b>)`, 'g');
  return html.replace(re, '<b>$1</b>');
}

// ================= Bilder =================
let shareToken = null; // gesetzt, solange ein geteiltes Rezept angezeigt wird
function photoUrl(f) {
  return shareToken
    ? `/api/public/${encodeURIComponent(shareToken)}/photos/${encodeURIComponent(f)}`
    : '/uploads/' + encodeURIComponent(f);
}

function placeholder(id, cls = '') {
  return `<div class="ph ${cls}"><span class="ph-dot" style="--dc:${recipeColor(id)}"></span></div>`;
}

// Bildansicht mit Blättern (Pfeile, Pfeiltasten, Wischen)
const lightbox = { list: [], i: 0 };
function showLightbox() {
  const lb = $('#lightbox');
  $('img', lb).src = lightbox.list[lightbox.i];
  const multi = lightbox.list.length > 1;
  $('.lb-prev', lb).hidden = $('.lb-next', lb).hidden = $('.lb-count', lb).hidden = !multi;
  $('.lb-count', lb).textContent = `${lightbox.i + 1} / ${lightbox.list.length}`;
}
function openLightbox(src, list = [src]) {
  lightbox.list = list;
  lightbox.i = Math.max(0, list.indexOf(src));
  showLightbox();
  $('#lightbox').hidden = false;
}
function stepLightbox(d) {
  const n = lightbox.list.length;
  if (n < 2) return;
  lightbox.i = (lightbox.i + d + n) % n;
  showLightbox();
}
const closeLightbox = () => ($('#lightbox').hidden = true);
$('#lightbox').addEventListener('click', (e) => {
  if (e.target.closest('.lb-prev')) stepLightbox(-1);
  else if (e.target.closest('.lb-next')) stepLightbox(1);
  else closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') stepLightbox(-1);
  if (e.key === 'ArrowRight') stepLightbox(1);
});
{
  let lbX = null;
  $('#lightbox').addEventListener('touchstart', (e) => { lbX = e.touches[0].clientX; }, { passive: true });
  $('#lightbox').addEventListener('touchend', (e) => {
    if (lbX == null) return;
    const dx = e.changedTouches[0].clientX - lbX;
    lbX = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); stepLightbox(dx > 0 ? -1 : 1); }
  });
}

async function resizeImage(file, max = 1800) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

// ================= Rezeptkarte (Vorderseite) =================
function metaLine(r) {
  const euro = { 'günstig': '€', 'mittel': '€€', 'teuer': '€€€' }[r.preis] || '';
  return [r.gang, r.zeit, r.kcal ? `${r.kcal} kcal` : '', r.aufwand, euro].filter(Boolean).map(esc).join(' · ');
}

function cardIngredients(r, max) {
  const ings = parseIngredients(r.ingredients).filter((i) => !i.heading).slice(0, max);
  return ings.map((i) => {
    const name = i.name.replace(/\(.*?\)/g, '').split(',')[0].trim();
    return `<li><span class="ing-ic" style="--dc:${dotColor(name)}"></span><span class="ing-lbl">${esc(name)}</span></li>`;
  }).join('');
}

function recipeCard(r, { link = true, big = false } = {}) {
  const tag = link ? 'a' : 'div';
  const href = link ? ` href="#/r/${r.id}"` : '';
  const photo = r.photo || r.photos?.[0]?.filename;
  const ingList = cardIngredients(r, big ? 12 : 8);
  return `
  <${tag} class="rcard${big ? ' rcard-big' : ''}"${href} data-id="${r.id}">
    <div class="rcard-head">
      <div class="rcard-leaf" aria-hidden="true" style="--dc:${recipeColor(r.id)}"></div>
      <div class="rcard-titles">
        <h3 class="rcard-title">${esc(r.title)}</h3>
        ${r.subtitle ? `<p class="rcard-sub">${esc(r.subtitle)}</p>` : ''}
        <p class="rcard-meta">${metaLine(r)}</p>
        ${r.own === false && r.author ? `<p class="rcard-author">von ${esc(r.author)}</p>` : ''}
      </div>
      <div class="rcard-badge-wrap">
        <div class="rcard-badge" style="--bc:${badgeColor(r.id)}"><span>${r.id}</span></div>
        ${r.kueche ? `<div class="rcard-badge-label">${esc(r.kueche)}</div>` : ''}
      </div>
    </div>
    <div class="rcard-main">
      <div class="rcard-photo${photo ? ' has-ph' : ''}"${photo ? ` style="--ph:url('${photoUrl(photo)}')"` : ''}>${photo ? `<img loading="lazy" src="${photoUrl(photo)}" alt="">` : placeholder(r.id)}</div>
      ${ingList ? `<ul class="rcard-ings">${ingList}</ul>` : ''}
    </div>
  </${tag}>`;
}

// ================= Router =================
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  closeSheet();
  const [, view, id, sub] = (location.hash.slice(1) || '/').split('/');
  if (view !== 'kalender') shopSel = null;
  shareToken = view === 's' ? id : null;
  if (!shareToken) document.title = 'Kochbuch';
  try {
    // Geteiltes Rezept: ohne Login sichtbar
    if (!auth) auth = await api('/api/auth/me');
    if (shareToken) { showUser(); return await renderDetail(null, { shared: true }); }
    if (!auth.user) return renderLogin();
    showUser();
    if (!meta) await reloadMeta();
    // Nach dem Login: vorgemerktes geteiltes Rezept übernehmen
    const pending = ssTake('import');
    if (pending) return await importShared(pending);
    if (view === 'kategorien') renderCategories();
    else if (view === 'benutzer') await renderUsers();
    else if (view === 'gruppen') await renderGroups();
    else if (view === 'ausgeblendet') await renderHidden();
    else if (view === 'kalender') await renderCalendar(id);
    else if (view === 'einkaufslisten') await renderShopping(id);
    else if (view === 'events') await renderEvents(id, sub);
    else if (view === 'r') await renderDetail(id);
    else if (view === 'neu') renderForm();
    else if (view === 'edit') await renderForm(id);
    else await renderList();
  } catch (e) {
    app.innerHTML = shareToken
      ? `<div class="empty"><div class="empty-ic">🔗</div><h2>Rezept nicht verfügbar</h2><p>${esc(e.message)}</p></div>`
      : `<div class="empty"><p>${esc(e.message)}</p><a class="btn" href="#/">Zur Übersicht</a></div>`;
  }
}
window.addEventListener('hashchange', route);

async function goRandom(useFilters) {
  try {
    const p = useFilters ? filterParams() : new URLSearchParams();
    const current = location.hash.match(/^#\/r\/(\d+)/);
    if (current) p.set('exclude', current[1]);
    const r = await api('/api/recipes/random?' + p);
    state.random = true;
    state.randomFiltered = useFilters;
    if (location.hash === `#/r/${r.id}`) route();
    else location.hash = `#/r/${r.id}`;
  } catch (e) {
    toast(e.message, true);
  }
}
$('#btn-random').addEventListener('click', () => goRandom(false));

// ================= Login =================
function showUser() {
  $('#nav').hidden = !auth?.user;
  $('#user-name').textContent = auth?.user ? auth.user.username : '';
  const admin = !!auth?.user?.isAdmin;
  $('#menu-users').hidden = !admin;
  const n = admin ? auth.pending || 0 : 0;
  $('#menu-users-badge').textContent = n;
  $('#menu-users-badge').hidden = !n;
  const inv = auth?.user ? meta?.invites || 0 : 0;
  $('#menu-groups-badge').textContent = inv;
  $('#menu-groups-badge').hidden = !inv;
  $('#user-badge').hidden = !(n || inv);
}

const fmtMB = (bytes) => {
  const mb = bytes / 1048576;
  return mb >= 1000 ? `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
    : `${mb.toLocaleString('de-DE', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
};

// Speicherverbrauch im Benutzermenü
function showStorage() {
  const el = $('#menu-storage');
  const s = meta?.storage;
  el.hidden = !s;
  if (!s) return;
  const pct = s.quota ? Math.min(100, (s.used / s.quota) * 100) : 0;
  el.innerHTML = `<div class="storage-txt">Fotos: ${fmtMB(s.used)}${s.quota ? ` von ${fmtMB(s.quota)}` : ''}</div>
    ${s.quota ? `<div class="storage-bar${pct >= 90 ? ' full' : ''}"><span style="width:${pct.toFixed(1)}%"></span></div>` : ''}`;
}

function resetState() {
  meta = null;
  Object.values(state.f).forEach((s) => s.clear());
  Object.assign(state, { q: '', ids: [], random: false, listScroll: 0 });
}

function renderLogin(mode = 'login', notice = '') {
  if (cleanup) { cleanup(); cleanup = null; }
  showUser();
  const reg = mode === 'register';
  const canRegister = auth?.allowRegistration !== false;
  app.innerHTML = `
  <form class="auth panel" id="auth-form" novalidate>
    <img class="auth-ic" src="logo.svg" alt="">
    <h1>${reg ? 'Konto anlegen' : 'Anmelden'}</h1>
    <p class="muted">${ssGet('import') ? 'Melde dich an oder registriere dich, dann wird das geteilte Rezept in dein Kochbuch übernommen.'
      : reg ? 'Leg ein Konto für deine eigene Rezeptsammlung an. Neue Konten werden erst nach Bestätigung freigeschaltet.' : 'Melde dich an, um deine Rezepte zu sehen.'}</p>
    ${notice ? `<p class="auth-notice">${esc(notice)}</p>` : ''}
    <div class="field">
      <label for="a-user">Benutzername</label>
      <input id="a-user" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
    </div>
    <div class="field">
      <label for="a-pass">Passwort${reg ? ' <small>(mind. 8 Zeichen)</small>' : ''}</label>
      <input id="a-pass" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
    </div>
    ${reg ? `<div class="field">
      <label for="a-pass2">Passwort wiederholen</label>
      <input id="a-pass2" name="password2" type="password" autocomplete="new-password" required>
    </div>` : ''}
    <p class="auth-error" id="auth-error" hidden></p>
    <button type="submit" class="btn btn-primary auth-submit">${reg ? 'Registrieren' : 'Anmelden'}</button>
    ${canRegister ? `<p class="auth-switch">${reg ? 'Schon ein Konto?' : 'Noch kein Konto?'}
      <button type="button" class="link-btn" id="auth-toggle">${reg ? 'Anmelden' : 'Registrieren'}</button></p>` : ''}
  </form>`;
  $('#a-user').focus();
  $('#auth-toggle')?.addEventListener('click', () => renderLogin(reg ? 'login' : 'register'));
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $('#auth-error');
    const fail = (msg) => { err.textContent = msg; err.hidden = false; };
    err.hidden = true;
    if (!f.username.value.trim() || !f.password.value) return fail('Bitte Benutzername und Passwort eingeben');
    if (reg && f.password.value !== f.password2.value) return fail('Die Passwörter stimmen nicht überein');
    const btn = $('.auth-submit');
    btn.disabled = true;
    try {
      const res = await api('/api/auth/' + (reg ? 'register' : 'login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.username.value.trim(), password: f.password.value }),
      });
      if (res.pending) return renderLogin('login', 'Danke! Dein Konto wird freigeschaltet, sobald es bestätigt wurde. Danach kannst du dich hier anmelden.');
      auth = { ...auth, user: res.user, pending: 0 };
      if (res.user.isAdmin) api('/api/auth/me').then((me) => { auth = me; showUser(); }).catch(() => {});
      resetState();
      if (location.hash && location.hash !== '#/') route();
      else { location.hash = '#/'; route(); }
    } catch (ex) {
      fail(ex.message);
      btn.disabled = false;
    }
  });
}

// Benutzermenü im Header
const userMenu = $('#user-menu');
const setMenu = (open) => { userMenu.hidden = !open; $('#btn-user').setAttribute('aria-expanded', String(open)); };
$('#btn-user').addEventListener('click', (e) => { e.stopPropagation(); setMenu(userMenu.hidden); });
document.addEventListener('click', (e) => { if (!e.target.closest('.user-menu')) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setMenu(false); closeSheet(); } });
window.addEventListener('hashchange', () => { setMenu(false); closeSheet(); });

$('#btn-logout').addEventListener('click', async () => {
  setMenu(false);
  try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
  auth = { ...auth, user: null };
  resetState();
  history.replaceState(null, '', '#/');
  renderLogin();
});

// ================= Übersicht =================
const CAT_LABELS = { gang: 'Gang', zeit: 'Zeit', aufwand: 'Aufwand', preis: 'Preis', kueche: 'Küche' };
const GROUPS = [
  ...Object.keys(CAT_LABELS).map((k) => [k, CAT_LABELS[k], () => (meta.filterOptions[k] || []).map((v) => [v, v])]),
  ['tags', 'Tags', () => meta.tags.map((t) => [t.name, '#' + t.name])],
];

// Filter entfernen, deren Wert es nicht mehr gibt (z. B. nach Löschen/Umbenennen)
function pruneFilters() {
  for (const k of Object.keys(CAT_LABELS)) {
    for (const v of state.f[k]) if (!(meta.filterOptions[k] || []).includes(v)) state.f[k].delete(v);
  }
  const tags = new Set(meta.tags.map((t) => t.name));
  for (const v of state.f.tags) if (!tags.has(v)) state.f.tags.delete(v);
}

// Neuen Wert in einer Kategorie anlegen (gibt den gespeicherten Wert zurück oder null)
// Kleines Eingabefeld direkt an Stelle des "+ Neu"-Chips (Enter speichert, Esc bricht ab)
function askInline(btn, placeholder) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.className = 'chip chip-input';
    inp.placeholder = placeholder;
    inp.maxLength = 40;
    inp.enterKeyHint = 'done';
    btn.hidden = true;
    btn.after(inp);
    inp.focus();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      inp.remove();
      btn.hidden = false;
      resolve(v);
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(inp.value.trim() || null); }
      if (e.key === 'Escape') finish(null);
    });
    inp.addEventListener('blur', () => finish(inp.value.trim() || null));
  });
}

async function addOption(category, btn) {
  const value = await askInline(btn, CAT_LABELS[category] + '…');
  if (!value) return null;
  try {
    const res = await api('/api/options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category, value }),
    });
    meta.options[category].push(res.value);
    const fo = meta.filterOptions[category];
    if (!fo.some((v) => v.toLowerCase() === res.value.toLowerCase())) fo.push(res.value);
    return res.value;
  } catch (e) { toast(e.message, true); return null; }
}

async function renderList() {
  state.random = false;
  app.innerHTML = `
    <section class="intro">
      <h1>Was kochen wir heute?</h1>
      ${meta.groups.length ? `<div class="scope-bar" role="group" aria-label="Kochbuch">
        <button class="chip${state.scope === 'mine' ? ' on' : ''}" data-scope="mine">Meine Rezepte</button>
        ${meta.groups.map((g) => `<button class="chip${state.scope === String(g.id) ? ' on' : ''}" data-scope="${g.id}">👥 ${esc(g.name)}</button>`).join('')}
      </div>` : ''}
      <div class="searchbar">
        <input id="q" type="search" placeholder="Rezept oder Zutat suchen…" value="${esc(state.q)}" autocomplete="off">
      </div>
    </section>
    <section class="filters" id="filters"></section>
    <div class="toolbar">
      <span id="count" class="count"></span>
      <div class="toolbar-right">
        <div class="seg" role="group" aria-label="Ansicht">
          <button data-view="stapel" title="Stapel">${ICON.stack}</button>
          <button data-view="raster" title="Raster">${ICON.grid}</button>
        </div>
        <select id="sort" aria-label="Sortierung">
          <option value="titel">A–Z</option>
          <option value="neu">Neueste</option>
        </select>
        <button class="btn btn-outline" id="rnd-filter">${ICON.dice} <span class="hide-sm">Zufall aus Auswahl</span></button>
      </div>
    </div>
    <section id="cards"></section>`;

  renderFilters();
  $('#sort').value = state.sort;
  updateViewButtons();

  let timer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); loadCards(); renderFilters(); }, 200);
  });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; loadCards(); });
  $('#rnd-filter').addEventListener('click', () => goRandom(true));
  $$('[data-scope]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.scope === state.scope) return;
    setScope(b.dataset.scope);
    Object.values(state.f).forEach((s) => s.clear());
    state.listScroll = 0;
    try { await reloadMeta(); } catch (e) { return toast(e.message, true); }
    renderList();
  }));
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    state.view = b.dataset.view;
    lsSet('view', state.view);
    updateViewButtons();
    $('#cards').className = 'cards cards-' + state.view;
  }));

  const onScroll = () => (state.listScroll = window.scrollY);
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => window.removeEventListener('scroll', onScroll);

  await loadCards();
  window.scrollTo(0, state.listScroll);
}

function updateViewButtons() {
  $$('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
}

function renderFilters() {
  const el = $('#filters');
  if (!el) return;
  el.innerHTML = GROUPS.map(([key, label, opts]) => {
    const o = opts();
    if (!o.length && key === 'tags') return '';
    return `<div class="fgroup"><span class="flabel">${label}</span><div class="chips">${o
      .map(([v, l]) => `<button class="chip${state.f[key].has(v) ? ' on' : ''}" data-k="${key}" data-v="${esc(v)}">${esc(l)}</button>`)
      .join('')}${key === 'tags' ? '' : `<button class="chip chip-add" data-add="${key}" title="Neuen Wert anlegen">+ Neu</button>`}</div></div>`;
  }).join('') + `<div class="filters-foot">${anyFilter() ? '<button class="link-btn" id="reset">× Filter zurücksetzen</button>' : '<span></span>'}
    <a class="link-btn" href="#/kategorien">⚙ Kategorien verwalten</a></div>`;
  el.onclick = async (e) => {
    if (e.target.closest('.chip-input')) return;
    const add = e.target.closest('.chip-add');
    if (add) {
      if (await addOption(add.dataset.add, add)) renderFilters();
      return;
    }
    const b = e.target.closest('.chip');
    if (b) {
      const s = state.f[b.dataset.k];
      s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v);
    } else if (e.target.id === 'reset') {
      Object.values(state.f).forEach((s) => s.clear());
      state.q = '';
      $('#q').value = '';
    } else return;
    renderFilters();
    loadCards();
  };
}

let loadSeq = 0;
async function loadCards() {
  const seq = ++loadSeq;
  const list = await api('/api/recipes?' + filterParams());
  if (seq !== loadSeq || !$('#cards')) return;
  state.ids = list.map((r) => r.id);
  $('#count').textContent = `${list.length} ${list.length === 1 ? 'Rezept' : 'Rezepte'}`;
  const cards = $('#cards');
  cards.className = 'cards cards-' + state.view;
  if (list.length) {
    cards.innerHTML = list.map((r) => recipeCard(r)).join('');
  } else if (meta.total === 0 && state.scope !== 'mine') {
    cards.innerHTML = `<div class="empty"><div class="empty-ic">👥</div><h2>Noch keine Rezepte in der Gruppe</h2>
      <p>Hier erscheinen die Rezepte aller Mitglieder, sobald jemand eins anlegt.</p></div>`;
  } else if (meta.total === 0) {
    cards.innerHTML = `<div class="empty"><div class="empty-ic">📖</div><h2>Noch keine Rezepte</h2>
      <p>Leg dein erstes Rezept an, mit Foto, Zutaten und Schritten.</p><a class="btn btn-primary" href="#/neu">+ Erstes Rezept anlegen</a></div>`;
  } else {
    cards.innerHTML = '<div class="empty"><div class="empty-ic">🔍</div><h2>Nichts gefunden</h2><p>Probier andere Filter oder Suchbegriffe.</p></div>';
  }
}

// ================= Detailansicht =================
async function renderDetail(id, { shared = false } = {}) {
  const r = shared
    ? await api('/api/public/' + encodeURIComponent(shareToken))
    : await api('/api/recipes/' + encodeURIComponent(id));
  window.scrollTo(0, 0);
  if (shared) document.title = r.title + ' · Kochbuch';

  // Trefferliste zum Blättern sicherstellen (nicht bei geteilten Rezepten)
  if (!shared && !state.ids.length) {
    try { state.ids = (await api('/api/recipes?' + filterParams())).map((x) => x.id); } catch {}
  }
  const idx = shared ? -1 : state.ids.indexOf(r.id);
  const prevId = idx > 0 ? state.ids[idx - 1] : null;
  const nextId = idx >= 0 && idx < state.ids.length - 1 ? state.ids[idx + 1] : null;

  const ingredients = parseIngredients(r.ingredients);
  const steps = parseSteps(r.instructions);
  const photoSrcs = r.photos.map((p) => photoUrl(p.filename));
  let portions = r.servings || null;

  const info = [
    r.gang && [ICON.plate, 'Gang', r.gang],
    r.zeit && [ICON.clock, 'Zeit', r.zeit],
    r.aufwand && [ICON.chef, 'Aufwand', r.aufwand],
    r.preis && [ICON.euro, 'Preis', r.preis],
    r.kueche && [ICON.globe, 'Küche', r.kueche],
    r.kcal && [ICON.fire, 'Energie', `${r.kcal} kcal`],
  ].filter(Boolean);

  app.innerHTML = `
  <article class="detail">
    <div class="detail-nav">
      ${shared ? '<span class="shared-note">Geteiltes Rezept</span>' : `<a href="#/" class="back">${ICON.left} Alle Rezepte</a>`}
      ${r.hidden ? '<span class="shared-note">Für dich ausgeblendet</span>' : ''}
      ${idx >= 0 ? `<span class="pos">${idx + 1} / ${state.ids.length}</span>` : ''}
    </div>

    <div class="flip">
      ${prevId ? `<a class="flip-btn flip-prev" href="#/r/${prevId}" title="Vorheriges Rezept (←)">${ICON.left}</a>` : ''}
      ${recipeCard(r, { link: false, big: true })}
      ${nextId ? `<a class="flip-btn flip-next" href="#/r/${nextId}" title="Nächstes Rezept (→)">${ICON.right}</a>` : ''}
    </div>
    ${photoSrcs.length > 1 ? `<div class="gallery" aria-label="Fotos">${photoSrcs.map((src, i) => `<button class="gallery-thumb" data-src="${src}" title="Foto ${i + 1}"><img loading="lazy" src="${src}" alt="Foto ${i + 1}"></button>`).join('')}</div>` : ''}

    <div class="detail-bar">
      <div class="tags">${r.tags.map((t) => shared
        ? `<span class="chip chip-sm">#${esc(t)}</span>`
        : `<button class="chip chip-sm" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>
      ${shared ? `<div class="actions">
        <button class="btn btn-primary" id="import">+ Zu meinem Kochbuch hinzufügen</button>
      </div>` : r.own === false ? `<div class="actions">
        ${state.random ? `<button class="btn btn-outline" id="reroll">${ICON.dice} Nochmal würfeln</button>` : ''}
        ${r.myVersion
          ? `<a class="btn btn-outline" href="#/r/${r.myVersion}">Meine Version öffnen</a>`
          : '<button class="btn btn-primary" id="copy">+ In mein Kochbuch kopieren</button>'}
        ${r.viaEvent ? '' : r.hidden
          ? '<button class="btn btn-outline" id="unhide">Wieder einblenden</button>'
          : '<button class="btn btn-ghost-danger" id="hide" title="Für dich ausblenden, die Gruppe behält das Rezept">Ausblenden</button>'}
      </div>` : `<div class="actions">
        ${state.random ? `<button class="btn btn-outline" id="reroll">${ICON.dice} Nochmal würfeln</button>` : ''}
        <button class="btn btn-outline" id="share">${ICON.share} Teilen</button>
        <a class="btn btn-outline" href="#/edit/${r.id}">Bearbeiten</a>
        <button class="btn btn-ghost-danger" id="del">Löschen</button>
      </div>`}
    </div>
    <div id="share-box" class="share-box panel" hidden></div>

    ${info.length ? `<div class="infobar">${info.map(([ic, l, v]) => `<div class="info"><span class="info-ic">${ic}</span><div><small>${l}</small><strong>${esc(v)}</strong></div></div>`).join('')}</div>` : ''}
    ${r.description ? `<p class="desc">${esc(r.description).replace(/\n/g, '<br>')}</p>` : ''}
    ${/^https?:\/\//i.test(r.video || '') ? `<p class="video-row"><a class="btn btn-outline" href="${esc(r.video)}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24" class="ic"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/></svg> Video ansehen
      <small class="muted">${esc(r.video.replace(/^https?:\/\/(www\.|m\.)?/i, '').split('/')[0])}</small></a></p>` : ''}

    <div class="sheet">
      <aside class="sheet-side">
        <div class="ing-head">
          <h2>Zutaten</h2>
          ${portions ? `<div class="stepper" aria-label="Portionen">
            <button id="p-minus" aria-label="Weniger">−</button>
            <span>${ICON.people}<b id="p-val">${portions}</b></span>
            <button id="p-plus" aria-label="Mehr">+</button></div>` : ''}
        </div>
        <table class="ing-table" id="ing-table"></table>
        ${r.pantry ? `<h3 class="side-h">Gut im Haus zu haben</h3><p class="side-p">${esc(r.pantry).replace(/\n/g, '<br>')}</p>` : ''}
        ${r.equipment ? `<h3 class="side-h">Was zum Kochen gebraucht wird</h3><p class="side-p">${esc(r.equipment).replace(/\n/g, '<br>')}</p>` : ''}
        ${r.kcal ? `<h3 class="side-h">Nährwerte pro Portion</h3><p class="side-p">Energie: ${r.kcal} kcal / ${Math.round(r.kcal * 4.184)} kJ</p>` : ''}
        ${r.source ? `<h3 class="side-h">Quelle</h3><p class="side-p">${/^https?:\/\//i.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">${esc(r.source.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50))}</a>` : esc(r.source)}</p>` : ''}
      </aside>

      <section class="sheet-steps">
        ${steps.length ? `<ol class="steps">${steps.map((s, i) => `
          <li class="step no-photo">
            <div class="step-text"><span class="step-num">${i + 1}</span>${highlightStep(s, ingredients).replace(/\n/g, '<br>')}</div>
          </li>`).join('')}</ol>` : '<p class="muted">Noch keine Zubereitungsschritte eingetragen.</p>'}
        <p class="enjoy">Guten Appetit!</p>
      </section>
    </div>

    <div class="pager">
      ${prevId ? `<a class="btn btn-outline" href="#/r/${prevId}">${ICON.left} Vorheriges</a>` : '<span></span>'}
      ${nextId ? `<a class="btn btn-outline" href="#/r/${nextId}">Nächstes ${ICON.right}</a>` : '<span></span>'}
    </div>
  </article>`;

  const renderIngs = () => {
    const factor = r.servings && portions ? portions / r.servings : 1;
    $('#ing-table').innerHTML = ingredients.length
      ? ingredients.map((i) => i.heading
        ? `<tr class="ing-sec"><th colspan="2">${esc(i.heading)}</th></tr>`
        : `<tr><td class="ing-n">${esc(i.name)}</td><td class="ing-q">${esc(qtyText(i, factor))}</td></tr>`).join('')
      : '<tr><td class="muted">Keine Zutaten eingetragen.</td></tr>';
    if ($('#p-val')) $('#p-val').textContent = portions;
  };
  renderIngs();
  $('#p-minus')?.addEventListener('click', () => { if (portions > 1) { portions--; renderIngs(); } });
  $('#p-plus')?.addEventListener('click', () => { if (portions < 50) { portions++; renderIngs(); } });

  // Fotos vergrößern
  $('.rcard-big .rcard-photo img')?.addEventListener('click', () => openLightbox(photoSrcs[0], photoSrcs));
  $$('.gallery-thumb').forEach((b) => b.addEventListener('click', () => openLightbox(b.dataset.src, photoSrcs)));

  // Tag anklicken → als Filter in der Übersicht
  $$('[data-tag]').forEach((b) => b.addEventListener('click', () => {
    Object.values(state.f).forEach((s) => s.clear());
    state.q = '';
    state.f.tags.add(b.dataset.tag);
    state.listScroll = 0;
    location.hash = '#/';
  }));

  $('#reroll')?.addEventListener('click', () => goRandom(state.randomFiltered));
  $('#hide')?.addEventListener('click', async () => {
    if (!confirm(`„${r.title}“ für dich ausblenden? Es verschwindet aus der Gruppenansicht, aus „Zufall“ und aus der Kalenderauswahl. ${r.author} und die anderen behalten es. Wieder einblenden kannst du es im Benutzermenü unter „Ausgeblendete Rezepte“.`)) return;
    try {
      await api(`/api/recipes/${r.id}/hide`, { method: 'POST' });
      meta = null;
      state.ids = state.ids.filter((x) => x !== r.id);
      toast('Ausgeblendet');
      location.hash = '#/';
    } catch (err) { toast(err.message, true); }
  });
  $('#unhide')?.addEventListener('click', async () => {
    try {
      await api(`/api/recipes/${r.id}/hide`, { method: 'DELETE' });
      meta = null;
      state.ids = [];
      toast('Wieder eingeblendet');
      route();
    } catch (err) { toast(err.message, true); }
  });
  $('#copy')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const res = await api(`/api/recipes/${r.id}/copy`, { method: 'POST' });
      meta = null;
      state.ids = [];
      toast(res.existing ? 'Du hast schon eine Version davon' : 'In dein Kochbuch kopiert ✓');
      location.hash = '#/r/' + res.id;
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  });
  $('#share')?.addEventListener('click', () => openShareBox(r));
  $('#import')?.addEventListener('click', () => {
    if (auth?.user) return importShared(shareToken);
    // Erst einloggen/registrieren, danach wird das Rezept automatisch übernommen
    ssSet('import', shareToken);
    location.hash = '#/';
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`„${r.title}“ wirklich löschen?`)) return;
    try {
      await api('/api/recipes/' + r.id, { method: 'DELETE' });
      meta = null;
      state.ids = state.ids.filter((x) => x !== r.id);
      toast('Rezept gelöscht');
      location.hash = '#/';
    } catch (e) { toast(e.message, true); }
  });

  // Blättern per Pfeiltasten und Wischen
  const go = (target) => { if (target) { state.random = false; location.hash = `#/r/${target}`; } };
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select') || !$('#lightbox').hidden) return;
    if (e.key === 'ArrowLeft') go(prevId);
    if (e.key === 'ArrowRight') go(nextId);
  };
  let touchX = null, touchY = null;
  const card = $('.rcard-big');
  const onStart = (e) => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; };
  const onEnd = (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx > 0 ? prevId : nextId);
    touchX = null;
  };
  document.addEventListener('keydown', onKey);
  card.addEventListener('touchstart', onStart, { passive: true });
  card.addEventListener('touchend', onEnd);
  cleanup = () => document.removeEventListener('keydown', onKey);
}

// ================= Auswahlfenster (unten auf dem Handy, mittig am Desktop) =================
function openSheet(html) {
  const sheet = $('#sheet');
  $('.sheet-panel', sheet).innerHTML = `<button class="sheet-x" aria-label="Schließen">×</button>${html}`;
  sheet.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#toast').hidden = true; // alte Meldung nicht über den Buttons stehen lassen
  return $('.sheet-panel', sheet);
}
function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  document.body.style.overflow = '';
}
$('#sheet').addEventListener('click', (e) => {
  if (e.target.id === 'sheet' || e.target.closest('.sheet-x')) closeSheet();
});

// ================= Kalender =================
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
let shopSel = null; // Zeitraumauswahl für die Einkaufsliste: null oder { start: 'YYYY-MM-DD' | null }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayLabel = (day) => new Date(day + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

async function renderCalendar(monthStr) {
  const today = new Date();
  const [y, m] = /^\d{4}-\d{2}$/.test(monthStr || '')
    ? monthStr.split('-').map(Number)
    : [today.getFullYear(), today.getMonth() + 1];
  const first = new Date(y, m - 1, 1);
  const last = new Date(y, m, 0);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));            // Montag davor
  const end = new Date(y, m - 1, last.getDate() + (6 - ((last.getDay() + 6) % 7))); // Sonntag danach
  const [plan, events] = await Promise.all([
    api(`/api/plan?from=${ymd(start)}&to=${ymd(end)}`),
    api(`/api/events?from=${ymd(start)}&to=${ymd(end)}`),
  ]);
  const evByDay = {};
  for (const ev of events) (evByDay[ev.day] ||= []).push(ev);
  const byDay = {}; // Tag → Liste der Gerichte (Vorspeise, Hauptgang, Nachtisch …)
  for (const e of plan) (byDay[e.day] ||= []).push(e);
  const month = (yy, mm) => ymd(new Date(yy, mm - 1, 1)).slice(0, 7);
  const todayStr = ymd(today);

  let cells = '';
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = ymd(d);
    const list = byDay[day] || [];
    const e = list.find((x) => x.photo) || list[0]; // Bild: erstes Gericht mit Foto
    const titles = list.map((x) => x.title).join(' · ');
    const cls = ['cal-day', d.getMonth() !== m - 1 && 'out', day === todayStr && 'today', e && 'has'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-day="${day}" aria-label="${esc(dayLabel(day))}${e ? ': ' + esc(titles) : ''}">
      ${e ? (e.photo ? `<img src="${photoUrl(e.photo)}" alt="" loading="lazy">` : `<span class="cal-dot" style="--dc:${recipeColor(e.id)}"></span>`) : ''}
      <span class="cal-num">${d.getDate()}</span>
      ${list.length > 1 ? `<span class="cal-more">${list.length}</span>` : ''}
      ${evByDay[day] ? `<span class="cal-ev" title="${esc(evByDay[day].map((x) => x.title).join(', '))}">🎉<span>${esc(evByDay[day][0].title)}${evByDay[day].length > 1 ? ` +${evByDay[day].length - 1}` : ''}</span></span>` : ''}
      ${e ? `<span class="cal-title">${esc(titles)}</span>` : ''}
    </button>`;
  }

  app.innerHTML = `
  <section class="cal">
    <div class="cal-head">
      <h1>Kalender</h1>
      <div class="cal-nav">
        <a class="btn btn-outline cal-arrow" href="#/kalender/${month(y, m - 1)}" aria-label="Voriger Monat">${ICON.left}</a>
        <span class="cal-month">${first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
        <a class="btn btn-outline cal-arrow" href="#/kalender/${month(y, m + 1)}" aria-label="Nächster Monat">${ICON.right}</a>
        <a class="link-btn cal-today" href="#/kalender">Heute</a>
      </div>
      <div class="cal-shop">
        <button class="btn btn-outline" id="shop-btn">${ICON.cart} Einkaufsliste</button>
        <a class="link-btn" href="#/einkaufslisten">Gespeicherte</a>
      </div>
    </div>
    <p class="muted cal-hint" id="cal-hint">Tag antippen, um ein Gericht zu planen.</p>
    <div class="cal-grid">
      ${WEEKDAYS.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
      ${cells}
    </div>
  </section>`;

  const refresh = () => renderCalendar(monthStr);
  const grid = $('.cal-grid');
  const hint = $('#cal-hint');
  const shopBtn = $('#shop-btn');

  // Einkaufsliste: Zeitraum mit zwei Klicks/Taps wählen (erster und letzter Tag).
  // Die Auswahl steht in shopSel und bleibt beim Monatswechsel erhalten.
  const markRange = (a, b) => $$('.cal-day', grid).forEach((c) => {
    const d = c.dataset.day;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    c.classList.toggle('in-range', !!a && d >= lo && d <= hi);
    c.classList.toggle('range-edge', !!a && (d === a || d === b));
  });
  const syncShopUi = () => {
    const on = !!shopSel;
    grid.classList.toggle('selecting', on);
    hint.classList.toggle('cal-hint-active', on);
    shopBtn.innerHTML = on ? 'Abbrechen' : `${ICON.cart} Einkaufsliste`;
    hint.innerHTML = !on ? 'Tag antippen, um ein Gericht zu planen.'
      : !shopSel.start ? '<b>Einkaufsliste:</b> ersten Tag des Zeitraums antippen.'
        : `<b>Ab ${esc(shortDay(shopSel.start))}:</b> jetzt den letzten Tag antippen, gern auch in einem anderen Monat. Nur dieser eine Tag: nochmal antippen.`;
    markRange(shopSel?.start, shopSel?.start);
  };
  syncShopUi();
  shopBtn.addEventListener('click', () => {
    shopSel = shopSel ? null : { start: null };
    syncShopUi();
  });
  grid.addEventListener('mouseover', (ev) => {
    const c = ev.target.closest('.cal-day');
    if (shopSel?.start && c) markRange(shopSel.start, c.dataset.day);
  });

  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.cal-day');
    if (!btn) return;
    const day = btn.dataset.day;
    if (!shopSel) return byDay[day] || evByDay[day] ? openDaySheet(day, refresh) : showRecipePicker(day, refresh);
    if (!shopSel.start) {
      shopSel.start = day;
      return syncShopUi();
    }
    const [from, to] = shopSel.start < day ? [shopSel.start, day] : [day, shopSel.start];
    if ((new Date(to) - new Date(from)) / 864e5 > 62) return toast('Bitte höchstens zwei Monate auswählen', true);
    shopSel = null;
    syncShopUi();
    openShoppingList(from, to);
  });
}

// ================= Einkaufsliste =================
// Gewichte und Volumen auf eine Einheit bringen, damit 500 g + 1 kg zusammengezählt werden
const UNIT_BASE = { mg: ['g', 0.001], g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000] };
const UNIT_ALIAS = { stk: 'Stück', stück: 'Stück', zehen: 'Zehe', dosen: 'Dose', prisen: 'Prise', scheiben: 'Scheibe', tassen: 'Tasse',
  zweige: 'Zweig', stangen: 'Stange', knollen: 'Knolle', gläser: 'Glas', blätter: 'Blatt', päckchen: 'Pck', packung: 'Pck', pck: 'Pck' };

function buildShoppingList(recipes) {
  const items = new Map();
  for (const r of recipes) {
    for (const ing of parseIngredients(r.ingredients)) {
      if (ing.heading || !ing.name) continue;
      const u = ing.unit.toLowerCase();
      const base = UNIT_BASE[u];
      const unit = base ? base[0] : (UNIT_ALIAS[u] || ing.unit);
      const name = ing.name.trim().replace(/\s+/g, ' ');
      const key = name.toLowerCase() + '|' + unit.toLowerCase();
      const it = items.get(key) || { name, unit, amount: 0, counted: false, open: false, from: new Set() };
      const a = ing.amountTo ?? ing.amount; // bei „2–3“ lieber die größere Menge kaufen
      if (a != null && isFinite(a)) { it.amount += a * (base ? base[1] : 1); it.counted = true; }
      else it.open = true;
      it.from.add(r.title);
      items.set(key, it);
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function shopQty(it) {
  if (!it.counted) return '';
  let { amount, unit } = it;
  if (unit === 'g' && amount >= 1000) { amount /= 1000; unit = 'kg'; }
  if (unit === 'ml' && amount >= 1000) { amount /= 1000; unit = 'l'; }
  return `${fmtAmount(amount)}${unit ? ' ' + unit : ''}${it.open ? ' +' : ''}`;
}

const shortDay = (d) => new Date(d + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const rangeLabel = (from, to) => (from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`);

// Positionen als Abhakliste. items: [{ q, n, done, note? }]
const shopListHtml = (items) => `<ul class="shop-list">${items.map((it, i) => `<li><label>
    <input type="checkbox" data-i="${i}"${it.done ? ' checked' : ''}>
    <span class="shop-q">${esc(it.q)}</span>
    <span class="shop-n">${esc(it.n)}${it.note ? `<small>${esc(it.note)}</small>` : ''}</span>
  </label></li>`).join('')}</ul>`;
const shopText = (title, items) => [title, ...items.filter((it) => !it.done)
  .map((it) => `- ${[it.q, it.n].filter(Boolean).join(' ')}`)].join('\n');

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Einkaufsliste kopiert ✓');
}
const shareText = (text) => navigator.share({ title: 'Einkaufsliste', text }).catch(() => {});

// Häkchen in einer Abhakliste auf items übertragen
function bindChecks(root, items, onChange) {
  $('.shop-list', root)?.addEventListener('change', (e) => {
    const box = e.target.closest('input[data-i]');
    if (!box) return;
    items[box.dataset.i].done = box.checked;
    onChange?.();
  });
}

async function openShoppingList(from, to) {
  const range = rangeLabel(from, to);
  const panel = openSheet('<h2 class="sheet-h">Einkaufsliste</h2><div class="loading">Lade…</div>');
  let recipes;
  try {
    const entries = await api(`/api/plan?from=${from}&to=${to}`);
    if (!entries.length) { closeSheet(); return toast(`Für ${range} ist nichts geplant`, true); }
    const ids = [...new Set(entries.map((e) => e.id))];
    const byId = Object.fromEntries((await Promise.all(ids.map((id) => api('/api/recipes/' + id)))).map((r) => [r.id, r]));
    recipes = entries.map((e) => byId[e.id]).filter(Boolean); // dasselbe Rezept an zwei Tagen zählt doppelt
  } catch (e) { closeSheet(); return toast(e.message, true); }
  const items = buildShoppingList(recipes).map((it) => ({
    q: shopQty(it), n: it.name, done: false, note: it.from.size > 1 ? `${it.from.size} Gerichte` : '',
  }));
  const dishes = recipes.map((r) => r.title);

  panel.innerHTML = `<button class="sheet-x" aria-label="Schließen">×</button>
    <h2 class="sheet-h">Einkaufsliste</h2>
    <p class="shop-range"><b>${esc(range)}</b> · ${dishes.length} ${dishes.length === 1 ? 'Gericht' : 'Gerichte'}</p>
    <p class="shop-dishes muted">${dishes.map(esc).join(' · ')}</p>
    ${items.length ? `<p class="hint">Hak ab, was du schon zu Hause hast. Abgehaktes wird beim Kopieren weggelassen.</p>
    ${shopListHtml(items)}
    <div class="sheet-actions shop-actions">
      <button class="btn btn-primary" id="shop-save">Speichern</button>
      <button class="btn btn-outline" id="shop-copy">Kopieren</button>
      ${navigator.share ? '<button class="btn btn-outline" id="shop-share">Teilen</button>' : ''}
    </div>` : '<p class="muted">Die geplanten Rezepte haben keine Zutaten eingetragen.</p>'}`;

  bindChecks(panel, items);
  const text = () => shopText(`Einkaufsliste ${range}`, items);
  $('#shop-copy', panel)?.addEventListener('click', () => copyText(text()));
  $('#shop-share', panel)?.addEventListener('click', () => shareText(text()));
  $('#shop-save', panel)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const saved = await api('/api/shopping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, dishes, items: items.map(({ q, n, done }) => ({ q, n, done })) }),
      });
      btn.outerHTML = `<a class="btn btn-primary" href="#/einkaufslisten/${saved.id}">Gespeichert ✓ Öffnen</a>`;
      toast('Unter Benutzer → Einkaufslisten gespeichert');
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

// ================= Gespeicherte Einkaufslisten =================
const fmtCreated = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

async function renderShopping(id) {
  if (id) return renderShoppingList(id);
  const lists = await api('/api/shopping');
  window.scrollTo(0, 0);
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/kalender" class="back">${ICON.left} Kalender</a>
      <h1>Einkaufslisten</h1>
      <p class="muted">Neue Liste: im Kalender auf „Einkaufsliste“ tippen, ersten und letzten Tag wählen und dann „Speichern“.</p>
    </div>
    <fieldset class="panel">
      <legend>Gespeichert</legend>
      ${lists.length ? `<ul class="user-list">${lists.map((l) => {
        const done = l.items.filter((it) => it.done).length;
        return `<li class="user-row">
          <div class="user-info"><a href="#/einkaufslisten/${l.id}"><strong>${esc(rangeLabel(l.from, l.to))}</strong></a>
            <small class="muted">${done} von ${l.items.length} erledigt · ${esc(l.dishes.join(', '))}</small>
            <small class="muted">erstellt ${esc(fmtCreated(l.created_at))}</small></div>
          <div class="user-actions">
            <a class="btn btn-outline" href="#/einkaufslisten/${l.id}">Öffnen</a>
            <button type="button" class="btn btn-ghost-danger" data-del="${l.id}">Löschen</button>
          </div>
        </li>`;
      }).join('')}</ul>` : '<p class="muted user-empty">Noch keine Einkaufslisten gespeichert.</p>'}
    </fieldset>
  </div>`;
  app.querySelector('.form').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-del]');
    if (!btn || !confirm('Diese Einkaufsliste löschen?')) return;
    try {
      await api('/api/shopping/' + btn.dataset.del, { method: 'DELETE' });
      toast('Gelöscht');
      await renderShopping();
    } catch (err) { toast(err.message, true); }
  });
}

async function renderShoppingList(id) {
  const l = await api('/api/shopping/' + encodeURIComponent(id));
  const range = rangeLabel(l.from, l.to);
  window.scrollTo(0, 0);
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/einkaufslisten" class="back">${ICON.left} Alle Einkaufslisten</a>
      <h1>Einkaufsliste</h1>
      <p class="shop-range"><b>${esc(range)}</b> · erstellt ${esc(fmtCreated(l.created_at))}</p>
      <p class="shop-dishes muted">${l.dishes.map(esc).join(' · ')}</p>
    </div>
    <div class="panel shop-panel">
      <p class="hint" id="shop-count"></p>
      ${shopListHtml(l.items)}
      <div class="sheet-actions shop-actions">
        <button class="btn btn-primary" id="shop-copy">Kopieren</button>
        ${navigator.share ? '<button class="btn btn-outline" id="shop-share">Teilen</button>' : ''}
        <button class="btn btn-outline" id="shop-reset">Häkchen zurücksetzen</button>
        <button class="btn btn-ghost-danger" id="shop-del">Löschen</button>
      </div>
    </div>
  </div>`;
  const count = () => {
    const done = l.items.filter((it) => it.done).length;
    $('#shop-count').textContent = done === l.items.length ? 'Alles erledigt 🎉'
      : `${done} von ${l.items.length} erledigt. Häkchen werden gespeichert, Kopieren lässt Erledigtes weg.`;
  };
  count();
  const save = () => api('/api/shopping/' + l.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: l.items }),
  }).catch((err) => toast(err.message, true));
  bindChecks(app, l.items, () => { count(); save(); });
  const text = () => shopText(`Einkaufsliste ${range}`, l.items);
  $('#shop-copy').addEventListener('click', () => copyText(text()));
  $('#shop-share')?.addEventListener('click', () => shareText(text()));
  $('#shop-reset').addEventListener('click', () => {
    l.items.forEach((it) => { it.done = false; });
    $$('.shop-list input').forEach((b) => { b.checked = false; });
    count();
    save();
  });
  $('#shop-del').addEventListener('click', async () => {
    if (!confirm('Diese Einkaufsliste löschen?')) return;
    try {
      await api('/api/shopping/' + l.id, { method: 'DELETE' });
      toast('Gelöscht');
      location.hash = '#/einkaufslisten';
    } catch (err) { toast(err.message, true); }
  });
}

const MAX_PER_DAY = 6;

// Alle Gerichte eines Tages: öffnen, austauschen, entfernen, weiteres hinzufügen
async function openDaySheet(day, refresh) {
  let entries, events;
  try {
    [entries, events] = await Promise.all([api(`/api/plan?from=${day}&to=${day}`), api(`/api/events?from=${day}&to=${day}`)]);
  } catch (e) { return toast(e.message, true); }
  if (!entries.length && !events.length) return showRecipePicker(day, refresh);
  const panel = openSheet(`
    <h2 class="sheet-h">${esc(dayLabel(day))}</h2>
    ${events.length ? `<div class="plan-list plan-events">${events.map((ev) => `
      <a class="plan-recipe" href="#/events/${ev.id}">
        <span class="plan-thumb ev-thumb">🎉</span>
        <span class="plan-info"><b>${esc(ev.title)}</b><small>${ev.time ? esc(ev.time) + ' Uhr · ' : ''}Event öffnen ›</small></span>
      </a>`).join('')}</div>` : ''}
    <div class="plan-list">${entries.map((e) => `
      <div class="plan-entry">
        <a class="plan-recipe" href="#/r/${e.id}">
          <span class="plan-thumb">${e.photo ? `<img src="${photoUrl(e.photo)}" alt="">` : `<span class="cal-dot" style="--dc:${recipeColor(e.id)}"></span>`}</span>
          <span class="plan-info"><b>${esc(e.title)}</b><small>Rezept öffnen ›</small></span>
        </a>
        <div class="plan-entry-actions">
          <button class="link-btn" data-change="${e.entry}">Tauschen</button>
          <button class="link-btn danger" data-remove="${e.entry}">Entfernen</button>
        </div>
      </div>`).join('')}</div>
    ${entries.length < MAX_PER_DAY
      ? `<button class="btn btn-outline plan-add" id="plan-add">+ ${entries.length ? 'Weiteres Rezept hinzufügen' : 'Rezept einplanen'}</button>
         ${entries.length ? '<p class="hint plan-add-hint">z. B. Vorspeise oder Nachtisch</p>' : ''}`
      : ''}
    <a class="btn btn-outline plan-add" href="#/events/neu/${day}">🎉 Event an diesem Tag anlegen</a>`);
  $('#plan-add', panel)?.addEventListener('click', () => showRecipePicker(day, refresh));
  $('.plan-list', panel).addEventListener('click', async (ev) => {
    const change = ev.target.closest('[data-change]');
    if (change) return showRecipePicker(day, refresh, Number(change.dataset.change));
    const remove = ev.target.closest('[data-remove]');
    if (!remove) return;
    try {
      await api('/api/plan/' + remove.dataset.remove, { method: 'DELETE' });
      toast('Entfernt');
      await refresh();
      if (entries.length > 1 || events.length) openDaySheet(day, refresh); else closeSheet();
    } catch (e) { toast(e.message, true); }
  });
}

// entryId gesetzt: dieses Gericht austauschen, sonst ein Gericht zum Tag hinzufügen
async function showRecipePicker(day, refresh, entryId = null) {
  const panel = openSheet(`
    <h2 class="sheet-h">${esc(dayLabel(day))}</h2>
    ${entryId ? '' : `<a class="pick-event" href="#/events/neu/${day}">🎉 Oder ein Event an diesem Tag anlegen ›</a>`}
    <input type="search" class="pick-search" placeholder="Rezept suchen…" autocomplete="off">
    <div class="pick-list"><div class="loading">Lade…</div></div>`);
  let list = [];
  try { list = await api('/api/recipes?sort=titel&scope=all'); } catch (e) { toast(e.message, true); return; }
  const box = $('.pick-list', panel);
  const draw = (q) => {
    const hits = list.filter((r) => !q || (r.title + ' ' + (r.subtitle || '')).toLowerCase().includes(q.toLowerCase()));
    box.innerHTML = !list.length
      ? '<p class="muted">Noch keine Rezepte. <a href="#/neu">Erstes Rezept anlegen</a></p>'
      : hits.length
        ? hits.map((r) => `<button class="pick-item" data-id="${r.id}">
            <span class="plan-thumb">${r.photo ? `<img src="${photoUrl(r.photo)}" alt="" loading="lazy">` : `<span class="cal-dot" style="--dc:${recipeColor(r.id)}"></span>`}</span>
            <span class="plan-info"><b>${esc(r.title)}</b>${(() => {
              const sub = [r.gang, r.zeit, r.own === false && r.author ? 'von ' + r.author : ''].filter(Boolean).join(' · ');
              return sub ? `<small>${esc(sub)}</small>` : '';
            })()}</span>
          </button>`).join('')
        : '<p class="muted">Kein Rezept gefunden.</p>';
  };
  draw('');
  const search = $('.pick-search', panel);
  search.addEventListener('input', () => draw(search.value.trim()));
  if (window.matchMedia('(min-width: 641px)').matches) search.focus();
  box.addEventListener('click', async (e) => {
    const item = e.target.closest('.pick-item');
    if (!item) return;
    try {
      const recipe_id = Number(item.dataset.id);
      const saved = await api(entryId ? '/api/plan/' + entryId : '/api/plan', {
        method: entryId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entryId ? { recipe_id } : { day, recipe_id }),
      });
      toast(`${saved.title} eingeplant ✓`);
      await refresh();
      openDaySheet(day, refresh); // Tagesübersicht zeigen, damit direkt ein weiteres Gericht dazukommen kann
    } catch (err) { toast(err.message, true); }
  });
}

// ================= Eventplaner =================
const COURSES = ['Vorspeise', 'Hauptspeise', 'Dessert', 'Sonstiges'];
const evDay = (d, opts) => new Date(d + 'T12:00:00').toLocaleDateString('de-DE', opts);
const evWhen = (e) => `${evDay(e.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}${e.time ? `, ${e.time} Uhr` : ''}`;
const planThumb = (r) => `<span class="plan-thumb">${r.photo
  ? `<img src="${photoUrl(r.photo)}" alt="" loading="lazy">`
  : `<span class="cal-dot" style="--dc:${recipeColor(r.id)}"></span>`}</span>`;

// Einladen: ganze Gruppen (Häkchen) und einzelne Personen (Benutzernamen)
const inviteFields = () => `
  ${meta.groups.length ? `<div class="ev-field"><span class="ev-label">Ganze Gruppe</span><div class="ev-groups">
    ${meta.groups.map((g) => `<label class="ev-check"><input type="checkbox" name="groups" value="${g.id}"> 👥 ${esc(g.name)}</label>`).join('')}
  </div></div>` : ''}
  <div class="field"><label>Einzelne Personen <small>Benutzernamen, mit Komma getrennt</small></label>
    <input name="usernames" placeholder="z. B. anna, tom" autocomplete="off" autocapitalize="none"></div>`;
const readInvites = (form) => ({
  groups: $$('input[name="groups"]:checked', form).map((c) => Number(c.value)),
  usernames: toNames(form.elements.usernames.value),
});
const toNames = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

async function renderEvents(id, sub) {
  if (id === 'neu') return renderEventForm(null, sub);
  if (id && sub === 'bearbeiten') return renderEventForm(id);
  if (id) return renderEvent(id);
  const events = await api('/api/events');
  const today = ymd(new Date());
  const upcoming = events.filter((e) => e.day >= today);
  const past = events.filter((e) => e.day < today).reverse();
  const card = (e) => `<a class="ev-card" href="#/events/${e.id}">
      <span class="ev-date"><b>${Number(e.day.slice(8))}</b><small>${esc(evDay(e.day, { month: 'short' }))}</small></span>
      <span class="ev-info">
        <strong>${esc(e.title)}</strong>
        <small>${esc([evDay(e.day, { weekday: 'long' }) + (e.time ? `, ${e.time} Uhr` : ''), e.location].filter(Boolean).join(' · '))}</small>
        <small class="muted">${e.isOwner ? 'von dir' : 'von ' + esc(e.owner)} · ${e.members} Teilnehmer · ${e.recipes} Rezepte${e.comments ? ` · 💬 ${e.comments}` : ''}</small>
      </span>
    </a>`;
  window.scrollTo(0, 0);
  app.innerHTML = `
  <div class="form events">
    <div class="form-head ev-head">
      <div>
        <h1>Eventplaner</h1>
        <p class="muted">Gemeinsam kochen, Geburtstage, Grillabende: Leute einladen, Rezepte sammeln und absprechen.</p>
      </div>
      <a class="btn btn-primary" href="#/events/neu">+ Neues Event</a>
    </div>
    <h2 class="ev-section">Bevorstehend</h2>
    ${upcoming.length ? `<div class="ev-list">${upcoming.map(card).join('')}</div>`
      : '<p class="muted">Keine bevorstehenden Events. Leg eins an oder tipp im Kalender auf einen Tag.</p>'}
    ${past.length ? `<h2 class="ev-section">Vergangen</h2><div class="ev-list ev-past">${past.map(card).join('')}</div>` : ''}
  </div>`;
}

async function renderEventForm(id, presetDay) {
  const e = id ? await api('/api/events/' + encodeURIComponent(id))
    : { title: '', day: /^\d{4}-\d{2}-\d{2}$/.test(presetDay || '') ? presetDay : ymd(new Date()), time: '', location: '', description: '' };
  if (id && !e.isOwner) throw new Error('Nur der Ersteller kann das Event bearbeiten');
  window.scrollTo(0, 0);
  app.innerHTML = `
  <form class="form" id="ev-form" novalidate>
    <div class="form-head">
      <a href="${id ? '#/events/' + e.id : '#/events'}" class="back">${ICON.left} Zurück</a>
      <h1>${id ? 'Event bearbeiten' : 'Neues Event'}</h1>
    </div>
    <fieldset class="panel">
      <legend>Event</legend>
      <div class="field"><label for="ev-title">Titel</label>
        <input id="ev-title" name="title" maxlength="100" value="${esc(e.title)}" placeholder="z. B. Pasta-Abend"></div>
      <div class="row2">
        <div class="field"><label for="ev-day">Datum</label><input id="ev-day" name="day" type="date" value="${esc(e.day)}"></div>
        <div class="field"><label for="ev-time">Uhrzeit <small>optional</small></label><input id="ev-time" name="time" type="time" value="${esc(e.time)}"></div>
      </div>
      <div class="field"><label for="ev-loc">Ort <small>optional</small></label>
        <input id="ev-loc" name="location" maxlength="200" value="${esc(e.location)}" placeholder="z. B. bei uns"></div>
      <div class="field"><label for="ev-desc">Beschreibung <small>optional</small></label>
        <textarea id="ev-desc" name="description" rows="3" maxlength="4000" placeholder="Was ist geplant?">${esc(e.description)}</textarea></div>
    </fieldset>
    ${id ? '' : `<fieldset class="panel"><legend>Einladen</legend>
      <p class="hint">Eingeladene sind direkt dabei und können jederzeit wieder austreten. Später hinzufügen geht auch.</p>
      ${inviteFields()}
    </fieldset>`}
    <div class="form-actions">
      <a class="btn btn-outline" href="${id ? '#/events/' + e.id : '#/events'}">Abbrechen</a>
      <button class="btn btn-primary" type="submit">${id ? 'Speichern' : 'Event anlegen'}</button>
    </div>
  </form>`;
  const form = $('#ev-form');
  if (!id) form.elements.title.focus();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('button[type="submit"]', form);
    const body = {
      title: form.elements.title.value, day: form.elements.day.value, time: form.elements.time.value,
      location: form.elements.location.value, description: form.elements.description.value,
      ...(id ? {} : readInvites(form)),
    };
    btn.disabled = true;
    try {
      const res = await api(id ? '/api/events/' + e.id : '/api/events', {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      toast(id ? 'Gespeichert' : 'Event angelegt 🎉');
      location.hash = '#/events/' + (id ? e.id : res.id);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

async function renderEvent(id, keepScroll = false) {
  const e = await api('/api/events/' + encodeURIComponent(id));
  const rerender = () => renderEvent(e.id, true);
  const sections = COURSES.map((c) => [c, e.recipes.filter((r) => r.course === c)])
    .filter(([c, list]) => list.length || c !== 'Sonstiges');
  const send = (url, method, body) => api(url, {
    method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const base = '/api/events/' + e.id;
  const y = window.scrollY;

  app.innerHTML = `
  <div class="form event">
    <div class="form-head">
      <a href="#/events" class="back">${ICON.left} Alle Events</a>
      <h1>${esc(e.title)}</h1>
      <p class="ev-meta">📅 ${esc(evWhen(e))}${e.location ? `<br>📍 ${esc(e.location)}` : ''}</p>
      <p class="muted ev-by">${e.isOwner ? 'Von dir erstellt' : 'Erstellt von ' + esc(e.owner)}</p>
      ${e.description ? `<p class="ev-desc">${esc(e.description).replace(/\n/g, '<br>')}</p>` : ''}
      <div class="ev-actions">
        <a class="btn btn-outline" href="#/kalender/${e.day.slice(0, 7)}">Im Kalender</a>
        ${e.isOwner
          ? `<a class="btn btn-outline" href="#/events/${e.id}/bearbeiten">Bearbeiten</a>
             <button class="btn btn-ghost-danger" data-act="delete">Event löschen</button>`
          : '<button class="btn btn-ghost-danger" data-act="leave">Event verlassen</button>'}
      </div>
    </div>

    <fieldset class="panel">
      <legend>Rezepte (${e.recipes.length})</legend>
      ${sections.map(([c, list]) => `<section class="ev-course">
        <h3>${c}</h3>
        ${list.length ? list.map((r) => `<div class="ev-recipe">
          <a class="plan-recipe" href="#/r/${r.id}">
            ${planThumb(r)}
            <span class="plan-info"><b>${esc(r.title)}</b>
              <small>von ${esc(r.author)}${r.added_by_name && r.added_by_name !== r.author ? ` · beigefügt von ${esc(r.added_by_name)}` : ''}</small></span>
          </a>
          ${r.canRemove ? `<div class="ev-recipe-actions">
            <select data-course="${r.entry}" aria-label="Gang">${COURSES.map((x) => `<option${x === r.course ? ' selected' : ''}>${x}</option>`).join('')}</select>
            <button class="link-btn danger" data-unlink="${r.entry}">Entfernen</button>
          </div>` : ''}
        </div>`).join('') : '<p class="muted ev-empty">Noch nichts eingetragen.</p>'}
      </section>`).join('')}
      <button class="btn btn-outline ev-add" data-act="add-recipe">+ Rezept beifügen</button>
    </fieldset>

    <fieldset class="panel">
      <legend>Teilnehmer (${e.members.length})</legend>
      <ul class="ev-members">${e.members.map((m) => `<li class="ev-member${m.isMe ? ' me' : ''}">
        ${esc(m.username)}${m.isOwner ? ' <small>Ersteller</small>' : ''}${m.isMe && !m.isOwner ? ' <small>du</small>' : ''}
        ${e.isOwner && !m.isOwner ? `<button class="ev-x" data-kick="${m.id}" title="${esc(m.username)} entfernen" aria-label="Entfernen">×</button>` : ''}
      </li>`).join('')}</ul>
      ${e.isOwner ? `<details class="ev-invite-box"><summary>+ Personen oder Gruppe hinzufügen</summary>
        <form id="ev-invite">${inviteFields()}<button class="btn btn-outline" type="submit">Hinzufügen</button></form>
      </details>` : ''}
    </fieldset>

    <fieldset class="panel">
      <legend>Kommentare (${e.comments.length})</legend>
      ${e.comments.length ? `<ul class="ev-comments">${e.comments.map((c) => `<li class="ev-comment${c.own ? ' own' : ''}">
        <div class="ev-comment-head"><b>${esc(c.username)}</b><small class="muted">${esc(fmtCreated(c.created_at))}</small>
          ${c.canDelete ? `<button class="ev-x" data-uncomment="${c.id}" title="Kommentar löschen" aria-label="Löschen">×</button>` : ''}</div>
        <p>${esc(c.body).replace(/\n/g, '<br>')}</p>
      </li>`).join('')}</ul>` : '<p class="muted">Noch keine Kommentare. Wer bringt was mit?</p>'}
      <form id="ev-comment" class="ev-comment-form">
        <textarea name="body" rows="2" maxlength="2000" placeholder="Kommentar schreiben …"></textarea>
        <button class="btn btn-primary" type="submit">Senden</button>
      </form>
    </fieldset>
  </div>`;
  window.scrollTo(0, keepScroll ? y : 0);

  const root = $('.event');
  root.addEventListener('click', async (ev) => {
    const t = ev.target.closest('[data-act], [data-unlink], [data-kick], [data-uncomment]');
    if (!t) return;
    try {
      if (t.dataset.act === 'add-recipe') return pickEventRecipe(e, rerender);
      if (t.dataset.act === 'delete') {
        if (!confirm(`„${e.title}“ für alle löschen?`)) return;
        await send(base, 'DELETE');
        toast('Event gelöscht');
        return (location.hash = '#/events');
      }
      if (t.dataset.act === 'leave') {
        if (!confirm('Event verlassen? Du siehst es danach nicht mehr.')) return;
        const me = e.members.find((m) => m.isMe);
        await send(`${base}/members/${me.id}`, 'DELETE');
        toast('Du hast das Event verlassen');
        return (location.hash = '#/events');
      }
      if (t.dataset.unlink) {
        await send(`${base}/recipes/${t.dataset.unlink}`, 'DELETE');
        toast('Rezept entfernt');
      } else if (t.dataset.kick) {
        const m = e.members.find((x) => String(x.id) === t.dataset.kick);
        if (!confirm(`${m?.username || 'Teilnehmer'} aus dem Event entfernen?`)) return;
        await send(`${base}/members/${t.dataset.kick}`, 'DELETE');
        toast('Entfernt');
      } else if (t.dataset.uncomment) {
        if (!confirm('Kommentar löschen?')) return;
        await send(`${base}/comments/${t.dataset.uncomment}`, 'DELETE');
      }
      await rerender();
    } catch (err) { toast(err.message, true); }
  });
  root.addEventListener('change', async (ev) => {
    const sel = ev.target.closest('select[data-course]');
    if (!sel) return;
    try {
      await send(`${base}/recipes/${sel.dataset.course}`, 'PUT', { course: sel.value });
      await rerender();
    } catch (err) { toast(err.message, true); }
  });
  $('#ev-invite')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = readInvites(ev.target);
    if (!body.groups.length && !body.usernames.length) return toast('Bitte eine Gruppe ankreuzen oder Namen eingeben', true);
    try {
      const { added } = await send(`${base}/members`, 'POST', body);
      toast(added ? `${added} ${added === 1 ? 'Person' : 'Personen'} hinzugefügt` : 'Alle waren schon dabei');
      await rerender();
    } catch (err) { toast(err.message, true); }
  });
  $('#ev-comment').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const box = ev.target.elements.body;
    if (!box.value.trim()) return box.focus();
    const btn = $('button', ev.target);
    btn.disabled = true;
    try {
      await send(`${base}/comments`, 'POST', { body: box.value });
      await rerender();
      $('#ev-comment textarea')?.scrollIntoView({ block: 'center' });
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

// Rezept auswählen und einem Gang zuordnen
async function pickEventRecipe(e, rerender) {
  const panel = openSheet(`
    <h2 class="sheet-h">Rezept beifügen</h2>
    <div class="ev-course-pick" role="group" aria-label="Gang">
      <span class="muted">Gang:</span>
      ${['Automatisch', ...COURSES].map((c, i) => `<button class="chip chip-sm${i ? '' : ' on'}" data-c="${i ? c : ''}">${c}</button>`).join('')}
    </div>
    <input type="search" class="pick-search" placeholder="Rezept suchen…" autocomplete="off">
    <div class="pick-list"><div class="loading">Lade…</div></div>`);
  let course = '';
  $('.ev-course-pick', panel).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-c]');
    if (!b) return;
    course = b.dataset.c;
    $$('.ev-course-pick .chip', panel).forEach((x) => x.classList.toggle('on', x === b));
  });
  let list;
  try { list = await api('/api/recipes?sort=titel&scope=all'); } catch (err) { return toast(err.message, true); }
  const taken = new Set(e.recipes.map((r) => r.id));
  list = list.filter((r) => !taken.has(r.id));
  const box = $('.pick-list', panel);
  const draw = (q) => {
    const hits = list.filter((r) => !q || (r.title + ' ' + (r.subtitle || '')).toLowerCase().includes(q.toLowerCase()));
    box.innerHTML = hits.length ? hits.map((r) => `<button class="pick-item" data-id="${r.id}">
        ${planThumb(r)}
        <span class="plan-info"><b>${esc(r.title)}</b>${(() => {
          const sub = [r.gang, r.own === false && r.author ? 'von ' + r.author : ''].filter(Boolean).join(' · ');
          return sub ? `<small>${esc(sub)}</small>` : '';
        })()}</span>
      </button>`).join('') : '<p class="muted">Kein Rezept gefunden.</p>';
  };
  draw('');
  const search = $('.pick-search', panel);
  search.addEventListener('input', () => draw(search.value.trim()));
  box.addEventListener('click', async (ev) => {
    const item = ev.target.closest('.pick-item');
    if (!item) return;
    try {
      const res = await api(`/api/events/${e.id}/recipes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_id: Number(item.dataset.id), ...(course ? { course } : {}) }),
      });
      closeSheet();
      toast(`Als ${res.course} beigefügt ✓`);
      await rerender();
    } catch (err) { toast(err.message, true); }
  });
}

// ================= Teilen =================
const shareUrl = (token) => `${location.origin}${location.pathname}#/s/${token}`;

async function openShareBox(r) {
  const box = $('#share-box');
  if (!box.hidden) { box.hidden = true; return; }
  try {
    if (!r.share_token) r.share_token = (await api(`/api/recipes/${r.id}/share`, { method: 'POST' })).token;
  } catch (e) { toast(e.message, true); return; }
  const url = shareUrl(r.share_token);
  box.innerHTML = `
    <p class="share-h"><b>Link zum Teilen</b><br><span class="muted">Jeder mit diesem Link kann genau dieses Rezept ansehen, ohne Login und ohne es ändern zu können.</span></p>
    <div class="share-row">
      <input id="share-url" readonly value="${esc(url)}" aria-label="Link zum Rezept">
      <button class="btn btn-primary" id="share-copy">Kopieren</button>
    </div>
    <div class="share-row share-actions">
      ${navigator.share ? '<button class="btn btn-outline" id="share-native">Teilen über …</button>' : '<span></span>'}
      <button class="link-btn share-off" id="share-off">Link deaktivieren</button>
    </div>`;
  box.hidden = false;
  const input = $('#share-url');
  $('#share-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); }
    catch { input.select(); document.execCommand('copy'); }
    toast('Link kopiert ✓');
  });
  $('#share-native')?.addEventListener('click', () => navigator.share({ title: r.title, url }).catch(() => {}));
  $('#share-off').addEventListener('click', async () => {
    if (!confirm('Link deaktivieren? Wer den Link hat, kann das Rezept dann nicht mehr öffnen.')) return;
    try {
      await api(`/api/recipes/${r.id}/share`, { method: 'DELETE' });
      r.share_token = null;
      box.hidden = true;
      toast('Link deaktiviert');
    } catch (e) { toast(e.message, true); }
  });
  input.addEventListener('focus', () => input.select());
}

async function importShared(token) {
  try {
    const res = await api(`/api/public/${encodeURIComponent(token)}/import`, { method: 'POST' });
    meta = null;
    state.ids = [];
    toast(res.own ? 'Das ist schon dein eigenes Rezept' : 'Zu deinem Kochbuch hinzugefügt ✓');
    document.title = 'Kochbuch';
    location.hash = '#/r/' + res.id;
  } catch (e) {
    toast(e.message, true);
    if (!location.hash.startsWith('#/s/')) location.hash = '#/';
  }
}

// ================= Kategorien verwalten =================
function renderCategories() {
  window.scrollTo(0, 0);
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/" class="back">${ICON.left} Zurück</a>
      <h1>Kategorien verwalten</h1>
      <p class="muted">Deine eigenen Werte je Kategorie. Antippen zum Umbenennen, × zum Löschen. Änderungen gelten auch für deine Rezepte.</p>
    </div>
    ${Object.entries(CAT_LABELS).map(([k, label]) => `
    <fieldset class="panel cat-panel" data-cat="${k}">
      <legend>${label}</legend>
      <div class="chips">${(meta.options[k] || []).map((v) => `
        <span class="chip cat-chip"><button type="button" class="cat-rename" data-v="${esc(v)}">${esc(v)}</button><button type="button" class="cat-del" data-v="${esc(v)}" aria-label="${esc(v)} löschen">×</button></span>`).join('')}
        <button type="button" class="chip chip-add">+ Neu</button>
      </div>
    </fieldset>`).join('')}
  </div>`;

  app.querySelector('.form').addEventListener('click', async (e) => {
    const panel = e.target.closest('.cat-panel');
    if (!panel) return;
    const category = panel.dataset.cat;
    const json = (method, body, qs = '') => api('/api/options' + qs, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    try {
      if (e.target.closest('.chip-input')) return;
      if (e.target.closest('.chip-add')) {
        if (await addOption(category, e.target.closest('.chip-add'))) renderCategories();
      } else if (e.target.closest('.cat-rename')) {
        const from = e.target.closest('.cat-rename').dataset.v;
        const value = prompt(`„${from}“ umbenennen in:`, from)?.trim();
        if (!value || value === from) return;
        const res = await json('PUT', { category, from, value });
        await reloadMeta();
        toast(res.recipes ? `Umbenannt, ${res.recipes} Rezept(e) angepasst` : 'Umbenannt');
        renderCategories();
      } else if (e.target.closest('.cat-del')) {
        const value = e.target.closest('.cat-del').dataset.v;
        if (!confirm(`„${value}“ aus ${CAT_LABELS[category]} löschen? Bei Rezepten mit diesem Wert wird er entfernt.`)) return;
        const res = await json('DELETE', null, `?category=${encodeURIComponent(category)}&value=${encodeURIComponent(value)}`);
        await reloadMeta();
        toast(res.recipes ? `Gelöscht, bei ${res.recipes} Rezept(en) entfernt` : 'Gelöscht');
        renderCategories();
      }
    } catch (err) { toast(err.message, true); }
  });
}

// ================= Benutzerverwaltung (Admin) =================
async function renderUsers() {
  if (!auth.user.isAdmin) { location.hash = '#/'; return; }
  const users = await api('/api/admin/users');
  auth.pending = users.filter((u) => !u.approved).length;
  showUser();
  window.scrollTo(0, 0);
  const date = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const pending = users.filter((u) => !u.approved);
  const active = users.filter((u) => u.approved);
  const row = (u, actions) => `
    <li class="user-row" data-id="${u.id}" data-name="${esc(u.username)}">
      <div class="user-info"><strong>${esc(u.username)}</strong>${u.is_admin ? ' <span class="user-tag">Admin</span>' : ''}
        <small class="muted">${u.approved
          ? `${u.recipes} Rezept(e) · ${fmtMB(u.storage)}${u.quota ? ` von ${fmtMB(u.quota)}` : ''} · seit ${date(u.created_at)}`
          : `angefragt am ${date(u.created_at)}`}</small></div>
      <div class="user-actions">${actions}</div>
    </li>`;
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/" class="back">${ICON.left} Zurück</a>
      <h1>Benutzer</h1>
      <p class="muted">Neue Registrierungen müssen hier freigeschaltet werden, bevor sich jemand anmelden kann.</p>
    </div>
    <fieldset class="panel">
      <legend>Offene Anfragen</legend>
      ${pending.length ? `<ul class="user-list">${pending.map((u) => row(u, `
        <button type="button" class="btn btn-primary" data-act="approve">Freischalten</button>
        <button type="button" class="btn btn-ghost-danger" data-act="reject">Ablehnen</button>`)).join('')}</ul>`
        : '<p class="muted user-empty">Keine offenen Anfragen.</p>'}
    </fieldset>
    <fieldset class="panel">
      <legend>Konten</legend>
      <ul class="user-list">${active.map((u) => row(u, u.is_admin ? ''
        : '<button type="button" class="btn btn-ghost-danger" data-act="delete">Löschen</button>')).join('')}</ul>
    </fieldset>
  </div>`;

  app.querySelector('.form').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('.user-row');
    const { id, name } = li.dataset;
    const act = btn.dataset.act;
    if (act === 'reject' && !confirm(`Anfrage von „${name}“ ablehnen?`)) return;
    if (act === 'delete' && !confirm(`Konto „${name}“ mit allen Rezepten und Fotos endgültig löschen?`)) return;
    btn.disabled = true;
    try {
      if (act === 'approve') await api(`/api/admin/users/${id}/approve`, { method: 'POST' });
      else await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      toast(act === 'approve' ? `„${name}“ freigeschaltet` : act === 'reject' ? 'Anfrage abgelehnt' : 'Konto gelöscht');
      await renderUsers();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

// ================= Gruppen =================
async function renderGroups() {
  const { groups, invites } = await api('/api/groups');
  if (meta) { meta.invites = invites.length; showUser(); }
  window.scrollTo(0, 0);
  const me = auth.user.id;
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/" class="back">${ICON.left} Zurück</a>
      <h1>Gruppen</h1>
      <p class="muted">In einer Gruppe sieht jedes Mitglied die Rezepte der anderen (nur lesen, kopieren ins eigene Kochbuch geht).
        Umschalten kannst du oben in der Übersicht. Gruppenrezepte lassen sich auch im Kalender einplanen. Kategorien und Kalender bleiben privat.</p>
    </div>
    ${invites.length ? `<fieldset class="panel">
      <legend>Einladungen</legend>
      <ul class="user-list">${invites.map((i) => `
        <li class="user-row" data-gid="${i.id}" data-name="${esc(i.name)}">
          <div class="user-info"><strong>${esc(i.name)}</strong><small class="muted">eingeladen von ${esc(i.owner)}</small></div>
          <div class="user-actions">
            <button type="button" class="btn btn-primary" data-act="accept">Beitreten</button>
            <button type="button" class="btn btn-ghost-danger" data-act="decline">Ablehnen</button>
          </div>
        </li>`).join('')}</ul>
      <p class="muted group-hint">Wenn du beitrittst, sehen die Mitglieder auch deine Rezepte.</p>
    </fieldset>` : ''}
    ${groups.map((g) => `
    <fieldset class="panel group-panel" data-gid="${g.id}" data-name="${esc(g.name)}">
      <legend>👥 ${esc(g.name)}</legend>
      <ul class="user-list">${g.members.map((m) => `
        <li class="user-row" data-uid="${m.id}" data-uname="${esc(m.username)}">
          <div class="user-info"><strong>${esc(m.username)}${m.id === me ? ' (du)' : ''}</strong>
            <small class="muted">${m.isOwner ? 'hat die Gruppe angelegt' : m.accepted ? 'Mitglied' : 'eingeladen, noch nicht beigetreten'}</small></div>
          <div class="user-actions">${g.isOwner && !m.isOwner
            ? `<button type="button" class="btn btn-ghost-danger" data-act="remove">${m.accepted ? 'Entfernen' : 'Zurückziehen'}</button>` : ''}</div>
        </li>`).join('')}</ul>
      <div class="group-foot">
        ${g.isOwner ? `<form class="group-invite" data-act="invite">
            <input name="username" placeholder="Benutzername einladen" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="32" required>
            <button class="btn btn-primary">Einladen</button>
          </form>
          <div class="group-links">
            <button type="button" class="link-btn" data-act="rename">Umbenennen</button>
            <button type="button" class="link-btn share-off" data-act="delete">Gruppe löschen</button>
          </div>`
          : '<div class="group-links"><button type="button" class="link-btn share-off" data-act="leave">Gruppe verlassen</button></div>'}
      </div>
    </fieldset>`).join('')}
    <fieldset class="panel">
      <legend>Neue Gruppe</legend>
      <form class="group-invite" data-act="create">
        <input name="name" placeholder="z. B. Familie" maxlength="60" autocomplete="off" required>
        <button class="btn btn-primary">Anlegen</button>
      </form>
    </fieldset>
  </div>`;

  const json = (url, method, body) => api(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const done = async (msg) => {
    toast(msg);
    meta = null; // Gruppenliste/Umschalter neu laden
    await reloadMeta();
    await renderGroups();
  };
  const root = app.querySelector('.form');

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $('button', f);
    btn.disabled = true;
    try {
      if (f.dataset.act === 'create') {
        await json('/api/groups', 'POST', { name: f.name.value });
        await done('Gruppe angelegt. Lade jetzt Mitglieder ein.');
      } else {
        const gid = f.closest('.group-panel').dataset.gid;
        const res = await json(`/api/groups/${gid}/members`, 'POST', { username: f.username.value.trim() });
        await done(`${res.username} eingeladen. Sichtbar wird alles, sobald die Einladung angenommen ist.`);
      }
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const row = btn.closest('.user-row');
    const panel = btn.closest('[data-gid]');
    const gid = panel.dataset.gid;
    const gname = panel.dataset.name;
    try {
      if (act === 'accept') {
        await api(`/api/groups/${gid}/accept`, { method: 'POST' });
        await done(`Du bist jetzt in „${gname}“`);
      } else if (act === 'decline' || act === 'leave') {
        if (!confirm(act === 'leave' ? `„${gname}“ verlassen? Die anderen sehen deine Rezepte dann nicht mehr.` : `Einladung zu „${gname}“ ablehnen?`)) return;
        await api(`/api/groups/${gid}/members/${me}`, { method: 'DELETE' });
        await done(act === 'leave' ? 'Gruppe verlassen' : 'Einladung abgelehnt');
      } else if (act === 'remove') {
        if (!confirm(`${row.dataset.uname} aus „${gname}“ entfernen?`)) return;
        await api(`/api/groups/${gid}/members/${row.dataset.uid}`, { method: 'DELETE' });
        await done(`${row.dataset.uname} entfernt`);
      } else if (act === 'rename') {
        const name = prompt('Neuer Name der Gruppe:', gname)?.trim();
        if (!name || name === gname) return;
        await json(`/api/groups/${gid}`, 'PUT', { name });
        await done('Umbenannt');
      } else if (act === 'delete') {
        if (!confirm(`Gruppe „${gname}“ löschen? Die Rezepte bleiben bei ihren Besitzern erhalten.`)) return;
        await api(`/api/groups/${gid}`, { method: 'DELETE' });
        await done('Gruppe gelöscht');
      }
    } catch (err) { toast(err.message, true); }
  });
}

// ================= Ausgeblendete Rezepte =================
async function renderHidden() {
  const hidden = await api('/api/hidden');
  window.scrollTo(0, 0);
  app.innerHTML = `
  <div class="form">
    <div class="form-head">
      <a href="#/" class="back">${ICON.left} Zurück</a>
      <h1>Ausgeblendete Rezepte</h1>
      <p class="muted">Rezepte aus deinen Gruppen, die du für dich ausgeblendet hast. Sie erscheinen nicht in der Gruppenansicht,
        bei „Zufall“ oder in der Kalenderauswahl. Die anderen in der Gruppe sehen sie weiterhin.</p>
    </div>
    <fieldset class="panel">
      <legend>Ausgeblendet</legend>
      ${hidden.length ? `<ul class="user-list">${hidden.map((h) => `
        <li class="user-row">
          <div class="user-info"><a href="#/r/${h.id}"><strong>${esc(h.title)}</strong></a><small class="muted">von ${esc(h.author)}</small></div>
          <div class="user-actions"><button type="button" class="btn btn-outline" data-unhide="${h.id}">Einblenden</button></div>
        </li>`).join('')}</ul>`
        : '<p class="muted user-empty">Du hast keine Rezepte ausgeblendet. Bei Rezepten anderer findest du in der Detailansicht den Button „Ausblenden“.</p>'}
    </fieldset>
  </div>`;
  app.querySelector('.form').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-unhide]');
    if (!btn) return;
    btn.disabled = true;
    try {
      await api(`/api/recipes/${btn.dataset.unhide}/hide`, { method: 'DELETE' });
      meta = null;
      state.ids = [];
      toast('Wieder eingeblendet');
      await reloadMeta();
      await renderHidden();
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });
}

function setScope(scope) {
  state.scope = String(scope);
  lsSet('scope', state.scope);
}

async function reloadMeta() {
  meta = await api('/api/meta' + (state.scope !== 'mine' ? '?scope=' + encodeURIComponent(state.scope) : ''));
  if (meta.scope !== state.scope) setScope(meta.scope); // z. B. Gruppe verlassen
  pruneFilters();
  showStorage();
  showUser();
  state.ids = [];
}

// ================= Formular =================
async function renderForm(id) {
  const r = id ? await api('/api/recipes/' + encodeURIComponent(id)) : { tags: [], photos: [] };
  window.scrollTo(0, 0);
  const deletePhotos = new Set();
  let newFiles = [];

  const choice = (field, label) => `
    <div class="field">
      <label>${label}</label>
      <div class="chips choice" data-field="${field}">
        ${(meta.options[field] || []).map((v) => `<button type="button" class="chip${r[field] === v ? ' on' : ''}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}
        <button type="button" class="chip chip-add" title="Eigenen Wert anlegen">+ Neu</button>
      </div>
      <input type="hidden" name="${field}" value="${esc(r[field] || '')}">
    </div>`;

  app.innerHTML = `
  <form class="form" id="form" novalidate>
    <div class="form-head">
      <a href="${id ? '#/r/' + r.id : '#/'}" class="back">${ICON.left} Abbrechen</a>
      <h1>${id ? 'Rezept bearbeiten' : 'Neues Rezept'}</h1>
    </div>

    <fieldset class="panel">
      <legend>Vorderseite</legend>
      <div class="field">
        <label for="f-title">Titel *</label>
        <input id="f-title" name="title" required maxlength="200" value="${esc(r.title)}" placeholder="z. B. Schweinefilet mit Orangen-Teriyaki-Soße">
      </div>
      <div class="field">
        <label for="f-sub">Untertitel</label>
        <input id="f-sub" name="subtitle" maxlength="200" value="${esc(r.subtitle)}" placeholder="z. B. dazu Ofenpaprika und Basmatireis">
      </div>
      ${choice('gang', 'Gang')}
      <div class="row3">
        ${choice('zeit', 'Zeit')}
        ${choice('aufwand', 'Aufwand')}
        ${choice('preis', 'Preis')}
      </div>
      ${choice('kueche', 'Küche')}
      <p class="hint">Fehlt ein Wert? Einfach <b>+ Neu</b> antippen. Umbenennen oder löschen unter <a href="#/kategorien">Kategorien verwalten</a>.</p>
      <div class="row2">
        <div class="field">
          <label for="f-serv">Portionen</label>
          <input id="f-serv" name="servings" type="number" min="1" max="50" value="${esc(r.servings ?? '')}" placeholder="2">
        </div>
        <div class="field">
          <label for="f-kcal">kcal pro Portion</label>
          <input id="f-kcal" name="kcal" type="number" min="1" value="${esc(r.kcal ?? '')}" placeholder="650">
        </div>
      </div>
      <div class="field">
        <label for="f-tags">Tags <small>(mit Komma getrennt)</small></label>
        <input id="f-tags" name="tags" value="${esc(r.tags.join(', '))}" placeholder="vegetarisch, meal prep, sommer">
        ${meta.tags.length ? `<div class="chips tag-suggest">${meta.tags.map((t) => `<button type="button" class="chip chip-sm" data-tag="${esc(t.name)}">+ ${esc(t.name)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="field">
        <label for="f-desc">Beschreibung</label>
        <textarea id="f-desc" name="description" rows="2" placeholder="Ein, zwei Sätze zum Gericht (optional)">${esc(r.description)}</textarea>
      </div>
    </fieldset>

    <fieldset class="panel">
      <legend>Fotos</legend>
      <p class="hint">Das <b>erste Foto</b> ist das Titelbild der Karte. Weitere Fotos erscheinen in der <b>Galerie</b> unter dem Titelbild.</p>
      <div class="photo-grid" id="photo-grid"></div>
      <label class="dropzone" id="dropzone">
        <input type="file" id="f-photos" accept="image/*" multiple hidden>
        <span>📷 Fotos hinzufügen</span><small>Klicken oder hierher ziehen</small>
      </label>
    </fieldset>

    <fieldset class="panel">
      <legend>Rückseite</legend>
      <div class="row2">
        <div class="field">
          <label for="f-ing">Zutaten</label>
          <textarea id="f-ing" name="ingredients" rows="12" placeholder="200 g Basmatireis&#10;300 g Schweinefilet&#10;1 Orange&#10;2 Zehen Knoblauch&#10;&#10;Für die Soße:&#10;3 EL Sojasoße">${esc(r.ingredients)}</textarea>
          <p class="hint">Eine Zutat pro Zeile, Menge zuerst (für die Portions&shy;umrechnung). Zeilen mit <code>:</code> am Ende sind Zwischenüberschriften.</p>
        </div>
        <div class="field">
          <label for="f-ins">Zubereitung</label>
          <textarea id="f-ins" name="instructions" rows="12" placeholder="Reis in kochendem Salzwasser 10 Min. garen.&#10;&#10;Orange halbieren und Saft auspressen…">${esc(r.instructions)}</textarea>
          <p class="hint">Schritte durch eine <b>Leerzeile</b> trennen. Zutaten werden im Text automatisch fett, oder manuell mit <code>**so**</code>.</p>
        </div>
      </div>
      <div class="row2">
        <div class="field">
          <label for="f-pantry">Gut im Haus zu haben</label>
          <input id="f-pantry" name="pantry" value="${esc(r.pantry)}" placeholder="Salz, Pfeffer, Öl, Zucker">
        </div>
        <div class="field">
          <label for="f-equip">Was zum Kochen gebraucht wird</label>
          <input id="f-equip" name="equipment" value="${esc(r.equipment)}" placeholder="Topf, große Pfanne, Backblech">
        </div>
      </div>
      <div class="field">
        <label for="f-src">Quelle</label>
        <input id="f-src" name="source" value="${esc(r.source)}" placeholder="Link oder z. B. „Omas Kochbuch“">
      </div>
      <div class="field">
        <label for="f-video">Video-Link</label>
        <input id="f-video" name="video" type="url" inputmode="url" value="${esc(r.video)}" placeholder="z. B. https://www.youtube.com/watch?v=…">
      </div>
    </fieldset>

    <div class="form-actions">
      <a href="${id ? '#/r/' + r.id : '#/'}" class="btn btn-outline">Abbrechen</a>
      <button type="submit" class="btn btn-primary" id="save">Speichern</button>
    </div>
  </form>`;

  // Auswahl-Chips (Zeit/Aufwand/Preis): Klick wählt, erneuter Klick hebt auf
  $$('.choice').forEach((group) => group.addEventListener('click', async (e) => {
    const input = $(`input[name="${group.dataset.field}"]`);
    if (e.target.closest('.chip-input')) return;
    if (e.target.closest('.chip-add')) {
      const value = await addOption(group.dataset.field, e.target.closest('.chip-add'));
      if (!value) return;
      $$('.chip', group).forEach((c) => c.classList.remove('on'));
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip on';
      chip.dataset.v = value;
      chip.textContent = value;
      group.insertBefore(chip, $('.chip-add', group));
      input.value = value;
      return;
    }
    const b = e.target.closest('.chip');
    if (!b) return;
    const on = !b.classList.contains('on');
    $$('.chip', group).forEach((c) => c.classList.remove('on'));
    b.classList.toggle('on', on);
    input.value = on ? b.dataset.v : '';
  }));

  $$('.tag-suggest .chip').forEach((b) => b.addEventListener('click', () => {
    const inp = $('#f-tags');
    const tags = inp.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (!tags.map((t) => t.toLowerCase()).includes(b.dataset.tag)) tags.push(b.dataset.tag);
    inp.value = tags.join(', ');
  }));

  // Fotos
  const renderPhotos = () => {
    const items = [
      ...r.photos.map((p) => ({ src: photoUrl(p.filename), del: deletePhotos.has(p.id), key: 'e' + p.id })),
      ...newFiles.map((f, i) => ({ src: f.preview, key: 'n' + i, isNew: true })),
    ];
    let n = 0;
    $('#photo-grid').innerHTML = items.map((it) => {
      const label = it.del ? 'wird gelöscht' : (n++ === 0 ? 'Titelbild' : `Foto ${n}`);
      return `<div class="photo-item${it.del ? ' del' : ''}">
        <img src="${it.src}" alt="">
        <span class="photo-label">${label}${it.isNew ? ' · neu' : ''}</span>
        <button type="button" class="photo-x" data-key="${it.key}" title="${it.del ? 'Wiederherstellen' : 'Entfernen'}">${it.del ? '↺' : '×'}</button>
      </div>`;
    }).join('');
  };
  renderPhotos();

  $('#photo-grid').addEventListener('click', (e) => {
    const b = e.target.closest('.photo-x');
    if (!b) return;
    const key = b.dataset.key;
    if (key[0] === 'e') {
      const pid = Number(key.slice(1));
      deletePhotos.has(pid) ? deletePhotos.delete(pid) : deletePhotos.add(pid);
    } else {
      const i = Number(key.slice(1));
      URL.revokeObjectURL(newFiles[i].preview);
      newFiles.splice(i, 1);
    }
    renderPhotos();
  });

  const addFiles = (files) => {
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      newFiles.push({ file: f, preview: URL.createObjectURL(f) });
    }
    renderPhotos();
  };
  $('#f-photos').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.title.value.trim()) { toast('Bitte einen Titel eingeben', true); form.title.focus(); return; }
    const btn = $('#save');
    btn.disabled = true;
    btn.textContent = newFiles.length ? 'Fotos werden hochgeladen…' : 'Speichern…';
    try {
      const fd = new FormData();
      for (const name of ['title', 'subtitle', 'description', 'gang', 'zeit', 'aufwand', 'preis', 'kueche', 'servings', 'kcal', 'tags', 'ingredients', 'instructions', 'pantry', 'equipment', 'source', 'video']) {
        fd.append(name, form.elements[name].value);
      }
      fd.append('deletePhotos', [...deletePhotos].join(','));
      for (const nf of newFiles) fd.append('photos', await resizeImage(nf.file));
      const saved = await api(id ? '/api/recipes/' + r.id : '/api/recipes', { method: id ? 'PUT' : 'POST', body: fd });
      newFiles.forEach((nf) => URL.revokeObjectURL(nf.preview));
      meta = null;
      state.ids = [];
      state.random = false;
      toast('Gespeichert ✓');
      location.hash = '#/r/' + saved.id;
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Speichern';
    }
  });
}

route();

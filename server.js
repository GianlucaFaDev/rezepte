const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Kategorien mit Auswahlwerten. Jeder Benutzer startet mit diesen Standardwerten
// und kann eigene Werte anlegen, umbenennen und löschen (Tabelle user_options).
const CATEGORIES = ['gang', 'zeit', 'aufwand', 'preis', 'kueche'];
const DEFAULT_OPTIONS = {
  gang: ['Vorspeise', 'Hauptspeise', 'Dessert'],
  zeit: ['15–30 Min', '30–60 Min', 'über 1 Std'],
  aufwand: ['einfach', 'mittel', 'aufwendig'],
  preis: ['günstig', 'mittel', 'teuer'],
  kueche: ['Deutsch', 'Italienisch', 'Französisch'],
};

// ---------- Datenbank ----------
const db = new Database(path.join(DATA_DIR, 'rezepte.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS recipes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  subtitle     TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  ingredients  TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  servings     INTEGER,
  kcal         INTEGER,
  pantry       TEXT NOT NULL DEFAULT '',
  equipment    TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT '',
  zeit         TEXT,
  preis        TEXT,
  aufwand      TEXT,
  kueche       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS photos (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  filename  TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS recipe_tags (
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  PRIMARY KEY (recipe_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_photos_recipe ON photos(recipe_id);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON recipe_tags(tag);
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash  TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_filename ON photos(filename);
`);
// Migration: Rezepte gehören einem Benutzer
if (!db.prepare('PRAGMA table_info(recipes)').all().some((c) => c.name === 'user_id')) {
  db.exec('ALTER TABLE recipes ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE');
}
db.exec(`
CREATE TABLE IF NOT EXISTS user_options (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  value    TEXT NOT NULL COLLATE NOCASE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, category, value)
);`);
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'options_seeded')) {
  db.exec('ALTER TABLE users ADD COLUMN options_seeded INTEGER NOT NULL DEFAULT 0');
}
if (!db.prepare('PRAGMA table_info(recipes)').all().some((c) => c.name === 'gang')) {
  db.exec('ALTER TABLE recipes ADD COLUMN gang TEXT');
}
if (!db.prepare('PRAGMA table_info(recipes)').all().some((c) => c.name === 'share_token')) {
  db.exec('ALTER TABLE recipes ADD COLUMN share_token TEXT');
}
db.exec(`
CREATE TABLE IF NOT EXISTS meal_plan (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,                -- YYYY-MM-DD
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, day)
);`);
// Migration: Freischaltung neuer Konten durch einen Admin.
// Bestehende Konten gelten als freigeschaltet, der älteste Benutzer wird Admin.
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'approved')) {
  db.exec(`ALTER TABLE users ADD COLUMN approved INTEGER NOT NULL DEFAULT 1;
           ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
           UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users);`);
}
// Migration: Dateigröße der Fotos merken (für das Speicherlimit pro Benutzer)
if (!db.prepare('PRAGMA table_info(photos)').all().some((c) => c.name === 'size')) {
  db.exec('ALTER TABLE photos ADD COLUMN size INTEGER NOT NULL DEFAULT 0');
}
{
  const setSize = db.prepare('UPDATE photos SET size = ? WHERE id = ?');
  for (const p of db.prepare('SELECT id, filename FROM photos WHERE size = 0').all()) {
    try { setSize.run(fs.statSync(path.join(UPLOAD_DIR, path.basename(p.filename))).size, p.id); } catch {}
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes(user_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_share ON recipes(share_token) WHERE share_token IS NOT NULL');

// Standardwerte + bereits in Rezepten verwendete Werte einmalig pro Benutzer anlegen
const seedOptions = db.transaction((userId) => {
  const ins = db.prepare('INSERT OR IGNORE INTO user_options (user_id, category, value, position) VALUES (?, ?, ?, ?)');
  for (const cat of CATEGORIES) {
    let pos = 0;
    for (const v of DEFAULT_OPTIONS[cat]) ins.run(userId, cat, v, pos++);
    for (const { v } of db.prepare(`SELECT DISTINCT ${cat} AS v FROM recipes WHERE user_id = ? AND ${cat} IS NOT NULL`).all(userId)) {
      ins.run(userId, cat, v, pos++);
    }
  }
  db.prepare('UPDATE users SET options_seeded = 1 WHERE id = ?').run(userId);
});
for (const { id } of db.prepare('SELECT id FROM users WHERE options_seeded = 0').all()) seedOptions(id);

function userOptions(userId) {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const r of db.prepare('SELECT category, value FROM user_options WHERE user_id = ? ORDER BY position, rowid').all(userId)) {
    if (out[r.category]) out[r.category].push(r.value);
  }
  return out;
}

// ---------- App ----------
const app = express();
app.disable('x-powered-by');

// Hinter einem Reverse-Proxy (Caddy, nginx, Traefik): TRUST_PROXY setzen, damit req.ip die echte
// Client-IP ist (Login-Sperre pro IP) und req.secure bei HTTPS stimmt (Secure-Cookie).
// Werte: Anzahl Proxys ("1"), "loopback", "uniquelocal", IP/Subnetz-Liste ("10.0.0.0/8, 172.16.0.0/12")
// Nicht setzen, wenn die App direkt erreichbar ist, sonst kann jeder seine IP per Header fälschen.
const TRUST_PROXY = (process.env.TRUST_PROXY || '').trim();
if (TRUST_PROXY && !/^(0|false|no|nein)$/i.test(TRUST_PROXY)) {
  app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : /^true$/i.test(TRUST_PROXY) ? true : TRUST_PROXY);
}

// ---------- Login (Benutzer + Sessions) ----------
// Registrierung neuer Konten erlauben? (ALLOW_REGISTRATION=false zum Abschalten)
const ALLOW_REGISTRATION = !/^(0|false|no|nein)$/i.test(process.env.ALLOW_REGISTRATION || '');
const SESSION_DAYS = 30;
const COOKIE = 'kb_session';
const failedLogins = new Map(); // IP → { count, until }

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
// Dummy-Hash, damit unbekannte Benutzernamen gleich lange brauchen
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = req.secure;
  res.append('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(tokenHash(token), userId, expires);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

// Abgelaufene Sessions regelmäßig aufräumen
const purgeSessions = () => {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  for (const [ip, e] of failedLogins) if (e.until < Date.now()) failedLogins.delete(ip);
};
purgeSessions();
setInterval(purgeSessions, 6 * 3600e3).unref();

// Eingeloggten Benutzer an req.user hängen (oder null)
app.use((req, res, next) => {
  req.user = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(`SELECT u.id, u.username, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
                            WHERE s.token_hash = ? AND s.expires_at > ? AND u.approved = 1`).get(tokenHash(token), Date.now());
    if (row) req.user = { id: row.id, username: row.username, isAdmin: !!row.is_admin };
  }
  next();
});

const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: 'Bitte einloggen' });
const requireAdmin = (req, res, next) =>
  !req.user ? res.status(401).json({ error: 'Bitte einloggen' })
    : req.user.isAdmin ? next() : res.status(403).json({ error: 'Nur für Admins' });

// Höchstzahl offener Anfragen, damit Bots die Datenbank nicht mit Anfragen füllen
const MAX_PENDING = 20;

// Einfacher Schutz gegen Passwort-Raten: max. 10 Fehlversuche pro IP in 15 Min.
function tooManyAttempts(ip) {
  const e = failedLogins.get(ip);
  if (!e || e.until < Date.now()) { failedLogins.delete(ip); return false; }
  return e.count >= 10;
}
function noteFailure(ip) {
  const e = failedLogins.get(ip);
  if (!e || e.until < Date.now()) failedLogins.set(ip, { count: 1, until: Date.now() + 15 * 60e3 });
  else e.count++;
}

const authRouter = express.Router();
authRouter.use(express.json({ limit: '10kb' }));

authRouter.get('/me', (req, res) => {
  const pending = req.user?.isAdmin ? db.prepare('SELECT COUNT(*) AS n FROM users WHERE approved = 0').get().n : 0;
  res.json({ user: req.user, allowRegistration: ALLOW_REGISTRATION, pending });
});

authRouter.post('/register', (req, res) => {
  if (!ALLOW_REGISTRATION) return res.status(403).json({ error: 'Registrierung ist deaktiviert' });
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!/^[\p{L}\p{N}._-]{3,32}$/u.test(username)) {
    return res.status(400).json({ error: 'Benutzername: 3–32 Zeichen (Buchstaben, Ziffern, . _ -)' });
  }
  if (password.length < 8 || password.length > 200) {
    return res.status(400).json({ error: 'Passwort muss mindestens 8 Zeichen haben' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Benutzername ist schon vergeben' });
  }
  const passHash = hashPassword(password);
  const result = db.transaction(() => {
    // Der erste Benutzer wird Admin und ist sofort freigeschaltet, alle weiteren warten auf Freischaltung
    const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
    if (!first && db.prepare('SELECT COUNT(*) AS n FROM users WHERE approved = 0').get().n >= MAX_PENDING) return null;
    const id = db.prepare('INSERT INTO users (username, pass_hash, approved, is_admin) VALUES (?, ?, ?, ?)')
      .run(username, passHash, first ? 1 : 0, first ? 1 : 0).lastInsertRowid;
    if (first) db.prepare('UPDATE recipes SET user_id = ? WHERE user_id IS NULL').run(id); // Rezepte aus der Zeit vor dem Login
    seedOptions(id);
    return { id, first };
  })();
  if (!result) return res.status(429).json({ error: 'Gerade sind zu viele Anfragen offen, bitte später erneut versuchen' });
  if (!result.first) return res.status(202).json({ pending: true });
  createSession(req, res, result.id);
  res.status(201).json({ user: { id: result.id, username, isAdmin: true } });
});

authRouter.post('/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Zu viele Fehlversuche, bitte in 15 Minuten erneut versuchen' });
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const user = db.prepare('SELECT id, username, pass_hash, approved, is_admin FROM users WHERE username = ?').get(username);
  const ok = verifyPassword(password, user ? user.pass_hash : DUMMY_HASH) && !!user;
  if (!ok) {
    noteFailure(ip);
    return res.status(401).json({ error: 'Benutzername oder Passwort falsch' });
  }
  failedLogins.delete(ip);
  if (!user.approved) return res.status(403).json({ error: 'Dein Konto wartet noch auf Freischaltung' });
  createSession(req, res, user.id);
  res.json({ user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
});

authRouter.post('/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  setSessionCookie(req, res, '', 0);
  res.status(204).end();
});

app.use('/api/auth', authRouter);

// ---------- Benutzerverwaltung (nur Admins) ----------
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT u.id, u.username, u.created_at, u.approved, u.is_admin,
                              (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) AS recipes,
                              (SELECT COALESCE(SUM(p.size), 0) FROM photos p JOIN recipes r ON r.id = p.recipe_id
                               WHERE r.user_id = u.id) AS storage
                       FROM users u ORDER BY u.approved, u.created_at DESC`).all()
    .map((u) => ({ ...u, approved: !!u.approved, is_admin: !!u.is_admin, quota: USER_QUOTA })));
});

app.post('/api/admin/users/:id/approve', requireAdmin, (req, res) => {
  const info = db.prepare('UPDATE users SET approved = 1 WHERE id = ? AND approved = 0').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Anfrage nicht gefunden' });
  res.status(204).end();
});

// Ablehnen (offene Anfrage) bzw. Konto löschen, samt Rezepten und Fotos
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, is_admin FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (target.is_admin) return res.status(400).json({ error: 'Admin-Konten können nicht gelöscht werden' });
  const photos = db.prepare('SELECT p.filename FROM photos p JOIN recipes r ON r.id = p.recipe_id WHERE r.user_id = ?').all(target.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id); // Rezepte, Sessions usw. per ON DELETE CASCADE
  removeFiles(photos.map((p) => p.filename));
  res.status(204).end();
});

app.use(express.static(path.join(__dirname, 'public')));

// Fotos nur für den Besitzer des Rezepts
app.use('/uploads', (req, res, next) => {
  if (!req.user) return res.status(401).end();
  const owns = db.prepare(`SELECT 1 FROM photos p JOIN recipes r ON r.id = p.recipe_id
                           WHERE p.filename = ? AND r.user_id = ?`).get(path.basename(req.path), req.user.id);
  if (!owns) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=2592000, immutable');
  next();
}, express.static(UPLOAD_DIR, { cacheControl: false }));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype] || '.jpg';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

// ---------- Helfer ----------
const toList = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

const normTag = (t) => t.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');

function buildFilter(q, userId) {
  const where = ['r.user_id = ?'];
  const params = [userId];
  for (const field of ['gang', 'zeit', 'preis', 'aufwand', 'kueche']) {
    const vals = toList(q[field]);
    if (vals.length) {
      where.push(`r.${field} COLLATE NOCASE IN (${vals.map(() => '?').join(',')})`);
      params.push(...vals);
    }
  }
  // Freie Tags: Rezept muss ALLE gewählten Tags haben
  for (const tag of toList(q.tags).map(normTag)) {
    where.push('EXISTS (SELECT 1 FROM recipe_tags t WHERE t.recipe_id = r.id AND t.tag = ?)');
    params.push(tag);
  }
  const text = String(q.q ?? '').trim();
  if (text) {
    where.push('(r.title LIKE ? OR r.subtitle LIKE ? OR r.description LIKE ? OR r.ingredients LIKE ? OR r.kueche LIKE ?)');
    const like = `%${text}%`;
    params.push(like, like, like, like, like);
  }
  return { sql: 'WHERE ' + where.join(' AND '), params };
}

const LIST_COLUMNS = `
  r.id, r.title, r.subtitle, r.description, r.gang, r.zeit, r.preis, r.aufwand, r.kueche, r.kcal, r.servings, r.ingredients, r.created_at,
  (SELECT filename FROM photos p WHERE p.recipe_id = r.id ORDER BY position, id LIMIT 1) AS photo,
  (SELECT group_concat(tag, ',') FROM (SELECT tag FROM recipe_tags t WHERE t.recipe_id = r.id ORDER BY tag)) AS tags`;

const rowToSummary = (r) => ({ ...r, tags: r.tags ? r.tags.split(',') : [] });

function getRecipe(id, userId) {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!recipe) return null;
  recipe.photos = db.prepare('SELECT id, filename FROM photos WHERE recipe_id = ? ORDER BY position, id').all(id);
  recipe.tags = db.prepare('SELECT tag FROM recipe_tags WHERE recipe_id = ? ORDER BY tag').all(id).map((t) => t.tag);
  return recipe;
}

// Speicherlimit für Fotos pro Benutzer (USER_QUOTA_MB, 0 = unbegrenzt)
const USER_QUOTA = Math.max(0, Number(process.env.USER_QUOTA_MB ?? 500) || 0) * 1024 * 1024;
const storageUsed = (userId) =>
  db.prepare('SELECT COALESCE(SUM(p.size), 0) AS n FROM photos p JOIN recipes r ON r.id = p.recipe_id WHERE r.user_id = ?').get(userId).n;
const storageInfo = (userId) => ({ used: storageUsed(userId), quota: USER_QUOTA });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function removeFiles(filenames) {
  for (const f of filenames) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(f)), () => {});
  }
}

function parseRecipeBody(body, userId) {
  // Nur Werte übernehmen, die der Benutzer in der Kategorie angelegt hat (Schreibweise aus der Liste)
  const pick = (field) => {
    const v = String(body[field] ?? '').trim();
    if (!v) return null;
    const row = db.prepare('SELECT value FROM user_options WHERE user_id = ? AND category = ? AND value = ?').get(userId, field, v);
    return row ? row.value : null;
  };
  const servings = parseInt(body.servings, 10);
  const kcal = parseInt(body.kcal, 10);
  return {
    title: String(body.title ?? '').trim().slice(0, 200),
    subtitle: String(body.subtitle ?? '').trim().slice(0, 200),
    description: String(body.description ?? '').trim(),
    ingredients: String(body.ingredients ?? '').trim(),
    instructions: String(body.instructions ?? '').trim(),
    servings: Number.isFinite(servings) && servings > 0 ? servings : null,
    kcal: Number.isFinite(kcal) && kcal > 0 ? kcal : null,
    pantry: String(body.pantry ?? '').trim(),
    equipment: String(body.equipment ?? '').trim(),
    source: String(body.source ?? '').trim(),
    gang: pick('gang'),
    zeit: pick('zeit'),
    preis: pick('preis'),
    aufwand: pick('aufwand'),
    kueche: pick('kueche'),
    tags: [...new Set(toList(body.tags).map(normTag).filter(Boolean))].slice(0, 30),
  };
}

const saveRecipe = db.transaction((id, userId, data, newFiles, deletePhotoIds) => {
  const fields = ['title', 'subtitle', 'description', 'ingredients', 'instructions', 'servings', 'kcal', 'pantry', 'equipment', 'source', 'gang', 'zeit', 'preis', 'aufwand', 'kueche'];
  if (id) {
    db.prepare(`UPDATE recipes SET ${fields.map((f) => `${f} = @${f}`).join(', ')}, updated_at = datetime('now') WHERE id = @id AND user_id = @user_id`)
      .run({ ...data, id, user_id: userId });
  } else {
    id = db.prepare(`INSERT INTO recipes (user_id, ${fields.join(', ')}) VALUES (@user_id, ${fields.map((f) => '@' + f).join(', ')})`)
      .run({ ...data, user_id: userId }).lastInsertRowid;
  }

  db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ?').run(id);
  const insTag = db.prepare('INSERT INTO recipe_tags (recipe_id, tag) VALUES (?, ?)');
  for (const t of data.tags) insTag.run(id, t);

  const removed = [];
  for (const pid of deletePhotoIds) {
    const p = db.prepare('SELECT filename FROM photos WHERE id = ? AND recipe_id = ?').get(pid, id);
    if (p) {
      db.prepare('DELETE FROM photos WHERE id = ?').run(pid);
      removed.push(p.filename);
    }
  }

  // Speicherlimit nur beim Hinzufügen prüfen (Bearbeiten und Löschen geht immer). Läuft in der
  // Transaktion, ein Fehler macht also alle Änderungen dieses Speicherns rückgängig.
  const added = newFiles.reduce((s, f) => s + (f.size || 0), 0);
  if (USER_QUOTA && added && storageUsed(userId) + added > USER_QUOTA) {
    const mb = (n) => Math.round(n / 1048576);
    throw new HttpError(413, `Speicherplatz voll: ${mb(storageUsed(userId))} von ${mb(USER_QUOTA)} MB belegt, die neuen Fotos haben ${Math.max(1, mb(added))} MB. Bitte zuerst Fotos löschen.`);
  }

  let pos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM photos WHERE recipe_id = ?').get(id).m;
  const insPhoto = db.prepare('INSERT INTO photos (recipe_id, filename, position, size) VALUES (?, ?, ?, ?)');
  for (const f of newFiles) insPhoto.run(id, f.filename, ++pos, f.size || 0);

  return { id, removed };
});

// ---------- Öffentlich geteilte Rezepte (ohne Login, nur über den geheimen Link) ----------
const SHARE_RE = /^[A-Za-z0-9_-]{32,64}$/;
function sharedRecipe(token) {
  if (!SHARE_RE.test(token)) return null;
  const row = db.prepare('SELECT id, user_id FROM recipes WHERE share_token = ?').get(token);
  return row ? getRecipe(row.id, row.user_id) : null;
}

app.get('/api/public/:token', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  const r = sharedRecipe(req.params.token);
  if (!r) return res.status(404).json({ error: 'Dieser Link ist ungültig oder wurde deaktiviert' });
  const { user_id, share_token, ...pub } = r; // interne Felder nicht herausgeben
  res.json(pub);
});

app.get('/api/public/:token/photos/:filename', (req, res) => {
  const r = sharedRecipe(req.params.token);
  const photo = r && r.photos.find((p) => p.filename === req.params.filename);
  if (!photo) return res.status(404).end();
  res.set({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'private, max-age=3600' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(photo.filename)));
});

// Geteiltes Rezept ins eigene Kochbuch übernehmen (Kopie inkl. Fotos und Tags)
app.post('/api/public/:token/import', requireAuth, (req, res) => {
  const src = sharedRecipe(req.params.token);
  if (!src) return res.status(404).json({ error: 'Dieser Link ist ungültig oder wurde deaktiviert' });
  const uid = req.user.id;
  if (src.user_id === uid) return res.json({ id: src.id, own: true });

  // Fotos als eigene Dateien kopieren, damit sie unabhängig vom Original bleiben
  const copied = [];
  try {
    for (const p of src.photos) {
      const filename = crypto.randomBytes(12).toString('hex') + path.extname(p.filename);
      fs.copyFileSync(path.join(UPLOAD_DIR, path.basename(p.filename)), path.join(UPLOAD_DIR, filename));
      copied.push({ filename, size: fs.statSync(path.join(UPLOAD_DIR, filename)).size });
    }
    const id = db.transaction(() => {
      const data = { ...src, tags: src.tags };
      // Kategorie-Werte, die der Benutzer noch nicht hat, bei ihm anlegen
      for (const cat of CATEGORIES) {
        if (!src[cat]) continue;
        const own = findOption(uid, cat, src[cat]);
        if (own) { data[cat] = own.value; continue; }
        const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_options WHERE user_id = ? AND category = ?').get(uid, cat).p;
        db.prepare('INSERT INTO user_options (user_id, category, value, position) VALUES (?, ?, ?, ?)').run(uid, cat, src[cat], pos);
      }
      return saveRecipe(null, uid, data, copied, []).id;
    })();
    res.status(201).json({ id });
  } catch (err) {
    removeFiles(copied.map((f) => f.filename));
    throw err;
  }
});

// ---------- API ----------
app.use('/api', requireAuth);

// Freigabe-Link erzeugen (oder vorhandenen zurückgeben) bzw. deaktivieren
app.post('/api/recipes/:id/share', (req, res) => {
  const r = db.prepare('SELECT share_token FROM recipes WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!r) return res.status(404).json({ error: 'Rezept nicht gefunden' });
  let token = r.share_token;
  if (!token) {
    token = crypto.randomBytes(24).toString('base64url');
    db.prepare('UPDATE recipes SET share_token = ? WHERE id = ? AND user_id = ?').run(token, req.params.id, req.user.id);
  }
  res.json({ token });
});

app.delete('/api/recipes/:id/share', (req, res) => {
  const info = db.prepare('UPDATE recipes SET share_token = NULL WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Rezept nicht gefunden' });
  res.status(204).end();
});

app.get('/api/meta', (req, res) => {
  const uid = req.user.id;
  res.json({
    categories: CATEGORIES,
    options: userOptions(uid),
    tags: db.prepare(`SELECT t.tag AS name, COUNT(*) AS n FROM recipe_tags t JOIN recipes r ON r.id = t.recipe_id
                      WHERE r.user_id = ? GROUP BY t.tag ORDER BY t.tag`).all(uid),
    total: db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?').get(uid).n,
    storage: storageInfo(uid),
  });
});

// ---------- Eigene Kategorie-Werte ----------
const optionsJson = express.json({ limit: '10kb' });
function optionCategory(req, res) {
  const category = String(req.body?.category ?? req.query.category ?? '');
  if (!CATEGORIES.includes(category)) { res.status(400).json({ error: 'Unbekannte Kategorie' }); return null; }
  return category;
}
const cleanValue = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
function validValue(v, res) {
  if (!v || v.length > 40) { res.status(400).json({ error: 'Name: 1–40 Zeichen' }); return false; }
  return true;
}
const findOption = (uid, category, value) =>
  db.prepare('SELECT value FROM user_options WHERE user_id = ? AND category = ? AND value = ?').get(uid, category, value);

app.post('/api/options', optionsJson, (req, res) => {
  const category = optionCategory(req, res); if (!category) return;
  const value = cleanValue(req.body?.value);
  if (!validValue(value, res)) return;
  const uid = req.user.id;
  if (findOption(uid, category, value)) return res.status(409).json({ error: `„${value}“ gibt es schon` });
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM user_options WHERE user_id = ? AND category = ?').get(uid, category).p;
  db.prepare('INSERT INTO user_options (user_id, category, value, position) VALUES (?, ?, ?, ?)').run(uid, category, value, pos);
  res.status(201).json({ category, value });
});

// Umbenennen: betrifft auch alle Rezepte des Benutzers mit diesem Wert
app.put('/api/options', optionsJson, (req, res) => {
  const category = optionCategory(req, res); if (!category) return;
  const from = cleanValue(req.body?.from);
  const value = cleanValue(req.body?.value);
  if (!validValue(value, res)) return;
  const uid = req.user.id;
  const result = db.transaction(() => {
    const cur = findOption(uid, category, from);
    if (!cur) return { status: 404, body: { error: 'Wert nicht gefunden' } };
    const clash = findOption(uid, category, value);
    if (clash && clash.value.toLowerCase() !== cur.value.toLowerCase()) return { status: 409, body: { error: `„${value}“ gibt es schon` } };
    db.prepare('UPDATE user_options SET value = ? WHERE user_id = ? AND category = ? AND value = ?').run(value, uid, category, cur.value);
    const n = db.prepare(`UPDATE recipes SET ${category} = ? WHERE user_id = ? AND ${category} = ? COLLATE NOCASE`).run(value, uid, cur.value).changes;
    return { status: 200, body: { category, value, recipes: n } };
  })();
  res.status(result.status).json(result.body);
});

// Löschen: der Wert wird bei den betroffenen Rezepten entfernt (Rezepte bleiben erhalten)
app.delete('/api/options', (req, res) => {
  const category = optionCategory(req, res); if (!category) return;
  const value = cleanValue(req.query.value);
  const uid = req.user.id;
  const n = db.transaction(() => {
    if (!db.prepare('DELETE FROM user_options WHERE user_id = ? AND category = ? AND value = ?').run(uid, category, value).changes) return -1;
    return db.prepare(`UPDATE recipes SET ${category} = NULL WHERE user_id = ? AND ${category} = ? COLLATE NOCASE`).run(uid, value).changes;
  })();
  if (n < 0) return res.status(404).json({ error: 'Wert nicht gefunden' });
  res.json({ recipes: n });
});

// ---------- Kalender / Essensplan (ein Rezept pro Tag) ----------
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const PLAN_SELECT = `
  SELECT m.day, r.id, r.title,
    (SELECT filename FROM photos p WHERE p.recipe_id = r.id ORDER BY position, id LIMIT 1) AS photo
  FROM meal_plan m JOIN recipes r ON r.id = m.recipe_id AND r.user_id = m.user_id`;

app.get('/api/plan', (req, res) => {
  const { from, to } = req.query;
  if (!isDay(from) || !isDay(to) || from > to) return res.status(400).json({ error: 'Ungültiger Zeitraum' });
  res.json(db.prepare(`${PLAN_SELECT} WHERE m.user_id = ? AND m.day BETWEEN ? AND ? ORDER BY m.day`).all(req.user.id, from, to));
});

app.put('/api/plan/:day', express.json({ limit: '1kb' }), (req, res) => {
  const { day } = req.params;
  if (!isDay(day)) return res.status(400).json({ error: 'Ungültiges Datum' });
  const recipeId = Number(req.body?.recipe_id);
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ? AND user_id = ?').get(recipeId, req.user.id)) {
    return res.status(404).json({ error: 'Rezept nicht gefunden' });
  }
  db.prepare(`INSERT INTO meal_plan (user_id, day, recipe_id) VALUES (?, ?, ?)
              ON CONFLICT (user_id, day) DO UPDATE SET recipe_id = excluded.recipe_id`).run(req.user.id, day, recipeId);
  res.json(db.prepare(`${PLAN_SELECT} WHERE m.user_id = ? AND m.day = ?`).get(req.user.id, day));
});

app.delete('/api/plan/:day', (req, res) => {
  if (!isDay(req.params.day)) return res.status(400).json({ error: 'Ungültiges Datum' });
  db.prepare('DELETE FROM meal_plan WHERE user_id = ? AND day = ?').run(req.user.id, req.params.day);
  res.status(204).end();
});

app.get('/api/recipes', (req, res) => {
  const { sql, params } = buildFilter(req.query, req.user.id);
  const order = req.query.sort === 'neu' ? 'r.created_at DESC, r.id DESC' : 'r.title COLLATE NOCASE';
  const rows = db.prepare(`SELECT ${LIST_COLUMNS} FROM recipes r ${sql} ORDER BY ${order}`).all(...params);
  res.json(rows.map(rowToSummary));
});

app.get('/api/recipes/random', (req, res) => {
  const { sql, params } = buildFilter(req.query, req.user.id);
  const exclude = parseInt(req.query.exclude, 10);
  let where = sql;
  if (Number.isFinite(exclude)) {
    // Möglichst nicht dasselbe Rezept zweimal hintereinander
    const count = db.prepare(`SELECT COUNT(*) AS n FROM recipes r ${sql}`).get(...params).n;
    if (count > 1) {
      where = `${sql} AND r.id != ?`;
      params.push(exclude);
    }
  }
  const row = db.prepare(`SELECT r.id FROM recipes r ${where} ORDER BY RANDOM() LIMIT 1`).get(...params);
  if (!row) return res.status(404).json({ error: 'Kein passendes Rezept gefunden' });
  res.json(getRecipe(row.id, req.user.id));
});

app.get('/api/recipes/:id', (req, res) => {
  const recipe = getRecipe(req.params.id, req.user.id);
  if (!recipe) return res.status(404).json({ error: 'Rezept nicht gefunden' });
  res.json(recipe);
});

function handleSave(req, res) {
  const id = req.params.id ? Number(req.params.id) : null;
  const uid = req.user.id;
  const files = req.files || [];
  if (id && !db.prepare('SELECT 1 FROM recipes WHERE id = ? AND user_id = ?').get(id, uid)) {
    removeFiles(files.map((f) => f.filename));
    return res.status(404).json({ error: 'Rezept nicht gefunden' });
  }
  const data = parseRecipeBody(req.body, uid);
  if (!data.title) {
    removeFiles(files.map((f) => f.filename));
    return res.status(400).json({ error: 'Titel fehlt' });
  }
  const deleteIds = toList(req.body.deletePhotos).map(Number).filter(Number.isFinite);
  try {
    const result = saveRecipe(id, uid, data, files, deleteIds);
    removeFiles(result.removed);
    res.status(id ? 200 : 201).json(getRecipe(result.id, uid));
  } catch (err) {
    removeFiles(files.map((f) => f.filename));
    throw err;
  }
}

app.post('/api/recipes', upload.array('photos', 20), handleSave);
app.put('/api/recipes/:id', upload.array('photos', 20), handleSave);

app.delete('/api/recipes/:id', (req, res) => {
  const uid = req.user.id;
  const photos = db.prepare(`SELECT p.filename FROM photos p JOIN recipes r ON r.id = p.recipe_id
                             WHERE r.id = ? AND r.user_id = ?`).all(req.params.id, uid);
  const info = db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  if (!info.changes) return res.status(404).json({ error: 'Rezept nicht gefunden' });
  removeFiles(photos.map((p) => p.filename));
  res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Foto ist zu groß (max. 15 MB)' : err.message;
    return res.status(400).json({ error: msg });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler' });
});

app.listen(PORT, () => {
  console.log(`Rezepte läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})${ALLOW_REGISTRATION ? '' : '  [Registrierung aus]'}`);
});

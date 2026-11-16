const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

const COOKIE = 'sid';
const SESSION_DAYS = 7;
const isProd = process.env.NODE_ENV === 'production';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 11);
}

// Used so that "unknown email" costs the same time as "wrong password".
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 11);

function verifyLogin(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email || '').trim().toLowerCase());
  const ok = bcrypt.compareSync(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  return user && ok ? user : null;
}

function startSession(res, userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 3600;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + maxAge * 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`
  );
}

function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Looks up the logged-in user (if any) and puts it on req.user.
function attachUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
      )
      .get(sha(token), Date.now());
    if (row) req.user = row;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrator access required.' });
  next();
}

// Cross-site forms cannot add custom headers, so requiring one on every
// state-changing request blocks CSRF (on top of SameSite=Lax cookies).
function csrfGuard(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-requested-with') !== 'fetch') {
    return res.status(403).json({ error: 'Invalid request.' });
  }
  next();
}

// Simple in-memory limiter: 10 failed logins per 15 minutes per IP + email.
const attempts = new Map();
function loginThrottle(req, res, next) {
  const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.reset > now && rec.count >= 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  res.on('finish', () => {
    if (res.statusCode === 401) {
      const r = attempts.get(key);
      if (!r || r.reset < Date.now()) attempts.set(key, { count: 1, reset: Date.now() + 15 * 60 * 1000 });
      else r.count += 1;
    } else if (res.statusCode === 200) attempts.delete(key);
  });
  next();
}

module.exports = { hashPassword, verifyLogin, startSession, endSession, attachUser, requireAuth, requireAdmin, csrfGuard, loginThrottle };

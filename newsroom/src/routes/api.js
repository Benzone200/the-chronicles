const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const { db, getSettings, setSetting } = require('../db');
const { hashPassword, verifyLogin, startSession, endSession, attachUser, requireAuth, requireAdmin, csrfGuard, loginThrottle } = require('../auth');
const { uniqueSlug, slugify, cleanBody, textOf } = require('../util');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));
router.use(csrfGuard);
router.use(attachUser);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const PAGE_SIZE = 15;
const nowIso = () => new Date().toISOString();
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/* ---------------------------------------------------------------- auth */

router.post('/auth/login', loginThrottle, (req, res) => {
  const user = verifyLogin(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
  startSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: req.user });
});

router.post('/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(next)), req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ articles */

function stateOf(a) {
  if (a.status !== 'published') return 'draft';
  return a.published_at && a.published_at > nowIso() ? 'scheduled' : 'published';
}

function shape(a, user) {
  return { ...a, featured: !!a.featured, state: stateOf(a), can_edit: !!user && (user.role === 'admin' || a.author_id === user.id) };
}

const LIST_COLS = `a.id, a.title, a.slug, a.summary, a.cover_image, a.category_id, a.author_id, a.status, a.featured, a.views,
  a.published_at, a.created_at, a.updated_at, c.name AS category_name, u.name AS author_name`;
const JOINS = `FROM articles a LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id`;

router.get('/articles', requireAuth, (req, res) => {
  const where = [];
  const params = {};
  const { status, category, q } = req.query;
  if (status === 'draft') where.push(`a.status = 'draft'`);
  if (status === 'published') where.push(`a.status = 'published' AND a.published_at <= @now`);
  if (status === 'scheduled') where.push(`a.status = 'published' AND a.published_at > @now`);
  if (category) {
    where.push('a.category_id = @category');
    params.category = Number(category);
  }
  if (q) {
    where.push('(a.title LIKE @q OR a.summary LIKE @q)');
    params.q = `%${String(q).slice(0, 80)}%`;
  }
  params.now = nowIso();
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n ${JOINS} ${clause}`).get(params).n;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = db
    .prepare(`SELECT ${LIST_COLS} ${JOINS} ${clause} ORDER BY a.updated_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`)
    .all(params)
    .map((a) => shape(a, req.user));
  res.json({ articles: rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/articles/:id', requireAuth, (req, res) => {
  const a = db.prepare(`SELECT a.*, c.name AS category_name, u.name AS author_name ${JOINS} WHERE a.id = ?`).get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Article not found.' });
  res.json({ article: shape(a, req.user) });
});

function validateArticle(input, existing) {
  const title = str(input.title, 200);
  if (!title) return { error: 'A title is required.' };

  const status = input.status === 'published' ? 'published' : 'draft';
  const body = cleanBody(input.body);
  if (status === 'published' && !textOf(body) && !/<img /.test(body)) return { error: 'Add some body text before publishing.' };

  let cover = str(input.cover_image, 500);
  if (cover && !/^(\/uploads\/|\/seed\/|https?:\/\/)/.test(cover)) return { error: 'Invalid cover image.' };

  let categoryId = null;
  if (input.category_id) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(input.category_id));
    if (!cat) return { error: 'That category does not exist.' };
    categoryId = cat.id;
  }

  let publishedAt = existing?.published_at || null;
  if (input.published_at) {
    const d = new Date(input.published_at);
    if (Number.isNaN(d.getTime())) return { error: 'Invalid publish date.' };
    publishedAt = d.toISOString();
  }
  if (status === 'published' && !publishedAt) publishedAt = nowIso();

  return {
    value: {
      title,
      summary: str(input.summary, 400),
      body,
      cover_image: cover,
      cover_caption: str(input.cover_caption, 200),
      category_id: categoryId,
      status,
      featured: input.featured ? 1 : 0,
      published_at: publishedAt,
      slugInput: str(input.slug, 90),
    },
  };
}

router.post('/articles', requireAuth, (req, res) => {
  const v = validateArticle(req.body || {}, null);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = v.value;
  const slug = uniqueSlug(db, 'articles', a.slugInput || a.title);
  const info = db
    .prepare(
      `INSERT INTO articles (title, slug, summary, body, cover_image, cover_caption, category_id, author_id, status, featured, published_at, updated_at)
       VALUES (@title, @slug, @summary, @body, @cover_image, @cover_caption, @category_id, @author_id, @status, @featured, @published_at, @updated_at)`
    )
    .run({ ...a, slug, author_id: req.user.id, updated_at: nowIso() });
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ article: shape(row, req.user) });
});

function loadForEdit(req, res) {
  const existing = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Article not found.' });
    return null;
  }
  if (req.user.role !== 'admin' && existing.author_id !== req.user.id) {
    res.status(403).json({ error: 'You can only edit your own articles.' });
    return null;
  }
  return existing;
}

router.put('/articles/:id', requireAuth, (req, res) => {
  const existing = loadForEdit(req, res);
  if (!existing) return;
  const v = validateArticle(req.body || {}, existing);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = v.value;
  const slug = uniqueSlug(db, 'articles', a.slugInput || existing.slug, existing.id);
  db.prepare(
    `UPDATE articles SET title=@title, slug=@slug, summary=@summary, body=@body, cover_image=@cover_image, cover_caption=@cover_caption,
       category_id=@category_id, status=@status, featured=@featured, published_at=@published_at, updated_at=@updated_at WHERE id=@id`
  ).run({ ...a, slug, id: existing.id, updated_at: nowIso() });
  const row = db.prepare('SELECT * FROM articles WHERE id = ?').get(existing.id);
  res.json({ article: shape(row, req.user) });
});

// Quick actions from the article list: publish / unpublish / feature.
router.patch('/articles/:id', requireAuth, (req, res) => {
  const existing = loadForEdit(req, res);
  if (!existing) return;
  let { status, featured, published_at } = existing;
  if (req.body?.status === 'published') {
    if (!textOf(existing.body) && !/<img /.test(existing.body)) return res.status(400).json({ error: 'Add some body text before publishing.' });
    status = 'published';
    published_at = published_at && published_at <= nowIso() ? published_at : nowIso();
  } else if (req.body?.status === 'draft') status = 'draft';
  if (typeof req.body?.featured === 'boolean') featured = req.body.featured ? 1 : 0;
  db.prepare('UPDATE articles SET status=?, featured=?, published_at=?, updated_at=? WHERE id=?').run(status, featured, published_at, nowIso(), existing.id);
  res.json({ article: shape(db.prepare('SELECT * FROM articles WHERE id = ?').get(existing.id), req.user) });
});

router.delete('/articles/:id', requireAuth, (req, res) => {
  const existing = loadForEdit(req, res);
  if (!existing) return;
  db.prepare('DELETE FROM articles WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------- categories */

router.get('/categories', requireAuth, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS article_count
       FROM categories c ORDER BY c.sort_order, c.name`
    )
    .all();
  res.json({ categories: rows });
});

function categoryInput(body, id = null) {
  const name = str(body?.name, 40);
  if (!name) return { error: 'A name is required.' };
  const dupe = db.prepare('SELECT id FROM categories WHERE lower(name) = lower(?)').get(name);
  if (dupe && dupe.id !== id) return { error: 'A category with that name already exists.' };
  return { name, description: str(body?.description, 200), sort_order: parseInt(body?.sort_order, 10) || 0 };
}

router.post('/categories', requireAdmin, (req, res) => {
  const v = categoryInput(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const slug = uniqueSlug(db, 'categories', v.name);
  const info = db.prepare('INSERT INTO categories (name, slug, description, sort_order) VALUES (?,?,?,?)').run(v.name, slug, v.description, v.sort_order);
  res.status(201).json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid) });
});

router.put('/categories/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  const v = categoryInput(req.body, existing.id);
  if (v.error) return res.status(400).json({ error: v.error });
  const slug = v.name === existing.name ? existing.slug : uniqueSlug(db, 'categories', v.name, existing.id);
  db.prepare('UPDATE categories SET name=?, slug=?, description=?, sort_order=? WHERE id=?').run(v.name, slug, v.description, v.sort_order, existing.id);
  res.json({ category: db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id) });
});

router.delete('/categories/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Category not found.' });
  res.json({ ok: true });
});

/* --------------------------------------------------------------- users */

const userCols = 'id, name, email, role, active, created_at';

function activeAdminCount(excludeId) {
  return db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id != ?`).get(excludeId ?? -1).n;
}

router.get('/users', requireAdmin, (_req, res) => {
  res.json({ users: db.prepare(`SELECT ${userCols}, (SELECT COUNT(*) FROM articles a WHERE a.author_id = users.id) AS article_count FROM users ORDER BY created_at`).all() });
});

router.post('/users', requireAdmin, (req, res) => {
  const name = str(req.body?.name, 80);
  const email = str(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'editor';
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return res.status(400).json({ error: 'That email is already in use.' });
  const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run(name, email, hashPassword(password), role);
  res.status(201).json({ user: db.prepare(`SELECT ${userCols} FROM users WHERE id = ?`).get(info.lastInsertRowid) });
});

router.put('/users/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const name = str(req.body?.name ?? existing.name, 80);
  const email = str(req.body?.email ?? existing.email, 120).toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'editor';
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const dupe = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (dupe && dupe.id !== existing.id) return res.status(400).json({ error: 'That email is already in use.' });
  if ((role !== 'admin' || !active) && existing.role === 'admin' && activeAdminCount(existing.id) === 0) {
    return res.status(400).json({ error: 'There must be at least one active administrator.' });
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), existing.id);
  }
  db.prepare('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?').run(name, email, role, active, existing.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  res.json({ user: db.prepare(`SELECT ${userCols} FROM users WHERE id = ?`).get(existing.id) });
});

router.delete('/users/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (existing.role === 'admin' && activeAdminCount(existing.id) === 0) return res.status(400).json({ error: 'There must be at least one active administrator.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ settings */

router.get('/settings', requireAuth, (_req, res) => res.json({ settings: getSettings() }));

router.put('/settings', requireAdmin, (req, res) => {
  const name = str(req.body?.site_name, 60);
  if (!name) return res.status(400).json({ error: 'Site name is required.' });
  setSetting('site_name', name);
  setSetting('tagline', str(req.body?.tagline, 120));
  setSetting('footer_text', str(req.body?.footer_text, 200));
  res.json({ settings: getSettings() });
});

/* ----------------------------------------------------------- dashboard */

router.get('/stats', requireAuth, (req, res) => {
  const now = nowIso();
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;
  const recent = db.prepare(`SELECT ${LIST_COLS} ${JOINS} ORDER BY a.updated_at DESC LIMIT 6`).all().map((a) => shape(a, req.user));
  const top = db
    .prepare(`SELECT ${LIST_COLS} ${JOINS} WHERE a.status='published' AND a.published_at <= ? ORDER BY a.views DESC LIMIT 5`)
    .all(now)
    .map((a) => shape(a, req.user));
  res.json({
    totals: {
      articles: count('SELECT COUNT(*) n FROM articles'),
      published: count(`SELECT COUNT(*) n FROM articles WHERE status='published' AND published_at <= ?`, now),
      scheduled: count(`SELECT COUNT(*) n FROM articles WHERE status='published' AND published_at > ?`, now),
      drafts: count(`SELECT COUNT(*) n FROM articles WHERE status='draft'`),
      views: count('SELECT COALESCE(SUM(views),0) n FROM articles'),
    },
    recent,
    top,
  });
});

/* -------------------------------------------------------------- upload */

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(EXT[file.mimetype] ? null : new Error('Only JPG, PNG, WebP or GIF images are allowed.'), !!EXT[file.mimetype]),
});

function looksLikeImage(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  return (
    hex.startsWith('ffd8ff') ||
    hex.startsWith('89504e47') ||
    buf.toString('ascii', 0, 4) === 'GIF8' ||
    (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
  );
}

router.post('/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'No file received.' });
    if (!looksLikeImage(req.file.path)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'That file is not a valid image.' });
    }
    res.status(201).json({ url: `/uploads/${req.file.filename}` });
  });
});

router.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
router.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong on the server.' });
});

module.exports = router;

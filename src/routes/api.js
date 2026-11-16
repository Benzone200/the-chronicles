const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const { db, getSettings, setSetting } = require('../db');
const { hashPassword, verifyLogin, startSession, endSession, attachUser, requireAuth, requireAdmin, csrfGuard, loginThrottle } = require('../auth');
const { uniqueSlug, cleanBody, textOf } = require('../util');
const { saveImage, looksLikeImage } = require('../storage');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));
router.use(csrfGuard);
router.use(attachUser);

const PAGE_SIZE = 15;
const nowIso = () => new Date().toISOString();
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const one = (sql, ...args) => db.prepare(sql).get(...args);
const many = (sql, ...args) => db.prepare(sql).all(...args);
const exec = (sql, ...args) => db.prepare(sql).run(...args);

/* ---------------------------------------------------------------- auth */

router.post('/auth/login', loginThrottle, async (req, res) => {
  const user = await verifyLogin(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: 'Incorrect email or password.' });
  await startSession(res, user.id);
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.post('/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
  res.json({ user: req.user });
});

router.post('/auth/password', requireAuth, async (req, res) => {
  const { current, next } = req.body || {};
  const row = await one('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  await exec('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(next)), req.user.id);
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

router.get('/articles', requireAuth, async (req, res) => {
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
  const total = (await one(`SELECT COUNT(*) n ${JOINS} ${clause}`, params)).n;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const rows = (await many(`SELECT ${LIST_COLS} ${JOINS} ${clause} ORDER BY a.updated_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params)).map((a) =>
    shape(a, req.user)
  );
  res.json({ articles: rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

router.get('/articles/:id', requireAuth, async (req, res) => {
  const a = await one(`SELECT a.*, c.name AS category_name, u.name AS author_name ${JOINS} WHERE a.id = ?`, req.params.id);
  if (!a) return res.status(404).json({ error: 'Article not found.' });
  res.json({ article: shape(a, req.user) });
});

async function validateArticle(input, existing) {
  const title = str(input.title, 200);
  if (!title) return { error: 'A title is required.' };

  const status = input.status === 'published' ? 'published' : 'draft';
  const body = cleanBody(input.body);
  if (status === 'published' && !textOf(body) && !/<img /.test(body)) return { error: 'Add some body text before publishing.' };

  const cover = str(input.cover_image, 500);
  if (cover && !/^(\/uploads\/|\/seed\/|https?:\/\/)/.test(cover)) return { error: 'Invalid cover image.' };

  let categoryId = null;
  if (input.category_id) {
    const cat = await one('SELECT id FROM categories WHERE id = ?', Number(input.category_id));
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

router.post('/articles', requireAuth, async (req, res) => {
  const v = await validateArticle(req.body || {}, null);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = v.value;
  const slug = await uniqueSlug(db, 'articles', a.slugInput || a.title);
  const info = await exec(
    `INSERT INTO articles (title, slug, summary, body, cover_image, cover_caption, category_id, author_id, status, featured, published_at, updated_at)
     VALUES (@title, @slug, @summary, @body, @cover_image, @cover_caption, @category_id, @author_id, @status, @featured, @published_at, @updated_at)`,
    { ...a, slug, author_id: req.user.id, updated_at: nowIso() }
  );
  const row = await one('SELECT * FROM articles WHERE id = ?', info.lastInsertRowid);
  res.status(201).json({ article: shape(row, req.user) });
});

async function loadForEdit(req, res) {
  const existing = await one('SELECT * FROM articles WHERE id = ?', req.params.id);
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

router.put('/articles/:id', requireAuth, async (req, res) => {
  const existing = await loadForEdit(req, res);
  if (!existing) return;
  const v = await validateArticle(req.body || {}, existing);
  if (v.error) return res.status(400).json({ error: v.error });
  const a = v.value;
  const slug = await uniqueSlug(db, 'articles', a.slugInput || existing.slug, existing.id);
  await exec(
    `UPDATE articles SET title=@title, slug=@slug, summary=@summary, body=@body, cover_image=@cover_image, cover_caption=@cover_caption,
       category_id=@category_id, status=@status, featured=@featured, published_at=@published_at, updated_at=@updated_at WHERE id=@id`,
    { ...a, slug, id: existing.id, updated_at: nowIso() }
  );
  const row = await one('SELECT * FROM articles WHERE id = ?', existing.id);
  res.json({ article: shape(row, req.user) });
});

// Quick actions from the article list: publish / unpublish / feature.
router.patch('/articles/:id', requireAuth, async (req, res) => {
  const existing = await loadForEdit(req, res);
  if (!existing) return;
  let { status, featured, published_at } = existing;
  if (req.body?.status === 'published') {
    if (!textOf(existing.body) && !/<img /.test(existing.body)) return res.status(400).json({ error: 'Add some body text before publishing.' });
    status = 'published';
    published_at = published_at && published_at <= nowIso() ? published_at : nowIso();
  } else if (req.body?.status === 'draft') status = 'draft';
  if (typeof req.body?.featured === 'boolean') featured = req.body.featured ? 1 : 0;
  await exec('UPDATE articles SET status=?, featured=?, published_at=?, updated_at=? WHERE id=?', status, featured, published_at, nowIso(), existing.id);
  res.json({ article: shape(await one('SELECT * FROM articles WHERE id = ?', existing.id), req.user) });
});

router.delete('/articles/:id', requireAuth, async (req, res) => {
  const existing = await loadForEdit(req, res);
  if (!existing) return;
  await exec('DELETE FROM articles WHERE id = ?', existing.id);
  res.json({ ok: true });
});

/* ---------------------------------------------------------- categories */

router.get('/categories', requireAuth, async (_req, res) => {
  const rows = await many(
    `SELECT c.*, (SELECT COUNT(*) FROM articles a WHERE a.category_id = c.id) AS article_count
     FROM categories c ORDER BY c.sort_order, c.name`
  );
  res.json({ categories: rows });
});

async function categoryInput(body, id = null) {
  const name = str(body?.name, 40);
  if (!name) return { error: 'A name is required.' };
  const dupe = await one('SELECT id FROM categories WHERE lower(name) = lower(?)', name);
  if (dupe && dupe.id !== id) return { error: 'A category with that name already exists.' };
  return { name, description: str(body?.description, 200), sort_order: parseInt(body?.sort_order, 10) || 0 };
}

router.post('/categories', requireAdmin, async (req, res) => {
  const v = await categoryInput(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const slug = await uniqueSlug(db, 'categories', v.name);
  const info = await exec('INSERT INTO categories (name, slug, description, sort_order) VALUES (?,?,?,?)', v.name, slug, v.description, v.sort_order);
  res.status(201).json({ category: await one('SELECT * FROM categories WHERE id = ?', info.lastInsertRowid) });
});

router.put('/categories/:id', requireAdmin, async (req, res) => {
  const existing = await one('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  const v = await categoryInput(req.body, existing.id);
  if (v.error) return res.status(400).json({ error: v.error });
  const slug = v.name === existing.name ? existing.slug : await uniqueSlug(db, 'categories', v.name, existing.id);
  await exec('UPDATE categories SET name=?, slug=?, description=?, sort_order=? WHERE id=?', v.name, slug, v.description, v.sort_order, existing.id);
  res.json({ category: await one('SELECT * FROM categories WHERE id = ?', existing.id) });
});

router.delete('/categories/:id', requireAdmin, async (req, res) => {
  const existing = await one('SELECT id FROM categories WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  await exec('UPDATE articles SET category_id = NULL WHERE category_id = ?', existing.id);
  await exec('DELETE FROM categories WHERE id = ?', existing.id);
  res.json({ ok: true });
});

/* --------------------------------------------------------------- users */

const userCols = 'id, name, email, role, active, created_at';

async function activeAdminCount(excludeId) {
  return (await one(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1 AND id != ?`, excludeId ?? -1)).n;
}

router.get('/users', requireAdmin, async (_req, res) => {
  res.json({
    users: await many(`SELECT ${userCols}, (SELECT COUNT(*) FROM articles a WHERE a.author_id = users.id) AS article_count FROM users ORDER BY created_at`),
  });
});

router.post('/users', requireAdmin, async (req, res) => {
  const name = str(req.body?.name, 80);
  const email = str(req.body?.email, 120).toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'admin' ? 'admin' : 'editor';
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (await one('SELECT id FROM users WHERE email = ?', email)) return res.status(400).json({ error: 'That email is already in use.' });
  const info = await exec('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', name, email, hashPassword(password), role);
  res.status(201).json({ user: await one(`SELECT ${userCols} FROM users WHERE id = ?`, info.lastInsertRowid) });
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const existing = await one('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  const name = str(req.body?.name ?? existing.name, 80);
  const email = str(req.body?.email ?? existing.email, 120).toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'editor';
  const active = req.body?.active === false || req.body?.active === 0 ? 0 : 1;
  if (!name) return res.status(400).json({ error: 'A name is required.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const dupe = await one('SELECT id FROM users WHERE email = ?', email);
  if (dupe && dupe.id !== existing.id) return res.status(400).json({ error: 'That email is already in use.' });
  if ((role !== 'admin' || !active) && existing.role === 'admin' && (await activeAdminCount(existing.id)) === 0) {
    return res.status(400).json({ error: 'There must be at least one active administrator.' });
  }
  if (req.body?.password) {
    if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    await exec('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(req.body.password)), existing.id);
  }
  await exec('UPDATE users SET name=?, email=?, role=?, active=? WHERE id=?', name, email, role, active, existing.id);
  if (!active) await exec('DELETE FROM sessions WHERE user_id = ?', existing.id);
  res.json({ user: await one(`SELECT ${userCols} FROM users WHERE id = ?`, existing.id) });
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  const existing = await one('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  if (existing.role === 'admin' && (await activeAdminCount(existing.id)) === 0) return res.status(400).json({ error: 'There must be at least one active administrator.' });
  await exec('UPDATE articles SET author_id = NULL WHERE author_id = ?', existing.id);
  await exec('DELETE FROM sessions WHERE user_id = ?', existing.id);
  await exec('DELETE FROM users WHERE id = ?', existing.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ settings */

router.get('/settings', requireAuth, async (_req, res) => res.json({ settings: await getSettings() }));

router.put('/settings', requireAdmin, async (req, res) => {
  const name = str(req.body?.site_name, 60);
  if (!name) return res.status(400).json({ error: 'Site name is required.' });
  await setSetting('site_name', name);
  await setSetting('tagline', str(req.body?.tagline, 120));
  await setSetting('footer_text', str(req.body?.footer_text, 200));
  res.json({ settings: await getSettings() });
});

/* ----------------------------------------------------------- dashboard */

router.get('/stats', requireAuth, async (req, res) => {
  const now = nowIso();
  const count = async (sql, ...p) => (await one(sql, ...p)).n;
  const recent = (await many(`SELECT ${LIST_COLS} ${JOINS} ORDER BY a.updated_at DESC LIMIT 6`)).map((a) => shape(a, req.user));
  const top = (await many(`SELECT ${LIST_COLS} ${JOINS} WHERE a.status='published' AND a.published_at <= ? ORDER BY a.views DESC LIMIT 5`, now)).map((a) =>
    shape(a, req.user)
  );
  res.json({
    totals: {
      articles: await count('SELECT COUNT(*) n FROM articles'),
      published: await count(`SELECT COUNT(*) n FROM articles WHERE status='published' AND published_at <= ?`, now),
      scheduled: await count(`SELECT COUNT(*) n FROM articles WHERE status='published' AND published_at > ?`, now),
      drafts: await count(`SELECT COUNT(*) n FROM articles WHERE status='draft'`),
      views: await count('SELECT COALESCE(SUM(views),0) n FROM articles'),
    },
    recent,
    top,
  });
});

/* -------------------------------------------------------------- upload */

// Vercel functions accept request bodies up to 4.5 MB, so images are capped at 4 MB.
const MAX_BYTES = 4 * 1024 * 1024;
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => cb(EXT[file.mimetype] ? null : new Error('Only JPG, PNG, WebP or GIF images are allowed.'), !!EXT[file.mimetype]),
});

router.post('/upload', requireAuth, (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 4 MB or smaller.' : err.message });
      if (!req.file) return res.status(400).json({ error: 'No file received.' });
      if (!looksLikeImage(req.file.buffer)) return res.status(400).json({ error: 'That file is not a valid image.' });
      const url = await saveImage(req.file.buffer, EXT[req.file.mimetype], req.file.mimetype);
      res.status(201).json({ url });
    } catch (e) {
      next(e);
    }
  });
});

router.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
router.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong on the server.' });
});

module.exports = router;

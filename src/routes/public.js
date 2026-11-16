const express = require('express');
const { db, getSettings } = require('../db');
const { attachUser } = require('../auth');
const { esc, excerpt } = require('../util');
const views = require('../views');

const router = express.Router();
router.use(attachUser);

const SELECT = `SELECT a.*, c.name AS category_name, c.slug AS category_slug, u.name AS author_name
  FROM articles a LEFT JOIN categories c ON c.id = a.category_id LEFT JOIN users u ON u.id = a.author_id`;
const LIVE = `a.status = 'published' AND a.published_at <= @now`;
const PAGE_SIZE = 10;

const nowIso = () => new Date().toISOString();
const categories = () => db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
const page = (req) => Math.max(1, parseInt(req.query.page, 10) || 1);

async function render(req, res, opts) {
  const [settings, cats] = await Promise.all([getSettings(), categories()]);
  res.type('html').send(views.layout({ settings, categories: cats, user: req.user, ...opts }));
}

function absolute(req, p) {
  return p && p.startsWith('/') ? `${req.protocol}://${req.get('host')}${p}` : p;
}

router.get('/', async (req, res) => {
  const rows = await db.prepare(`${SELECT} WHERE ${LIVE} ORDER BY a.published_at DESC LIMIT 60`).all({ now: nowIso() });
  const lead = rows.find((a) => a.featured) || rows[0];
  const rest = rows.filter((a) => a !== lead);
  const latest = rest.slice(0, 3);
  const more = rest.slice(3, 8);
  const popular = await db.prepare(`${SELECT} WHERE ${LIVE} ORDER BY a.views DESC, a.published_at DESC LIMIT 5`).all({ now: nowIso() });

  const shown = new Set([lead, ...latest, ...more].filter(Boolean).map((a) => a.id));
  const sections = (await categories())
    .map((category) => ({ category, articles: rest.filter((a) => a.category_id === category.id && !shown.has(a.id)).slice(0, 3) }))
    .filter((s) => s.articles.length);

  await render(req, res, { body: views.home({ lead, latest, more, popular, sections }) });
});

router.get('/category/:slug', async (req, res, next) => {
  const cat = await db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!cat) return next();
  const p = page(req);
  const total = (await db.prepare(`SELECT COUNT(*) n FROM articles a WHERE ${LIVE} AND a.category_id = @cid`).get({ now: nowIso(), cid: cat.id })).n;
  const articles = await db
    .prepare(`${SELECT} WHERE ${LIVE} AND a.category_id = @cid ORDER BY a.published_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(p - 1) * PAGE_SIZE}`)
    .all({ now: nowIso(), cid: cat.id });
  await render(req, res, {
    title: cat.name,
    description: cat.description,
    active: cat.slug,
    body: views.listing({
      heading: cat.name,
      sub: cat.description,
      articles,
      base: `/category/${cat.slug}`,
      page: p,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      emptyMessage: 'Nothing has been published in this section yet.',
    }),
  });
});

// Counts one view per visitor per article every 30 minutes, so refreshing does not inflate numbers.
const seen = new Map();
async function countView(req, id) {
  const key = `${req.ip}|${id}`;
  const last = seen.get(key) || 0;
  if (Date.now() - last < 30 * 60 * 1000) return;
  seen.set(key, Date.now());
  if (seen.size > 5000) for (const [k, t] of seen) if (Date.now() - t > 30 * 60 * 1000) seen.delete(k);
  await db.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').run(id);
}

router.get('/article/:slug', async (req, res, next) => {
  const a = await db.prepare(`${SELECT} WHERE a.slug = ?`).get(req.params.slug);
  if (!a) return next();
  const live = a.status === 'published' && a.published_at <= nowIso();
  if (!live && !req.user) return next();
  if (live && !req.user) await countView(req, a.id).catch(() => {});

  let related = a.category_id
    ? await db.prepare(`${SELECT} WHERE ${LIVE} AND a.category_id = @cid AND a.id != @id ORDER BY a.published_at DESC LIMIT 3`).all({ now: nowIso(), cid: a.category_id, id: a.id })
    : [];
  if (related.length < 3) {
    const ids = [a.id, ...related.map((r) => r.id)];
    related = related.concat(
      await db.prepare(`${SELECT} WHERE ${LIVE} AND a.id NOT IN (${ids.join(',')}) ORDER BY a.published_at DESC LIMIT ${3 - related.length}`).all({ now: nowIso() })
    );
  }

  await render(req, res, {
    title: a.title,
    description: excerpt(a, 160),
    image: absolute(req, a.cover_image),
    type: 'article',
    active: a.category_slug || '',
    noindex: !live,
    body: views.article({ a, related, preview: !live }),
  });
});

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const p = page(req);
  let articles = [];
  let total = 0;
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    const where = `${LIVE} AND (a.title LIKE @like ESCAPE '\\' OR a.summary LIKE @like ESCAPE '\\' OR a.body LIKE @like ESCAPE '\\')`;
    total = (await db.prepare(`SELECT COUNT(*) n FROM articles a WHERE ${where}`).get({ now: nowIso(), like })).n;
    articles = await db.prepare(`${SELECT} WHERE ${where} ORDER BY a.published_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(p - 1) * PAGE_SIZE}`).all({ now: nowIso(), like });
  }
  await render(req, res, {
    title: q ? `Search: ${q}` : 'Search',
    q,
    noindex: true,
    body: views.searchPage({ q, articles, total, base: `/search?q=${encodeURIComponent(q)}`, page: p, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) }),
  });
});

router.get('/rss.xml', async (req, res) => {
  const s = await getSettings();
  const origin = `${req.protocol}://${req.get('host')}`;
  const rows = await db.prepare(`${SELECT} WHERE ${LIVE} ORDER BY a.published_at DESC LIMIT 20`).all({ now: nowIso() });
  const items = rows
    .map(
      (a) => `<item><title>${esc(a.title)}</title><link>${origin}/article/${esc(a.slug)}</link><guid isPermaLink="true">${origin}/article/${esc(a.slug)}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate>${a.category_name ? `<category>${esc(a.category_name)}</category>` : ''}<description>${esc(excerpt(a, 300))}</description></item>`
    )
    .join('');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(s.site_name)}</title><link>${origin}</link><description>${esc(s.tagline)}</description>${items}</channel></rss>`);
});

router.get('/sitemap.xml', async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const rows = await db.prepare(`SELECT slug, updated_at FROM articles a WHERE ${LIVE} ORDER BY published_at DESC`).all({ now: nowIso() });
  const cats = await categories();
  const urls = [`<url><loc>${origin}/</loc></url>`]
    .concat(cats.map((c) => `<url><loc>${origin}/category/${esc(c.slug)}</loc></url>`))
    .concat(rows.map((a) => `<url><loc>${origin}/article/${esc(a.slug)}</loc><lastmod>${a.updated_at.slice(0, 10)}</lastmod></url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
});

module.exports = router;

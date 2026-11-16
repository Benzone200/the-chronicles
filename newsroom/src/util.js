const sanitizeHtml = require('sanitize-html');

const SITE_TZ = process.env.SITE_TZ || 'Africa/Lagos';

function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'untitled'
  );
}

// `table` is always a hard-coded constant from our own code, never user input.
function uniqueSlug(db, table, base, excludeId = null) {
  const root = slugify(base);
  const q = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`);
  let slug = root;
  let n = 1;
  for (;;) {
    const row = q.get(slug);
    if (!row || row.id === excludeId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Article bodies are written in a rich-text editor. Whatever the browser sends is
// reduced to a small whitelist of tags before it is stored.
function cleanBody(html) {
  return sanitizeHtml(html || '', {
    allowedTags: ['p', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'blockquote', 'img', 'figure', 'figcaption', 'br', 'hr'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      div: 'p',
      b: 'strong',
      i: 'em',
      a: (tagName, attribs) => ({
        tagName: 'a',
        attribs: { href: attribs.href || '#', target: '_blank', rel: 'noopener noreferrer' },
      }),
    },
  });
}

function textOf(html) {
  return sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function readingTime(html) {
  const words = textOf(html).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}

function excerpt(a, max = 180) {
  const src = a.summary || textOf(a.body);
  return src.length > max ? src.slice(0, max).replace(/\s+\S*$/, '') + '…' : src;
}

function fmtDate(iso, opts) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { timeZone: SITE_TZ, day: 'numeric', month: 'short', year: 'numeric', ...opts }).format(d);
}

module.exports = { slugify, uniqueSlug, esc, cleanBody, textOf, readingTime, excerpt, fmtDate };

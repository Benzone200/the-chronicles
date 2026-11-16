const { esc, fmtDate, excerpt, readingTime } = require('./util');

const SEARCH_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>`;

function layout({ settings, categories, title, description, image, path = '/', active = '', body, q = '', type = 'website', noindex = false, user = null }) {
  const site = settings.site_name;
  const fullTitle = title ? `${title} — ${site}` : `${site} — ${settings.tagline}`;
  const desc = description || settings.tagline;
  const nav = categories
    .map((c) => `<a href="/category/${esc(c.slug)}"${active === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`)
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:site_name" content="${esc(site)}">
<meta property="og:title" content="${esc(title || site)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="${type}">
${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<link rel="alternate" type="application/rss+xml" title="${esc(site)}" href="/rss.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap bar">
    <a class="brand" href="/">${esc(site)}</a>
    <nav class="nav" id="nav" aria-label="Sections">${nav}</nav>
    <form class="search" action="/search" role="search">
      <input type="search" name="q" value="${esc(q)}" placeholder="Search" aria-label="Search stories">
      <button type="submit" aria-label="Search">${SEARCH_ICON}</button>
    </form>
    <a class="btn sm signin" href="/admin/">${user ? 'Dashboard' : 'Staff sign in'}</a>
    <button class="menu-toggle" type="button" aria-controls="nav" aria-expanded="false" aria-label="Menu"><span></span><span></span></button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="foot-top">
      <div>
        <div class="foot-brand">${esc(site)}</div>
        <p>${esc(settings.tagline)}</p>
      </div>
      <nav aria-label="Footer">
        <h3>Sections</h3>
        ${categories.map((c) => `<a href="/category/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}
      </nav>
      <nav aria-label="More">
        <h3>More</h3>
        <a href="/search">Search</a>
        <a href="/rss.xml">RSS feed</a>
        <a href="/admin/">Staff sign in</a>
      </nav>
    </div>
    <div class="foot-bottom">© ${new Date().getFullYear()} ${esc(site)}. ${esc(settings.footer_text)}</div>
  </div>
</footer>
<script src="/js/site.js" defer></script>
</body>
</html>`;
}

const eyebrow = (a) => (a.category_name ? `<a class="eyebrow" href="/category/${esc(a.category_slug)}">${esc(a.category_name)}</a>` : '');
const meta = (a) => `<div class="meta">${a.author_name ? `<span>${esc(a.author_name)}</span>` : ''}<time datetime="${esc(a.published_at)}">${fmtDate(a.published_at)}</time></div>`;

function media(a, ratio = 'r32') {
  return a.cover_image ? `<a class="media ${ratio}" href="/article/${esc(a.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(a.cover_image)}" alt="" loading="lazy"></a>` : '';
}

function card(a) {
  return `<article class="card${a.cover_image ? '' : ' no-media'}">
  ${media(a)}
  ${eyebrow(a)}
  <h3><a href="/article/${esc(a.slug)}">${esc(a.title)}</a></h3>
  <p>${esc(excerpt(a, 130))}</p>
  ${meta(a)}
</article>`;
}

function rowItem(a) {
  return `<article class="row-item">
  <div class="row-text">
    ${eyebrow(a)}
    <h3><a href="/article/${esc(a.slug)}">${esc(a.title)}</a></h3>
    <p>${esc(excerpt(a, 150))}</p>
    ${meta(a)}
  </div>
  ${media(a, 'r43')}
</article>`;
}

function empty(message) {
  return `<div class="empty"><p>${esc(message)}</p></div>`;
}

function home({ lead, latest, more, popular, sections }) {
  if (!lead) {
    return `<div class="wrap">${empty('No stories have been published yet.')}</div>`;
  }
  return `
<section class="hero wrap">
  <div class="hero-text">
    ${eyebrow(lead)}
    <h1><a href="/article/${esc(lead.slug)}">${esc(lead.title)}</a></h1>
    <p class="lede">${esc(excerpt(lead, 240))}</p>
    ${meta(lead)}
    <a class="btn" href="/article/${esc(lead.slug)}">Read the story</a>
  </div>
  ${lead.cover_image ? `<a class="hero-media" href="/article/${esc(lead.slug)}" tabindex="-1" aria-hidden="true"><img src="${esc(lead.cover_image)}" alt=""></a>` : ''}
</section>

${latest.length ? `<section class="wrap block"><div class="block-head"><h2>Latest</h2></div><div class="grid-3">${latest.map(card).join('')}</div></section>` : ''}

${more.length || popular.length ? `<section class="wrap block split">
  <div>
    <div class="block-head"><h2>More stories</h2></div>
    ${more.map(rowItem).join('')}
  </div>
  <aside aria-label="Most read">
    <div class="block-head"><h2>Most read</h2></div>
    <ol class="popular">
      ${popular.map((a) => `<li><a href="/article/${esc(a.slug)}">${esc(a.title)}</a><span>${esc(a.category_name || '')}</span></li>`).join('')}
    </ol>
  </aside>
</section>` : ''}

${sections
  .map(
    (s) => `<section class="wrap block"><div class="block-head"><h2>${esc(s.category.name)}</h2><a class="more" href="/category/${esc(s.category.slug)}">All ${esc(s.category.name)} →</a></div>
  <div class="grid-3 compact">${s.articles.map(card).join('')}</div></section>`
  )
  .join('')}`;
}

function pager(base, page, pages) {
  if (pages <= 1) return '';
  const join = base.includes('?') ? '&' : '?';
  const link = (p, label, cls = '') => `<a class="${cls}" href="${base}${join}page=${p}">${label}</a>`;
  return `<nav class="pager" aria-label="Pagination">
  ${page > 1 ? link(page - 1, '← Newer') : '<span></span>'}
  <span class="count">Page ${page} of ${pages}</span>
  ${page < pages ? link(page + 1, 'Older →') : '<span></span>'}
</nav>`;
}

function listing({ heading, sub, articles, base, page, pages, emptyMessage }) {
  return `<section class="wrap page-head"><h1>${esc(heading)}</h1>${sub ? `<p class="lede">${esc(sub)}</p>` : ''}</section>
<section class="wrap block tight">
  ${articles.length ? `<div class="list">${articles.map(rowItem).join('')}</div>${pager(base, page, pages)}` : empty(emptyMessage)}
</section>`;
}

function article({ a, related, preview }) {
  return `
${preview ? `<div class="preview-bar">Preview — this story is ${a.status === 'draft' ? 'a draft' : 'scheduled'} and not visible to the public.</div>` : ''}
<article class="story">
  <header class="wrap-narrow story-head">
    ${eyebrow(a)}
    <h1>${esc(a.title)}</h1>
    ${a.summary ? `<p class="lede">${esc(a.summary)}</p>` : ''}
    <div class="byline">
      ${a.author_name ? `<span>By <strong>${esc(a.author_name)}</strong></span>` : ''}
      ${a.published_at ? `<time datetime="${esc(a.published_at)}">${fmtDate(a.published_at, { weekday: 'long' })}</time>` : ''}
      <span>${readingTime(a.body)} min read</span>
    </div>
  </header>
  ${a.cover_image ? `<figure class="wrap story-cover"><img src="${esc(a.cover_image)}" alt="">${a.cover_caption ? `<figcaption>${esc(a.cover_caption)}</figcaption>` : ''}</figure>` : ''}
  <div class="wrap-narrow prose">${a.body}</div>
  <div class="wrap-narrow story-foot"><button class="btn ghost" type="button" data-copy-link>Copy link</button></div>
</article>
${related.length ? `<section class="wrap block"><div class="block-head"><h2>Keep reading</h2></div><div class="grid-3">${related.map(card).join('')}</div></section>` : ''}`;
}

function searchPage({ q, articles, total, base, page, pages }) {
  return `<section class="wrap page-head">
  <h1>Search</h1>
  <form class="search-big" action="/search" role="search"><input type="search" name="q" value="${esc(q)}" placeholder="Search stories" aria-label="Search stories" autofocus><button class="btn" type="submit">Search</button></form>
  ${q ? `<p class="sub">${total} result${total === 1 ? '' : 's'} for “${esc(q)}”</p>` : ''}
</section>
<section class="wrap block tight">
  ${q ? (articles.length ? `<div class="list">${articles.map(rowItem).join('')}</div>${pager(base, page, pages)}` : empty('No stories matched your search.')) : ''}
</section>`;
}

function notFound() {
  return `<section class="wrap page-head not-found"><p class="eyebrow">404</p><h1>That page could not be found.</h1><p class="lede">It may have been moved, unpublished or never existed.</p><a class="btn" href="/">Back to the front page</a></section>`;
}

module.exports = { layout, home, listing, article, searchPage, notFound };

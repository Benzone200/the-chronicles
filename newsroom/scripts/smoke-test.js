/*
 * End-to-end check of the API and public pages against a throwaway database.
 *   npm test
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'newsroom-')), 'test.db');
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'AdminPass123!';

const app = require('../server');

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, url, body, extra = {}) => {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { 'X-Requested-With': 'fetch', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
  let passed = 0;
  const ok = (name, fn) => { fn(); passed++; console.log('  ✓', name); };

  try {
    let r = await call('GET', '/api/articles');
    ok('API rejects anonymous users', () => assert.strictEqual(r.status, 401));

    r = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'wrong' });
    ok('login rejects a wrong password', () => assert.strictEqual(r.status, 401));

    r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok('state-changing requests without the CSRF header are refused', () => assert.strictEqual(r.status, 403));

    r = await call('POST', '/api/auth/login', { email: 'admin@test.local', password: 'AdminPass123!' });
    ok('admin can sign in', () => assert.strictEqual(r.status, 200));

    r = await call('POST', '/api/categories', { name: 'Testing' });
    ok('admin can create a category', () => assert.strictEqual(r.status, 201));
    const catId = r.json.category.id;

    r = await call('POST', '/api/articles', {
      title: 'Hello <World>', status: 'published', category_id: catId, summary: 'Short summary',
      body: '<p>Body text <script>alert(1)</script><b>bold</b> <a href="javascript:alert(1)">bad</a> <img src="x" onerror="alert(1)"></p>',
    });
    ok('admin can publish an article', () => assert.strictEqual(r.status, 201));
    const art = r.json.article;
    ok('body is sanitised', () => {
      assert(!/script|onerror|javascript:/i.test(art.body), art.body);
      assert(art.body.includes('<strong>bold</strong>'));
    });

    r = await call('GET', `/article/${art.slug}`);
    ok('published article is public and HTML-escaped', () => {
      assert.strictEqual(r.status, 200);
      assert(r.text.includes('Hello &lt;World&gt;'));
    });

    r = await call('POST', '/api/articles', { title: 'Draft only', status: 'draft', body: '<p>x</p>' });
    const draft = r.json.article;
    const anon = await fetch(`${base}/article/${draft.slug}`);
    ok('drafts are hidden from the public', () => assert.strictEqual(anon.status, 404));

    const future = new Date(Date.now() + 86400000).toISOString();
    r = await call('POST', '/api/articles', { title: 'Scheduled story', status: 'published', published_at: future, body: '<p>later</p>' });
    ok('future publish date becomes "scheduled"', () => assert.strictEqual(r.json.article.state, 'scheduled'));
    const sched = await fetch(`${base}/article/${r.json.article.slug}`);
    ok('scheduled stories are hidden until their time', () => assert.strictEqual(sched.status, 404));

    r = await call('POST', '/api/articles', { title: 'No body', status: 'published', body: '' });
    ok('cannot publish an empty article', () => assert.strictEqual(r.status, 400));

    r = await call('POST', '/api/users', { name: 'Ed', email: 'ed@test.local', password: 'EditorPass1', role: 'editor' });
    ok('admin can create an editor', () => assert.strictEqual(r.status, 201));

    // switch to the editor
    cookie = '';
    r = await call('POST', '/api/auth/login', { email: 'ed@test.local', password: 'EditorPass1' });
    ok('editor can sign in', () => assert.strictEqual(r.status, 200));
    r = await call('PUT', `/api/articles/${art.id}`, { title: 'Hijack', body: '<p>x</p>' });
    ok("editor cannot edit someone else's article", () => assert.strictEqual(r.status, 403));
    r = await call('POST', '/api/categories', { name: 'Nope' });
    ok('editor cannot manage categories', () => assert.strictEqual(r.status, 403));
    r = await call('GET', '/api/users');
    ok('editor cannot list users', () => assert.strictEqual(r.status, 403));
    r = await call('POST', '/api/articles', { title: 'Editor piece', status: 'draft', body: '<p>mine</p>' });
    ok('editor can write their own article', () => assert.strictEqual(r.status, 201));

    r = await call('GET', '/search?q=hello');
    ok('search finds published articles', () => assert(r.text.includes('Hello &lt;World&gt;')));
    r = await call('GET', '/rss.xml');
    ok('RSS feed works', () => assert(r.text.includes('<rss')));

    console.log(`\n${passed} checks passed.`);
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('\nFAILED:', e.message);
    server.close();
    process.exit(1);
  }
});

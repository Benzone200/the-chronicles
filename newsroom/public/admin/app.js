(function () {
  'use strict';

  const app = document.getElementById('app');
  const state = { user: null, categories: [], settings: null, dirty: false };

  /* ------------------------------------------------------------ helpers */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' };
    if (opts.json !== undefined) {
      init.method = opts.method || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    }
    if (opts.form) {
      init.method = 'POST';
      init.body = opts.form;
    }
    const res = await fetch('/api' + path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Request failed.');
      err.status = res.status;
      if (res.status === 401 && path !== '/auth/login') {
        state.user = null;
        location.hash = '#/login';
      }
      throw err;
    }
    return data;
  }

  let toastTimer;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), 2800);
  }

  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const pill = (s) => `<span class="pill ${s}">${s[0].toUpperCase() + s.slice(1)}</span>`;
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const isAdmin = () => state.user && state.user.role === 'admin';

  async function loadCategories() {
    state.categories = (await api('/categories')).categories;
  }

  /* -------------------------------------------------------------- shell */
  function shell(active, content) {
    const link = (hash, label, key) => `<a href="${hash}" class="${active === key ? 'on' : ''}">${label}</a>`;
    app.innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand">Newsroom</div>
        <div class="sub">Publishing admin</div>
        <nav>
          ${link('#/', 'Dashboard', 'dash')}
          ${link('#/articles', 'Articles', 'articles')}
          ${link('#/categories', 'Categories', 'categories')}
          ${isAdmin() ? link('#/users', 'Users', 'users') : ''}
          ${link('#/settings', 'Settings', 'settings')}
          <a href="/" target="_blank" rel="noopener">View site ↗</a>
        </nav>
        <div class="grow"></div>
        <div class="me"><strong>${esc(state.user.name)}</strong><span>${esc(state.user.role)}</span><br><button type="button" data-action="logout">Sign out</button></div>
      </aside>
      <main class="main">${content}</main>
    </div>`;
  }

  /* -------------------------------------------------------------- login */
  function viewLogin() {
    app.innerHTML = `<div class="login"><form id="login" novalidate>
      <h1>Sign in</h1><p>Use your staff account to manage the newsroom.</p>
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="username" required autofocus></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required></div>
      <div class="err" id="err"></div>
      <button class="btn" type="submit">Sign in</button>
      <p class="hint" style="margin-top:20px"><a href="/">← Back to the site</a></p>
    </form></div>`;
    $('#login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('button', e.target);
      btn.disabled = true;
      try {
        const { user } = await api('/auth/login', { json: { email: $('#email').value, password: $('#password').value } });
        state.user = user;
        location.hash = '#/';
      } catch (err) {
        $('#err').textContent = err.message;
        btn.disabled = false;
      }
    });
  }

  /* ---------------------------------------------------------- dashboard */
  async function viewDashboard() {
    const { totals, recent, top } = await api('/stats');
    const rows = (list) =>
      list.length
        ? `<table><tbody>${list
            .map((a) => `<tr><td class="title"><a href="#/articles/${a.id}">${esc(a.title)}</a><div class="muted" style="font-size:12.5px">${esc(a.category_name || 'Uncategorised')} · ${fmt(a.updated_at)}</div></td><td class="actions">${pill(a.state)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<div class="empty">Nothing here yet.</div>';
    shell(
      'dash',
      `<div class="page-title"><h1>Dashboard</h1><a class="btn" href="#/articles/new">New article</a></div>
      <div class="stats">
        <div class="stat"><b>${totals.articles}</b><span>Total articles</span></div>
        <div class="stat"><b>${totals.published}</b><span>Published</span></div>
        <div class="stat"><b>${totals.drafts}</b><span>Drafts</span></div>
        <div class="stat"><b>${totals.scheduled}</b><span>Scheduled</span></div>
        <div class="stat"><b>${totals.views.toLocaleString()}</b><span>Total views</span></div>
      </div>
      <div class="cols">
        <section><h2 class="section-title">Recently updated</h2>${rows(recent)}</section>
        <section><h2 class="section-title">Most read</h2>${
          top.length
            ? `<table><tbody>${top.map((a) => `<tr><td class="title"><a href="#/articles/${a.id}">${esc(a.title)}</a></td><td class="actions muted">${a.views.toLocaleString()}</td></tr>`).join('')}</tbody></table>`
            : '<div class="empty">No views yet.</div>'
        }</section>
      </div>`
    );
  }

  /* ----------------------------------------------------------- articles */
  const listQuery = { status: '', category: '', q: '', page: 1 };

  async function viewArticles() {
    await loadCategories();
    const qs = new URLSearchParams();
    Object.entries(listQuery).forEach(([k, v]) => v && qs.set(k, v));
    const { articles, total, page, pages } = await api('/articles?' + qs);
    const opt = (v, label, cur) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
    shell(
      'articles',
      `<div class="page-title"><h1>Articles</h1><a class="btn" href="#/articles/new">New article</a></div>
      <div class="filters">
        <input type="search" id="f-q" placeholder="Search titles" value="${esc(listQuery.q)}" aria-label="Search titles">
        <select id="f-status" aria-label="Status">${opt('', 'All statuses', listQuery.status)}${opt('published', 'Published', listQuery.status)}${opt('draft', 'Drafts', listQuery.status)}${opt('scheduled', 'Scheduled', listQuery.status)}</select>
        <select id="f-cat" aria-label="Category">${opt('', 'All categories', listQuery.category)}${state.categories.map((c) => opt(c.id, esc(c.name), listQuery.category)).join('')}</select>
      </div>
      ${
        articles.length
          ? `<div class="table-wrap"><table>
        <thead><tr><th>Title</th><th>Category</th><th>Author</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>${articles
          .map(
            (a) => `<tr>
          <td class="title"><a href="#/articles/${a.id}">${esc(a.title)}</a>${a.featured ? '<span class="feat">★ Featured</span>' : ''}</td>
          <td class="muted">${esc(a.category_name || '—')}</td>
          <td class="muted">${esc(a.author_name || '—')}</td>
          <td>${pill(a.state)}</td>
          <td class="muted">${fmt(a.updated_at)}</td>
          <td class="actions">
            ${a.can_edit ? `<a href="#/articles/${a.id}">Edit</a>` : ''}
            <a href="/article/${esc(a.slug)}" target="_blank" rel="noopener">${a.state === 'published' ? 'View' : 'Preview'}</a>
            ${a.can_edit ? `<button class="link" data-action="toggle-publish" data-id="${a.id}" data-status="${a.status}">${a.status === 'published' ? 'Unpublish' : 'Publish'}</button>
            <button class="link danger" data-action="delete-article" data-id="${a.id}" data-title="${esc(a.title)}">Delete</button>` : ''}
          </td></tr>`
          )
          .join('')}</tbody></table></div>
      <div class="pager"><span>${total} article${total === 1 ? '' : 's'}</span><span>
        <button class="btn ghost small" data-action="page" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <span style="margin:0 10px">Page ${page} of ${pages}</span>
        <button class="btn ghost small" data-action="page" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button></span></div>`
          : '<div class="empty">No articles match your filters.</div>'
      }`
    );
    let timer;
    $('#f-q').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        listQuery.q = e.target.value.trim();
        listQuery.page = 1;
        route();
      }, 350);
    });
    $('#f-status').addEventListener('change', (e) => ((listQuery.status = e.target.value), (listQuery.page = 1), route()));
    $('#f-cat').addEventListener('change', (e) => ((listQuery.category = e.target.value), (listQuery.page = 1), route()));
    if (document.activeElement === document.body && listQuery.q) {
      const q = $('#f-q');
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  }

  /* ------------------------------------------------------------- editor */
  async function viewEditor(id) {
    await loadCategories();
    let a = { title: '', slug: '', summary: '', body: '', cover_image: '', cover_caption: '', category_id: '', status: 'draft', featured: false, published_at: null };
    if (id !== 'new') {
      try {
        a = (await api('/articles/' + id)).article;
      } catch (e) {
        toast(e.message, true);
        location.hash = '#/articles';
        return;
      }
      if (!a.can_edit) {
        toast('You can only edit your own articles.', true);
        location.hash = '#/articles';
        return;
      }
    }
    let slugTouched = !!a.slug;
    state.dirty = false;

    shell(
      'articles',
      `<div class="page-title"><h1>${id === 'new' ? 'New article' : 'Edit article'}</h1>
        <a class="btn ghost" href="#/articles">← All articles</a></div>
      <div class="editor-grid">
        <div>
          <div class="field"><input class="title-input" id="title" type="text" placeholder="Headline" maxlength="200" value="${esc(a.title)}" aria-label="Headline"></div>
          <div class="field"><label for="summary">Summary</label><textarea id="summary" maxlength="400" placeholder="One or two sentences shown on the front page and in search results.">${esc(a.summary)}</textarea></div>
          <div class="field"><label>Story</label>
            <div class="toolbar" role="toolbar" aria-label="Formatting">
              <button type="button" data-cmd="bold" title="Bold"><b>B</b></button>
              <button type="button" data-cmd="italic" title="Italic"><i>I</i></button>
              <span class="sep"></span>
              <button type="button" data-cmd="h2" title="Heading">H2</button>
              <button type="button" data-cmd="h3" title="Subheading">H3</button>
              <button type="button" data-cmd="p" title="Paragraph">¶</button>
              <span class="sep"></span>
              <button type="button" data-cmd="ul" title="Bulleted list">• List</button>
              <button type="button" data-cmd="ol" title="Numbered list">1. List</button>
              <button type="button" data-cmd="quote" title="Quote">“ ”</button>
              <span class="sep"></span>
              <button type="button" data-cmd="link" title="Link">Link</button>
              <button type="button" data-cmd="image" title="Insert image">Image</button>
              <button type="button" data-cmd="clear" title="Clear formatting">Clear</button>
            </div>
            <div class="body-edit" id="body" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="Start writing…">${a.body || ''}</div>
            <input type="file" id="body-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
          </div>
        </div>
        <aside>
          <div class="panel">
            <h3>Publish</h3>
            <div class="field"><label for="status">Status</label>
              <select id="status"><option value="draft"${a.status === 'draft' ? ' selected' : ''}>Draft</option><option value="published"${a.status === 'published' ? ' selected' : ''}>Published</option></select></div>
            <div class="field" id="date-field"><label for="pub-at">Publish date</label><input type="datetime-local" id="pub-at" value="${toLocalInput(a.published_at)}">
              <p class="hint">Leave blank to publish immediately. A future date schedules the story.</p></div>
            <div class="field"><label class="check"><input type="checkbox" id="featured"${a.featured ? ' checked' : ''}> Feature on the front page</label></div>
            <button class="btn" type="button" data-action="save" id="save-btn">${a.status === 'published' ? 'Update article' : 'Save'}</button>
            ${id !== 'new' ? `<a class="btn ghost" style="margin-top:10px" href="/article/${esc(a.slug)}" target="_blank" rel="noopener">Preview</a>` : ''}
          </div>
          <div class="panel">
            <h3>Category</h3>
            <select id="category" aria-label="Category"><option value="">Uncategorised</option>${state.categories
              .map((c) => `<option value="${c.id}"${Number(a.category_id) === c.id ? ' selected' : ''}>${esc(c.name)}</option>`)
              .join('')}</select>
          </div>
          <div class="panel">
            <h3>Cover image</h3>
            <div id="cover-box"></div>
            <input type="file" id="cover-file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>
            <div class="field" style="margin-top:14px;margin-bottom:0"><label for="caption">Caption</label><input type="text" id="caption" maxlength="200" value="${esc(a.cover_caption)}"></div>
          </div>
          <div class="panel">
            <h3>URL</h3>
            <input type="text" id="slug" maxlength="90" value="${esc(a.slug)}" placeholder="generated-from-headline" aria-label="URL slug">
            <p class="hint">/article/<span id="slug-preview">${esc(a.slug || '…')}</span></p>
          </div>
        </aside>
      </div>`
    );

    const body = $('#body');
    let cover = a.cover_image;

    function renderCover() {
      $('#cover-box').innerHTML = cover
        ? `<div class="cover-preview"><img src="${esc(cover)}" alt="Cover preview"></div><div class="cover-actions"><button class="link" type="button" data-action="cover-pick">Replace</button><button class="link danger" type="button" data-action="cover-remove">Remove</button></div>`
        : `<button class="btn ghost" type="button" data-action="cover-pick">Upload image</button><p class="hint">JPG, PNG, WebP or GIF, up to 5 MB.</p>`;
    }
    renderCover();

    async function upload(file) {
      const fd = new FormData();
      fd.append('file', file);
      return (await api('/upload', { form: fd })).url;
    }

    document.execCommand('defaultParagraphSeparator', false, 'p');
    const markDirty = () => (state.dirty = true);
    ['title', 'summary', 'status', 'pub-at', 'featured', 'category', 'caption', 'slug'].forEach((i) => $('#' + i).addEventListener('input', markDirty));
    body.addEventListener('input', markDirty);

    $('#title').addEventListener('input', (e) => {
      if (!slugTouched) {
        $('#slug').value = '';
        $('#slug-preview').textContent = slugPreview(e.target.value);
      }
    });
    $('#slug').addEventListener('input', (e) => {
      slugTouched = !!e.target.value;
      $('#slug-preview').textContent = slugPreview(e.target.value || $('#title').value);
    });
    const slugPreview = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '…';

    body.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });

    $('.toolbar').addEventListener('mousedown', (e) => e.preventDefault()); // keep selection in the editor
    $('.toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cmd]');
      if (!btn) return;
      body.focus();
      const cmd = btn.dataset.cmd;
      const ex = (c, v) => document.execCommand(c, false, v);
      if (cmd === 'bold') ex('bold');
      else if (cmd === 'italic') ex('italic');
      else if (cmd === 'h2') ex('formatBlock', 'h2');
      else if (cmd === 'h3') ex('formatBlock', 'h3');
      else if (cmd === 'p') ex('formatBlock', 'p');
      else if (cmd === 'ul') ex('insertUnorderedList');
      else if (cmd === 'ol') ex('insertOrderedList');
      else if (cmd === 'quote') ex('formatBlock', 'blockquote');
      else if (cmd === 'clear') {
        ex('removeFormat');
        ex('formatBlock', 'p');
      } else if (cmd === 'link') {
        const url = prompt('Link address (https://…)');
        if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) ex('createLink', url.trim());
        else if (url) toast('Links must start with http://, https:// or mailto:', true);
      } else if (cmd === 'image') $('#body-file').click();
      markDirty();
    });

    $('#body-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const url = await upload(file);
        body.focus();
        document.execCommand('insertImage', false, url);
        markDirty();
      } catch (err) {
        toast(err.message, true);
      }
    });

    $('#cover-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        cover = await upload(file);
        renderCover();
        markDirty();
      } catch (err) {
        toast(err.message, true);
      }
    });

    // Actions that need editor-local state
    app.onclick = async (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      const action = el.dataset.action;
      if (action === 'cover-pick') $('#cover-file').click();
      else if (action === 'cover-remove') (cover = ''), renderCover(), markDirty();
      else if (action === 'save') {
        const payload = {
          title: $('#title').value,
          summary: $('#summary').value,
          body: body.innerHTML,
          cover_image: cover,
          cover_caption: $('#caption').value,
          category_id: $('#category').value || null,
          status: $('#status').value,
          featured: $('#featured').checked,
          slug: $('#slug').value,
          published_at: $('#pub-at').value ? new Date($('#pub-at').value).toISOString() : null,
        };
        el.disabled = true;
        try {
          const res = id === 'new' ? await api('/articles', { json: payload }) : await api('/articles/' + id, { method: 'PUT', json: payload });
          state.dirty = false;
          const st = res.article.state;
          toast(st === 'published' ? 'Article published.' : st === 'scheduled' ? 'Article scheduled.' : 'Draft saved.');
          if (id === 'new') location.hash = '#/articles/' + res.article.id;
          else {
            $('#slug').value = res.article.slug;
            $('#slug-preview').textContent = res.article.slug;
            el.textContent = res.article.status === 'published' ? 'Update article' : 'Save';
            el.disabled = false;
          }
        } catch (err) {
          toast(err.message, true);
          el.disabled = false;
        }
      } else globalActions(e);
    };
  }

  /* --------------------------------------------------------- categories */
  async function viewCategories(editId) {
    await loadCategories();
    const editing = state.categories.find((c) => c.id === Number(editId));
    shell(
      'categories',
      `<div class="page-title"><h1>Categories</h1></div>
      ${
        isAdmin()
          ? `<form class="card-form" id="cat-form"><h2>${editing ? 'Edit category' : 'Add a category'}</h2>
        <div class="two"><div class="field"><label for="c-name">Name</label><input id="c-name" type="text" maxlength="40" required value="${esc(editing?.name)}"></div>
        <div class="field"><label for="c-order">Order</label><input id="c-order" type="number" value="${editing ? editing.sort_order : state.categories.length}"></div></div>
        <div class="field"><label for="c-desc">Description</label><input id="c-desc" type="text" maxlength="200" value="${esc(editing?.description)}"></div>
        <div class="err" id="err"></div>
        <button class="btn" type="submit">${editing ? 'Save changes' : 'Add category'}</button>
        ${editing ? '<a class="btn ghost" href="#/categories" style="margin-left:10px">Cancel</a>' : ''}</form>`
          : '<p class="muted" style="margin-bottom:24px">Only administrators can change categories.</p>'
      }
      <table><thead><tr><th>Name</th><th>Description</th><th>Articles</th><th></th></tr></thead><tbody>${state.categories
        .map(
          (c) => `<tr><td class="title"><strong>${esc(c.name)}</strong></td><td class="muted">${esc(c.description)}</td><td class="muted">${c.article_count}</td>
          <td class="actions">${isAdmin() ? `<a href="#/categories/${c.id}">Edit</a><button class="link danger" data-action="delete-category" data-id="${c.id}" data-name="${esc(c.name)}" data-count="${c.article_count}">Delete</button>` : ''}</td></tr>`
        )
        .join('')}</tbody></table>`
    );
    const form = $('#cat-form');
    if (form)
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const json = { name: $('#c-name').value, description: $('#c-desc').value, sort_order: $('#c-order').value };
        try {
          if (editing) await api('/categories/' + editing.id, { method: 'PUT', json });
          else await api('/categories', { json });
          toast('Category saved.');
          location.hash = '#/categories';
          route();
        } catch (err) {
          $('#err').textContent = err.message;
        }
      });
  }

  /* -------------------------------------------------------------- users */
  async function viewUsers(editId) {
    if (!isAdmin()) return (location.hash = '#/');
    const { users } = await api('/users');
    const editing = users.find((u) => u.id === Number(editId));
    shell(
      'users',
      `<div class="page-title"><h1>Users</h1></div>
      <form class="card-form" id="user-form"><h2>${editing ? 'Edit user' : 'Add a user'}</h2>
        <div class="two"><div class="field"><label for="u-name">Name</label><input id="u-name" type="text" maxlength="80" required value="${esc(editing?.name)}"></div>
        <div class="field"><label for="u-email">Email</label><input id="u-email" type="email" required value="${esc(editing?.email)}"></div></div>
        <div class="two"><div class="field"><label for="u-role">Role</label><select id="u-role"><option value="editor"${editing?.role === 'editor' ? ' selected' : ''}>Editor — manages own articles</option><option value="admin"${editing?.role === 'admin' ? ' selected' : ''}>Administrator — full access</option></select></div>
        <div class="field"><label for="u-pass">${editing ? 'New password' : 'Password'}</label><input id="u-pass" type="password" minlength="8" autocomplete="new-password" ${editing ? 'placeholder="Leave blank to keep"' : 'required'}></div></div>
        ${editing ? `<div class="field"><label class="check"><input type="checkbox" id="u-active"${editing.active ? ' checked' : ''}> Account is active</label></div>` : ''}
        <div class="err" id="err"></div>
        <button class="btn" type="submit">${editing ? 'Save changes' : 'Add user'}</button>
        ${editing ? '<a class="btn ghost" href="#/users" style="margin-left:10px">Cancel</a>' : ''}</form>
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Articles</th><th></th></tr></thead><tbody>${users
        .map(
          (u) => `<tr><td class="title"><strong>${esc(u.name)}</strong></td><td class="muted">${esc(u.email)}</td><td style="text-transform:capitalize">${esc(u.role)}</td>
          <td>${u.active ? pill('published').replace('Published', 'Active') : '<span class="pill off">Disabled</span>'}</td><td class="muted">${u.article_count}</td>
          <td class="actions"><a href="#/users/${u.id}">Edit</a>${u.id !== state.user.id ? `<button class="link danger" data-action="delete-user" data-id="${u.id}" data-name="${esc(u.name)}">Delete</button>` : ''}</td></tr>`
        )
        .join('')}</tbody></table>`
    );
    $('#user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const json = { name: $('#u-name').value, email: $('#u-email').value, role: $('#u-role').value, password: $('#u-pass').value };
      try {
        if (editing) {
          json.active = $('#u-active').checked;
          await api('/users/' + editing.id, { method: 'PUT', json });
        } else await api('/users', { json });
        toast('User saved.');
        location.hash = '#/users';
        route();
      } catch (err) {
        $('#err').textContent = err.message;
      }
    });
  }

  /* ----------------------------------------------------------- settings */
  async function viewSettings() {
    const { settings } = await api('/settings');
    shell(
      'settings',
      `<div class="page-title"><h1>Settings</h1></div>
      ${
        isAdmin()
          ? `<form class="card-form" id="site-form"><h2>Site</h2>
        <div class="field"><label for="s-name">Site name</label><input id="s-name" type="text" maxlength="60" required value="${esc(settings.site_name)}"></div>
        <div class="field"><label for="s-tag">Tagline</label><input id="s-tag" type="text" maxlength="120" value="${esc(settings.tagline)}"></div>
        <div class="field"><label for="s-foot">Footer text</label><input id="s-foot" type="text" maxlength="200" value="${esc(settings.footer_text)}"></div>
        <div class="err" id="err1"></div><button class="btn" type="submit">Save site settings</button></form>`
          : ''
      }
      <form class="card-form" id="pw-form"><h2>Change your password</h2>
        <div class="field"><label for="p-cur">Current password</label><input id="p-cur" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="p-new">New password</label><input id="p-new" type="password" minlength="8" autocomplete="new-password" required><p class="hint">At least 8 characters.</p></div>
        <div class="err" id="err2"></div><button class="btn" type="submit">Update password</button></form>`
    );
    const site = $('#site-form');
    if (site)
      site.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/settings', { method: 'PUT', json: { site_name: $('#s-name').value, tagline: $('#s-tag').value, footer_text: $('#s-foot').value } });
          toast('Settings saved.');
        } catch (err) {
          $('#err1').textContent = err.message;
        }
      });
    $('#pw-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/auth/password', { json: { current: $('#p-cur').value, next: $('#p-new').value } });
        toast('Password updated.');
        e.target.reset();
        $('#err2').textContent = '';
      } catch (err) {
        $('#err2').textContent = err.message;
      }
    });
  }

  /* ------------------------------------------------------ global actions */
  async function globalActions(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, id } = el.dataset;
    try {
      if (action === 'logout') {
        await api('/auth/logout', { method: 'POST', json: {} });
        state.user = null;
        location.hash = '#/login';
      } else if (action === 'page') {
        listQuery.page = Number(el.dataset.page);
        route();
      } else if (action === 'toggle-publish') {
        const status = el.dataset.status === 'published' ? 'draft' : 'published';
        await api('/articles/' + id, { method: 'PATCH', json: { status } });
        toast(status === 'published' ? 'Article published.' : 'Moved back to drafts.');
        route();
      } else if (action === 'delete-article') {
        if (!confirm(`Delete “${el.dataset.title}”? This cannot be undone.`)) return;
        await api('/articles/' + id, { method: 'DELETE' });
        toast('Article deleted.');
        route();
      } else if (action === 'delete-category') {
        const n = Number(el.dataset.count);
        if (!confirm(`Delete “${el.dataset.name}”?${n ? ` Its ${n} article${n === 1 ? '' : 's'} will become uncategorised.` : ''}`)) return;
        await api('/categories/' + id, { method: 'DELETE' });
        toast('Category deleted.');
        route();
      } else if (action === 'delete-user') {
        if (!confirm(`Delete ${el.dataset.name}? Their articles stay published but lose the author name.`)) return;
        await api('/users/' + id, { method: 'DELETE' });
        toast('User deleted.');
        route();
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* -------------------------------------------------------------- router */
  async function route() {
    app.onclick = globalActions;
    const hash = location.hash || '#/';
    if (!state.user) {
      try {
        state.user = (await api('/auth/me')).user;
      } catch {
        state.user = null;
      }
    }
    if (!state.user) {
      if (hash !== '#/login') return (location.hash = '#/login');
      return viewLogin();
    }
    if (hash === '#/login') return (location.hash = '#/');
    const [, section, arg] = hash.split('/');
    try {
      if (!section) await viewDashboard();
      else if (section === 'articles' && arg) await viewEditor(arg);
      else if (section === 'articles') await viewArticles();
      else if (section === 'categories') await viewCategories(arg);
      else if (section === 'users') await viewUsers(arg);
      else if (section === 'settings') await viewSettings();
      else location.hash = '#/';
    } catch (err) {
      if (err.status !== 401) toast(err.message, true);
    }
  }

  let reverting = false;
  window.addEventListener('hashchange', () => {
    if (reverting) {
      reverting = false;
      return;
    }
    if (state.dirty && !confirm('You have unsaved changes. Leave this page?')) {
      reverting = true;
      history.back();
      return;
    }
    state.dirty = false;
    route();
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  route();
})();

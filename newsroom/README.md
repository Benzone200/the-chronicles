# Newsroom — Publishing Management System

A complete publishing platform: a public news website, an admin dashboard for editors, and a REST API, backed by SQLite.

## Run it

Requires Node.js 22.5 or newer (uses the built-in SQLite, nothing to compile).

```bash
npm install
npm run seed     # optional: loads sample articles and demo accounts
npm start        # http://localhost:3000
```

- Public site: `http://localhost:3000`
- Admin dashboard: `http://localhost:3000/admin/`

If you skip `npm run seed`, an administrator is created on first start using `ADMIN_EMAIL` / `ADMIN_PASSWORD` (see `.env.example`; default `admin@newsroom.local` / `ChangeMe123!`).

Demo accounts created by `npm run seed`:

| Role   | Email                   | Password       |
|--------|-------------------------|----------------|
| Admin  | admin@newsroom.local    | ChangeMe123!   |
| Editor | editor@newsroom.local   | Editor123!     |

Change these before deploying. `npm test` runs an automated end-to-end check (20 assertions).

## Features

**Public site**
- Front page with lead story, latest, more stories, most read and per-section blocks
- Category pages with pagination, article pages with reading time and related stories
- Search, RSS feed (`/rss.xml`), sitemap, robots.txt, Open Graph tags
- Responsive layout, mobile menu, skip link and keyboard focus styles

**Admin dashboard**
- Sign-in with secure session cookies
- Dashboard: totals, recently updated, most read
- Articles: create, edit, delete, search, filter by status/category
- Rich-text editor (headings, bold/italic, lists, quotes, links, inline images)
- Draft / Published / Scheduled (future publish date), featured flag, cover image with caption, editable URL slug
- Preview of drafts and scheduled stories while signed in
- Categories (admin), users and roles (admin), site name/tagline/footer, change password

**Roles**
- *Administrator*: everything
- *Editor*: can write and manage their own articles only

## Security notes

- Passwords hashed with bcrypt; sessions stored server-side as hashes; HttpOnly + SameSite cookies
- Login rate limiting; CSRF protection via required request header on all writes
- Article HTML is sanitised on save (whitelist of tags); all other output is escaped
- Uploads limited to JPG/PNG/WebP/GIF, 5 MB, verified by file signature, renamed on save
- Content-Security-Policy and other security headers on every response

## Project layout

```
server.js              app entry
src/db.js              SQLite schema and settings
src/auth.js            sessions, roles, CSRF, rate limit
src/routes/api.js      REST API (/api/...)
src/routes/public.js   public pages, RSS, sitemap
src/views.js           HTML templates for the public site
public/css/site.css    public design
public/admin/          admin single-page app (index.html, app.js, admin.css)
scripts/seed.js        sample content
scripts/smoke-test.js  automated checks
data/                  SQLite database (created on first run)
uploads/               uploaded images
```

## API summary

All write requests need the header `X-Requested-With: fetch` and a signed-in session.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/login`, `/api/auth/logout` | |
| GET | `/api/auth/me` | current user |
| GET/POST | `/api/articles` | list (filters: `status`, `category`, `q`, `page`) / create |
| GET/PUT/PATCH/DELETE | `/api/articles/:id` | PATCH publishes/unpublishes/features |
| GET/POST/PUT/DELETE | `/api/categories` | writes: admin only |
| GET/POST/PUT/DELETE | `/api/users` | admin only |
| GET/PUT | `/api/settings` | PUT: admin only |
| POST | `/api/upload` | multipart field `file` |
| GET | `/api/stats` | dashboard numbers |

## Deploying

Set `NODE_ENV=production` (adds the `Secure` cookie flag, needs HTTPS) and `TRUST_PROXY=1` behind a reverse proxy. Back up the `data/` and `uploads/` folders.

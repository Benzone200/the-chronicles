const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

/*
 * Database: libSQL (SQLite-compatible).
 *  - Production / Vercel: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN (a free hosted Turso database).
 *  - Local development: with nothing set, a plain file at data/newsroom.db is used.
 */
let url = process.env.TURSO_DATABASE_URL;
if (!url) {
  if (process.env.VERCEL) {
    throw new Error('TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) in the Vercel project settings.');
  }
  const file = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'newsroom.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rel = path.relative(process.cwd(), file);
  url = 'file:' + (path.isAbsolute(rel) ? file : rel).replace(/\\/g, '/');
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  summary       TEXT NOT NULL DEFAULT '',
  body          TEXT NOT NULL DEFAULT '',
  cover_image   TEXT NOT NULL DEFAULT '',
  cover_caption TEXT NOT NULL DEFAULT '',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  author_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  featured      INTEGER NOT NULL DEFAULT 0,
  views         INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_pub ON articles (status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cat ON articles (category_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// Resolves once the tables exist. Every query waits for it.
const ready = (async () => {
  try {
    await client.execute('PRAGMA foreign_keys = ON');
  } catch {
    /* remote databases manage this themselves */
  }
  await client.executeMultiple(SCHEMA);
})();
ready.catch(() => {}); // the error is reported by the first query that awaits it

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// db.prepare(sql).get / .all / .run — all return promises.
// Named parameters (@name) are passed as one object; unused keys are ignored.
const db = {
  ready,
  prepare(sql) {
    const names = new Set([...sql.matchAll(/@(\w+)/g)].map((m) => m[1]));
    const exec = async (args) => {
      await ready;
      let a = args;
      if (args.length === 1 && isPlainObject(args[0])) {
        a = Object.fromEntries(Object.entries(args[0]).filter(([k]) => names.has(k)));
      }
      return client.execute({ sql, args: a });
    };
    const plain = (res, row) => Object.fromEntries(res.columns.map((c, i) => [c, row[i]]));
    return {
      async get(...args) {
        const res = await exec(args);
        return res.rows[0] ? plain(res, res.rows[0]) : undefined;
      },
      async all(...args) {
        const res = await exec(args);
        return res.rows.map((r) => plain(res, r));
      },
      async run(...args) {
        const res = await exec(args);
        return { changes: res.rowsAffected, lastInsertRowid: Number(res.lastInsertRowid) };
      },
    };
  },
};

const DEFAULT_SETTINGS = {
  site_name: 'The Chronicle',
  tagline: 'Independent reporting, published with care.',
  footer_text: 'All rights reserved.',
};

async function getSettings() {
  const rows = await db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function setSetting(key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

module.exports = { db, getSettings, setSetting, DEFAULT_SETTINGS };

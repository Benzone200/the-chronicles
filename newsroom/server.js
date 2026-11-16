const express = require('express');
const path = require('path');
const { db } = require('./src/db');
const { hashPassword } = require('./src/auth');
const views = require('./src/views');
const { getSettings } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// First run: create an administrator so the dashboard is reachable.
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const email = (process.env.ADMIN_EMAIL || 'admin@newsroom.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run('Administrator', email, hashPassword(password), 'admin');
  console.log(`\n  First run: created admin account\n    email:    ${email}\n    password: ${password}\n  Change this password after signing in.\n`);
}

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  });
  next();
});

const pub = path.join(__dirname, 'public');
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: '7d', index: false }));
app.use('/admin', express.static(path.join(pub, 'admin'), { index: 'index.html' }));
app.use(express.static(pub, { maxAge: '1h', index: false }));

app.use('/api', require('./src/routes/api'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => {
  const { db: _db } = require('./src/db');
  const categories = _db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  res.status(404).type('html').send(views.layout({ settings: getSettings(), categories, title: 'Not found', noindex: true, body: views.notFound() }));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).type('text').send('Something went wrong on the server.');
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Newsroom running at http://localhost:${PORT}  (admin: /admin/)`));
}

module.exports = app;

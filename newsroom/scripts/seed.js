/*
 * Loads sample content so the site looks complete on first run.
 *   npm run seed
 * Safe to run more than once: it only adds data to empty tables.
 */
const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');
const { hashPassword } = require('../src/auth');
const { uniqueSlug, cleanBody } = require('../src/util');

const seedDir = path.join(__dirname, '..', 'public', 'seed');
fs.mkdirSync(seedDir, { recursive: true });

/* ---- simple monochrome cover images (SVG), so the demo has visuals without stock photos ---- */
const covers = [
  (w, h) => `<rect width="${w}" height="${h}" fill="#0c0c0c"/><circle cx="1130" cy="450" r="430" fill="#fff"/><circle cx="1130" cy="450" r="300" fill="none" stroke="#0c0c0c" stroke-width="2"/>`,
  (w, h) => `<rect width="${w}" height="${h}" fill="#efefec"/><rect x="260" y="330" width="170" height="570" fill="#0c0c0c"/><rect x="480" y="150" width="170" height="750" fill="#0c0c0c"/><rect x="700" y="450" width="170" height="450" fill="#0c0c0c"/><rect x="920" y="240" width="170" height="660" fill="#0c0c0c"/>`,
  (w, h) => `<rect width="${w}" height="${h}" fill="#d9d9d5"/><path d="M200 900 A 400 400 0 0 1 1000 900 Z" fill="#0c0c0c"/><line x1="100" y1="900" x2="1500" y2="900" stroke="#0c0c0c" stroke-width="3"/>`,
  (w, h) => `<rect width="${w}" height="${h}" fill="#0c0c0c"/>${Array.from({ length: 22 }, (_, i) => `<line x1="0" y1="${60 + i * 40}" x2="${w}" y2="${60 + i * 40}" stroke="#fff" stroke-opacity="${(0.12 + (i % 5) * 0.14).toFixed(2)}" stroke-width="2"/>`).join('')}`,
  (w, h) => `<rect width="${w}" height="${h}" fill="#f7f7f5"/><circle cx="800" cy="450" r="330" fill="none" stroke="#0c0c0c" stroke-width="3"/><circle cx="800" cy="450" r="14" fill="#0c0c0c"/><line x1="800" y1="0" x2="800" y2="900" stroke="#0c0c0c" stroke-width="1"/><line x1="0" y1="450" x2="1600" y2="450" stroke="#0c0c0c" stroke-width="1"/>`,
  (w, h) => `<rect width="${w}" height="${h}" fill="#e6e6e2"/>${Array.from({ length: 36 }, (_, i) => `<line x1="${i * 50 - 300}" y1="900" x2="${i * 50 + 600}" y2="0" stroke="#0c0c0c" stroke-opacity="0.55" stroke-width="1.5"/>`).join('')}`,
];
covers.forEach((fn, i) => {
  fs.writeFileSync(path.join(seedDir, `cover-${i + 1}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" width="1600" height="900">${fn(1600, 900)}</svg>`);
});

/* ---- accounts ---- */
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const email = (process.env.ADMIN_EMAIL || 'admin@newsroom.local').toLowerCase();
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run('Administrator', email, hashPassword(process.env.ADMIN_PASSWORD || 'ChangeMe123!'), 'admin');
}
const admin = db.prepare(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`).get();
if (!db.prepare(`SELECT 1 FROM users WHERE email = 'editor@newsroom.local'`).get()) {
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)').run('Amaka Obi', 'editor@newsroom.local', hashPassword('Editor123!'), 'editor');
}
const editor = db.prepare(`SELECT id FROM users WHERE email = 'editor@newsroom.local'`).get();

/* ---- categories ---- */
if (!db.prepare('SELECT 1 FROM categories LIMIT 1').get()) {
  const cats = [
    ['Campus', 'News and events from around the university.'],
    ['Technology', 'Software, devices and the people building them.'],
    ['Business', 'Markets, startups and the local economy.'],
    ['Sport', 'Results, previews and profiles.'],
    ['Culture', 'Arts, music, books and everyday life.'],
    ['Opinion', 'Commentary and analysis from our contributors.'],
  ];
  cats.forEach(([name, description], i) => {
    db.prepare('INSERT INTO categories (name, slug, description, sort_order) VALUES (?,?,?,?)').run(name, uniqueSlug(db, 'categories', name), description, i);
  });
}
const cat = (name) => db.prepare('SELECT id FROM categories WHERE name = ?').get(name).id;

/* ---- articles ---- */
if (!db.prepare('SELECT 1 FROM articles LIMIT 1').get()) {
  const day = 86400000;
  const ago = (d, h = 0) => new Date(Date.now() - d * day - h * 3600000).toISOString();

  const stories = [
    {
      title: 'Library extends opening hours ahead of examination period',
      category: 'Campus', cover: 1, featured: 1, days: 0, hours: 3, views: 412, author: admin.id,
      summary: 'The main library will stay open until midnight on weekdays from next week, with a quiet floor set aside for final-year students.',
      body: `<p>The university library will extend its weekday opening hours until midnight from Monday, following a request from the students’ union and a successful two-week trial earlier this term.</p>
<p>The third floor will be reserved as a silent study area, and a limited number of rooms can be booked in advance for group revision. Librarians say the trial showed demand was highest between 8pm and 11pm, when seats were often full.</p>
<h2>What changes</h2>
<ul><li>Weekday hours: 7:30am to midnight</li><li>Weekend hours: 9am to 8pm</li><li>Silent floor and bookable rooms open to all registered students</li></ul>
<p>The extended hours will run until the end of the examination period. Staff will review attendance before deciding whether to keep them next semester.</p>`,
    },
    {
      title: 'Local startup launches payments tool for small market traders',
      category: 'Business', cover: 2, featured: 0, days: 1, hours: 2, views: 301, author: editor.id,
      summary: 'A team of three graduates has built a simple point-of-sale app designed for traders who work without a shop or a fixed internet connection.',
      body: `<p>A small team of recent graduates has released a payments app aimed at traders who sell from stalls, trays and roadside tables. The app records sales offline and syncs them once a connection returns.</p>
<p>The founders say they spent six months talking to traders before writing any code. The most common complaint was not fees but record keeping: many traders keep sales in notebooks and lose track of what they are owed.</p>
<p>The app is free during its first year. The team plans to charge a small monthly fee for reports and supplier reminders once it has several thousand active users.</p>`,
    },
    {
      title: 'Why open-source tools are changing how student teams build software',
      category: 'Technology', cover: 3, featured: 0, days: 2, hours: 5, views: 266, author: admin.id,
      summary: 'From version control to deployment, free tools now give a class project the same foundations as a professional team.',
      body: `<p>Ten years ago, a final-year project often meant a single laptop and a USB drive. Today, even first-year teams share a repository, run automated tests and deploy to a public address before the first demo.</p>
<p>Lecturers say the biggest change is collaboration. Reviewing a classmate’s code, or having your own reviewed, teaches habits that used to be learned only on the job.</p>
<p>The trade-off is complexity. Beginners can spend a week configuring tools instead of writing features, and some departments now provide starter templates to shorten that gap.</p>`,
    },
    {
      title: 'Women’s basketball side reaches the final after narrow semi-final win',
      category: 'Sport', cover: 4, featured: 0, days: 3, hours: 1, views: 198, author: editor.id,
      summary: 'A late three-pointer sealed a 61–59 victory and a place in Saturday’s inter-university final.',
      body: `<p>The university’s women’s basketball team booked its place in the inter-university final on Thursday night, winning a tense semi-final by two points.</p>
<p>The side trailed by seven at the start of the fourth quarter before a run of defensive stops turned the game. The winning basket came with eleven seconds left.</p>
<p>The final is on Saturday afternoon at the sports hall. Entry is free for students with a valid ID.</p>`,
    },
    {
      title: 'A new reading room opens in the arts building',
      category: 'Culture', cover: 5, featured: 0, days: 4, hours: 6, views: 154, author: admin.id,
      summary: 'Donated books, long tables and no screens: the space is meant to slow things down.',
      body: `<p>On the ground floor of the arts building, a former storeroom has been turned into a reading room stocked with more than two thousand donated books.</p>
<p>There are no charging points and the wireless network does not reach the room. Organisers say this is deliberate. “People come in, put their phones in a bag and read,” said one volunteer.</p>
<p>The room is open daily from 10am to 6pm. Book donations are accepted at the front desk.</p>`,
    },
    {
      title: 'Opinion: group projects should be marked on process, not just product',
      category: 'Opinion', cover: 6, featured: 0, days: 5, hours: 4, views: 233, author: editor.id,
      summary: 'A single grade for a team hides who did what, and rewards the wrong things.',
      body: `<p>Most students have been in a group where one person quietly carried the work. Most have also been in one where everyone worked hard and the result was still disappointing. A single mark for the final product treats both situations the same.</p>
<p>Marking process, through short check-ins, contribution logs and a brief individual reflection, would give lecturers a clearer picture. It would also reward the unglamorous work of testing, documenting and coordinating that rarely shows in a demo.</p>
<p>It is more effort for staff, and it needs to be designed so that logging work does not become a chore of its own. But the current approach is simpler only because it measures less.</p>`,
    },
    {
      title: 'Student union approves budget for new mental health peer-support network',
      category: 'Campus', cover: 2, featured: 0, days: 6, hours: 2, views: 120, author: admin.id,
      summary: 'Trained volunteers will run weekly drop-in sessions in two campus locations from next month.',
      body: `<p>The student union has approved funding for a peer-support network, with volunteers trained by the university counselling service.</p>
<p>Drop-in sessions will run weekly in the student centre and one hall of residence. Volunteers will not give clinical advice but will help students find the right support and listen without judgement.</p>
<p>Applications for volunteer places open next week.</p>`,
    },
    {
      title: 'Small banks and mobile wallets: what the new transfer rules mean for students',
      category: 'Business', cover: 4, featured: 0, days: 8, hours: 3, views: 98, author: editor.id,
      summary: 'Lower limits and new verification steps are coming. Here is what is likely to change in practice.',
      body: `<p>New rules for mobile transfers introduce stricter identity checks for larger payments. For most students sending small amounts, the day-to-day experience should change very little.</p>
<p>The main difference is likely to be at the point of setting up an account or raising limits, where providers will ask for additional documents. Some providers have already begun notifying customers.</p>
<p>Students who receive allowances or freelance payments may want to check their account limits before the end of the month.</p>`,
    },
    {
      title: 'Draft: coverage plan for the end-of-year cultural festival',
      category: 'Culture', cover: 0, featured: 0, days: 0, hours: 0, views: 0, author: editor.id, status: 'draft',
      summary: 'Working notes. Not yet ready for publication.',
      body: `<p>Outline of stories, photographers and publication dates for the festival week.</p>`,
    },
  ];

  const insert = db.prepare(
    `INSERT INTO articles (title, slug, summary, body, cover_image, cover_caption, category_id, author_id, status, featured, views, published_at, created_at, updated_at)
     VALUES (@title, @slug, @summary, @body, @cover_image, '', @category_id, @author_id, @status, @featured, @views, @published_at, @ts, @ts)`
  );
  for (const s of stories) {
    const published = s.status !== 'draft';
    const ts = ago(s.days, s.hours);
    insert.run({
      title: s.title,
      slug: uniqueSlug(db, 'articles', s.title),
      summary: s.summary,
      body: cleanBody(s.body),
      cover_image: s.cover ? `/seed/cover-${s.cover}.svg` : '',
      category_id: cat(s.category),
      author_id: s.author,
      status: published ? 'published' : 'draft',
      featured: s.featured,
      views: s.views,
      published_at: published ? ts : null,
      ts,
    });
  }
}

console.log('Sample content ready.');
console.log('  Admin:  admin@newsroom.local  / ChangeMe123!');
console.log('  Editor: editor@newsroom.local / Editor123!');

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!ADMIN_TOKEN) {
  console.warn('WARNING: ADMIN_TOKEN is not set in .env — admin routes will reject all requests.');
}

app.use(express.json({ limit: '20kb' }));

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      // Reject without throwing: this just omits CORS headers so the
      // browser blocks the response for disallowed cross-origin callers.
      // Throwing here instead would turn every non-approved request
      // (including the app's own domain, e.g. this Render URL used
      // directly) into a 500 error, which is what happened before this fix.
      return callback(null, false);
    },
  })
);

// Serve the moderation dashboard
app.use('/admin', express.static(path.join(__dirname, 'public', 'admin')));

// --- Rate limiting for public submissions (spam control) ---
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 8, // 8 submissions per IP per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions from this device. Please try again later.' },
});

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// --- Admin auth middleware ---
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token') || req.query.token;
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// =====================
// PUBLIC ROUTES
// =====================

// Get approved reviews + aggregate rating for one community
// GET /api/reviews?community=sherwood-park
app.get('/api/reviews', (req, res) => {
  const slug = slugify(req.query.community || '');
  if (!slug) return res.status(400).json({ error: 'community is required' });

  const rows = db
    .prepare(
      `SELECT id, reviewer_name AS name, rating, review_text AS text, created_at
       FROM reviews WHERE community_slug = ? AND status = 'approved'
       ORDER BY created_at DESC`
    )
    .all(slug);

  const count = rows.length;
  const average = count ? rows.reduce((sum, r) => sum + r.rating, 0) / count : 0;

  res.json({
    community: slug,
    count,
    average: Math.round(average * 10) / 10,
    reviews: rows,
  });
});

// Submit a new review (goes to pending queue)
// POST /api/reviews  { community, communityName, name, rating, text, hp }
app.post('/api/reviews', submitLimiter, (req, res) => {
  const { community, communityName, name, rating, text, hp } = req.body || {};

  // Honeypot: bots fill hidden fields. Silently "succeed" without storing anything.
  if (hp) {
    return res.status(201).json({ status: 'pending' });
  }

  const slug = slugify(community || '');
  const cName = String(communityName || community || '').trim().slice(0, 120);
  const reviewerName = String(name || '').trim().slice(0, 80) || 'Anonymous';
  const ratingNum = parseInt(rating, 10);
  const reviewText = String(text || '').trim().slice(0, 1000);

  if (!slug || !cName) return res.status(400).json({ error: 'community and communityName are required' });
  if (!ratingNum || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'rating must be 1-5' });
  if (!reviewText) return res.status(400).json({ error: 'text is required' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  const info = db
    .prepare(
      `INSERT INTO reviews (community_slug, community_name, reviewer_name, rating, review_text, submitted_ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(slug, cName, reviewerName, ratingNum, reviewText, String(ip));

  res.status(201).json({ status: 'pending', id: info.lastInsertRowid });
});

// =====================
// ADMIN ROUTES (require x-admin-token header, or ?token=)
// =====================

// List reviews, default to pending, optionally filter by community/status
// GET /api/admin/reviews?status=pending&community=sherwood-park
app.get('/api/admin/reviews', requireAdmin, (req, res) => {
  const status = req.query.status || 'pending';
  const community = req.query.community ? slugify(req.query.community) : null;

  let query = `SELECT * FROM reviews WHERE status = ?`;
  const params = [status];
  if (community) {
    query += ` AND community_slug = ?`;
    params.push(community);
  }
  query += ` ORDER BY created_at ASC`;

  const rows = db.prepare(query).all(...params);
  res.json({ reviews: rows });
});

// Summary of communities with pending counts, for the dashboard landing view
app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT community_slug, community_name,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected
       FROM reviews GROUP BY community_slug ORDER BY pending DESC, community_name ASC`
    )
    .all();
  res.json({ communities: rows });
});

app.post('/api/admin/reviews/:id/approve', requireAdmin, (req, res) => {
  const result = db
    .prepare(`UPDATE reviews SET status = 'approved', moderated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ status: 'approved' });
});

app.post('/api/admin/reviews/:id/reject', requireAdmin, (req, res) => {
  const result = db
    .prepare(`UPDATE reviews SET status = 'rejected', moderated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ status: 'rejected' });
});

// Permanently remove a review (e.g. an approved one you no longer want live).
// DELETE /api/admin/reviews/:id
app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  const result = db.prepare(`DELETE FROM reviews WHERE id = ?`).run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ status: 'deleted' });
});

app.get('/', (req, res) => {
  res.type('text/plain').send('Community reviews API is running. See /admin for the moderation dashboard.');
});

app.listen(PORT, () => {
  console.log(`Community reviews backend listening on port ${PORT}`);
});

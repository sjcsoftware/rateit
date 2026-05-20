require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();

const rawPort = process.env.PORT;
const PORT = rawPort !== undefined ? Number(rawPort) : 3001;

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

const dbPath = process.env.DB_PATH || path.join(__dirname, 'ratings.db');
const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    spotify_client_id TEXT NOT NULL,
    spotify_client_secret TEXT NOT NULL,
    profile_picture TEXT,
    custom_criteria TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS albums (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    cover_url TEXT,
    overall_score REAL,
    one_line_review TEXT,
    long_review TEXT,
    score_flow REAL,
    score_production REAL,
    score_lyricism REAL,
    score_originality REAL,
    score_replay REAL,
    release_year INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    album_id TEXT NOT NULL,
    title TEXT NOT NULL,
    track_number INTEGER,
    score REAL,
    notes TEXT,
    FOREIGN KEY (album_id) REFERENCES albums(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS wishlist (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    cover_url TEXT,
    release_year INTEGER,
    user_id INTEGER REFERENCES users(id),
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS collection_albums (
    collection_id INTEGER NOT NULL,
    album_id TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, album_id),
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
    FOREIGN KEY (album_id) REFERENCES albums(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    overall_score REAL,
    rated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ── Migrations ────────────────────────────────────────────────
const migrations = [
  `ALTER TABLE albums ADD COLUMN user_id INTEGER REFERENCES users(id)`,
  `ALTER TABLE albums ADD COLUMN genres TEXT`,
  `ALTER TABLE albums ADD COLUMN score_flow REAL`,
  `ALTER TABLE albums ADD COLUMN score_production REAL`,
  `ALTER TABLE albums ADD COLUMN score_lyricism REAL`,
  `ALTER TABLE albums ADD COLUMN score_originality REAL`,
  `ALTER TABLE albums ADD COLUMN score_replay REAL`,
  `ALTER TABLE albums ADD COLUMN long_review TEXT`,
  `ALTER TABLE albums ADD COLUMN release_year INTEGER`,
  `ALTER TABLE albums ADD COLUMN extra_criteria TEXT`,
  `ALTER TABLE albums ADD COLUMN criteria_snapshot TEXT`,
  `ALTER TABLE tracks ADD COLUMN notes TEXT`,
  `ALTER TABLE users ADD COLUMN custom_criteria TEXT`,
];
migrations.forEach(sql => { try { db.exec(sql); } catch {} });

// ── Password Helpers ──────────────────────────────────────────
function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, storedHash) {
  return hashPassword(password, salt) === storedHash;
}

// ── Spotify Token Cache (per user) ────────────────────────────
const spotifyTokenCache = new Map();

async function getSpotifyToken(userId, clientId, clientSecret) {
  const cached = spotifyTokenCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    'https://accounts.spotify.com/api/token',
    'grant_type=client_credentials',
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      }
    }
  );

  const token = response.data.access_token;
  const expiresAt = Date.now() + (response.data.expires_in - 60) * 1000;
  spotifyTokenCache.set(userId, { token, expiresAt });
  return token;
}

function getUserCredentials(userId) {
  const user = db.prepare(
    'SELECT spotify_client_id, spotify_client_secret FROM users WHERE id = ?'
  ).get(userId);
  if (!user) throw new Error('User not found');
  return { clientId: user.spotify_client_id, clientSecret: user.spotify_client_secret };
}

// ── Auth Endpoints ────────────────────────────────────────────

app.get('/api/auth/has-users', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
  res.json({ hasUsers: row.count > 0 });
});

app.post('/api/auth/register', (req, res) => {
  const { username, password, spotifyClientId, spotifyClientSecret } = req.body;

  if (!username || !password || !spotifyClientId || !spotifyClientSecret) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 2–32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const salt = generateSalt();
  const hash = hashPassword(password, salt);

  try {
    const result = db.prepare(
      `INSERT INTO users (username, password_hash, password_salt, spotify_client_id, spotify_client_secret)
       VALUES (?, ?, ?, ?, ?)`
    ).run(username, hash, salt, spotifyClientId, spotifyClientSecret);

    const userId = result.lastInsertRowid;
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount === 1) {
      db.prepare('UPDATE albums SET user_id = ? WHERE user_id IS NULL').run(userId);
    }

    const user = db.prepare(
      'SELECT id, username, profile_picture, custom_criteria, created_at FROM users WHERE id = ?'
    ).get(userId);

    res.json({
      id: user.id,
      username: user.username,
      profilePicture: user.profile_picture || null,
      customCriteria: user.custom_criteria ? JSON.parse(user.custom_criteria) : null,
      createdAt: user.created_at
    });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare(
    'SELECT id, username, password_hash, password_salt, profile_picture, custom_criteria, created_at FROM users WHERE username = ?'
  ).get(username);

  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  res.json({
    id: user.id,
    username: user.username,
    profilePicture: user.profile_picture || null,
    customCriteria: user.custom_criteria ? JSON.parse(user.custom_criteria) : null,
    createdAt: user.created_at
  });
});

app.get('/api/auth/account-details', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const user = db.prepare(
    'SELECT id, username, spotify_client_id, spotify_client_secret, custom_criteria FROM users WHERE id = ?'
  ).get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({
    id: user.id,
    username: user.username,
    spotifyClientId: user.spotify_client_id,
    spotifyClientSecret: user.spotify_client_secret,
    customCriteria: user.custom_criteria ? JSON.parse(user.custom_criteria) : null
  });
});

app.put('/api/auth/password', (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;
  if (!userId || !currentPassword || !newPassword) return res.status(400).json({ error: 'All fields required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

  const user = db.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?').get(userId);
  if (!user || !verifyPassword(currentPassword, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newSalt = generateSalt();
  const newHash = hashPassword(newPassword, newSalt);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(newHash, newSalt, userId);
  res.json({ success: true });
});

app.put('/api/auth/spotify-credentials', async (req, res) => {
  const { userId, newClientId, newClientSecret } = req.body;
  if (!userId || !newClientId || !newClientSecret) {
    return res.status(400).json({ error: 'All fields required' });
  }

  // Validate the credentials by requesting a Spotify token
  try {
    const credentials = Buffer.from(`${newClientId}:${newClientSecret}`).toString('base64');
    await axios.post(
      'https://accounts.spotify.com/api/token',
      'grant_type=client_credentials',
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`
        }
      }
    );
  } catch {
    return res.status(401).json({ error: 'Invalid Spotify credentials — please check your Client ID and Secret' });
  }

  db.prepare('UPDATE users SET spotify_client_id = ?, spotify_client_secret = ? WHERE id = ?')
    .run(newClientId, newClientSecret, userId);
  // Invalidate cached token so the new credentials are used immediately
  spotifyTokenCache.delete(userId);
  res.json({ success: true });
});

app.put('/api/auth/profile-picture', (req, res) => {
  const { userId, imageData } = req.body;
  if (!userId || !imageData) return res.status(400).json({ error: 'userId and imageData required' });

  try {
    db.prepare('UPDATE users SET profile_picture = ? WHERE id = ?').run(imageData, userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Profile picture update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile picture' });
  }
});

// ── Custom Criteria ───────────────────────────────────────────

app.get('/api/criteria', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const user = db.prepare('SELECT custom_criteria FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const criteria = user.custom_criteria ? JSON.parse(user.custom_criteria) : null;
  res.json({ criteria });
});

app.put('/api/criteria', (req, res) => {
  const { userId, criteria } = req.body;
  if (!userId || !criteria) return res.status(400).json({ error: 'userId and criteria required' });
  if (!Array.isArray(criteria) || criteria.length < 1) return res.status(400).json({ error: 'criteria must be a non-empty array' });

  try {
    db.prepare('UPDATE users SET custom_criteria = ? WHERE id = ?').run(JSON.stringify(criteria), userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update criteria' });
  }
});

// ── Stats Endpoint ────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const albums = db.prepare(
      'SELECT id, title, artist, cover_url, overall_score, genres FROM albums WHERE user_id = ?'
    ).all(userId);

    const total = albums.length;
    const scored = albums.filter(a => a.overall_score != null);
    const averageRating = scored.length > 0
      ? scored.reduce((sum, a) => sum + a.overall_score, 0) / scored.length
      : null;

    const genreCounts = {};
    const allGenres = new Set();
    albums.forEach(a => {
      let genres = [];
      try { genres = JSON.parse(a.genres || '[]'); } catch {}
      genres.forEach(g => {
        if (g) { genreCounts[g] = (genreCounts[g] || 0) + 1; allGenres.add(g); }
      });
    });

    const topGenres = Object.entries(genreCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count }));

    const genresExplored = allGenres.size;

    const artistCounts = {};
    albums.forEach(a => {
      if (a.artist) artistCounts[a.artist] = (artistCounts[a.artist] || 0) + 1;
    });

    const topArtists = Object.entries(artistCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([artist, count]) => ({ artist, count }));

    // Top 3 for Hall of Fame
    const topAlbums = [...scored]
      .sort((a, b) => b.overall_score - a.overall_score)
      .slice(0, 3)
      .map(a => ({ id: a.id, title: a.title, artist: a.artist, cover_url: a.cover_url, overall_score: a.overall_score }));

    const ratingDistribution = {};
    for (let i = 0; i < 10; i++) ratingDistribution[`${i}-${i + 1}`] = 0;
    scored.forEach(a => {
      const s = a.overall_score;
      if (s == null || s < 0) return;
      const bucket = Math.min(9, Math.floor(s));
      ratingDistribution[`${bucket}-${bucket + 1}`]++;
    });

    const recentAlbums = db.prepare(
      `SELECT id, title, artist, cover_url, overall_score, created_at
       FROM albums WHERE user_id = ? AND overall_score IS NOT NULL
       ORDER BY created_at DESC LIMIT 4`
    ).all(userId);

    res.json({ albumsRated: total, averageRating, topGenres, topArtists, topAlbums, genresExplored, ratingDistribution, recentAlbums });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── Wrapped Stats ─────────────────────────────────────────────
app.get('/api/wrapped', (req, res) => {
  const { userId, year } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const targetYear = year ? parseInt(year) : new Date().getFullYear();

  try {
    const albums = db.prepare(
      `SELECT id, title, artist, cover_url, overall_score, genres, created_at
       FROM albums WHERE user_id = ? AND strftime('%Y', created_at) = ?`
    ).all(userId, String(targetYear));

    const total = albums.length;
    const scored = albums.filter(a => a.overall_score != null);
    const avg = scored.length > 0 ? scored.reduce((s, a) => s + a.overall_score, 0) / scored.length : null;

    // Monthly breakdown
    const monthly = {};
    for (let m = 1; m <= 12; m++) monthly[m] = 0;
    albums.forEach(a => {
      const m = parseInt(a.created_at.slice(5, 7));
      monthly[m] = (monthly[m] || 0) + 1;
    });

    const mostActiveMonth = Object.entries(monthly).sort(([, a], [, b]) => b - a)[0];

    const genreCounts = {};
    albums.forEach(a => {
      let genres = [];
      try { genres = JSON.parse(a.genres || '[]'); } catch {}
      genres.forEach(g => { if (g) genreCounts[g] = (genreCounts[g] || 0) + 1; });
    });
    const topGenre = Object.entries(genreCounts).sort(([, a], [, b]) => b - a)[0];

    const highest = scored.length ? scored.reduce((best, a) => a.overall_score > best.overall_score ? a : best) : null;
    const lowest = scored.length ? scored.reduce((worst, a) => a.overall_score < worst.overall_score ? a : worst) : null;

    res.json({ year: targetYear, total, avg, monthly, mostActiveMonth: mostActiveMonth ? { month: +mostActiveMonth[0], count: mostActiveMonth[1] } : null, topGenre: topGenre ? { genre: topGenre[0], count: topGenre[1] } : null, highest, lowest });
  } catch (err) {
    console.error('Wrapped error:', err.message);
    res.status(500).json({ error: 'Failed to fetch wrapped stats' });
  }
});

// ── Rating History ────────────────────────────────────────────
app.get('/api/rating-history/:albumId', (req, res) => {
  const { albumId } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const history = db.prepare(
      'SELECT overall_score, rated_at FROM rating_history WHERE album_id = ? AND user_id = ? ORDER BY rated_at ASC'
    ).all(albumId, userId);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ── Wishlist Endpoints ────────────────────────────────────────
app.get('/api/wishlist', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const items = db.prepare('SELECT * FROM wishlist WHERE user_id = ? ORDER BY added_at DESC').all(userId);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch wishlist' });
  }
});

app.post('/api/wishlist', (req, res) => {
  const { id, title, artist, cover_url, release_year, userId } = req.body;
  if (!id || !title || !artist || !userId) return res.status(400).json({ error: 'Missing required fields' });

  try {
    db.prepare(
      `INSERT OR IGNORE INTO wishlist (id, title, artist, cover_url, release_year, user_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, title, artist, cover_url || null, release_year || null, userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Wishlist add error:', err.message);
    res.status(500).json({ error: 'Failed to add to wishlist' });
  }
});

app.delete('/api/wishlist/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    db.prepare('DELETE FROM wishlist WHERE id = ? AND user_id = ?').run(id, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from wishlist' });
  }
});

// ── Collections Endpoints ─────────────────────────────────────
app.get('/api/collections', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const cols = db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    const result = cols.map(c => {
      const albums = db.prepare(
        `SELECT a.id, a.title, a.artist, a.cover_url, a.overall_score
         FROM albums a JOIN collection_albums ca ON ca.album_id = a.id
         WHERE ca.collection_id = ?`
      ).all(c.id);
      return { ...c, albums };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

app.post('/api/collections', (req, res) => {
  const { name, userId } = req.body;
  if (!name || !userId) return res.status(400).json({ error: 'name and userId required' });

  try {
    const result = db.prepare('INSERT INTO collections (name, user_id) VALUES (?, ?)').run(name, userId);
    res.json({ id: result.lastInsertRowid, name, userId });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create collection' });
  }
});

app.put('/api/collections/:id', (req, res) => {
  const { id } = req.params;
  const { name, userId } = req.body;
  if (!name || !userId) return res.status(400).json({ error: 'name and userId required' });

  try {
    db.prepare('UPDATE collections SET name = ? WHERE id = ? AND user_id = ?').run(name, id, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename collection' });
  }
});

app.delete('/api/collections/:id', (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

app.post('/api/collections/:id/albums', (req, res) => {
  const { id } = req.params;
  const { albumId } = req.body;
  if (!albumId) return res.status(400).json({ error: 'albumId required' });

  try {
    db.prepare('INSERT OR IGNORE INTO collection_albums (collection_id, album_id) VALUES (?, ?)').run(id, albumId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add album to collection' });
  }
});

app.delete('/api/collections/:id/albums/:albumId', (req, res) => {
  const { id, albumId } = req.params;

  try {
    db.prepare('DELETE FROM collection_albums WHERE collection_id = ? AND album_id = ?').run(id, albumId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove album from collection' });
  }
});

// ── Export ────────────────────────────────────────────────────
app.get('/api/export', (req, res) => {
  const { userId, format } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const albums = db.prepare(
      `SELECT a.*, COALESCE(json_group_array(
          CASE WHEN t.id IS NOT NULL
            THEN json_object('id', t.id, 'title', t.title, 'track_number', t.track_number, 'score', t.score, 'notes', t.notes)
            ELSE NULL END
        ), '[]') as tracks
       FROM albums a LEFT JOIN tracks t ON t.album_id = a.id
       WHERE a.user_id = ? GROUP BY a.id ORDER BY a.created_at DESC`
    ).all(userId);

    const parsed = albums.map(row => {
      let tracks = [];
      try { tracks = JSON.parse(row.tracks).filter(t => t && t.id); } catch {}
      let genres = [];
      try { genres = JSON.parse(row.genres || '[]'); } catch {}
      return { ...row, tracks, genres };
    });

    if (format === 'csv') {
      const escape = v => `"${String(v || '').replace(/"/g, '""')}"`;
      const header = 'Title,Artist,Score,Review,Long Review,Genres,Release Year,Rated Date';
      const rows = parsed.map(a => [
        escape(a.title), escape(a.artist),
        a.overall_score != null ? a.overall_score.toFixed(1) : '',
        escape(a.one_line_review), escape(a.long_review),
        escape(a.genres ? a.genres.join(', ') : ''),
        a.release_year || '',
        escape(a.created_at)
      ].join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.send([header, ...rows].join('\n'));
    } else {
      res.json(parsed);
    }
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── Import ────────────────────────────────────────────────────
app.post('/api/import', (req, res) => {
  const { userId, albums } = req.body;
  if (!userId || !Array.isArray(albums)) return res.status(400).json({ error: 'userId and albums array required' });

  let imported = 0;
  let skipped = 0;

  try {
    const insertAlbum = db.prepare(
      `INSERT OR IGNORE INTO albums
        (id, title, artist, cover_url, overall_score, one_line_review, long_review,
         score_flow, score_production, score_lyricism, score_originality, score_replay,
         user_id, genres, release_year, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertTrack = db.prepare(
      `INSERT OR IGNORE INTO tracks (id, album_id, title, track_number, score, notes) VALUES (?, ?, ?, ?, ?, ?)`
    );

    const txn = db.transaction(() => {
      for (const a of albums) {
        if (!a.id || !a.title || !a.artist) { skipped++; continue; }
        const existing = db.prepare('SELECT id FROM albums WHERE id = ? AND user_id = ?').get(a.id, userId);
        if (existing) { skipped++; continue; }

        const genresJson = Array.isArray(a.genres) ? JSON.stringify(a.genres) : null;
        insertAlbum.run(
          a.id, a.title, a.artist, a.cover_url || null,
          a.overall_score || null, a.one_line_review || null, a.long_review || null,
          a.score_flow || null, a.score_production || null, a.score_lyricism || null,
          a.score_originality || null, a.score_replay || null,
          userId, genresJson, a.release_year || null,
          a.created_at || new Date().toISOString()
        );

        if (Array.isArray(a.tracks)) {
          for (const t of a.tracks) {
            if (t && t.id) insertTrack.run(t.id, a.id, t.title || '', t.track_number || 0, t.score || null, t.notes || null);
          }
        }
        imported++;
      }
    });

    txn();
    res.json({ success: true, imported, skipped });
  } catch (err) {
    console.error('Import error:', err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// ── Session File (persists across launches) ───────────────────
const sessionPath = process.env.CONFIG_PATH
  ? path.join(path.dirname(process.env.CONFIG_PATH), 'rateit_session.json')
  : path.join(__dirname, 'rateit_session.json');

app.get('/api/session', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    res.json(data);
  } catch {
    res.json(null);
  }
});

app.post('/api/session', (req, res) => {
  try {
    fs.writeFileSync(sessionPath, JSON.stringify(req.body));
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.delete('/api/session', (req, res) => {
  try {
    if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
  } catch {}
  res.json({ success: true });
});

// ── Settings (iCloud) ─────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const configPath = process.env.CONFIG_PATH;
  if (!configPath) return res.json({ useICloud: false });

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({ useICloud: !!config.useICloud });
  } catch {
    res.json({ useICloud: false });
  }
});

app.put('/api/settings/icloud', (req, res) => {
  const configPath = process.env.CONFIG_PATH;
  if (!configPath) return res.status(503).json({ error: 'Settings not available' });

  const { enabled } = req.body;
  try {
    let config = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    config.useICloud = !!enabled;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// ── Spotify Endpoints ─────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, userId } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { clientId, clientSecret } = getUserCredentials(userId);
    const token = await getSpotifyToken(userId, clientId, clientSecret);

    const response = await axios.get('https://api.spotify.com/v1/search', {
      headers: { Authorization: `Bearer ${token}` },
      params: { q, type: 'album', limit: 50 }
    });

    const albums = response.data.albums.items.map(album => ({
      id: album.id,
      title: album.name,
      artist: album.artists.map(a => a.name).join(', '),
      cover_url: album.images[0]?.url || '',
      release_date: album.release_date,
      release_year: album.release_date ? parseInt(album.release_date.slice(0, 4)) : null,
      total_tracks: album.total_tracks
    }));

    res.json(albums);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Spotify search failed' });
  }
});

app.get('/api/album/:id/tracks', async (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const { clientId, clientSecret } = getUserCredentials(userId);
    const token = await getSpotifyToken(userId, clientId, clientSecret);

    const albumRes = await axios.get(`https://api.spotify.com/v1/albums/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const album = albumRes.data;
    const artistIds = album.artists.map(a => a.id).join(',');

    const [tracksRes, artistsRes] = await Promise.all([
      axios.get(`https://api.spotify.com/v1/albums/${id}/tracks`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { limit: 50 }
      }),
      axios.get(`https://api.spotify.com/v1/artists`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { ids: artistIds }
      })
    ]);

    let genres = [...new Set(artistsRes.data.artists.flatMap(a => a.genres))].filter(Boolean);
    if (!genres.length && Array.isArray(album.genres)) genres = album.genres.filter(Boolean);
    genres = genres.slice(0, 8);

    const tracks = tracksRes.data.items.map(track => ({
      id: track.id,
      title: track.name,
      track_number: track.track_number,
      duration_ms: track.duration_ms
    }));

    res.json({
      id: album.id,
      title: album.name,
      artist: album.artists.map(a => a.name).join(', '),
      cover_url: album.images[0]?.url || '',
      release_date: album.release_date,
      release_year: album.release_date ? parseInt(album.release_date.slice(0, 4)) : null,
      genres,
      tracks
    });
  } catch (err) {
    console.error('Track fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch album tracks' });
  }
});

app.post('/api/rate', (req, res) => {
  const {
    id, title, artist, cover_url, overall_score, one_line_review, tracks,
    score_flow, score_production, score_lyricism, score_originality, score_replay,
    userId, genres, release_year, extra_criteria, criteria_snapshot
  } = req.body;

  if (!id || !title || !artist) return res.status(400).json({ error: 'Missing required fields' });

  const genresJson = Array.isArray(genres) ? JSON.stringify(genres) : null;
  const extraJson = extra_criteria && typeof extra_criteria === 'object' ? JSON.stringify(extra_criteria) : null;
  const snapshotJson = criteria_snapshot && Array.isArray(criteria_snapshot) ? JSON.stringify(criteria_snapshot) : null;

  try {
    db.prepare(
      `INSERT OR REPLACE INTO albums
        (id, title, artist, cover_url, overall_score, one_line_review,
         score_flow, score_production, score_lyricism, score_originality, score_replay,
         user_id, genres, release_year, extra_criteria, criteria_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      id, title, artist, cover_url, overall_score, one_line_review,
      score_flow, score_production, score_lyricism, score_originality, score_replay,
      userId || null, genresJson, release_year || null, extraJson, snapshotJson
    );

    if (tracks && tracks.length > 0) {
      const stmt = db.prepare(
        `INSERT OR REPLACE INTO tracks (id, album_id, title, track_number, score, notes) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const track of tracks) {
        stmt.run(track.id, id, track.title, track.track_number, track.score, track.notes || null);
      }
    }

    // Record rating history
    if (overall_score != null && userId) {
      db.prepare(
        'INSERT INTO rating_history (album_id, user_id, overall_score) VALUES (?, ?, ?)'
      ).run(id, userId, overall_score);
    }

    // Remove from wishlist if it was there
    if (userId) {
      db.prepare('DELETE FROM wishlist WHERE id = ? AND user_id = ?').run(id, userId);
    }

    res.json({ success: true, id });
  } catch (err) {
    console.error('DB insert error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/saved', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const rows = db.prepare(
      `SELECT a.*, COALESCE(
        json_group_array(
          CASE WHEN t.id IS NOT NULL
            THEN json_object('id', t.id, 'title', t.title, 'track_number', t.track_number, 'score', t.score, 'notes', t.notes)
            ELSE NULL
          END
        ), '[]'
      ) as tracks
      FROM albums a
      LEFT JOIN tracks t ON t.album_id = a.id
      WHERE a.user_id = ?
      GROUP BY a.id
      ORDER BY a.created_at DESC`
    ).all(userId);

    const albums = rows.map(row => {
      let tracks = [];
      try { tracks = JSON.parse(row.tracks).filter(t => t !== null && t.id !== null); } catch {}
      return { ...row, tracks };
    });

    res.json(albums);
  } catch (err) {
    console.error('DB fetch error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ── Rated album IDs (for duplicate detection) ─────────────────
app.get('/api/rated-ids', (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const rows = db.prepare('SELECT id, overall_score FROM albums WHERE user_id = ?').all(userId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rated IDs' });
  }
});

module.exports.ready = new Promise((resolve) => {
  const httpServer = app.listen(PORT, () => {
    const port = httpServer.address().port;
    console.log(`RateIt server running on http://localhost:${port}`);
    resolve(port);
  });
});

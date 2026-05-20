const API_BASE = '';

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => ctx.querySelectorAll(sel);

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('show'));
  });
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function placeholderImg() {
  return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect fill='%231e1e3a' width='100' height='100'/%3E%3Ctext x='50' y='54' text-anchor='middle' fill='%23555' font-size='28'%3E%F0%9F%8E%B5%3C/text%3E%3C/svg%3E";
}

function safeImg(url) { return url || placeholderImg(); }

function formatMemberSince(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `Member since ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
}

// ── Color extraction from album cover ────────────────────────
const _colorCache = new Map();

function extractDominantColor(coverUrl) {
  if (_colorCache.has(coverUrl)) return Promise.resolve(_colorCache.get(coverUrl));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 40; canvas.height = 40;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 40, 40);
        const data = ctx.getImageData(0, 0, 40, 40).data;
        let best = [167, 139, 250], bestScore = 0;
        for (let i = 0; i < data.length; i += 12) {
          const r = data[i], g = data[i+1], b = data[i+2];
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const l = (max + min) / 510;
          const s = max === min ? 0 : (max - min) / (l < 0.5 ? max + min : 510 - max - min);
          const score = s * (1 - Math.abs(l - 0.45) * 2);
          if (score > bestScore) { bestScore = score; best = [r, g, b]; }
        }
        _colorCache.set(coverUrl, best);
        resolve(best);
      } catch { resolve([167, 139, 250]); }
    };
    img.onerror = () => resolve([167, 139, 250]);
    img.src = coverUrl;
  });
}

// ── Default / Active Criteria ────────────────────────────────
const DEFAULT_CRITERIA = [
  { id: 'tracks',      label: 'Track Scores', weight: 50 },
  { id: 'flow',        label: 'Flow',         weight: 10 },
  { id: 'production',  label: 'Production',   weight: 10 },
  { id: 'lyricism',    label: 'Lyricism',     weight: 10 },
  { id: 'originality', label: 'Originality',  weight: 10 },
  { id: 'replay',      label: 'Replay',       weight: 10 },
];

function getActiveCriteria() {
  return window.activeCriteria || DEFAULT_CRITERIA;
}

function getNonTrackCriteria() {
  return getActiveCriteria().filter(c => c.id !== 'tracks');
}

// ── Offline Search Cache ─────────────────────────────────────
const SEARCH_CACHE_KEY = 'rateit_search_cache';
const SEARCH_CACHE_MAX = 20;

function getSearchCache() {
  try { return JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || '{}'); } catch { return {}; }
}

function saveSearchCache(query, results) {
  const cache = getSearchCache();
  cache[query.toLowerCase()] = { results, ts: Date.now() };
  const keys = Object.keys(cache).sort((a, b) => cache[b].ts - cache[a].ts);
  if (keys.length > SEARCH_CACHE_MAX) keys.slice(SEARCH_CACHE_MAX).forEach(k => delete cache[k]);
  try { localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(cache)); } catch {}
}

function getCachedSearch(query) {
  const cache = getSearchCache();
  const entry = cache[query.toLowerCase()];
  return entry ? entry.results : null;
}

// ── API Layer ────────────────────────────────────────────────
const API = {
  async hasUsers() {
    const res = await fetch(`${API_BASE}/api/auth/has-users`);
    if (!res.ok) throw new Error('Request failed');
    return res.json();
  },

  async register(username, password, spotifyClientId, spotifyClientSecret) {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, spotifyClientId, spotifyClientSecret })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  },

  async login(username, password) {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    return data;
  },

  async getAccountDetails(userId) {
    const res = await fetch(`${API_BASE}/api/auth/account-details?userId=${userId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch account details');
    return data;
  },

  async changePassword(userId, currentPassword, newPassword) {
    const res = await fetch(`${API_BASE}/api/auth/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to change password');
    return data;
  },

  async updateSpotifyCredentials(userId, newClientId, newClientSecret) {
    const res = await fetch(`${API_BASE}/api/auth/spotify-credentials`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, newClientId, newClientSecret })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update Spotify credentials');
    return data;
  },

  async updateProfilePicture(userId, imageData) {
    const res = await fetch(`${API_BASE}/api/auth/profile-picture`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, imageData })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to update profile picture');
    return data;
  },

  async getStats(userId) {
    const res = await fetch(`${API_BASE}/api/stats?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  async getWrapped(year) {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/wrapped?userId=${userId}&year=${year}`);
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async getCriteria(userId) {
    const res = await fetch(`${API_BASE}/api/criteria?userId=${userId}`);
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async saveCriteria(userId, criteria) {
    const res = await fetch(`${API_BASE}/api/criteria`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, criteria })
    });
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async search(query) {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&userId=${userId}`);
    if (!res.ok) throw new Error('Search failed');
    return res.json();
  },

  async getAlbumTracks(albumId) {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/album/${albumId}/tracks?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch tracks');
    return res.json();
  },

  async rate(data) {
    const res = await fetch(`${API_BASE}/api/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, userId: window.currentUser?.id })
    });
    if (!res.ok) throw new Error('Failed to save rating');
    return res.json();
  },

  async getSaved() {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/saved?userId=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch saved albums');
    return res.json();
  },

  async getRatedIds() {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/rated-ids?userId=${userId}`);
    if (!res.ok) throw new Error('Failed');
    return res.json();
  },

  async exportLibrary(format) {
    const userId = window.currentUser?.id;
    const res = await fetch(`${API_BASE}/api/export?userId=${userId}&format=${format}`);
    if (!res.ok) throw new Error('Export failed');
    return format === 'csv' ? res.text() : res.json();
  },
};

// ── Star Rating Component ─────────────────────────────────────
class StarRating {
  constructor(container, max = 5, onChange) {
    this.container = container;
    this.max = max;
    this.value = 0;
    this.onChange = onChange;
    this._build();
  }

  _build() {
    this.container.className = 'stars';
    this.container.innerHTML = '';
    for (let i = 1; i <= this.max; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.textContent = '★';
      s.dataset.v = i;
      s.addEventListener('click', () => this.set(i));
      s.addEventListener('mouseenter', () => this._light(i));
      s.addEventListener('mouseleave', () => this._light(this.value));
      this.container.appendChild(s);
    }
  }

  _light(upTo) {
    this.container.querySelectorAll('.star').forEach((s, i) => {
      s.classList.toggle('lit', i < upTo);
    });
  }

  set(val) {
    this.value = val;
    this._light(val);
    if (this.onChange) this.onChange(val);
  }

  get() { return this.value; }
}

// ── Rating Controller ─────────────────────────────────────────
class RatingController {
  constructor(album, initialTrackScores = {}, initialCriteriaScores = {}, initialReview = '', savedOverallScore = 0, onBack, onSaved, albumCriteria = null, isFromLibrary = false) {
    this.album = album;
    this.trackScores = { ...initialTrackScores };
    this.criteriaScores = { ...initialCriteriaScores };
    this.initialReview = initialReview;
    this.savedOverallScore = savedOverallScore;
    this.overallScore = savedOverallScore;
    this.onBack = onBack;
    this.onSaved = onSaved;
    this.albumCriteria = albumCriteria || getActiveCriteria();
    this.isFromLibrary = isFromLibrary;
  }

  _getNonTrackCriteria() {
    return this.albumCriteria.filter(c => c.id !== 'tracks' && c.weight > 0);
  }

  _autoCalculate() {
    const config = this.albumCriteria;
    const tracksWeight = (config.find(c => c.id === 'tracks') || { weight: 50 }).weight;
    const criteriaConfig = config.filter(c => c.id !== 'tracks');

    const ratedTracks = Object.values(this.trackScores).filter(s => s > 0);
    const trackAvg = ratedTracks.length
      ? ratedTracks.reduce((a, b) => a + b, 0) / ratedTracks.length : 0;

    const trackPoints = (trackAvg / 5) * tracksWeight;
    const criteriaPoints = criteriaConfig.reduce((sum, c) => {
      return sum + ((this.criteriaScores[c.id] || 0) / 5) * c.weight;
    }, 0);

    return Math.round(trackPoints + criteriaPoints) / 10;
  }

  _allRated() {
    const allTracks = this.album.tracks.every(t => (this.trackScores[t.id] || 0) > 0);
    const allCriteria = this._getNonTrackCriteria().every(c => (this.criteriaScores[c.id] || 0) > 0);
    return allTracks && allCriteria;
  }

  _updateScoreDisplay() {
    const display = document.getElementById('overall-display');
    if (!display) return;
    if (this._allRated()) {
      const score = this._autoCalculate();
      this.overallScore = score;
      display.innerHTML = `${score.toFixed(1)}<span class="score-suffix"> / 10</span>`;
    } else if (this.savedOverallScore) {
      this.overallScore = this.savedOverallScore;
      display.innerHTML = `${this.savedOverallScore.toFixed(1)}<span class="score-suffix"> / 10</span>`;
    } else {
      this.overallScore = 0;
      display.innerHTML = `–<span class="score-suffix"> / 10</span>`;
    }
  }

  mount(container, backLabel = '← Back to search') {
    this._container = container;
    this._backLabel = backLabel;
    const album = this.album;
    const year = album.release_date?.split('-')[0] || '';
    const criteria = this._getNonTrackCriteria();

    container.innerHTML = `
      <div class="rating-panel">
        <button class="back-btn" id="back-btn" aria-label="Go back">${backLabel}</button>

        <div class="album-header">
          <img class="album-header-cover" src="${safeImg(album.cover_url)}"
            alt="${album.title}" onerror="this.src='${placeholderImg()}'">
          <div class="album-header-info">
            <h1 class="album-header-title">${album.title}</h1>
            <div class="album-header-artist">${album.artist}</div>
            <div class="album-header-meta">${[year, `${album.tracks.length} tracks`].filter(Boolean).join(' · ')}</div>
            <div class="album-header-actions">
              <button class="album-action-btn" id="open-spotify-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                Open in Spotify
              </button>
            </div>
          </div>
        </div>

        <div class="rating-columns">
          <div class="rating-col">
            <div class="section-label">Track Ratings</div>
            <div class="tracks-list" id="tracks-list">
              ${album.tracks.map(t => `
                <div class="track-row">
                  <span class="track-num">${t.track_number}</span>
                  <span class="track-name">${t.title}</span>
                  <div class="stars" id="stars-${t.id}"></div>
                  <span class="track-score-val" id="sv-${t.id}">${this.trackScores[t.id] || '–'}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <div class="rating-col">
            <div class="section-label">Album Qualities</div>
            <div class="criteria-list">
              ${criteria.map(c => `
                <div class="criteria-row">
                  <div class="criteria-info">
                    <span class="criteria-label">${c.label}</span>
                  </div>
                  <div class="stars" id="cstars-${c.id}"></div>
                  <span class="track-score-val" id="csv-${c.id}">${this.criteriaScores[c.id] || '–'}</span>
                </div>
              `).join('')}
            </div>

            <div class="section-label" style="margin-top: 24px;">Overall Score</div>
            <div class="overall-section">
              <div class="overall-score-display" id="overall-display">
                –<span class="score-suffix"> / 10</span>
              </div>
              <p class="score-hint">Auto-calculated from track & quality ratings</p>
            </div>

            <div class="section-label">One-Line Review</div>
            <input type="text" class="review-input" id="review-input"
              placeholder="Your quick take on this album…" maxlength="200">

            <button class="save-btn" id="save-btn">Save Rating</button>
            ${this.isFromLibrary ? `<button class="refresh-criteria-btn" id="refresh-criteria-btn">↻ Refresh Criteria</button>` : ''}
          </div>
        </div>
      </div>
    `;

    const reviewInput = document.getElementById('review-input');
    if (reviewInput && this.initialReview) reviewInput.value = this.initialReview;

    document.getElementById('open-spotify-btn')?.addEventListener('click', () => {
      window.open(`spotify:album:${this.album.id}`);
    });

    album.tracks.forEach(t => {
      const starContainer = document.getElementById(`stars-${t.id}`);
      if (!starContainer) return;
      const sr = new StarRating(starContainer, 5, val => {
        this.trackScores[t.id] = val;
        const sv = document.getElementById(`sv-${t.id}`);
        if (sv) sv.textContent = val;
        this._updateScoreDisplay();
      });
      if (this.trackScores[t.id]) sr.set(this.trackScores[t.id]);
    });

    criteria.forEach(c => {
      const starContainer = document.getElementById(`cstars-${c.id}`);
      if (!starContainer) return;
      const sr = new StarRating(starContainer, 5, val => {
        this.criteriaScores[c.id] = val;
        const sv = document.getElementById(`csv-${c.id}`);
        if (sv) sv.textContent = val;
        this._updateScoreDisplay();
      });
      if (this.criteriaScores[c.id] != null && this.criteriaScores[c.id] > 0) {
        sr.set(Math.round(this.criteriaScores[c.id]));
      }
    });

    this._updateScoreDisplay();

    document.getElementById('back-btn').addEventListener('click', () => {
      if (this.onBack) this.onBack();
    });

    document.getElementById('save-btn').addEventListener('click', () => this._save());

    if (this.isFromLibrary) {
      document.getElementById('refresh-criteria-btn').addEventListener('click', () => {
        this.albumCriteria = [...getActiveCriteria()];
        this.criteriaScores = {};
        this.savedOverallScore = 0;
        this.overallScore = 0;
        this.mount(this._container, this._backLabel);
      });
    }
  }

  async _save() {
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

    const extraCriteria = {};
    const standardIds = ['flow', 'production', 'lyricism', 'originality', 'replay'];
    getNonTrackCriteria().forEach(c => {
      if (!standardIds.includes(c.id) && this.criteriaScores[c.id]) {
        extraCriteria[c.id] = this.criteriaScores[c.id];
      }
    });

    const payload = {
      id: this.album.id,
      title: this.album.title,
      artist: this.album.artist,
      cover_url: this.album.cover_url,
      overall_score: this.overallScore,
      one_line_review: document.getElementById('review-input')?.value.trim() || '',
      score_flow: this.criteriaScores.flow || null,
      score_production: this.criteriaScores.production || null,
      score_lyricism: this.criteriaScores.lyricism || null,
      score_originality: this.criteriaScores.originality || null,
      score_replay: this.criteriaScores.replay || null,
      extra_criteria: Object.keys(extraCriteria).length ? extraCriteria : null,
      criteria_snapshot: this.albumCriteria,
      genres: this.album.genres || [],
      release_year: this.album.release_year || null,
      tracks: this.album.tracks.map(t => ({
        id: t.id,
        title: t.title,
        track_number: t.track_number,
        score: this.trackScores[t.id] || 0
      }))
    };

    try {
      await API.rate(payload);
      if (window.ratedAlbums) window.ratedAlbums.set(this.album.id, this.overallScore);
      window.libraryCache = null;
      showToast('Rating saved!', 'success');
      setTimeout(() => {
        if (this.onSaved) this.onSaved();
        else if (this.onBack) this.onBack();
      }, 1400);
    } catch {
      showToast('Failed to save rating', 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Rating'; }
    }
  }
}

// ── Auth View ─────────────────────────────────────────────────
class AuthView {
  render() {
    return `
      <div class="auth-card">
        <div class="auth-logo">
          <svg class="auth-logo-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <path d="M12 2C12 2 15 6 15 12C15 18 12 22 12 22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
            <path d="M12 2C12 2 9 6 9 12C9 18 12 22 12 22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
            <path d="M2 12H22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
          </svg>
          <span class="auth-logo-text">RateIt</span>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">Sign In</button>
          <button class="auth-tab" data-tab="register">Create Account</button>
        </div>

        <div id="login-form">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="login-username" placeholder="your username" autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="login-password" placeholder="••••••••" autocomplete="current-password">
          </div>
          <button class="auth-btn" id="login-btn">Sign In</button>
        </div>

        <div id="register-form" style="display:none">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" class="form-input" id="reg-username" placeholder="choose a username" autocomplete="username">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="reg-password" placeholder="at least 6 characters" autocomplete="new-password">
          </div>
          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input type="password" class="form-input" id="reg-confirm" placeholder="repeat password" autocomplete="new-password">
          </div>

          <div class="form-divider">Spotify Integration</div>

          <div class="spotify-help" id="spotify-help">
            <button class="spotify-help-toggle" id="help-toggle" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              How to get your Spotify credentials
              <span class="spotify-help-toggle-icon">▾</span>
            </button>
            <div class="spotify-help-content">
              <ol class="spotify-help-steps">
                <li class="spotify-help-step"><span class="spotify-help-num">1</span><span>Go to <a class="spotify-help-link" href="#" id="spotify-dev-link">developer.spotify.com/dashboard</a> and log in.</span></li>
                <li class="spotify-help-step"><span class="spotify-help-num">2</span><span>Click <strong>Create App</strong>. Give it any name.</span></li>
                <li class="spotify-help-step"><span class="spotify-help-num">3</span><span>Set Redirect URI to <strong>http://localhost</strong>, check <strong>Web API</strong>, save.</span></li>
                <li class="spotify-help-step"><span class="spotify-help-num">4</span><span>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the app settings.</span></li>
                <li class="spotify-help-step"><span class="spotify-help-num">5</span><span>Paste both values below. Stored only on your device.</span></li>
              </ol>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Spotify Client ID</label>
            <input type="text" class="form-input" id="reg-client-id" placeholder="Paste your Client ID" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">Spotify Client Secret</label>
            <input type="password" class="form-input" id="reg-client-secret" placeholder="Paste your Client Secret" autocomplete="off">
          </div>

          <button class="auth-btn" id="register-btn">Create Account</button>
        </div>
      </div>
    `;
  }

  async init() {
    $$('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.tab));
    });

    document.getElementById('spotify-dev-link')?.addEventListener('click', e => {
      e.preventDefault();
      window.open('https://developer.spotify.com/dashboard', '_blank');
    });

    document.getElementById('help-toggle')?.addEventListener('click', () => {
      document.getElementById('spotify-help')?.classList.toggle('open');
    });

    document.getElementById('login-btn').addEventListener('click', () => this._login());
    document.getElementById('login-username')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('login-password')?.focus();
    });
    document.getElementById('login-password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._login();
    });

    document.getElementById('register-btn').addEventListener('click', () => this._register());

    try {
      const { hasUsers } = await API.hasUsers();
      if (!hasUsers) this._switchTab('register');
    } catch {}
  }

  _switchTab(tabName) {
    $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.getElementById('login-form').style.display = tabName === 'login' ? '' : 'none';
    document.getElementById('register-form').style.display = tabName === 'register' ? '' : 'none';
  }

  async _login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    if (!username || !password) { showToast('Please fill in all fields', 'error'); return; }

    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';

    try {
      const user = await API.login(username, password);
      window.appInstance.onLogin(user);
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
      btn.disabled = false; btn.textContent = 'Sign In';
    }
  }

  async _register() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    const clientId = document.getElementById('reg-client-id').value.trim();
    const clientSecret = document.getElementById('reg-client-secret').value.trim();

    if (!username || !password || !confirm || !clientId || !clientSecret) {
      showToast('Please fill in all fields', 'error'); return;
    }
    if (password !== confirm) { showToast('Passwords do not match', 'error'); return; }
    if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }

    const btn = document.getElementById('register-btn');
    btn.disabled = true; btn.textContent = 'Creating account…';

    try {
      const user = await API.register(username, password, clientId, clientSecret);
      window.appInstance.onLogin(user);
    } catch (err) {
      showToast(err.message || 'Failed to create account', 'error');
      btn.disabled = false; btn.textContent = 'Create Account';
    }
  }
}

// ── Profile View ──────────────────────────────────────────────
class ProfileView {
  render() {
    const user = window.currentUser;
    const avatarContent = user.profilePicture
      ? `<img src="${user.profilePicture}" alt="${user.username}">`
      : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
           <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
           <circle cx="12" cy="12" r="3" fill="currentColor"/>
           <path d="M12 2C12 2 15 6 15 12C15 18 12 22 12 22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
           <path d="M12 2C12 2 9 6 9 12C9 18 12 22 12 22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
           <path d="M2 12H22" stroke="currentColor" stroke-width="1" opacity="0.4"/>
         </svg>`;

    return `
      <div id="profile-view">
        <div class="profile-hero">
          <div class="profile-avatar-large" id="profile-avatar-btn" title="Change profile picture">
            ${avatarContent}
            <div class="profile-avatar-overlay">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              Change
            </div>
          </div>
          <div class="profile-hero-info">
            <div class="profile-username">${user.username}</div>
            <div class="profile-member-since">${formatMemberSince(user.createdAt)}</div>
            <div class="profile-hero-stats" id="hero-stats"></div>
          </div>
        </div>

        <div id="stats-content">
          <div class="loading"><div class="spinner"></div></div>
        </div>

        <div class="profile-actions">
          <button class="profile-action-btn" id="wrapped-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            Year in Review
          </button>
          <button class="profile-action-btn" id="account-details-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Account Details
          </button>
          <button class="profile-action-btn danger" id="sign-out-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    `;
  }

  async init() {
    document.getElementById('profile-avatar-btn').addEventListener('click', () => this._uploadAvatar());
    document.getElementById('account-details-btn').addEventListener('click', () => {
      window.appInstance._navigate('account-details');
    });
    document.getElementById('wrapped-btn').addEventListener('click', () => {
      window.appInstance._navigate('wrapped');
    });
    document.getElementById('sign-out-btn').addEventListener('click', () => {
      window.appInstance.onLogout();
    });
    await this._loadStats();
  }

  async _loadStats() {
    try {
      const stats = await API.getStats(window.currentUser.id);
      this._renderStats(stats);
    } catch {
      document.getElementById('stats-content').innerHTML = `
        <div style="text-align:center; color:var(--text-secondary); padding:32px 0; font-size:0.88rem;">
          Could not load stats. Rate some albums to get started!
        </div>
      `;
    }
  }

  _renderStats(stats) {
    const avgDisplay = stats.averageRating != null ? stats.averageRating.toFixed(1) : '–';
    const topArtistLabel = stats.topArtists?.length
      ? stats.topArtists[0].artist.split(' ').slice(0, 2).join(' ') : null;

    const chips = [
      { value: stats.albumsRated, label: 'Albums Rated' },
      { value: avgDisplay, label: 'Avg Score / 10' },
      { value: stats.genresExplored || 0, label: 'Genres Explored' },
    ];
    if (topArtistLabel && stats.topArtists[0].count > 1) {
      chips.push({ value: stats.topArtists[0].count, label: `${topArtistLabel} albums` });
    }

    document.getElementById('hero-stats').innerHTML = chips.map(c => `
      <div class="hero-stat-chip">
        <div class="hero-stat-chip-value">${c.value}</div>
        <div class="hero-stat-chip-label">${c.label}</div>
      </div>
    `).join('');

    if (stats.albumsRated === 0) {
      document.getElementById('stats-content').innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <p class="empty-state-text">Rate some albums to see your stats here!</p>
        </div>
      `;
      return;
    }

    let html = '';

    if (stats.topAlbums?.length) {
      html += `
        <div class="top-albums-section">
          <div class="top-albums-header">Hall of Fame</div>
          <div class="top-albums-strip">
            ${stats.topAlbums.map((a, i) => `
              <div class="top-album-card rank-${i + 1}" title="${a.title} · ${a.artist}">
                <img src="${safeImg(a.cover_url)}" alt="${a.title}" onerror="this.src='${placeholderImg()}'">
                <div class="top-album-overlay">
                  <div class="top-album-rank">#${i + 1}</div>
                  <div class="top-album-score">${a.overall_score.toFixed(1)}</div>
                  <div class="top-album-title">${a.title}</div>
                  <div class="top-album-artist">${a.artist}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const dist = stats.ratingDistribution || {};
    const distTiers = [
      { key: '9-10', label: '9–10', cls: 'tier-1' },
      { key: '8-9',  label: '8–9',  cls: 'tier-2' },
      { key: '7-8',  label: '7–8',  cls: 'tier-3' },
      { key: '6-7',  label: '6–7',  cls: 'tier-4' },
      { key: '5-6',  label: '5–6',  cls: 'tier-5' },
      { key: '4-5',  label: '4–5',  cls: 'tier-6' },
      { key: '3-4',  label: '3–4',  cls: 'tier-7' },
      { key: '2-3',  label: '2–3',  cls: 'tier-8' },
      { key: '1-2',  label: '1–2',  cls: 'tier-9' },
      { key: '0-1',  label: '0–1',  cls: 'tier-10' },
    ];
    const totalRated = stats.albumsRated || 1;

    // ── Row 1: Genres | Artists ──
    html += `<div class="profile-stats-grid">`;

    html += `<div class="genre-section stats-cell">`;
    if (stats.topGenres?.length) {
      const maxCount = stats.topGenres[0].count;
      html += `<div class="genre-section-title">Top Genres</div>
        ${stats.topGenres.map((g, i) => `
          <div class="genre-row">
            <span class="genre-rank">#${i + 1}</span>
            <span class="genre-name">${g.genre}</span>
            <div class="genre-bar-container"><div class="genre-bar-fill" style="width:${Math.round(g.count / maxCount * 100)}%"></div></div>
            <span class="genre-count">${g.count}</span>
          </div>
        `).join('')}`;
    } else {
      html += `<div class="genre-section-title">Top Genres</div><p style="color:var(--text-secondary);font-size:0.82rem;padding:8px 0">Rate more albums to see genres.</p>`;
    }
    html += `</div>`;

    html += `<div class="genre-section stats-cell">`;
    if (stats.topArtists?.length) {
      html += `<div class="genre-section-title">Top Artists</div>
        ${stats.topArtists.map((a, i) => `
          <div class="genre-row">
            <span class="genre-rank">#${i + 1}</span>
            <span class="genre-name">${a.artist}</span>
            <span class="genre-count">${a.count} ${a.count === 1 ? 'album' : 'albums'}</span>
          </div>
        `).join('')}`;
    } else {
      html += `<div class="genre-section-title">Top Artists</div><p style="color:var(--text-secondary);font-size:0.82rem;padding:8px 0">Rate more albums to see artists.</p>`;
    }
    html += `</div>`;

    // ── Row 2: Distribution | Recently Rated ──
    html += `<div class="genre-section stats-cell dist-section">
      <div class="genre-section-title">Rating Distribution</div>
      ${distTiers.map(t => {
        const count = dist[t.key] || 0;
        const pct = Math.round(count / totalRated * 100);
        return `
        <div class="dist-row">
          <span class="dist-label">${t.label}</span>
          <div class="dist-bar-container"><div class="dist-bar-fill ${t.cls}" style="width:${Math.round(count / totalRated * 100)}%"></div></div>
          <span class="dist-count">${count} (${pct}%)</span>
        </div>`;
      }).join('')}
    </div>`;

    html += `<div class="genre-section stats-cell">
      <div class="genre-section-title">Recently Rated</div>`;
    if (stats.recentAlbums?.length) {
      html += `<div class="recent-albums-list">
        ${stats.recentAlbums.map(a => `
          <div class="recent-album-row">
            <img class="recent-album-cover" src="${safeImg(a.cover_url)}"
              alt="${a.title}" onerror="this.src='${placeholderImg()}'">
            <div class="recent-album-info">
              <div class="recent-album-title">${a.title}</div>
              <div class="recent-album-artist">${a.artist}</div>
            </div>
            <div class="recent-album-score">${a.overall_score != null ? a.overall_score.toFixed(1) : '–'}</div>
          </div>
        `).join('')}
      </div>`;
    } else {
      html += `<p style="color:var(--text-secondary);font-size:0.82rem;padding:8px 0">No rated albums yet.</p>`;
    }
    html += `</div>`;

    html += `</div>`;

    document.getElementById('stats-content').innerHTML = html;
  }

  async _uploadAvatar() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB)', 'error'); return; }
      try {
        const imageData = await this._resizeImage(file);
        await API.updateProfilePicture(window.currentUser.id, imageData);
        window.currentUser.profilePicture = imageData;
        window.appInstance._saveSession(window.currentUser);
        window.appInstance._updateNavProfile();
        const avatarBtn = document.getElementById('profile-avatar-btn');
        if (avatarBtn) {
          const overlay = avatarBtn.querySelector('.profile-avatar-overlay');
          avatarBtn.innerHTML = '';
          const img = document.createElement('img');
          img.src = imageData;
          img.alt = window.currentUser.username;
          avatarBtn.appendChild(img);
          if (overlay) avatarBtn.appendChild(overlay);
        }
        showToast('Profile picture updated!', 'success');
      } catch {
        showToast('Failed to update profile picture', 'error');
      }
    };
    input.click();
  }

  _resizeImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const size = 200;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const min = Math.min(img.width, img.height);
          const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
}

// ── Account Details View ──────────────────────────────────────
class AccountDetailsView {
  constructor() { this._secretRevealed = false; this._secret = ''; }

  render() {
    return `
      <div id="account-details-view">
        <button class="back-btn" id="back-to-profile">← Back to Profile</button>
        <h1 class="view-title">Account Details</h1>

        <div class="details-section" id="credentials-section">
          <div class="loading"><div class="spinner"></div></div>
        </div>

        <div class="details-section">
          <div class="details-section-title">Change Password</div>
          <div class="details-pw-fields">
            <div class="form-group">
              <label class="form-label">Current Password</label>
              <input type="password" class="form-input" id="current-pw" placeholder="••••••••">
            </div>
            <div class="form-group">
              <label class="form-label">New Password</label>
              <input type="password" class="form-input" id="new-pw" placeholder="at least 6 characters">
            </div>
            <div class="form-group">
              <label class="form-label">Confirm New Password</label>
              <input type="password" class="form-input" id="confirm-new-pw" placeholder="repeat new password">
            </div>
          </div>
          <button class="save-btn" id="change-pw-btn">Change Password</button>
        </div>
      </div>
    `;
  }

  async init() {
    document.getElementById('back-to-profile').addEventListener('click', () => {
      window.appInstance._navigate('profile');
    });
    document.getElementById('change-pw-btn').addEventListener('click', () => this._changePassword());
    await this._loadCredentials();
  }

  async _loadCredentials() {
    const section = document.getElementById('credentials-section');
    try {
      const details = await API.getAccountDetails(window.currentUser.id);
      this._secret = details.spotifyClientSecret;
      this._clientId = details.spotifyClientId;
      this._secretRevealed = false;
      section.innerHTML = `
        <div class="details-section-title">Account Info</div>
        <div class="detail-row">
          <span class="detail-key">Username</span>
          <span class="detail-value" style="font-family:inherit">${details.username}</span>
        </div>
        <div class="detail-row">
          <span class="detail-key">Spotify Client ID</span>
          <span class="detail-value" id="client-id-val">${details.spotifyClientId}</span>
          <button class="detail-action-btn" id="copy-id-btn">Copy</button>
        </div>
        <div class="detail-row">
          <span class="detail-key">Spotify Secret</span>
          <span class="detail-value secret" id="secret-val">●●●●●●●●●●●●●●●●</span>
          <button class="detail-action-btn" id="reveal-secret-btn">Reveal</button>
        </div>
        <div id="spotify-edit-form" style="display:none">
          <div class="details-pw-fields" style="margin-top:12px">
            <div class="form-group">
              <label class="form-label">New Client ID</label>
              <input type="text" class="form-input" id="new-client-id" placeholder="Spotify Client ID" autocomplete="off">
            </div>
            <div class="form-group">
              <label class="form-label">New Client Secret</label>
              <input type="password" class="form-input" id="new-client-secret" placeholder="Spotify Client Secret" autocomplete="off">
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="save-btn" id="save-spotify-btn">Save Credentials</button>
            <button class="detail-action-btn" id="cancel-spotify-btn" style="padding:8px 16px">Cancel</button>
          </div>
        </div>
        <button class="detail-action-btn" id="edit-spotify-btn" style="margin-top:12px">Edit Credentials</button>
      `;
      document.getElementById('copy-id-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(this._clientId)
          .then(() => showToast('Client ID copied!', 'success'))
          .catch(() => showToast('Failed to copy', 'error'));
      });
      document.getElementById('reveal-secret-btn').addEventListener('click', () => {
        this._secretRevealed = !this._secretRevealed;
        const el = document.getElementById('secret-val');
        const btn = document.getElementById('reveal-secret-btn');
        if (this._secretRevealed) { el.textContent = this._secret; el.classList.remove('secret'); btn.textContent = 'Hide'; }
        else { el.textContent = '●●●●●●●●●●●●●●●●'; el.classList.add('secret'); btn.textContent = 'Reveal'; }
      });
      document.getElementById('edit-spotify-btn').addEventListener('click', () => {
        document.getElementById('spotify-edit-form').style.display = '';
        document.getElementById('edit-spotify-btn').style.display = 'none';
        document.getElementById('new-client-id').focus();
      });
      document.getElementById('cancel-spotify-btn').addEventListener('click', () => {
        document.getElementById('spotify-edit-form').style.display = 'none';
        document.getElementById('edit-spotify-btn').style.display = '';
        document.getElementById('new-client-id').value = '';
        document.getElementById('new-client-secret').value = '';
      });
      document.getElementById('save-spotify-btn').addEventListener('click', () => this._saveSpotifyCredentials());
    } catch {
      section.innerHTML = `<div class="details-section-title">Account Info</div>
        <p style="color:var(--text-secondary);font-size:0.88rem">Failed to load account details.</p>`;
    }
  }

  async _saveSpotifyCredentials() {
    const newClientId = document.getElementById('new-client-id').value.trim();
    const newClientSecret = document.getElementById('new-client-secret').value.trim();
    if (!newClientId || !newClientSecret) { showToast('Please fill in both fields', 'error'); return; }
    const btn = document.getElementById('save-spotify-btn');
    btn.disabled = true; btn.textContent = 'Validating…';
    try {
      await API.updateSpotifyCredentials(window.currentUser.id, newClientId, newClientSecret);
      showToast('Spotify credentials updated!', 'success');
      await this._loadCredentials();
    } catch (err) {
      showToast(err.message || 'Failed to update credentials', 'error');
      btn.disabled = false; btn.textContent = 'Save Credentials';
    }
  }

  async _changePassword() {
    const currentPw = document.getElementById('current-pw').value;
    const newPw = document.getElementById('new-pw').value;
    const confirmPw = document.getElementById('confirm-new-pw').value;
    if (!currentPw || !newPw || !confirmPw) { showToast('Please fill in all fields', 'error'); return; }
    if (newPw !== confirmPw) { showToast('New passwords do not match', 'error'); return; }
    if (newPw.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
    const btn = document.getElementById('change-pw-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await API.changePassword(window.currentUser.id, currentPw, newPw);
      showToast('Password changed successfully!', 'success');
      document.getElementById('current-pw').value = '';
      document.getElementById('new-pw').value = '';
      document.getElementById('confirm-new-pw').value = '';
    } catch (err) {
      showToast(err.message || 'Failed to change password', 'error');
    }
    btn.disabled = false; btn.textContent = 'Change Password';
  }
}

// ── Wrapped (Year in Review) View ─────────────────────────────
class WrappedView {
  render() {
    const year = new Date().getFullYear();
    return `
      <div id="wrapped-view">
        <button class="back-btn" id="back-to-profile">← Back to Profile</button>
        <div class="wrapped-header">
          <div class="wrapped-title">${year} in Review</div>
          <div class="wrapped-subtitle">Your year of music</div>
        </div>
        <div id="wrapped-content">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  async init() {
    document.getElementById('back-to-profile').addEventListener('click', () => {
      window.appInstance._navigate('profile');
    });
    const year = new Date().getFullYear();
    try {
      const data = await API.getWrapped(year);
      this._render(data);
    } catch {
      document.getElementById('wrapped-content').innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;padding:32px 0">No data for this year yet.</p>';
    }
  }

  _render(data) {
    if (!data.total) {
      document.getElementById('wrapped-content').innerHTML =
        '<p style="color:var(--text-secondary);text-align:center;padding:32px 0">No albums rated this year yet.</p>';
      return;
    }

    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const maxBar = Math.max(...Object.values(data.monthly), 1);

    const chartBars = Object.entries(data.monthly).map(([m, count]) => {
      const isActive = data.mostActiveMonth && +m === data.mostActiveMonth.month;
      const h = Math.round((count / maxBar) * 100);
      return `<div class="wrapped-bar-col ${isActive ? 'active' : ''}">
        <div class="wrapped-bar-fill" style="height:${h}%"></div>
        <div class="wrapped-bar-label">${monthNames[+m - 1]}</div>
      </div>`;
    }).join('');

    // Row 1: 4 stat cards (always 2×2 grid)
    let html = `<div class="wrapped-grid">
      <div class="wrapped-card">
        <div class="wrapped-card-label">Albums Rated</div>
        <div class="wrapped-card-value">${data.total}</div>
        <div class="wrapped-card-sub">this year</div>
      </div>
      <div class="wrapped-card">
        <div class="wrapped-card-label">Average Score</div>
        <div class="wrapped-card-value">${data.avg ? data.avg.toFixed(1) : '–'}</div>
        <div class="wrapped-card-sub">out of 10</div>
      </div>
      <div class="wrapped-card">
        <div class="wrapped-card-label">Most Active Month</div>
        ${data.mostActiveMonth
          ? `<div class="wrapped-card-value" style="font-size:1.5rem">${monthNames[data.mostActiveMonth.month - 1]}</div>
             <div class="wrapped-card-sub">${data.mostActiveMonth.count} albums rated</div>`
          : `<div class="wrapped-card-value">–</div><div class="wrapped-card-sub">no data yet</div>`}
      </div>
      <div class="wrapped-card">
        <div class="wrapped-card-label">Most Rated Genre</div>
        ${data.topGenre
          ? `<div class="wrapped-card-value" style="font-size:1.2rem;letter-spacing:-0.5px">${data.topGenre.genre}</div>
             <div class="wrapped-card-sub">${data.topGenre.count} albums</div>`
          : `<div class="wrapped-card-value">–</div><div class="wrapped-card-sub">rate more albums</div>`}
      </div>
    </div>`;

    // Row 2: chart full-width + highlights side by side
    const highlightCards = [];
    if (data.highest) {
      highlightCards.push(`<div class="wrapped-card">
        <div class="wrapped-card-label">Highest Rated</div>
        <div class="wrapped-highlight">
          <img class="wrapped-highlight-cover" src="${safeImg(data.highest.cover_url)}" onerror="this.src='${placeholderImg()}'">
          <div>
            <div class="wrapped-highlight-title">${data.highest.title}</div>
            <div class="wrapped-highlight-sub">${data.highest.artist}</div>
            <div class="wrapped-highlight-score">${data.highest.overall_score?.toFixed(1) ?? '–'}</div>
          </div>
        </div>
      </div>`);
    }
    if (data.lowest) {
      highlightCards.push(`<div class="wrapped-card">
        <div class="wrapped-card-label">Lowest Rated</div>
        <div class="wrapped-highlight">
          <img class="wrapped-highlight-cover" src="${safeImg(data.lowest.cover_url)}" onerror="this.src='${placeholderImg()}'">
          <div>
            <div class="wrapped-highlight-title">${data.lowest.title}</div>
            <div class="wrapped-highlight-sub">${data.lowest.artist}</div>
            <div class="wrapped-highlight-score">${data.lowest.overall_score?.toFixed(1) ?? '–'}</div>
          </div>
        </div>
      </div>`);
    }

    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;width:100%">
      <div class="wrapped-card" style="grid-column:1/-1">
        <div class="wrapped-card-label">Albums Per Month</div>
        <div class="wrapped-chart">${chartBars}</div>
      </div>
      ${highlightCards.join('')}
    </div>`;

    document.getElementById('wrapped-content').innerHTML = html;
  }
}

// ── Gallery View ──────────────────────────────────────────────
class GalleryView {
  constructor() {
    this.albums = [];
    this.filtered = [];
    this._focused = null;
    this._flipped = false;
  }

  render() {
    return `
      <div id="gallery-view">
        <div class="gallery-header">
          <h1 class="view-title">Gallery</h1>
          <div class="gallery-search-wrapper">
            <svg class="gallery-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" class="gallery-search-input" id="gallery-search" placeholder="Search albums or artists…">
          </div>
        </div>
        <div id="gallery-grid" class="gallery-grid">
          <div class="loading"><div class="spinner"></div></div>
        </div>
        <div id="gallery-focus-overlay" class="gallery-focus-overlay" style="display:none">
          <div id="gallery-focus-stage" class="gallery-focus-stage">
            <div id="gallery-focus-card" class="gallery-focus-card">
              <div id="gallery-focus-inner" class="gallery-focus-inner">
                <div id="gallery-focus-front" class="gallery-focus-face gallery-focus-front"></div>
                <div id="gallery-focus-back" class="gallery-focus-face gallery-focus-back"></div>
              </div>
            </div>
            <button id="gallery-close-btn" class="gallery-close-btn">×</button>
          </div>
        </div>
      </div>
    `;
  }

  async init() {
    try {
      if (window.libraryCache) {
        this.albums = window.libraryCache;
      } else {
        this.albums = await API.getSaved();
        window.libraryCache = this.albums;
      }
    } catch {
      this.albums = [];
      showToast('Could not load gallery', 'error');
    }
    this.filtered = [...this.albums];
    this._renderGrid();

    document.getElementById('gallery-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      this.filtered = q
        ? this.albums.filter(a => a.title.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q))
        : [...this.albums];
      this._renderGrid();
    });

    document.getElementById('gallery-close-btn').addEventListener('click', () => this._closeFocus());

    document.addEventListener('keydown', this._onKey = (e) => {
      if (e.key === 'Escape' && this._focused) this._closeFocus();
    });
  }

  destroy() {
    if (this._onKey) document.removeEventListener('keydown', this._onKey);
  }

  _renderGrid() {
    const grid = document.getElementById('gallery-grid');
    if (!this.filtered.length) {
      grid.innerHTML = `<div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
        <p class="empty-state-text">${this.albums.length ? 'No results.' : 'No rated albums yet.'}</p>
      </div>`;
      return;
    }

    grid.innerHTML = this.filtered.map(a => {
      const score = a.overall_score != null ? a.overall_score.toFixed(1) : '–';
      return `
        <div class="gallery-card" data-id="${a.id}">
          <img class="gallery-card-img" src="${safeImg(a.cover_url)}" alt="${a.title}"
            crossorigin="anonymous" onerror="this.src='${placeholderImg()}'">
          <div class="gallery-card-overlay">
            <div class="gallery-card-score">${score}</div>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.gallery-card').forEach(card => {
      card.addEventListener('click', () => {
        const album = this.filtered.find(a => a.id === card.dataset.id);
        if (album) this._openFocus(album, card);
      });
    });

    this._applyColorThemes(grid);
  }

  async _applyColorThemes(grid) {
    for (const card of grid.querySelectorAll('.gallery-card')) {
      const img = card.querySelector('.gallery-card-img');
      if (!img || !img.src || img.src === placeholderImg()) continue;
      try {
        const color = await extractDominantColor(img.src);
        card.style.setProperty('--card-accent', `${color[0]}, ${color[1]}, ${color[2]}`);
      } catch {}
    }
  }

  async _openFocus(album, sourceCard) {
    this._focused = album;
    this._flipped = false;

    const overlay = document.getElementById('gallery-focus-overlay');
    const front = document.getElementById('gallery-focus-front');
    const back = document.getElementById('gallery-focus-back');
    const inner = document.getElementById('gallery-focus-inner');
    const focusCard = document.getElementById('gallery-focus-card');

    const score = album.overall_score != null ? album.overall_score.toFixed(1) : '–';

    front.innerHTML = `
      <img class="gallery-focus-cover" src="${safeImg(album.cover_url)}" alt="${album.title}"
        crossorigin="anonymous" onerror="this.src='${placeholderImg()}'">
      <div class="gallery-focus-front-info">
        <div class="gallery-focus-title">${album.title}</div>
        <div class="gallery-focus-artist">${album.artist}</div>
        ${album.one_line_review ? `<div class="gallery-focus-review">"${album.one_line_review}"</div>` : ''}
        <div class="gallery-focus-hint">Click to flip →</div>
      </div>
    `;

    let albumCriteria = DEFAULT_CRITERIA;
    if (album.criteria_snapshot) {
      try {
        const parsed = typeof album.criteria_snapshot === 'string'
          ? JSON.parse(album.criteria_snapshot) : album.criteria_snapshot;
        if (Array.isArray(parsed) && parsed.length) albumCriteria = parsed;
      } catch {}
    }
    const extraScores = (() => {
      try { return album.extra_criteria
        ? (typeof album.extra_criteria === 'string' ? JSON.parse(album.extra_criteria) : album.extra_criteria)
        : {}; } catch { return {}; }
    })();
    const criteria = albumCriteria.filter(c => c.id !== 'tracks' && c.weight > 0);
    const criteriaRows = criteria.map(c => {
      const raw = album[`score_${c.id}`] ?? extraScores[c.id] ?? 0;
      const val = Math.round(raw);
      return `<div class="gallery-back-row">
        <span class="gallery-back-label">${c.label}</span>
        <div class="gallery-back-stars">${'★'.repeat(val)}${'☆'.repeat(5 - val)}</div>
        <span class="gallery-back-val">${val || '–'}</span>
      </div>`;
    }).join('');

    const tracks = Array.isArray(album.tracks) ? album.tracks.filter(t => t && t.score > 0) : [];
    const topTracks = tracks.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 3);

    back.innerHTML = `
      <div class="gallery-back-header">
        <div class="gallery-back-score">${score}<span style="font-size:1rem;font-weight:400;color:rgba(255,255,255,0.4)"> / 10</span></div>
        <div class="gallery-back-title">${album.title}</div>
      </div>
      <div class="gallery-back-scroll">
        <div class="gallery-back-criteria">${criteriaRows}</div>
        ${topTracks.length ? `
          <div class="gallery-back-section">Top Tracks</div>
          <div class="gallery-back-criteria">
            ${topTracks.map(t => `
              <div class="gallery-back-row">
                <span class="gallery-back-label" style="text-align:right;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title}</span>
                <div class="gallery-back-stars">${'★'.repeat(t.score || 0)}${'☆'.repeat(5 - (t.score || 0))}</div>
                <span class="gallery-back-val"></span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;

    inner.classList.remove('flipped');
    inner.style.transform = '';
    inner.style.transition = '';
    overlay.style.display = 'flex';
    overlay.style.background = '';

    try {
      const coverUrl = album.cover_url;
      if (coverUrl) {
        const color = await extractDominantColor(coverUrl);
        const c = `${color[0]}, ${color[1]}, ${color[2]}`;
        focusCard.style.setProperty('--card-accent', c);
        overlay.style.background = `radial-gradient(ellipse 80% 60% at 50% 40%, rgba(${c}, 0.28) 0%, rgba(0,0,0,0.88) 70%)`;
      }
    } catch {}

    focusCard.onmousemove = null;
    focusCard.onmouseleave = null;

    focusCard.onclick = (e) => {
      if (e.target.closest('#gallery-close-btn')) return;
      this._flipped = !this._flipped;
      inner.style.transition = 'transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)';
      inner.style.transform = this._flipped ? 'rotateY(180deg)' : '';
      setTimeout(() => { inner.style.transition = ''; }, 560);
    };
  }

  _closeFocus() {
    const overlay = document.getElementById('gallery-focus-overlay');
    if (overlay) { overlay.style.display = 'none'; overlay.style.background = ''; }
    this._focused = null;
    this._flipped = false;
    const focusCard = document.getElementById('gallery-focus-card');
    if (focusCard) { focusCard.onmousemove = null; focusCard.onmouseleave = null; focusCard.onclick = null; }
  }
}

// ── Custom Criteria View ──────────────────────────────────────
class CustomCriteriaView {
  constructor() {
    this._draft = [];
  }

  render() {
    return `
      <div id="criteria-view">
        <h1 class="view-title">Custom Criteria</h1>
        <p class="criteria-intro">Adjust how each category contributes to the overall score. All weights must add up to 100%.</p>
        <div id="criteria-editor">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  async init() {
    const current = getActiveCriteria();
    this._draft = current.map(c => ({ ...c }));
    this._renderEditor();
  }

  _renderEditor() {
    const container = document.getElementById('criteria-editor');
    const total = this._draft.reduce((s, c) => s + c.weight, 0);
    const isValid = total === 100;

    container.innerHTML = `
      <div id="criteria-rows"></div>
      <button class="criteria-add-btn" id="add-criteria-btn">+ Add Criteria</button>
      <div class="criteria-total ${isValid ? 'valid' : 'invalid'}" id="criteria-total">
        Total: <strong>${total}%</strong> ${isValid ? '✓' : `(need ${100 - total > 0 ? '+' : ''}${100 - total}% more)`}
      </div>
      <div class="criteria-actions">
        <button class="save-btn" id="save-criteria-btn" ${isValid ? '' : 'disabled'}>Save Criteria</button>
        <button class="criteria-revert-btn" id="revert-criteria-btn">Revert to Default</button>
      </div>
    `;

    this._renderRows();

    document.getElementById('add-criteria-btn').addEventListener('click', () => {
      if (this._draft.length >= 9) { showToast('Maximum 9 criteria', 'error'); return; }
      const id = `custom_${Date.now()}`;
      this._draft.push({ id, label: 'New Criteria', weight: 0 });
      this._renderEditor();
    });

    document.getElementById('save-criteria-btn').addEventListener('click', () => this._save());
    document.getElementById('revert-criteria-btn').addEventListener('click', () => {
      this._draft = DEFAULT_CRITERIA.map(c => ({ ...c }));
      this._renderEditor();
    });
  }

  _renderRows() {
    const container = document.getElementById('criteria-rows');
    container.innerHTML = this._draft.map((c, i) => `
      <div class="criteria-edit-row" data-index="${i}">
        <div class="criteria-edit-top">
          ${c.id === 'tracks'
            ? `<span class="criteria-edit-label-fixed">${c.label}</span>`
            : `<input type="text" class="criteria-edit-name" value="${c.label}" placeholder="Criteria name" maxlength="20">`}
          <span class="criteria-edit-weight-val">${c.weight}%</span>
          ${c.id !== 'tracks' && !['flow','production','lyricism','originality','replay'].includes(c.id)
            ? `<button class="criteria-delete-btn" data-index="${i}" title="Remove">×</button>` : ''}
        </div>
        <input type="range" class="criteria-slider" min="0" max="100" value="${c.weight}" data-index="${i}">
      </div>
    `).join('');

    container.querySelectorAll('.criteria-edit-name').forEach((input, idx) => {
      const actualIdx = parseInt(input.closest('.criteria-edit-row').dataset.index);
      input.addEventListener('input', () => { this._draft[actualIdx].label = input.value; });
    });

    container.querySelectorAll('.criteria-slider').forEach(slider => {
      slider.addEventListener('input', () => {
        const idx = parseInt(slider.dataset.index);
        this._draft[idx].weight = parseInt(slider.value);
        const row = slider.closest('.criteria-edit-row');
        if (row) row.querySelector('.criteria-edit-weight-val').textContent = slider.value + '%';
        const total = this._draft.reduce((s, c) => s + c.weight, 0);
        const isValid = total === 100;
        const totalEl = document.getElementById('criteria-total');
        if (totalEl) {
          totalEl.innerHTML = `Total: <strong>${total}%</strong> ${isValid ? '✓' : `(need ${100 - total > 0 ? '+' : ''}${100 - total}% more)`}`;
          totalEl.className = `criteria-total ${isValid ? 'valid' : 'invalid'}`;
        }
        const saveBtn = document.getElementById('save-criteria-btn');
        if (saveBtn) saveBtn.disabled = !isValid;
      });
    });

    container.querySelectorAll('.criteria-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        this._draft.splice(idx, 1);
        this._renderEditor();
      });
    });
  }

  async _save() {
    const total = this._draft.reduce((s, c) => s + c.weight, 0);
    if (total !== 100) { showToast('Weights must add up to 100%', 'error'); return; }
    if (this._draft.some(c => !c.label.trim())) { showToast('All criteria need a name', 'error'); return; }

    const btn = document.getElementById('save-criteria-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      await API.saveCriteria(window.currentUser.id, this._draft);
      window.activeCriteria = this._draft.map(c => ({ ...c }));
      showToast('Criteria saved!', 'success');
    } catch {
      showToast('Failed to save criteria', 'error');
    }

    btn.disabled = false; btn.textContent = 'Save Criteria';
  }
}

// ── Search View ───────────────────────────────────────────────
class SearchView {
  constructor() {
    this._debounce = null;
  }

  render() {
    return `
      <div id="search-view">
        <div class="search-hero">
          <p class="search-tagline">Hear it. Feel it. Rate it.</p>
          <div class="search-bar-wrapper">
            <svg class="search-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" class="search-input" id="search-input"
              placeholder="Search albums, artists…"
              autocomplete="off" spellcheck="false">
          </div>
          <button class="surprise-btn" id="surprise-btn">🎲 Surprise Me</button>
        </div>
        <div id="search-results"></div>
      </div>
    `;
  }

  init() {
    const input = $('#search-input');
    const view = $('#search-view');
    input.focus();

    input.addEventListener('input', () => {
      clearTimeout(this._debounce);
      const q = input.value.trim();
      if (!q) {
        view.classList.remove('search-active');
        $('#search-results').innerHTML = '';
        return;
      }
      view.classList.add('search-active');
      if (q.length < 2) return;
      this._debounce = setTimeout(() => this._search(q), 480);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(this._debounce);
        const q = input.value.trim();
        if (q) { view.classList.add('search-active'); this._search(q); }
      }
    });

    document.getElementById('surprise-btn').addEventListener('click', () => this._surpriseMe());
  }

  async _search(query) {
    const results = $('#search-results');
    results.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const albums = await API.search(query);
      saveSearchCache(query, albums);
      this._renderGrid(albums);
    } catch (err) {
      const cached = getCachedSearch(query);
      if (cached) {
        showToast('Offline — showing cached results', 'error');
        this._renderGrid(cached);
      } else {
        results.innerHTML = '<p class="hint-text">Search failed. Check your Spotify credentials in Account Details.</p>';
      }
    }
  }

  async _surpriseMe() {
    const btn = document.getElementById('surprise-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Finding…'; }
    const reset = () => { if (btn) { btn.disabled = false; btn.textContent = '🎲 Surprise Me'; } };

    try {
      let albums = [];
      let stats;
      try { stats = await API.getStats(window.currentUser?.id); } catch {}

      // 1. Try top genre as plain search term
      if (!albums.length && stats?.topGenres?.length) {
        const pick = stats.topGenres[Math.floor(Math.random() * Math.min(stats.topGenres.length, 3))].genre;
        try { albums = await API.search(pick); } catch {}
      }

      // 2. Try top artist
      if (!albums.length && stats?.topArtists?.length) {
        const pick = stats.topArtists[Math.floor(Math.random() * stats.topArtists.length)].artist;
        try { albums = await API.search(pick); } catch {}
      }

      // 3. Year fallback
      if (!albums.length) {
        albums = await API.search(`year:${new Date().getFullYear()}`);
      }

      if (!albums.length) throw new Error('No results');

      // Prefer unrated albums
      const unrated = albums.filter(a => !window.ratedAlbums?.has(a.id));
      const pool = unrated.length ? unrated : albums;
      const chosen = pool[Math.floor(Math.random() * pool.length)];

      reset();
      this._openRating(chosen);
    } catch {
      showToast('Could not find a surprise album', 'error');
      reset();
    }
  }

  _renderGrid(albums) {
    const results = $('#search-results');
    if (!albums.length) {
      results.innerHTML = '<p class="hint-text">No albums found. Try a different query.</p>';
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'albums-grid';
    grid.innerHTML = albums.map(a => {
      const ratedScore = window.ratedAlbums?.get(a.id);
      const badge = ratedScore != null
        ? `<span class="card-rated-badge">✓ ${ratedScore.toFixed(1)}</span>` : '';
      return `
        <div class="album-card" data-id="${a.id}" role="button" tabindex="0"
          aria-label="${a.title} by ${a.artist}">
          <img class="album-card-cover" src="${safeImg(a.cover_url)}"
            alt="${a.title}" loading="lazy"
            onerror="this.src='${placeholderImg()}'">
          <div class="album-card-title">${a.title}</div>
          <div class="album-card-artist">${a.artist}</div>
          ${badge ? `<div class="album-card-actions">${badge}</div>` : ''}
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.album-card').forEach(card => {
      const open = () => {
        const a = albums.find(x => x.id === card.dataset.id);
        this._openRating(a);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });

    results.innerHTML = '';
    results.appendChild(grid);
  }

  async _openRating(album) {
    const view = $('#search-view');
    view.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    try {
      const full = await API.getAlbumTracks(album.id);
      const ctrl = new RatingController(
        full, {}, {}, '', 0,
        () => this._resetToSearch(),
        () => window.appInstance._navigate('library')
      );
      ctrl.mount(view);
    } catch {
      showToast('Failed to load album details', 'error');
      this._resetToSearch();
    }
  }

  _resetToSearch() {
    const main = document.getElementById('main-content');
    main.innerHTML = this.render();
    this.init();
  }
}

// ── Library View ──────────────────────────────────────────────
class LibraryView {
  constructor() {
    this.albums = [];
    this.grouping = 'none';
    this.sorting = 'newest';
  }

  render() {
    return `
      <div id="library-view">
        <div class="library-header">
          <div class="library-header-left">
            <h1 class="view-title">Rated Albums</h1>
            <div class="library-controls">
              <select class="control-select" id="group-select" aria-label="Grouping">
                <option value="none">No Grouping</option>
                <option value="artist">Group by Artist</option>
                <option value="genre">Group by Genre</option>
              </select>
              <select class="control-select" id="sort-select" aria-label="Sort order">
                <option value="newest">Newest First</option>
                <option value="highest">Highest Score</option>
                <option value="lowest">Lowest Score</option>
              </select>
            </div>
          </div>
          <div class="library-header-actions">
            <div class="export-dropdown-wrapper">
              <button class="lib-action-btn" id="export-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export
              </button>
              <div class="export-dropdown" id="export-dropdown">
                <div class="export-option" id="export-json">📄 JSON</div>
                <div class="export-option" id="export-csv">📊 CSV</div>
                <div class="export-option" id="export-html">🌐 HTML Page</div>
              </div>
            </div>
          </div>
        </div>
        <div class="library-stats-bar" id="library-stats-bar" style="display:none"></div>
        <div id="library-content">
          <div class="loading"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  async init() {
    try {
      if (window.libraryCache) {
        this.albums = window.libraryCache;
      } else {
        this.albums = await API.getSaved();
        window.libraryCache = this.albums;
      }
    } catch {
      this.albums = [];
      showToast('Could not load library', 'error');
    }
    this._updateStatsBar();
    this._render();

    $('#group-select').addEventListener('change', e => { this.grouping = e.target.value; this._render(); });
    $('#sort-select').addEventListener('change', e => { this.sorting = e.target.value; this._render(); });

    const exportBtn = document.getElementById('export-btn');
    const exportDropdown = document.getElementById('export-dropdown');
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => exportDropdown?.classList.remove('open'));

    document.getElementById('export-json').addEventListener('click', () => this._export('json'));
    document.getElementById('export-csv').addEventListener('click', () => this._export('csv'));
    document.getElementById('export-html').addEventListener('click', () => this._exportHtml());
  }

  async _export(format) {
    document.getElementById('export-dropdown').classList.remove('open');
    try {
      const data = await API.exportLibrary(format);
      const blob = new Blob(
        [format === 'csv' ? data : JSON.stringify(data, null, 2)],
        { type: format === 'csv' ? 'text/csv' : 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `rateit-library.${format}`;
      a.click(); URL.revokeObjectURL(url);
      showToast(`Exported as ${format.toUpperCase()}`, 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  }

  async _exportHtml() {
    document.getElementById('export-dropdown').classList.remove('open');
    try {
      const albums = await API.exportLibrary('json');
      const html = this._buildHtmlPage(albums);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'rateit-library.html';
      a.click(); URL.revokeObjectURL(url);
      showToast('HTML page exported', 'success');
    } catch {
      showToast('Export failed', 'error');
    }
  }

  _buildHtmlPage(albums) {
    const cards = albums.map(a => {
      const score = a.overall_score != null ? a.overall_score.toFixed(1) : '–';
      return `
        <div class="album-card">
          <img src="${a.cover_url || ''}" alt="${a.title}" onerror="this.style.background='#1e1e3a'">
          <div class="album-info">
            <div class="album-title">${a.title}</div>
            <div class="album-artist">${a.artist}</div>
            <div class="album-score">${score}<span class="score-unit"> / 10</span></div>
            ${a.one_line_review ? `<div class="album-review">"${a.one_line_review}"</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>My RateIt Library</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#08081a;color:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;padding:40px 24px}
  h1{font-size:2rem;font-weight:800;background:linear-gradient(135deg,#fff 20%,#a78bfa 60%,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  .subtitle{color:rgba(255,255,255,0.4);font-size:0.9rem;margin-bottom:40px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
  .album-card{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:18px;overflow:hidden;display:flex;gap:16px;padding:16px;transition:transform .2s}
  .album-card:hover{transform:translateY(-3px)}
  .album-card img{width:72px;height:72px;border-radius:10px;object-fit:cover;flex-shrink:0;background:#1e1e3a}
  .album-info{flex:1;min-width:0}
  .album-title{font-weight:700;font-size:0.95rem;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .album-artist{color:rgba(255,255,255,0.5);font-size:0.8rem;margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .album-score{font-size:1.4rem;font-weight:800;color:#a78bfa;line-height:1}
  .score-unit{font-size:0.75rem;font-weight:400;color:rgba(255,255,255,0.4)}
  .album-review{font-size:0.75rem;color:rgba(255,255,255,0.4);font-style:italic;margin-top:5px;line-height:1.4}
</style>
</head>
<body>
<h1>My RateIt Library</h1>
<div class="subtitle">Exported ${new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})} · ${albums.length} albums</div>
<div class="grid">${cards}</div>
</body>
</html>`;
  }

  _updateStatsBar() {
    const bar = document.getElementById('library-stats-bar');
    if (!bar || !this.albums.length) return;
    const scored = this.albums.filter(a => a.overall_score != null);
    const avg = scored.length ? (scored.reduce((s, a) => s + a.overall_score, 0) / scored.length).toFixed(1) : '–';
    const genres = new Set();
    this.albums.forEach(a => { try { JSON.parse(a.genres || '[]').forEach(g => g && genres.add(g)); } catch {} });
    bar.style.display = '';
    bar.innerHTML = `
      <div class="stats-bar-item"><span class="stats-bar-value">${this.albums.length}</span> albums</div>
      <span class="stats-bar-sep">·</span>
      <div class="stats-bar-item">avg <span class="stats-bar-value">${avg}</span> / 10</div>
      <span class="stats-bar-sep">·</span>
      <div class="stats-bar-item"><span class="stats-bar-value">${genres.size}</span> genres</div>
    `;
  }

  _sorted() {
    return [...this.albums].sort((a, b) => {
      if (this.sorting === 'highest') return (b.overall_score ?? -1) - (a.overall_score ?? -1);
      if (this.sorting === 'lowest') return (a.overall_score ?? 99) - (b.overall_score ?? 99);
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  _cardHTML(a) {
    const score = a.overall_score != null ? a.overall_score.toFixed(1) : '–';
    return `
      <div class="library-card" data-id="${a.id}" role="button" tabindex="0" aria-label="Re-rate ${a.title}">
        <img class="library-card-cover" src="${safeImg(a.cover_url)}" alt="${a.title}"
          onerror="this.src='${placeholderImg()}'">
        <div class="library-card-info">
          <div class="library-card-title">${a.title}</div>
          <div class="library-card-artist">${a.artist}</div>
          <div class="library-card-score">${score}<span class="library-card-score-unit"> / 10</span></div>
          ${a.one_line_review ? `<div class="library-card-review">"${a.one_line_review}"</div>` : ''}
        </div>
      </div>
    `;
  }

  _attachCardHandlers(content) {
    content.querySelectorAll('.library-card').forEach(card => {
      const albumId = card.dataset.id;
      const open = () => {
        const album = this.albums.find(a => a.id === albumId);
        if (album) window.appInstance.openAlbumRating(album);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });
  }

  _render() {
    const content = $('#library-content');
    const albums = this._sorted();

    if (!albums.length) {
      content.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <p class="empty-state-text">No rated albums yet.<br>Search for an album and start rating!</p>
        </div>
      `;
      return;
    }

    if (this.grouping === 'artist') {
      const groups = {};
      albums.forEach(a => {
        if (!groups[a.artist]) groups[a.artist] = [];
        groups[a.artist].push(a);
      });
      content.innerHTML = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([artist, list]) => `
          <div class="group-label">${artist}</div>
          <div class="library-grid">${list.map(a => this._cardHTML(a)).join('')}</div>
        `).join('');
    } else if (this.grouping === 'genre') {
      const groups = {};
      albums.forEach(a => {
        let genre = 'Unclassified';
        try {
          const arr = JSON.parse(a.genres || '[]').filter(Boolean);
          if (arr.length) genre = arr[0];
        } catch {}
        if (!groups[genre]) groups[genre] = [];
        groups[genre].push(a);
      });
      content.innerHTML = Object.entries(groups)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([genre, list]) => `
          <div class="group-label">${genre}</div>
          <div class="library-grid">${list.map(a => this._cardHTML(a)).join('')}</div>
        `).join('');
    } else {
      content.innerHTML = `<div class="library-grid">${albums.map(a => this._cardHTML(a)).join('')}</div>`;
    }

    this._attachCardHandlers(content);
  }
}

// ── App Controller ────────────────────────────────────────────
class App {
  constructor() {
    window.appInstance = this;
    window.currentUser = null;
    window.ratedAlbums = new Map();
    window.activeCriteria = null;
    window.libraryCache = null;

    this.viewMap = {
      search: SearchView,
      library: LibraryView,
      gallery: GalleryView,
      criteria: CustomCriteriaView,
      profile: ProfileView,
      'account-details': AccountDetailsView,
      wrapped: WrappedView,
    };

    document.querySelector('.side-panel').addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item[data-view]');
      if (navItem) this._navigate(navItem.dataset.view);
    });

    document.querySelector('.side-panel').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const navItem = e.target.closest('.nav-item[data-view]');
        if (navItem) this._navigate(navItem.dataset.view);
      }
    });

    // Show spinner while checking persisted session
    document.getElementById('main-content').innerHTML =
      '<div class="loading" style="height:100vh"><div class="spinner"></div></div>';
    this._restoreSession();
  }

  async _restoreSession() {
    try {
      const res = await fetch('/api/session');
      if (res.ok) {
        const data = await res.json();
        if (data && data.id) {
          window.currentUser = data;
          this._initApp();
          return;
        }
      }
    } catch {}
    this._renderAuth();
  }

  _saveSession(user) {
    const data = {
      id: user.id, username: user.username,
      profilePicture: user.profilePicture || null,
      createdAt: user.createdAt || null
    };
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});
  }

  _clearSession() {
    fetch('/api/session', { method: 'DELETE' }).catch(() => {});
  }

  _renderAuth() {
    document.querySelector('.app').classList.add('auth-mode');
    document.getElementById('nav-footer').style.display = 'none';
    $$('.nav-item').forEach(item => item.classList.remove('active'));
    const authView = new AuthView();
    document.getElementById('main-content').innerHTML = authView.render();
    authView.init();
  }

  async _initApp() {
    document.querySelector('.app').classList.remove('auth-mode');
    this._updateNavProfile();
    await Promise.all([this._loadRatedCache(), this._loadCriteriaCache()]);
    this._navigate('search');
  }

  async _loadRatedCache() {
    try {
      const rows = await API.getRatedIds();
      window.ratedAlbums = new Map(rows.map(r => [r.id, r.overall_score]));
    } catch { window.ratedAlbums = new Map(); }
  }

  async _loadCriteriaCache() {
    try {
      const { criteria } = await API.getCriteria(window.currentUser.id);
      if (Array.isArray(criteria) && criteria.length) {
        window.activeCriteria = criteria;
      }
    } catch {}
  }

  _updateNavProfile() {
    const user = window.currentUser;
    if (!user) return;
    const footer = document.getElementById('nav-footer');
    if (footer) footer.style.display = '';
    const label = document.getElementById('nav-username-label');
    if (label) label.textContent = user.username;
    const avatar = document.getElementById('nav-profile-avatar');
    if (avatar) {
      avatar.innerHTML = user.profilePicture
        ? `<img src="${user.profilePicture}" alt="${user.username}">`
        : `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
             <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.5"/>
             <circle cx="12" cy="12" r="3" fill="currentColor"/>
           </svg>`;
    }
  }

  onLogin(user) {
    window.currentUser = user;
    this._saveSession(user);
    this._initApp();
  }

  onLogout() {
    window.currentUser = null;
    window.ratedAlbums = new Map();
    window.activeCriteria = null;
    window.libraryCache = null;
    this._clearSession();
    this._renderAuth();
  }

  _navigate(name) {
    $$('.nav-item').forEach(item => {
      const active = item.dataset.view === name;
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });

    const View = this.viewMap[name];
    if (!View) return;

    if (this._currentView?.destroy) this._currentView.destroy();

    const view = new View();
    this._currentView = view;
    const main = document.getElementById('main-content');
    main.innerHTML = view.render();
    if (view.init) view.init();
  }

  async openAlbumRating(savedAlbum) {
    const main = document.getElementById('main-content');
    main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
      const full = await API.getAlbumTracks(savedAlbum.id);

      const initialTrackScores = {};
      if (savedAlbum.tracks) {
        savedAlbum.tracks.forEach(t => { if (t.score) initialTrackScores[t.id] = t.score; });
      }

      const initialCriteriaScores = {};
      const standardIds = ['flow', 'production', 'lyricism', 'originality', 'replay'];
      standardIds.forEach(id => {
        const val = savedAlbum[`score_${id}`];
        if (val != null && val > 0) initialCriteriaScores[id] = val;
      });
      if (savedAlbum.extra_criteria) {
        try {
          const extra = typeof savedAlbum.extra_criteria === 'string'
            ? JSON.parse(savedAlbum.extra_criteria) : savedAlbum.extra_criteria;
          Object.entries(extra).forEach(([k, v]) => { if (v != null && v > 0) initialCriteriaScores[k] = v; });
        } catch {}
      }

      let albumCriteria = DEFAULT_CRITERIA;
      if (savedAlbum.criteria_snapshot) {
        try {
          const parsed = typeof savedAlbum.criteria_snapshot === 'string'
            ? JSON.parse(savedAlbum.criteria_snapshot) : savedAlbum.criteria_snapshot;
          if (Array.isArray(parsed) && parsed.length) albumCriteria = parsed;
        } catch {}
      }

      const wrapper = document.createElement('div');
      wrapper.id = 'search-view';
      main.innerHTML = '';
      main.appendChild(wrapper);

      const ctrl = new RatingController(
        full,
        initialTrackScores,
        initialCriteriaScores,
        savedAlbum.one_line_review || '',
        savedAlbum.overall_score || 0,
        () => this._navigate('library'),
        () => this._navigate('library'),
        albumCriteria,
        true
      );
      ctrl.mount(wrapper, '← Back to rated albums');
    } catch {
      showToast('Failed to load album details', 'error');
      this._navigate('library');
    }
  }
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => new App());

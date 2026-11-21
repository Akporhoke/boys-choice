require('dotenv').config();                       // load .env into process.env
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { categories } = require('./data/nominees');

const PORT = process.env.PORT || 3000;
const VOTE_CODE = (process.env.VOTE_CODE || '').trim();   // empty = no code needed
const ADMIN_KEY = process.env.ADMIN_KEY || '';            // empty = results locked
const DB = path.join(__dirname, 'data', 'votes.json');    // all votes live in this file

const app = express();
app.use(express.json({ limit: '10kb' }));                 // read JSON bodies, reject huge ones
app.use(express.static(path.join(__dirname, 'public')));  // serve the frontend

// Read/write the votes file. Writing to a temp file then renaming avoids a half-written file.
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } };
const save = (v) => { fs.writeFileSync(DB + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(DB + '.tmp', DB); };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); // "  Ogor  " == "ogor"
const codeOk = (c) => !VOTE_CODE || String(c || '').trim() === VOTE_CODE;

const adminOk = (req) => {
  const a = Buffer.from(req.get('x-admin-key') || ''), b = Buffer.from(ADMIN_KEY);
  return !!ADMIN_KEY && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Tiny rate limit: max 20 requests per minute per IP on the voting routes.
const hits = new Map();
const limit = (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  recent.push(now); hits.set(req.ip, recent);
  if (recent.length > 20) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
  next();
};

// Frontend asks: what are the categories, and is a code required?
app.get('/api/ballot', (req, res) => res.json({ needsCode: !!VOTE_CODE, categories }));

// Checks the code before the voter starts, so a wrong code is caught early.
app.post('/api/enter', limit, (req, res) => {
  if (!codeOk(req.body.code)) return res.status(403).json({ error: 'That access code is wrong.' });
  res.json({ ok: true });
});

// Submit one ballot. picks = { categoryId: nomineeId }, skipped categories are simply missing.
app.post('/api/vote', limit, (req, res) => {
  const { name, code, token, picks } = req.body || {};
  if (!codeOk(code)) return res.status(403).json({ error: 'That access code is wrong.' });
  const who = norm(name);
  if (who.length < 2 || who.length > 60) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[\w-]{16,64}$/.test(token || '')) return res.status(400).json({ error: 'Bad device token. Refresh and try again.' });

  const clean = {};
  for (const c of categories) {                      // only accept ids that really exist
    const pick = picks && picks[c.id];
    if (!pick) continue;
    if (!c.nominees.some((x) => x.id === pick)) return res.status(400).json({ error: 'Invalid nominee.' });
    clean[c.id] = pick;
  }
  if (!Object.keys(clean).length) return res.status(400).json({ error: 'Pick at least one nominee.' });

  const votes = load();
  if (votes.some((v) => v.name === who || v.token === token))   // one ballot per name AND per device
    return res.status(409).json({ error: 'This name or device has already voted.' });
  votes.push({ name: who, display: String(name).trim().slice(0, 60), token, picks: clean, at: new Date().toISOString() });
  save(votes);
  res.json({ ok: true });
});

// Funny moments: every .mp4/.webm in public/videos is listed automatically, no code edits needed.
// Title = file name without extension, leading order numbers, and dashes/underscores.
app.get('/api/moments', (req, res) => {
  let files = [];
  try { files = fs.readdirSync(path.join(__dirname, 'public', 'videos')).filter((f) => /\.(mp4|webm)$/i.test(f)).sort(); } catch {}
  res.json(files.map((f) => ({
    src: '/videos/' + encodeURIComponent(f),
    title: f.replace(/\.[^.]+$/, '').replace(/^\d+[-_. ]*/, '').replace(/[-_]+/g, ' ').trim() || 'Moment',
  })));
});

// Has this device already voted? (The server is the source of truth, so admin resets work.)
app.get('/api/status', (req, res) => res.json({ voted: load().some((v) => v.token === req.query.token) }));

// Reveal switch: the public results page stays locked until the admin turns this on.
const SET = path.join(__dirname, 'data', 'settings.json');
const revealed = () => { try { return !!JSON.parse(fs.readFileSync(SET, 'utf8')).revealed; } catch { return false; } };

// Count votes per nominee, highest first. Used by both the admin and the public results.
const tally = (votes) => categories.map((c) => ({
  id: c.id, name: c.name,
  nominees: c.nominees
    .map((x) => ({ ...x, votes: votes.filter((v) => v.picks[c.id] === x.id).length }))
    .sort((a, b) => b.votes - a.votes),
}));

// Admin results: needs the admin key. Also lists voter NAMES (never their picks).
app.get('/api/results', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const votes = load();
  res.json({
    voters: votes.length, revealed: revealed(),
    people: votes.map((v) => ({ key: v.name, name: v.display || v.name, at: v.at })),
    categories: tally(votes),
  });
});

// Public results: only returns data once the admin has revealed them.
app.get('/api/public-results', (req, res) => {
  if (!revealed()) return res.json({ revealed: false });
  res.json({ revealed: true, categories: tally(load()) });
});

// Admin flips the public results page open or closed.
app.post('/api/admin/reveal', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  fs.writeFileSync(SET, JSON.stringify({ revealed: !!(req.body && req.body.revealed) }));
  res.json({ ok: true });
});

// Retake: delete ONE person's ballot so they can vote again (matched by name).
app.post('/api/admin/retake', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const key = norm(req.body && req.body.name);
  const votes = load(), rest = votes.filter((v) => v.name !== key);
  if (rest.length === votes.length) return res.status(404).json({ error: 'No ballot found for that name.' });
  save(rest); res.json({ ok: true });
});

// Clear: delete EVERY ballot, so the results reset to zero and everyone can vote again.
app.post('/api/admin/clear', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  save([]); res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Awards site running on http://localhost:${PORT}`));

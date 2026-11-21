require('dotenv').config();                       // load .env into process.env
const express = require('express');
const fs = require('fs');
const path = require('path');
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
  votes.push({ name: who, token, picks: clean, at: new Date().toISOString() });
  save(votes);
  res.json({ ok: true });
});

// Results are private: only with the admin key (sent in a header, never in the URL).
app.get('/api/results', (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Wrong admin key.' });
  const votes = load();
  res.json({
    voters: votes.length,
    categories: categories.map((c) => ({
      id: c.id, name: c.name,
      nominees: c.nominees
        .map((x) => ({ ...x, votes: votes.filter((v) => v.picks[c.id] === x.id).length }))
        .sort((a, b) => b.votes - a.votes),
    })),
  });
});

app.listen(PORT, () => console.log(`Awards site running on http://localhost:${PORT}`));

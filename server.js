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
// Serve the frontend. Photos and videos are cached by the phone for a day, so repeat visits are instant.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, p) => { if (/[\\/](img|videos)[\\/]/.test(p)) res.setHeader('Cache-Control', 'public, max-age=86400'); },
}));

// Read/write the votes file. Writing to a temp file then renaming avoids a half-written file.
const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return []; } };
const save = (v) => { fs.writeFileSync(DB + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(DB + '.tmp', DB); };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); // "  Ogor  " == "ogor"
const codeOk = (c) => !VOTE_CODE || String(c || '').trim() === VOTE_CODE;

// CHANGED: settings (reveal switch + NEW close-voting switch) live in one small file.
// saveSettings MERGES a change into what is already there, so flipping one switch never erases the other.
const SET = path.join(__dirname, 'data', 'settings.json');
const readSettings = () => { try { return JSON.parse(fs.readFileSync(SET, 'utf8')); } catch { return {}; } };
const saveSettings = (patch) => fs.writeFileSync(SET, JSON.stringify({ ...readSettings(), ...patch }));
const revealed = () => !!readSettings().revealed;       // public results page open?
// NEW: voting has three states. 'closed' (admin pressed Close), 'soon' (an opening date is set and has not arrived yet), 'open'.
// With no opening date saved, voting is open, so existing setups keep working.
const votingState = () => {
  const s = readSettings();
  if (s.closed) return 'closed';
  if (s.opensAt && Date.now() < Date.parse(s.opensAt)) return 'soon';
  return 'open';
};

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

// Frontend asks: what are the categories, is a code required, and (NEW) is voting closed?
// CHANGED: also sends `voting` ('open' | 'soon' | 'closed') and `opensAt` so the page can show "Voting opens ..." before the date.
app.get('/api/ballot', (req, res) => res.json({
  needsCode: !!VOTE_CODE, closed: votingState() === 'closed', voting: votingState(), opensAt: readSettings().opensAt || '',
  categories, voters: load().length }));

// Public voter counter: just a number, no names.
app.get('/api/count', (req, res) => res.json({ voters: load().length }));

// Checks the code before the voter starts, so a wrong code is caught early.
app.post('/api/enter', limit, (req, res) => {
  if (votingState() === 'closed') return res.status(403).json({ error: 'Voting is closed.' });   // NEW (before the opening date people may still enter and look around)
  if (!codeOk(req.body.code)) return res.status(403).json({ error: 'That access code is wrong.' });
  res.json({ ok: true });
});

// Submit one ballot. picks = { categoryId: nomineeId }, skipped categories are simply missing.
app.post('/api/vote', limit, (req, res) => {
  // NEW: the real lock. Even someone mid-ballot when the admin closed voting is turned away here,
  // and nobody can vote before the opening date, whatever the browser says.
  const vs = votingState();
  if (vs === 'closed') return res.status(403).json({ error: 'Voting is closed.' });
  if (vs === 'soon') return res.status(403).json({ error: 'Voting has not opened yet.' });
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

// Funny moments: every photo and clip in public/videos is listed automatically, no code edits needed.
// A file named with just a number (07.jpg) shows no caption. A name like 07-fejiro-sleeping.jpg shows "fejiro sleeping".
// A picture with the same name as a video (20.jpg next to 20.mp4) is that video's preview, not a separate photo.
app.get('/api/moments', (req, res) => {
  let all = [];
  try { all = fs.readdirSync(path.join(__dirname, 'public', 'videos')); } catch {}
  const base = (f) => f.replace(/\.[^.]+$/, '');
  const isVid = (f) => /\.(mp4|webm)$/i.test(f), isImg = (f) => /\.(jpe?g|png|webp)$/i.test(f);
  const vids = new Set(all.filter(isVid).map(base));
  const url = (f) => '/videos/' + encodeURIComponent(f);
  res.json(all
    .filter((f) => isVid(f) || (isImg(f) && !vids.has(base(f))))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => ({
      type: isVid(f) ? 'video' : 'image',
      src: url(f),
      poster: isVid(f) && all.includes(base(f) + '.jpg') ? url(base(f) + '.jpg') : '',
      wide: /(^|[-_ ])wide$/i.test(base(f)),                                         // name ending in -wide (24-wide.jpg) = shown full width
      title: base(f).replace(/^\d+[-_. ]*/, '').replace(/(^|[-_ ])wide$/i, '').replace(/[-_]+/g, ' ').trim(),   // empty when the name is only a number
    })));
});

// Has this device already voted? (The server is the source of truth, so admin resets work.)
app.get('/api/status', (req, res) => res.json({ voted: load().some((v) => v.token === req.query.token) }));

// A voter can look at their OWN ballot: the secret device token is the key, so nobody else can read it.
app.get('/api/my-ballot', limit, (req, res) => {
  const mine = load().find((x) => x.token === req.query.token);
  res.json({ picks: mine ? mine.picks : null });
});

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
    voters: votes.length, revealed: revealed(), closed: votingState() === 'closed',   // CHANGED: also tells the admin page if voting is closed
    voting: votingState(), opensAt: readSettings().opensAt || '',                     // NEW: current state and the saved opening date
    people: votes.map((v) => ({ key: v.name, name: v.display || v.name, at: v.at })),
    categories: tally(votes),
  });
});

// Public results: only returns data once the admin has revealed them.
app.get('/api/public-results', (req, res) => {
  if (!revealed()) return res.json({ revealed: false });
  res.json({ revealed: true, categories: tally(load()) });
});

// Admin flips the public results page open or closed. CHANGED: merges into settings instead of overwriting them.
app.post('/api/admin/reveal', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  saveSettings({ revealed: !!(req.body && req.body.revealed) });
  res.json({ ok: true });
});

// NEW: admin closes or reopens voting. While closed, /api/vote and /api/enter refuse everyone.
app.post('/api/admin/close', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  saveSettings({ closed: !!(req.body && req.body.closed) });
  res.json({ ok: true });
});

// NEW: admin sets the date voting opens (an ISO date string), or sends '' to clear it = "open voting now".
app.post('/api/admin/opens', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const v = req.body && req.body.opensAt;
  if (v && Number.isNaN(Date.parse(v))) return res.status(400).json({ error: 'That date is not valid.' });
  saveSettings({ opensAt: v ? new Date(v).toISOString() : '' });
  res.json({ ok: true });
});

// ---- NEW: The Boys Quiz. Exactly 6 questions, set by the admin, stored in data/quiz.json ----
// Each slot: { q: "question", options: [4 strings, blank = unused], answer: index 0-3 of the correct option }.
const QZ = path.join(__dirname, 'data', 'quiz.json');
const blankQ = () => ({ q: '', options: ['', '', '', ''], answer: 0 });
const loadQuiz = () => {
  try { const a = JSON.parse(fs.readFileSync(QZ, 'utf8')); if (Array.isArray(a)) return Array.from({ length: 6 }, (_, i) => ({ ...blankQ(), ...a[i] })); } catch {}
  return Array.from({ length: 6 }, blankQ);             // nothing saved yet = 6 empty slots
};
// A question is usable when it has text, at least 2 filled options, and the marked correct option is filled.
const qValid = (x) => !!x.q && x.options.filter(Boolean).length >= 2 && !!x.options[x.answer];
const quizReady = (qz) => qz.every(qValid);              // the quiz only goes live when all 6 are usable

// Public: the questions WITHOUT the answers. If the quiz is not ready, voters just see "coming soon".
app.get('/api/quiz', (req, res) => {
  const qz = loadQuiz();
  if (!quizReady(qz)) return res.json({ ready: false });
  res.json({ ready: true, questions: qz.map((x) => ({ q: x.q, options: x.options.map((t, i) => ({ i, t })).filter((o) => o.t) })) });
});

// Public: marking happens here, so the right answers never reach the browser until the voter has finished.
app.post('/api/quiz/check', limit, (req, res) => {
  const qz = loadQuiz();
  if (!quizReady(qz)) return res.status(409).json({ error: 'The quiz is not ready yet.' });
  const given = Array.isArray(req.body && req.body.answers) ? req.body.answers : [];
  const correct = qz.map((x) => x.answer);
  res.json({ score: correct.filter((c, i) => given[i] === c).length, total: 6, correct });
});

// Admin: read the 6 slots (including the right answers)...
app.get('/api/admin/quiz', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const qz = loadQuiz();
  res.json({ questions: qz, ready: quizReady(qz) });
});

// ...and save them. A slot may be left fully empty (the quiz just stays hidden), but a slot with anything in it must be complete.
app.post('/api/admin/quiz', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const raw = req.body && req.body.questions;
  if (!Array.isArray(raw) || raw.length !== 6) return res.status(400).json({ error: 'Send exactly 6 questions.' });
  const clean = raw.map((x) => ({
    q: String((x && x.q) || '').trim().slice(0, 200),
    options: Array.from({ length: 4 }, (_, i) => String((x && x.options && x.options[i]) || '').trim().slice(0, 100)),
    answer: Number.isInteger(x && x.answer) && x.answer >= 0 && x.answer < 4 ? x.answer : 0,
  }));
  for (const [i, x] of clean.entries()) {
    if ((x.q || x.options.some(Boolean)) && !qValid(x))
      return res.status(400).json({ error: `Question ${i + 1} needs the question, at least 2 options, and a correct answer that is filled in.` });
  }
  fs.writeFileSync(QZ, JSON.stringify(clean, null, 2));
  res.json({ ok: true, ready: quizReady(clean) });
});

// ---- Feedback: star ratings plus an optional note, stored without names ----
const FB = path.join(__dirname, 'data', 'feedback.json');
const loadFb = () => { try { return JSON.parse(fs.readFileSync(FB, 'utf8')); } catch { return []; } };
const saveFb = (v) => { fs.writeFileSync(FB + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(FB + '.tmp', FB); };

// type 'process' = rating the nomination and voting (only people who voted); 'ceremony' = after results open.
app.post('/api/feedback', limit, (req, res) => {
  const { token, type, rating, note } = req.body || {};
  if (!/^[\w-]{16,64}$/.test(token || '')) return res.status(400).json({ error: 'Bad device token. Refresh and try again.' });
  if (type !== 'process' && type !== 'ceremony') return res.status(400).json({ error: 'Unknown feedback type.' });
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: 'Pick 1 to 5 stars.' });
  if (type === 'process' && !load().some((x) => x.token === token)) return res.status(403).json({ error: 'Vote first, then rate the process.' });
  if (type === 'ceremony' && !revealed()) return res.status(403).json({ error: 'Ceremony ratings open with the results.' });
  const rest = loadFb().filter((f) => !(f.token === token && f.type === type));   // one per device per type
  rest.push({ token, type, rating: stars, note: String(note || '').trim().slice(0, 500), at: new Date().toISOString() });
  saveFb(rest);
  res.json({ ok: true });
});

// Admin: averages plus every written note (newest first). No names, no tokens.
app.get('/api/admin/feedback', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const all = loadFb(), summary = {};
  for (const t of ['process', 'ceremony']) {
    const mine = all.filter((f) => f.type === t);
    summary[t] = { count: mine.length, avg: mine.length ? mine.reduce((a, f) => a + f.rating, 0) / mine.length : 0 };
  }
  const notes = all.filter((f) => f.note).sort((a, b) => b.at.localeCompare(a.at)).map(({ type, rating, note, at }) => ({ type, rating, note, at }));
  res.json({ summary, notes });
});

app.post('/api/admin/feedback/clear', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  saveFb([]); res.json({ ok: true });
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

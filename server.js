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
// NEW: Render puts one proxy in front of the site. Without this line every visitor looks like the SAME IP address,
// so the rate limit below would be shared by everyone and could block people during a voting rush.
app.set('trust proxy', 1);
app.use(express.json({ limit: '60kb' }));                 // CHANGED: was 10kb. A quiz of 20 questions needs more room.
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

// NEW: LOCK AFTER EVERY UPDATE. Render tells the server which version of the code is running (RENDER_GIT_COMMIT).
// Each time that version is new (you pushed an update), voting is locked and the admin has to press "Reopen voting".
// The version we already locked for is remembered in settings.json, so an ordinary restart of the SAME version does not lock again
// (as long as the file survives; on free Render it is wiped, which also counts as "new" and locks, which is the safe direction).
// Locally there is no RENDER_GIT_COMMIT, so nothing locks while you test. To switch this off, set LOCK_ON_DEPLOY=false on Render.
const deployed = process.env.RENDER_GIT_COMMIT || '';
if (deployed && process.env.LOCK_ON_DEPLOY !== 'false' && readSettings().lockedFor !== deployed) {
  saveSettings({ closed: true, lockedFor: deployed });
  console.log('New version detected: voting is locked until the admin reopens it.');
}

const adminOk = (req) => {
  const a = Buffer.from(req.get('x-admin-key') || ''), b = Buffer.from(ADMIN_KEY);
  return !!ADMIN_KEY && a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Tiny rate limit: max 120 requests per minute per IP on the voting routes (a whole room on one Wi-Fi shares one address).
const hits = new Map();
const limit = (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  recent.push(now); hits.set(req.ip, recent);
  if (recent.length > 120) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
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

// NEW: the LIVE CEREMONY (big screen, phones, host panel). All of it lives in show-routes.js.
const show = require('./show-routes')(app, { adminOk, load, categories, tally, saveSettings, limit,
  dataDir: path.join(__dirname, 'data'), publicDir: path.join(__dirname, 'public') });

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

// ---- CHANGED: The Boys Quiz. A pool of up to 20 questions; every play gets 6 of them picked at random. ----
// Stored in data/quiz.json (the same file as before, so questions you already saved carry over).
// Each question: { id, q: "question", options: [4 strings, blank = unused], answer: index 0-3 of the correct option }.
const QZ = path.join(__dirname, 'data', 'quiz.json');
const QMAX = 20, QNEED = 6;                              // most questions kept / questions per play
// Cleans one question: trims and shortens text, always 4 option slots, keeps its id (or uses the fallback).
const qClean = (x, fallbackId) => {
  if (!x || typeof x !== 'object') return null;
  const o = Array.isArray(x.options) ? x.options : [];
  return {
    id: /^[a-z0-9]{4,16}$/i.test(String(x.id || '')) ? String(x.id) : fallbackId,
    q: String(x.q || '').trim().slice(0, 200),
    options: [0, 1, 2, 3].map((i) => String(o[i] || '').trim().slice(0, 100)),
    answer: Number.isInteger(x.answer) ? x.answer : -1,
  };
};
// A question is usable when it has text, at least 2 filled options, and the marked correct option is filled.
const qValid = (x) => !!(x && x.q && x.options.filter(Boolean).length >= 2 && x.answer >= 0 && x.answer < 4 && x.options[x.answer]);
// Reads the pool. Old 6-slot files still work: empty slots are dropped and the others get ids like "old0".
const loadQuiz = () => {
  try { const a = JSON.parse(fs.readFileSync(QZ, 'utf8')); if (Array.isArray(a)) return a.map((x, i) => qClean(x, 'old' + i)).filter(qValid); } catch {}
  return [];                                             // nothing saved yet
};
// Fisher-Yates shuffle using crypto.randomInt, so every question has the same chance of being picked.
const qShuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Public: a fresh random set of 6 questions WITHOUT the answers. With fewer than 6 saved, voters just see "coming soon".
app.get('/api/quiz', (req, res) => {
  res.set('Cache-Control', 'no-store');                  // never let a phone reuse an old random set
  const pool = loadQuiz();
  if (pool.length < QNEED) return res.json({ ready: false });
  res.json({ ready: true, questions: qShuffle(pool).slice(0, QNEED).map((x) => ({
    id: x.id, q: x.q, options: x.options.map((t, i) => ({ i, t })).filter((o) => o.t) })) });
});

// Public: marking happens here, so the right answers never reach the browser until the voter has finished.
// The browser sends the 6 ids it was given plus the option numbers it chose; answers[k] goes with ids[k].
app.post('/api/quiz/check', limit, (req, res) => {
  const { ids, answers } = req.body || {};
  if (!Array.isArray(ids) || !Array.isArray(answers) || ids.length !== QNEED || new Set(ids).size !== QNEED)
    return res.status(400).json({ error: 'Something went wrong. Start the quiz again.' });
  const byId = new Map(loadQuiz().map((x) => [x.id, x]));
  const picked = ids.map((id) => byId.get(String(id)));
  if (picked.some((x) => !x)) return res.status(400).json({ error: 'The quiz was just updated. Start it again.' });
  const correct = picked.map((x) => x.answer), score = picked.filter((x, k) => answers[k] === x.answer).length;
  if (req.body.token) show.quizScore(String(req.body.token), score, QNEED);   // NEW: feeds the quiz leaderboard in the live show (only checked-in guests count)
  res.json({ score, total: QNEED, correct });
});

// Admin: read the whole pool (including the right answers) for the editor.
app.get('/api/admin/quiz', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  res.json({ questions: loadQuiz(), max: QMAX, need: QNEED });
});

// Admin: replace the whole pool. Untouched blank boxes are skipped; half-filled ones are rejected with a clear message.
app.post('/api/admin/quiz', limit, (req, res) => {
  if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
  const raw = req.body && req.body.questions;
  if (!Array.isArray(raw) || raw.length > QMAX) return res.status(400).json({ error: `Send at most ${QMAX} questions.` });
  const out = [], seen = new Set();
  for (let k = 0; k < raw.length; k++) {
    const x = qClean(raw[k], crypto.randomBytes(4).toString('hex'));
    if (!x || (!x.q && !x.options.some(Boolean))) continue;          // an untouched blank box is simply skipped
    if (!qValid(x)) return res.status(400).json({ error: `Question ${k + 1} needs the question, at least 2 options, and the correct answer ticked on a filled option.` });
    if (seen.has(x.id)) x.id = crypto.randomBytes(4).toString('hex'); // never two questions with the same id
    seen.add(x.id); out.push(x);
  }
  fs.writeFileSync(QZ + '.tmp', JSON.stringify(out, null, 2)); fs.renameSync(QZ + '.tmp', QZ);   // temp file then rename, so a crash never leaves half a file
  res.json({ ok: true, ready: out.length >= QNEED, count: out.length });
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

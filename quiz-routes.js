// quiz-routes.js: the quiz question pool. The admin can store up to 20 questions;
// every time someone plays, the server picks 6 of them at random.
//
// HOW TO ADD IT: in server.js, right after the line  const app = express();  add this ONE line:
//     require('./quiz-routes')(app);
// It must come BEFORE the other app.use(...) lines. These routes then answer the quiz requests first,
// and the old quiz routes further down in server.js are simply never reached (you can delete them later).
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX = 20;   // most questions the admin can keep
const NEED = 6;   // questions each player gets
const FILE = path.join(__dirname, 'data', 'quiz-pool.json');   // the new pool lives here
const OLD = path.join(__dirname, 'data', 'quiz.json');         // the old 6-question file: imported once if it exists and the pool is new

// Clean one question: trim text, cut it to length, always give exactly 4 option slots.
function normalize(x, fallbackId) {
  if (!x || typeof x !== 'object') return null;
  const opts = Array.isArray(x.options) ? x.options : [];
  return {
    id: /^[a-z0-9]{4,16}$/i.test(String(x.id || '')) ? String(x.id) : fallbackId,
    q: String(x.q || '').trim().slice(0, 200),
    options: [0, 1, 2, 3].map((i) => String(opts[i] || '').trim().slice(0, 100)),
    answer: Number.isInteger(x.answer) ? x.answer : -1,
  };
}
// A question is usable when it has text, at least 2 options, and the right answer points at a filled option.
const valid = (x) => !!(x && x.q && x.options.filter(Boolean).length >= 2 && x.answer >= 0 && x.answer < 4 && x.options[x.answer]);

function read(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(raw) ? raw : raw.questions;
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}
function load() {
  const list = read(FILE) || (fs.existsSync(FILE) ? [] : read(OLD)) || [];
  return list.map((x, i) => normalize(x, 'old' + i)).filter(valid);
}
function save(list) {   // write to a temp file then rename, so a crash never leaves half a file
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(FILE + '.tmp', FILE);
}
// Fisher-Yates shuffle with crypto.randomInt: every question has the same chance of being picked.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

module.exports = function mountQuiz(app) {
  const json = express.json({ limit: '60kb' });   // 20 questions need more room than the 10kb used for votes

  // Admin check (the key arrives in a header, compared in constant time) plus a small attempt limiter.
  const adminOk = (req) => {
    const a = Buffer.from(req.get('x-admin-key') || ''), b = Buffer.from(process.env.ADMIN_KEY || '');
    return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const hits = new Map();
  const limit = (req, res, next) => {
    const now = Date.now(), recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
    recent.push(now); hits.set(req.ip, recent);
    if (recent.length > 30) return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    next();
  };

  // PUBLIC: a fresh random set of 6 questions, WITHOUT the answers. no-store stops the phone reusing an old set.
  app.get('/api/quiz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const pool = load();
    if (pool.length < NEED) return res.json({ ready: false });
    const picked = shuffle(pool).slice(0, NEED);
    res.json({ ready: true, questions: picked.map((x) => ({
      id: x.id, q: x.q,
      options: x.options.map((t, i) => ({ t, i })).filter((o) => o.t),   // i = the option's number, kept even when an option is empty
    })) });
  });

  // PUBLIC: marks a finished quiz. The browser sends the ids it was given and the option numbers it chose.
  app.post('/api/quiz/check', json, (req, res) => {
    const { ids, answers } = req.body || {};
    if (!Array.isArray(ids) || !Array.isArray(answers) || ids.length !== NEED || new Set(ids).size !== NEED)
      return res.status(400).json({ error: 'Something went wrong. Start the quiz again.' });
    const byId = new Map(load().map((x) => [x.id, x]));
    const picked = ids.map((id) => byId.get(String(id)));
    if (picked.some((x) => !x)) return res.status(400).json({ error: 'The quiz was just updated. Start it again.' });
    const correct = picked.map((x) => x.answer);
    res.json({ score: picked.filter((x, k) => answers[k] === x.answer).length, total: NEED, correct });
  });

  // ADMIN: read the whole pool (with answers) for the editor.
  app.get('/api/admin/quiz', limit, (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
    res.json({ questions: load(), max: MAX, need: NEED });
  });

  // ADMIN: replace the whole pool. Untouched blank boxes are skipped; half-filled ones are rejected with a clear message.
  app.post('/api/admin/quiz', limit, json, (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
    const list = req.body && req.body.questions;
    if (!Array.isArray(list) || list.length > MAX) return res.status(400).json({ error: `Send at most ${MAX} questions.` });
    const out = [], seen = new Set();
    for (let k = 0; k < list.length; k++) {
      const x = normalize(list[k], crypto.randomBytes(4).toString('hex'));
      if (!x) continue;
      if (!x.q && !x.options.some(Boolean)) continue;
      if (!valid(x)) return res.status(400).json({ error: `Question ${k + 1} needs the question, at least 2 options, and the correct answer ticked on a filled option.` });
      if (seen.has(x.id)) x.id = crypto.randomBytes(4).toString('hex');
      seen.add(x.id); out.push(x);
    }
    save(out);
    res.json({ ready: out.length >= NEED, count: out.length });
  });
};

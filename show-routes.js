// show-routes.js: the LIVE CEREMONY.
// One "show" lives on the server. The host moves it forward with Next; every phone and the big screen follow in real time.
// Things people can do: check in, predict winners, react with emojis, play bingo, write and vote on captions.
// Added to server.js with:  const show = require('./show-routes')(app, { adminOk, load, categories, tally, saveSettings, limit, dataDir, publicDir });
// All show data is kept in data/show.json. Every read/write goes through load/save below, so moving to MongoDB later only touches this file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SPEECH_MS = 15000;                               // time each winner gets for a speech
const EMOJIS = ['🔥', '😂', '💀', '👏', '😭', '🤯'];  // the reaction buttons
const DEFAULT_ADS = [                                  // fake sponsors, the host can edit these
  "This award is brought to you by the Free Data Foundation: because someone always types 'share me sub'.",
  'Sponsored by the Reply Fast Initiative: turning group chat ghosts into humans since 2026.',
  'A word from Broke Boys Bank: loans approved with one condition. You must still be poor.',
  'Powered by Group Chat Therapy: you are not alone. Someone left you on read today too.',
];
const ROASTS = [                                       // used when the host has not written a line for that winner
  'Nobody asked, but the people have spoken.',
  'Acceptance speech in 3, 2, 1. Please keep it under an hour.',
  'Stunning. Brave. Probably voted for himself.',
  'Respect. Now buy everybody data.',
  'The group chat will never hear the end of this.',
  'We are as shocked as you are.',
  'Come and collect it before we change our minds.',
];

module.exports = function mountShow(app, ctx) {
  const { adminOk, load, categories, tally, saveSettings, limit, dataDir, publicDir } = ctx;
  const FILE = path.join(dataDir, 'show.json');
  const fresh = () => ({ phase: 'pre', step: 0, startedAt: 0, guests: {}, predictions: {}, reactions: {}, bingo: {}, quiz: {},
    roasts: {}, ads: DEFAULT_ADS.slice(), captionPhoto: '', captions: [], capVotes: {} });
  let S; try { S = { ...fresh(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { S = fresh(); }
  const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(S)); fs.renameSync(FILE + '.tmp', FILE); };
  let dirty = false, version = 1;
  setInterval(() => { if (dirty) { dirty = false; save(); } }, 5000).unref();   // reactions are saved in batches, not one by one

  // ---- the run of show: the order the host steps through ----
  const STEPS = (() => {
    const out = [{ type: 'open', label: 'Welcome' }];
    categories.forEach((c, i) => {
      out.push({ type: 'intro', cat: c.id, label: `${c.name}: the nominees` }, { type: 'envelope', cat: c.id, label: `${c.name}: envelope` },
        { type: 'winner', cat: c.id, label: `${c.name}: WINNER` }, { type: 'speech', cat: c.id, label: `${c.name}: speech` });
      if (i === 2) out.push({ type: 'quiz', label: 'Quiz leaderboard' });
      if (i === 4) out.push({ type: 'caption', label: 'Caption battle: write' }, { type: 'captionvote', label: 'Caption battle: vote' }, { type: 'captionwin', label: 'Caption battle: winner' });
      if ((i + 1) % 3 === 0) out.push({ type: 'ad', n: Math.floor(i / 3), label: 'Sponsor break' });
    });
    out.push({ type: 'oracle', label: 'Best Oracle' }, { type: 'hype', label: 'Hype Man of the Night' }, { type: 'recap', label: '2026 recap' },
      { type: 'teaser', label: "Boys d'Or teaser" }, { type: 'end', label: 'Thank you' });
    return out;
  })();

  // ---- helpers ----
  const slim = (n) => ({ id: n.id, name: n.name, tag: n.tag, photo: n.photo, ...(n.video ? { video: n.video } : {}) });
  const nameOf = (token) => (S.guests[token] && S.guests[token].name) || 'Guest';
  const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
  // winners of one category = everyone tied on the most votes (nobody if there are no votes)
  const resultOf = (id) => {
    const t = tally(load()).find((x) => x.id === id), rows = t ? t.nominees : [], top = rows[0] ? rows[0].votes : 0;
    return { rows, winners: top > 0 ? rows.filter((n) => n.votes === top) : [] };
  };
  const roastFor = (n) => S.roasts[n.id] || ROASTS[hash(n.id) % ROASTS.length];
  const images = () => {                               // moments photos (not the little previews that sit next to videos)
    let all = []; try { all = fs.readdirSync(path.join(publicDir, 'videos')); } catch {}
    const base = (f) => f.replace(/\.[^.]+$/, ''), vids = new Set(all.filter((f) => /\.(mp4|webm)$/i.test(f)).map(base));
    return all.filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !vids.has(base(f))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((f) => '/videos/' + encodeURIComponent(f));
  };
  const capPhoto = () => S.captionPhoto || images()[0] || '';
  const winnerStepIdx = (id) => STEPS.findIndex((s) => s.type === 'winner' && s.cat === id);
  // categories whose winner has been shown by step number `idx` (and only while the show is on)
  const revealedIds = (idx) => (S.phase === 'pre' ? [] : categories.filter((c) => winnerStepIdx(c.id) <= idx).map((c) => c.id));
  const scoreOf = (token, idx) => {
    const p = S.predictions[token]; if (!p) return { score: 0, of: 0 };
    const ids = revealedIds(idx).filter((id) => p.picks[id]);
    return { score: ids.filter((id) => resultOf(id).winners.some((w) => w.id === p.picks[id])).length, of: ids.length };
  };
  const board = (rows, n = 10) => rows.sort((a, b) => b.n - a.n).slice(0, n);

  // what the screens get for the current step. A winner is only included when the step is the WINNER step.
  const view = (st) => {
    const cat = st.cat && categories.find((c) => c.id === st.cat);
    switch (st.type) {
      case 'intro': return { type: 'intro', cat: { id: cat.id, name: cat.name, info: cat.info || '', nominees: cat.nominees.map(slim) } };
      case 'envelope': return { type: 'envelope', cat: { id: cat.id, name: cat.name } };
      case 'winner': { const r = resultOf(st.cat); return { type: 'winner', cat: { id: cat.id, name: cat.name },
        winners: r.winners.map((n) => ({ ...slim(n), votes: n.votes, roast: roastFor(n) })), rows: r.rows.map((n) => ({ name: n.name, votes: n.votes })) }; }
      case 'speech': { const r = resultOf(st.cat); return { type: 'speech', cat: { id: cat.id, name: cat.name }, winners: r.winners.map(slim), endsAt: S.startedAt + SPEECH_MS, seconds: SPEECH_MS / 1000 }; }
      case 'ad': return { type: 'ad', text: S.ads[st.n % Math.max(1, S.ads.length)] || '' };
      case 'quiz': return { type: 'quiz', leaders: board(Object.entries(S.quiz).map(([t, q]) => ({ name: nameOf(t), n: q.score, total: q.total }))) };
      case 'caption': return { type: 'caption', photo: capPhoto(), count: S.captions.length };
      case 'captionvote': return { type: 'captionvote', photo: capPhoto(), captions: S.captions.map((c) => ({ id: c.id, text: c.text })) };
      case 'captionwin': { const top = S.captions.slice().sort((a, b) => b.votes - a.votes)[0];
        return { type: 'captionwin', photo: capPhoto(), win: top ? { text: top.text, author: nameOf(top.token), votes: top.votes } : null }; }
      case 'oracle': return { type: 'oracle', leaders: board(Object.keys(S.predictions).map((t) => ({ name: nameOf(t), ...scoreOf(t, STEPS.length), n: scoreOf(t, STEPS.length).score }))) };
      case 'hype': return { type: 'hype', leaders: board(Object.entries(S.reactions).map(([t, n]) => ({ name: nameOf(t), n })), 5) };
      default: return { type: st.type };
    }
  };
  const publicState = () => ({
    v: version, now: Date.now(), phase: S.phase, idx: S.step, total: STEPS.length, step: view(STEPS[S.step] || STEPS[0]),
    guests: Object.keys(S.guests).length, names: Object.values(S.guests).slice(-150).map((g) => g.name), emojis: EMOJIS,
    revealed: revealedIds(S.step).map((id) => { const c = categories.find((x) => x.id === id); return { cat: c.name, winners: resultOf(id).winners.map(slim) }; }),
  });

  // ---- real-time: Server-Sent Events. One long-lived connection per screen. ----
  const clients = new Set();
  const send = (cl, event, data) => cl.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = () => { version++; const st = publicState(); clients.forEach((cl) => send(cl, 'state', st)); };
  let soonTimer = null;                                 // groups many quick changes (like 100 check-ins) into one broadcast
  const broadcastSoon = () => { if (!soonTimer) soonTimer = setTimeout(() => { soonTimer = null; broadcast(); }, 400); };
  let rbuf = {};                                        // reactions waiting to be sent to the big screen
  setInterval(() => { if (Object.keys(rbuf).length) { const c = rbuf; rbuf = {}; clients.forEach((cl) => cl.role === 'stage' && send(cl, 'react', c)); } }, 250).unref();
  setInterval(() => clients.forEach((cl) => cl.res.write(': ping\n\n')), 20000).unref();   // keeps proxies from closing the connection

  app.get('/api/show/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const cl = { res, role: req.query.role === 'stage' ? 'stage' : 'phone' };
    clients.add(cl); send(cl, 'state', publicState());
    req.on('close', () => clients.delete(cl));
  });
  app.get('/api/show/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(publicState()); });

  // ---- limiters ----
  // On the night everyone shares one Wi-Fi, so ONE internet address looks like the whole room. Limits must be per phone, not per address.
  const tokHits = new Map();
  const tokLimit = (req, res, next) => {              // each phone may send 40 requests a minute to the guest routes
    const k = (req.body && req.body.token) || req.ip, now = Date.now(), recent = (tokHits.get(k) || []).filter((t) => now - t < 60000);
    recent.push(now); tokHits.set(k, recent);
    if (recent.length > 40) return res.status(429).json({ error: 'Slow down a little.' });
    next();
  };
  // The host panel is never slowed down while the key is right. Only WRONG keys are counted (20 a minute per address), to stop password guessing.
  const badKeys = new Map();
  const adminGate = (req, res, next) => {
    const now = Date.now(), recent = (badKeys.get(req.ip) || []).filter((t) => now - t < 60000);
    if (recent.length >= 20) return res.status(429).json({ error: 'Too many wrong keys. Wait a minute.' });
    if (!adminOk(req)) { recent.push(now); badKeys.set(req.ip, recent); return res.status(401).json({ error: 'Wrong admin key.' }); }
    next();
  };

  // ---- guests ----
  const tokenOk = (t) => /^[\w-]{16,64}$/.test(t || '');
  const need = (req, res) => {                          // every guest action needs a checked-in device token
    const t = req.body && req.body.token;
    if (!tokenOk(t)) { res.status(400).json({ error: 'Bad device token. Refresh and try again.' }); return null; }
    if (!S.guests[t]) { res.status(403).json({ error: 'Check in first.' }); return null; }
    return t;
  };
  app.post('/api/show/checkin', tokLimit, (req, res) => {
    const { token, name } = req.body || {}, nm = String(name || '').trim().slice(0, 40);
    if (!tokenOk(token)) return res.status(400).json({ error: 'Bad device token. Refresh and try again.' });
    if (nm.length < 2) return res.status(400).json({ error: 'Enter your name.' });
    S.guests[token] = { name: nm, at: Date.now() }; save(); broadcastSoon();
    res.json({ ok: true });
  });
  app.get('/api/show/me', (req, res) => {              // a guest's own status: name, predictions and score so far
    const t = String(req.query.token || ''), g = S.guests[t];
    if (!g) return res.json({ checkedIn: false });
    const p = S.predictions[t];
    res.json({ checkedIn: true, name: g.name, picks: p ? p.picks : null, ...scoreOf(t, S.step), bingo: !!S.bingo[t] });
  });
  app.post('/api/show/predict', tokLimit, (req, res) => {  // predictions close the moment the show goes live
    const t = need(req, res); if (!t) return;
    if (S.phase !== 'pre') return res.status(403).json({ error: 'Predictions are closed. The show has started.' });
    const picks = {};
    for (const c of categories) { const pick = req.body.picks && req.body.picks[c.id]; if (pick && c.nominees.some((n) => n.id === pick)) picks[c.id] = pick; }
    if (!Object.keys(picks).length) return res.status(400).json({ error: 'Pick at least one winner.' });
    S.predictions[t] = { name: nameOf(t), picks }; save(); res.json({ ok: true, count: Object.keys(picks).length });
  });
  const lastReact = new Map();
  app.post('/api/show/react', (req, res) => {          // no rate limiter here: a 250ms cooldown per device instead
    const t = need(req, res); if (!t) return;
    const e = req.body.emoji; if (!EMOJIS.includes(e)) return res.status(400).json({ error: 'Unknown reaction.' });
    const now = Date.now(); if (now - (lastReact.get(t) || 0) < 250) return res.json({ ok: true, skipped: true });
    lastReact.set(t, now); S.reactions[t] = (S.reactions[t] || 0) + 1; dirty = true; rbuf[e] = (rbuf[e] || 0) + 1;
    res.json({ ok: true });
  });
  app.post('/api/show/bingo', tokLimit, (req, res) => {   // a guest shouts BINGO: the big screen shows their name once
    const t = need(req, res); if (!t) return;
    if (S.bingo[t]) return res.json({ ok: true, again: true });
    S.bingo[t] = Date.now(); save(); clients.forEach((cl) => cl.role === 'stage' && send(cl, 'bingo', { name: nameOf(t) })); res.json({ ok: true });
  });
  app.post('/api/show/caption', tokLimit, (req, res) => {
    const t = need(req, res); if (!t) return;
    if ((STEPS[S.step] || {}).type !== 'caption') return res.status(403).json({ error: 'Captions are not open right now.' });
    const text = String(req.body.text || '').trim().slice(0, 80); if (text.length < 2) return res.status(400).json({ error: 'Write a caption.' });
    S.captions = S.captions.filter((c) => c.token !== t); S.captions.push({ id: crypto.randomBytes(3).toString('hex'), token: t, text, votes: 0 });
    save(); broadcastSoon(); res.json({ ok: true });
  });
  app.post('/api/show/capvote', tokLimit, (req, res) => {
    const t = need(req, res); if (!t) return;
    if ((STEPS[S.step] || {}).type !== 'captionvote') return res.status(403).json({ error: 'Voting is not open right now.' });
    const cap = S.captions.find((c) => c.id === req.body.id);
    if (!cap) return res.status(400).json({ error: 'Unknown caption.' });
    if (cap.token === t) return res.status(403).json({ error: 'You cannot vote for your own caption.' });
    if (S.capVotes[t]) return res.status(409).json({ error: 'You already voted.' });
    S.capVotes[t] = cap.id; cap.votes++; save(); res.json({ ok: true });
  });

  // ---- host controls (need the admin key) ----
  const go = (i) => {
    i = Math.max(0, Math.min(STEPS.length - 1, Math.floor(Number(i)) || 0));
    if (STEPS[i].type === 'caption' && i > S.step) { S.captions = []; S.capVotes = {}; }   // a fresh caption battle
    S.step = i; S.startedAt = Date.now();
    if (STEPS[i].type === 'end') { S.phase = 'done'; saveSettings({ revealed: true }); }   // the public results page opens at the end
    else if (S.phase !== 'pre') S.phase = 'live';
  };
  app.get('/api/show/admin', adminGate, (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
    const seen = new Map(); categories.forEach((c) => c.nominees.forEach((n) => seen.set(n.id, n.name)));
    res.json({ phase: S.phase, idx: S.step, steps: STEPS.map((s) => s.label), guests: Object.keys(S.guests).length, predictions: Object.keys(S.predictions).length,
      reactions: Object.values(S.reactions).reduce((a, b) => a + b, 0), screens: clients.size, roasts: S.roasts, ads: S.ads,
      captionPhoto: S.captionPhoto, images: images(), people: [...seen].map(([id, name]) => ({ id, name })), defaultRoasts: ROASTS });
  });
  app.post('/api/show/admin', adminGate, (req, res) => {
    if (!adminOk(req)) return res.status(401).json({ error: 'Wrong admin key.' });
    const b = req.body || {};
    if (b.action === 'start') { S.phase = 'live'; go(0); saveSettings({ closed: true }); }   // going live also closes voting
    else if (b.action === 'next') { if (S.phase === 'pre') return res.status(400).json({ error: 'Press Start the show first.' }); go(S.step + 1); }
    else if (b.action === 'back') go(S.step - 1);
    else if (b.action === 'goto') go(b.index);
    else if (b.action === 'pre') { S.phase = 'pre'; S.step = 0; }
    else if (b.action === 'reset') S = fresh();
    else if (b.action === 'config') {
      if (b.roasts && typeof b.roasts === 'object') S.roasts = Object.fromEntries(Object.entries(b.roasts).map(([k, v]) => [String(k), String(v).trim().slice(0, 140)]).filter(([, v]) => v));
      if (Array.isArray(b.ads)) S.ads = b.ads.map((a) => String(a).trim().slice(0, 200)).filter(Boolean).slice(0, 8);
      if (typeof b.captionPhoto === 'string') S.captionPhoto = b.captionPhoto;
    } else return res.status(400).json({ error: 'Unknown action.' });
    save(); broadcast(); res.json({ ok: true, idx: S.step, phase: S.phase });
  });

  // The quiz page reports each finished game so the leaderboard can show the best score per guest.
  return { quizScore(token, score, total) {
    if (!S.guests[token]) return;
    if (!S.quiz[token] || score > S.quiz[token].score) { S.quiz[token] = { score, total }; save(); }
  } };
};

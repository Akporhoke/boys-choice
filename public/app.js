// Tiny element builder: h('div', {class:'x'}, 'text', childEl). Uses textContent, so names can never inject HTML.
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  kids.flat().forEach((c) => el.append(c));
  return el;
};
// Ceremony start. Change this line if the time changes (+01:00 is Nigerian time).
const CEREMONY = new Date('2026-11-30T00:00:00+01:00');
// Funny lines shown while a vote is sending, and on the thank-you screen
const SENDING = ['Counting your votes...', 'Checking if you voted for yourself...', 'Asking the group chat ghost for permission...', 'Almost done. Stop refreshing.'];
const QUIPS = ['Vote sealed. Some people are about to be very upset.', 'Democracy has spoken. Somebody is already complaining in the group chat.',
  'Your vote is locked in. No take-backs, no excuses.', 'Done. Now go and pretend you did not vote for your friend.',
  'Vote received. The group chat ghost has been notified and will reply in 3 to 5 working days.'];
const main = document.getElementById('main');
const api = (url, body) => fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.'); return d; });

// One random token per browser: lets the server block a second ballot from the same device.
const token = localStorage.getItem('bc_token') || (() => { const t = crypto.randomUUID(); localStorage.setItem('bc_token', t); return t; })();
const state = { name: '', code: '', cats: [], i: 0, picks: {}, opens: 0 };   // opens = opening time in ms, or 0 when voting is already open

// NEW: "not open yet" helpers. locked() is true until the opening time. The server enforces this too; this only drives the screens.
const locked = () => state.opens && Date.now() < state.opens;
const fmtWhen = (ms) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });   // shown in the voter's own time
// A small message at the bottom of the screen that hides itself (textContent only).
let toastEl, toastTimer;
function toast(msg) {
  if (!toastEl) { toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: '' }); document.body.append(toastEl); }
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}
const show = (...nodes) => { main.replaceChildren(...nodes); window.scrollTo(0, 0); };

// Live countdown to the ceremony. It stops by itself when the screen changes.
function countdown() {
  const el = h('p', { class: 'count', 'aria-live': 'off' });
  const tick = () => {
    const ms = CEREMONY - Date.now();
    if (ms <= 0) { el.textContent = 'The ceremony is today!'; return; }
    const d = Math.floor(ms / 864e5), hr = Math.floor(ms / 36e5) % 24, mi = Math.floor(ms / 6e4) % 60, se = Math.floor(ms / 1e3) % 60;
    el.textContent = `${d} days ${hr}h ${mi}m ${se}s to the ceremony`;
  };
  tick();
  const t = setInterval(() => (el.isConnected ? tick() : clearInterval(t)), 1000);
  return el;
}

async function start() {
  const ballot = await api('/api/ballot');
  state.cats = ballot.categories;
  state.opens = ballot.voting === 'soon' ? Date.parse(ballot.opensAt) : 0;   // NEW: 0 means voting is already open
  if ((await api('/api/status?token=' + token)).voted) return done('You have already voted on this device.');
  // NEW: if the admin closed voting, new voters see this instead of the entry screen (people who already voted still get their thank-you screen above)
  if (ballot.closed) return show(h('section', { class: 'panel entry' }, h('h1', {}, 'Voting is closed'), h('p', {}, 'Results open at the ceremony on November 30.')));
  const err = h('p', { class: 'err', role: 'alert' });
  const name = h('input', { id: 'name', autocomplete: 'name', maxlength: 60 });
  const code = h('input', { id: 'code', autocomplete: 'off' });
  const btn = h('button', { class: 'go', type: 'button' }, 'Take your seat');
  btn.addEventListener('click', async () => {
    err.textContent = '';
    if (name.value.trim().length < 2) return (err.textContent = 'Enter your name to continue.');
    btn.disabled = true;
    try {
      if (ballot.needsCode) await api('/api/enter', { code: code.value });
      state.name = name.value.trim(); state.code = code.value;
      category();                                     // the first category is already there, behind the curtains
      document.body.classList.add('reveal', 'open');  // curtains come in front of it, then part to reveal it
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  });
  show(h('section', { class: 'panel entry' },
    h('h1', {}, "The Boys' Choice Awards"),
    countdown(),
    h('p', { class: 'voters' }, ballot.voters ? `${ballot.voters} ${ballot.voters === 1 ? 'boy has' : 'boys have'} voted so far.` : 'Be the first to vote.'),
    h('p', {}, 'Pick one nominee in each category. You can vote once.'),
    state.opens ? h('p', { class: 'soonline' }, `Voting opens ${fmtWhen(state.opens)}. You can look around until then.`) : '',   // NEW
    h('label', { for: 'name' }, 'Your name'), name,
    ballot.needsCode ? [h('label', { for: 'code' }, 'Access code from the group'), code] : '',
    err, btn));
}

// A nominee's picture. Video stickers play silently on a loop; everything else is a normal photo.
function media(n) {
  if (!n.video) return h('img', { src: n.photo, alt: n.name });
  const v = h('video', { src: n.video, poster: n.photo, loop: '', playsinline: '', 'aria-label': n.name });
  v.muted = true; v.autoplay = true;                   // browsers only autoplay when muted
  v.play().catch(() => {});                            // if autoplay is blocked, the still picture shows instead
  return v;
}

// ---- NEW: tap feedback. A tiny "ting" sound plus a short vibration (vibration works on Android; iPhones ignore it). ----
// Built in the browser, so no sound file is needed. Everything is wrapped in try/catch so it can never block a vote.
let ac;
function tick() {
  try {
    if (navigator.vibrate) navigator.vibrate(15);
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.08);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);   // quiet and short
    o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.13);
  } catch { /* no sound is fine */ }
}

// ---- NEW: confetti when the vote is sent (same effect as the results page; skipped if the phone asks for reduced motion) ----
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50';
  document.body.append(cv);                            // lives on the body, so it survives the screen change
  const W = (cv.width = innerWidth), H = (cv.height = innerHeight), g = cv.getContext('2d');
  const cols = ['#e8cf9a', '#b3252b', '#f6ead0', '#ffd36e'];
  const bits = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .55,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 16 - 6, s: 5 + Math.random() * 6, r: Math.random() * 6,
    vr: (Math.random() - .5) * .4, c: cols[Math.random() * 4 | 0] }));
  let frame = 0;
  (function step() {
    g.clearRect(0, 0, W, H);
    for (const p of bits) {
      p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); g.restore();
    }
    if (++frame < 200) requestAnimationFrame(step); else cv.remove();   // removes itself when done
  })();
}

// ---- NEW: info button support ----
// Only one category screen exists at a time, so one shared record is enough: { btn, panel, set }.
// category() fills it in on every draw; it is null when the category has no `info` text.
let info = null;
// Escape closes the panel and puts focus back on the "i" button.
// This listener is added ONCE here (not inside category()), so redraws never stack up listeners.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && info && info.btn.isConnected && !info.panel.hidden) info.set(false, true);
});

function category() {
  const c = state.cats[state.i], last = state.i === state.cats.length - 1;
  const look = !!locked();                              // NEW: true = voting has not opened yet, so this screen is look-only
  const next = state.cats[state.i + 1];
  if (next) next.nominees.forEach((n) => { new Image().src = n.photo; });
  const cards = c.nominees.map((n) => {
    const card = h('button', { class: 'card', type: 'button', 'aria-pressed': state.picks[c.id] === n.id },
      h('span', { class: 'frame' }, media(n)),
      h('span', { class: 'nm' }, n.name), h('span', { class: 'tg' }, n.tag));
    card.addEventListener('click', () => {
      if (locked()) return toast(`Voting opens ${fmtWhen(state.opens)}. You cannot pick yet.`);   // NEW: before opening, a tap picks nothing and moves nothing
      const picking = state.picks[c.id] !== n.id;       // tap the same nominee again to un-pick
      state.picks[c.id] = picking ? n.id : undefined;
      if (picking) tick();                              // NEW: tiny sound + vibration on a pick (not on un-pick)
      category();                                       // show the glow right away
      if (picking) {                                    // then move on by itself (one tap per category)
        const at = state.i;
        setTimeout(() => { if (state.i === at && state.picks[c.id]) last ? review() : (state.i++, category()); }, 350);
      }
    });
    return card;
  });

  // NEW step 1: build the info button and its panel (only if this category has an `info` text).
  // Every draw of category() builds a fresh panel that starts hidden, so moving to another category closes it.
  let infoBtn = '', infoPanel = '';
  info = null;
  if (c.info) {
    const closeBtn = h('button', { class: 'ghost info-close', type: 'button' }, 'Close');
    // h() puts the text in as a text node, so the description can never inject HTML.
    infoPanel = h('div', { class: 'info', id: 'info-panel', role: 'region', 'aria-label': `About ${c.name}`, hidden: '' },
      h('p', {}, c.info), closeBtn);
    // A real <button> with the required label, and aria-expanded that always matches the panel state.
    infoBtn = h('button', { class: 'info-btn', type: 'button', 'aria-label': 'About this award', 'aria-expanded': 'false', 'aria-controls': 'info-panel' }, 'i');
    // NEW step 2: one function opens or closes the panel and keeps aria-expanded in sync.
    // refocus = true sends keyboard focus back to the "i" button (used by Close and Escape).
    const set = (open, refocus) => {
      infoPanel.hidden = !open;
      infoBtn.setAttribute('aria-expanded', String(open));
      if (refocus) infoBtn.focus();
    };
    // NEW step 3: tapping "i" only toggles the panel. It is not inside a nominee card and never touches state.picks or state.i.
    infoBtn.addEventListener('click', () => set(infoPanel.hidden));
    closeBtn.addEventListener('click', () => set(false, true));
    info = { btn: infoBtn, panel: infoPanel, set };
  }

  show(h('section', {},
    // NEW step 4: the "i" button sits next to "Category X of Y" (grouped in .top-l so the name stays on the right).
    h('div', { class: 'top' }, h('div', { class: 'top-l' }, h('span', {}, `Category ${state.i + 1} of ${state.cats.length}`), infoBtn), h('span', {}, state.name)),
    h('div', { class: 'bar' }, h('i', { style: `width:${((state.i + 1) / state.cats.length) * 100}%` })),
    infoPanel,                                          // NEW step 5: the panel (hidden until "i" is tapped)
    h('h2', {}, c.name),
    h('p', { class: 'hint' }, look ? `Voting opens ${fmtWhen(state.opens)}. You can look around, but tapping a nominee will not pick yet.`
      : 'Tap a nominee and it moves on by itself. Use Skip to leave one blank.'),
    h('div', { class: 'grid' + (c.nominees.length < 4 ? ' few' : '') }, cards),
    h('div', { class: 'nav' },
      h('button', { class: 'ghost', type: 'button', onclick: () => { state.i ? (state.i--, category()) : null; } }, 'Back'),
      // NEW: while look-only, the button just browses (the last category loops back to the first); it never opens the review/submit screen
      h('button', { class: 'go', type: 'button', onclick: () => { look ? (last ? (state.i = 0, category()) : (state.i++, category())) : last ? review() : (state.i++, category()); } },
        look ? (last ? 'Back to the first one' : 'Next category') : last ? 'Review my picks' : (state.picks[c.id] ? 'Next category' : 'Skip this one')))));
}

function review() {
  const err = h('p', { class: 'err', role: 'alert' });
  const send = h('button', { class: 'go', type: 'button' }, 'Submit my vote');
  send.addEventListener('click', async () => {
    send.disabled = true; err.textContent = '';
    let k = 0; send.textContent = SENDING[0];                 // funny lines while the vote is sending
    const cycle = setInterval(() => { send.textContent = SENDING[++k % SENDING.length]; }, 1400);
    try {
      await api('/api/vote', { name: state.name, code: state.code, token, picks: state.picks });
      clearInterval(cycle); confetti(); done('Your vote is in. See you on November 30.');   // NEW: confetti on a successful submit
    } catch (e) { clearInterval(cycle); send.textContent = 'Submit my vote'; err.textContent = e.message; send.disabled = false; }
  });
  show(h('section', { class: 'panel' }, h('h2', {}, 'Your ballot'),
    h('ul', { class: 'review' }, state.cats.map((c) => {
      const n = c.nominees.find((x) => x.id === state.picks[c.id]);
      return h('li', {}, h('span', {}, c.name), h('b', {}, n ? n.name : 'No pick'));
    })),
    h('p', {}, 'You cannot change your vote after you submit.'), err,
    h('div', { class: 'nav' },
      h('button', { class: 'ghost', type: 'button', onclick: () => { state.i = state.cats.length - 1; category(); } }, 'Back'), send)));
}

async function done(msg) {
  document.body.classList.add('open');
  const count = h('p', { class: 'voters' }), ballotBox = h('div'), momentsBox = h('div'), cardBox = h('div');   // cardBox: NEW, holds the share card
  const ballotBtn = h('button', { class: 'ghost', type: 'button' }, 'View my ballot');
  const momentsBtn = h('button', { class: 'go', type: 'button', hidden: '' }, 'Relive the memories of 2026');   // shown once we know clips exist
  const wrap = h('section', { class: 'done' }, h('h2', {}, 'Thank you'), h('p', {}, msg),
    h('p', { class: 'quip' }, QUIPS[Math.floor(Math.random() * QUIPS.length)]), count,
    // CHANGED: the buttons now come right after the voter count, so "Relive the memories" is seen without scrolling.
    // The two boxes stay directly under the buttons, so the ballot or the gallery opens right where the voter tapped.
    h('div', { class: 'btnrow' }, momentsBtn, ballotBtn), ballotBox, momentsBox,
    cardBox,                                                              // share card
    makeRater('process', 'How was the nomination and voting process?'));   // feedback (from rate.js), now at the bottom
  show(wrap);

  // NEW: screenshot-friendly "I voted" card. It shows only HOW MANY categories were voted in, never who, so the ballot stays secret.
  // The count comes from the server (this device's own ballot), so it is also right when someone comes back later.
  api('/api/my-ballot?token=' + token).then(({ picks }) => {
    if (!picks) return;
    const line = `I voted in ${Object.keys(picks).length} of ${state.cats.length} categories.`;
    const card = h('div', { class: 'votecard' },
      h('p', { class: 'vc-title' }, "The Boys' Choice Awards"),
      h('p', { class: 'vc-big' }, line),
      state.name ? h('p', { class: 'vc-name' }, state.name) : '',
      h('p', { class: 'vc-foot' }, 'Winners revealed November 30'));
    cardBox.replaceChildren(card, h('p', { class: 'vc-hint' }, 'Screenshot it and post it in the group chat.'));
    if (navigator.share) {                              // phones with a share sheet get a Share button too
      const share = h('button', { class: 'ghost', type: 'button' }, 'Share');
      share.addEventListener('click', () => navigator.share({ title: "The Boys' Choice Awards", text: line, url: location.origin }).catch(() => {}));
      cardBox.append(share);
    }
  }).catch(() => {});                                   // the card is a bonus: ignore errors
  api('/api/count').then((d) => { count.textContent = `${d.voters} ${d.voters === 1 ? 'boy has' : 'boys have'} voted so far.`; }).catch(() => {});

  // View my ballot: asks the server for THIS device's picks, tap again to hide
  ballotBtn.addEventListener('click', async () => {
    if (ballotBox.childElementCount) return ballotBox.replaceChildren();
    try {
      const { picks } = await api('/api/my-ballot?token=' + token);
      if (!picks) return ballotBox.replaceChildren(h('p', {}, 'No ballot found on this device.'));
      ballotBox.replaceChildren(h('section', { class: 'panel', style: 'margin-top:1.4rem' }, h('h2', {}, 'Your ballot'),
        h('ul', { class: 'review' }, state.cats.map((c) => {
          const n = c.nominees.find((x) => x.id === picks[c.id]);
          return h('li', {}, h('span', {}, c.name), h('b', {}, n ? n.name : 'No pick'));
        }))));
    } catch (e) { ballotBox.replaceChildren(h('p', { class: 'err' }, e.message)); }
  });

  try {                                               // funny moments: the count comes from the files, so it is always right
    const list = await api('/api/moments');
    if (!list.length) return;
    momentsBtn.textContent = `Relive the ${list.length} memories of 2026`; momentsBtn.hidden = false;
    momentsBtn.addEventListener('click', () => {
      momentsBtn.hidden = true;
      momentsBox.replaceChildren(h('h2', { class: 'mh' }, 'Funny 2026 moments'),
        h('p', { class: 'quip' }, `2026 presents ${list.length} amazing memories of the boys.`),
        h('div', { class: 'moments' }, list.map((m) => {
          if (m.type === 'video') {                   // clips: nothing downloads until the voter presses play
            return h('figure', { class: 'moment vid' },
              h('span', { class: 'frame' }, h('video', { src: m.src, poster: m.poster, controls: '', playsinline: '', preload: 'none' })),
              m.title ? h('figcaption', {}, m.title) : '');
          }
          const img = h('img', { src: m.src, alt: m.title || 'Funny moment', loading: 'lazy' });   // lazy: loads only as you scroll
          const fig = h('figure', { class: 'moment' + (m.wide ? ' wide' : '') }, h('span', { class: 'frame' }, img), m.title ? h('figcaption', {}, m.title) : '');
          fig.addEventListener('click', () => fig.classList.toggle('big'));                         // tap a photo to enlarge it
          return fig;
        })));
    });
  } catch { /* clips are a bonus: ignore errors */ }
}

start().catch((e) => show(h('p', { class: 'err' }, e.message)));

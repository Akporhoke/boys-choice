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
const state = { name: '', code: '', cats: [], i: 0, picks: {} };
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
  if ((await api('/api/status?token=' + token)).voted) return done('You have already voted on this device.');
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
  const next = state.cats[state.i + 1];
  if (next) next.nominees.forEach((n) => { new Image().src = n.photo; });
  const cards = c.nominees.map((n) => {
    const card = h('button', { class: 'card', type: 'button', 'aria-pressed': state.picks[c.id] === n.id },
      h('span', { class: 'frame' }, media(n)),
      h('span', { class: 'nm' }, n.name), h('span', { class: 'tg' }, n.tag));
    card.addEventListener('click', () => {
      const picking = state.picks[c.id] !== n.id;       // tap the same nominee again to un-pick
      state.picks[c.id] = picking ? n.id : undefined;
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
    h('p', { class: 'hint' }, 'Tap a nominee and it moves on by itself. Use Skip to leave one blank.'),
    h('div', { class: 'grid' + (c.nominees.length < 4 ? ' few' : '') }, cards),
    h('div', { class: 'nav' },
      h('button', { class: 'ghost', type: 'button', onclick: () => { state.i ? (state.i--, category()) : null; } }, 'Back'),
      h('button', { class: 'go', type: 'button', onclick: () => { last ? review() : (state.i++, category()); } },
        last ? 'Review my picks' : (state.picks[c.id] ? 'Next category' : 'Skip this one')))));
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
      clearInterval(cycle); done('Your vote is in. See you on November 30.');
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
  const count = h('p', { class: 'voters' }), ballotBox = h('div'), momentsBox = h('div');
  const ballotBtn = h('button', { class: 'ghost', type: 'button' }, 'View my ballot');
  const momentsBtn = h('button', { class: 'go', type: 'button', hidden: '' }, 'Relive the memories of 2026');   // shown once we know clips exist
  const wrap = h('section', { class: 'done' }, h('h2', {}, 'Thank you'), h('p', {}, msg),
    h('p', { class: 'quip' }, QUIPS[Math.floor(Math.random() * QUIPS.length)]), count,
    makeRater('process', 'How was the nomination and voting process?'),   // from rate.js
    h('div', { class: 'btnrow' }, ballotBtn, momentsBtn), ballotBox, momentsBox);
  show(wrap);
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

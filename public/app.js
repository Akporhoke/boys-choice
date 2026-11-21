// Tiny element builder: h('div', {class:'x'}, 'text', childEl). Uses textContent, so names can never inject HTML.
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k.startsWith('on') ? el.addEventListener(k.slice(2), v) : el.setAttribute(k, v);
  kids.flat().forEach((c) => el.append(c));
  return el;
};
const main = document.getElementById('main');
const api = (url, body) => fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.'); return d; });

// One random token per browser: lets the server block a second ballot from the same device.
const token = localStorage.getItem('bc_token') || (() => { const t = crypto.randomUUID(); localStorage.setItem('bc_token', t); return t; })();
const state = { name: '', code: '', cats: [], i: 0, picks: {} };
const show = (...nodes) => { main.replaceChildren(...nodes); window.scrollTo(0, 0); };

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
      document.body.classList.add('open');            // curtains slide open
      setTimeout(category, 350);                      // first category appears as they part
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  });
  show(h('section', { class: 'panel entry' },
    h('h1', {}, "The Boys' Choice Awards"),
    h('p', {}, 'Ceremony on November 30. Pick one nominee in each category. You can vote once.'),
    h('label', { for: 'name' }, 'Your name'), name,
    ballot.needsCode ? [h('label', { for: 'code' }, 'Access code from the group'), code] : '',
    err, btn));
}

function category() {
  const c = state.cats[state.i], last = state.i === state.cats.length - 1;
  const next = state.cats[state.i + 1];
  if (next) next.nominees.forEach((n) => { new Image().src = n.photo; });
  const cards = c.nominees.map((n) => {
    const card = h('button', { class: 'card', type: 'button', 'aria-pressed': state.picks[c.id] === n.id },
      h('span', { class: 'frame' }, h('img', { src: n.photo, alt: n.name })),
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
  show(h('section', {},
    h('div', { class: 'top' }, h('span', {}, `Category ${state.i + 1} of ${state.cats.length}`), h('span', {}, state.name)),
    h('div', { class: 'bar' }, h('i', { style: `width:${((state.i + 1) / state.cats.length) * 100}%` })),
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
    try {
      await api('/api/vote', { name: state.name, code: state.code, token, picks: state.picks });
      done('Your vote is in. See you on November 30.');
    } catch (e) { err.textContent = e.message; send.disabled = false; }
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
  const wrap = h('section', { class: 'done' }, h('h2', {}, 'Thank you'), h('p', {}, msg));
  show(wrap);
  try {                                               // then load the clips; if none exist, show nothing extra
    const list = await api('/api/moments');
    if (!list.length) return;
    const open = h('button', { class: 'go', type: 'button', style: 'margin-top:2.5rem' }, `Watch funny 2026 moments (${list.length})`);
    open.addEventListener('click', () => {
      open.replaceWith(h('div', {}, h('h2', { class: 'mh' }, 'Funny 2026 moments'),
        h('div', { class: 'moments' }, list.map((m) => {
          if (m.type === 'video') {                   // clips: nothing downloads until the voter presses play
            return h('figure', { class: 'moment vid' },
              h('span', { class: 'frame' }, h('video', { src: m.src, poster: m.poster, controls: '', playsinline: '', preload: 'none' })),
              m.title ? h('figcaption', {}, m.title) : '');
          }
          const img = h('img', { src: m.src, alt: m.title || 'Funny moment', loading: 'lazy' });   // lazy: loads only as you scroll
          const fig = h('figure', { class: 'moment' }, h('span', { class: 'frame' }, img), m.title ? h('figcaption', {}, m.title) : '');
          fig.addEventListener('click', () => fig.classList.toggle('big'));                         // tap a photo to enlarge it
          return fig;
        }))));
    });
    wrap.append(open);
  } catch { /* clips are a bonus: ignore errors */ }
}

start().catch((e) => show(h('p', { class: 'err' }, e.message)));

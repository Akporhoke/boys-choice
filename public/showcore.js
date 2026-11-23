// showcore.js: shared by stage.html (big screen), show.html (phones) and host.html.
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (cls) e.className = cls; return e; };   // text goes in with textContent, so names can never inject HTML
const myToken = () => { let t = localStorage.getItem('bc_token'); if (!t) { t = crypto.randomUUID(); localStorage.setItem('bc_token', t); } return t; };
const api = (url, body, key) => fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(key ? { 'x-admin-key': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong. Try again.'); return d; });

// ---- live connection: Server-Sent Events, plus a slow poll as a safety net ----
function connect(role, onState, onEvent, onStatus) {
  let last = 0;
  const take = (s) => { s._skew = s.now - Date.now(); if (s.v >= last) { last = s.v; onState(s); } };   // _skew = how far this phone's clock is off the server's
  const es = new EventSource('/api/show/stream?role=' + role);
  es.addEventListener('state', (e) => take(JSON.parse(e.data)));
  es.addEventListener('react', (e) => onEvent && onEvent('react', JSON.parse(e.data)));
  es.addEventListener('bingo', (e) => onEvent && onEvent('bingo', JSON.parse(e.data)));
  es.onopen = () => { last = 0; onStatus && onStatus(true); };   // after a reconnect (or a server restart) accept any version again
  es.onerror = () => onStatus && onStatus(false);
  setInterval(() => api('/api/show/state').then(take).catch(() => {}), 15000);
}

// ---- confetti (same effect as the results page) ----
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:50'; document.body.append(cv);
  const W = (cv.width = innerWidth), H = (cv.height = innerHeight), g = cv.getContext('2d'), cols = ['#e8cf9a', '#b3252b', '#f6ead0', '#ffd36e'];
  const bits = Array.from({ length: 200 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .4, y: H * .6, vx: (Math.random() - .5) * 16, vy: -Math.random() * 18 - 6, s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.random() * 4 | 0] }));
  let f = 0;
  (function step() { g.clearRect(0, 0, W, H);
    for (const p of bits) { p.vy += .35; p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .6); g.restore(); }
    if (++f < 220) requestAnimationFrame(step); else cv.remove(); })();
}

// ---- small pieces ----
const CROWN = '<svg class="crown" viewBox="0 0 120 92" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M14 70 L8 24 L38 47 L60 12 L82 47 L112 24 L106 70 Z"/><path d="M14 78 H106"/><path d="M20 86 H100"/><circle cx="8" cy="19" r="4"/><circle cx="60" cy="7" r="4"/><circle cx="112" cy="19" r="4"/></svg>';
const crown = () => { const d = el('div'); d.innerHTML = CROWN; return d.firstChild; };   // fixed markup, no user text, so innerHTML is safe here
function media(n, win) {                              // a nominee picture in the bulb frame (video stickers loop silently)
  const f = el('span', undefined, 'frame' + (win ? ' win' : ''));
  if (n.video) { const v = el('video'); v.src = n.video; v.poster = n.photo; v.loop = true; v.muted = true; v.autoplay = true; v.setAttribute('playsinline', ''); v.play().catch(() => {}); f.append(v); }
  else { const i = el('img'); i.src = n.photo; i.alt = n.name; f.append(i); }
  return f;
}
const lb = (rows, fmt) => { const ul = el('ul', undefined, 'lb'); rows.forEach((r) => { const li = el('li'); li.append(el('span', r.name), el('span', fmt(r))); ul.append(li); }); return ul; };   // a ranked list

// ---- one function draws any step, for both the phone and the big screen ----
// role = 'stage' | 'phone'. hooks = the things only phones do (caption, vote, certificate) and sounds.
function renderStep(S, role, hooks = {}) {
  const st = S.step, box = el('section', undefined, 'step'), T = st.type, add = (...n) => box.append(...n);
  box._stops = [];
  const stop = (fn) => box._stops.push(fn);
  if (S.phase === 'pre') {                              // before the show: the red carpet
    add(crown(), el('h1', 'The Red Carpet'), el('p', S.guests === 1 ? '1 guest has checked in' : `${S.guests} guests have checked in`));
    const wall = el('div'); wall.style.margin = '1rem 0'; S.names.slice(-80).forEach((n) => wall.append(el('span', n, 'pill'))); add(wall);
    return box;
  }
  if (T === 'open') add(crown(), el('h1', "The Boys' Choice Awards 2026"), el('p', 'Welcome. Find your seat. Phones on silent.'));
  else if (T === 'intro') {
    add(el('p', 'The nominees for'), el('h1', st.cat.name)); if (st.cat.info) add(el('p', st.cat.info, 'roast'));
    const g = el('div', undefined, 'grid'), nn = st.cat.nominees.length; g.style.setProperty('--c', nn <= 6 ? nn : Math.ceil(nn / 2)); g.style.setProperty('--s', nn <= 6 ? '24vh' : '16vh');   // --c = nominees per row, so the big screen can size the pictures to fit
    st.cat.nominees.forEach((n) => { const f = el('figure'); f.append(media(n), el('figcaption', n.name)); g.append(f); }); add(g);
  } else if (T === 'envelope') {
    add(el('h2', st.cat.name), el('p', 'And the winner is...'));
    const e = el('div', undefined, 'env'); e.innerHTML = '<svg viewBox="0 0 120 84" fill="none" stroke="#e8cf9a" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="112" height="76" rx="4" fill="#1f0a0c"/><path d="M4 8 L60 50 L116 8"/><circle cx="60" cy="50" r="9" fill="#b3252b"/></svg>'; add(e);   // fixed markup
  } else if (T === 'winner') {
    add(el('p', 'The winner is'), el('h2', st.cat.name));
    if (!st.winners.length) add(el('p', 'No votes in this category.'));
    else {
      const row = el('div', undefined, 'winrow');
      st.winners.forEach((w) => { const f = el('figure'); f.append(media(w, true), el('b', w.name)); if (w.tag) f.append(el('span', w.tag)); f.append(el('div', `${w.votes} ${w.votes === 1 ? 'vote' : 'votes'}`));
        if (hooks.cert) { const b = el('button', 'Make winner card', 'btn ghost'); b.style.marginTop = '.6rem'; b.onclick = () => hooks.cert(w, st.cat.name); f.append(b); } row.append(f); });
      add(row, el('p', st.winners.length > 1 ? 'It is a tie!' : st.winners[0].roast, 'roast'));
      const max = Math.max(1, ...st.rows.map((r) => r.votes));
      st.rows.forEach((r) => { const d = el('div', undefined, 'bar'), i = el('i'), w = el('div'); w.style.flex = '1'; i.style.width = (r.votes / max * 100) + '%'; w.append(i); d.append(el('span', r.name), w, el('b', r.votes)); add(d); });
    }
  } else if (T === 'speech') {
    add(el('h2', st.winners.length ? st.winners.map((w) => w.name).join(' and ') : st.cat.name), el('p', 'Your speech. Fifteen seconds. Go.'));
    const num = el('div', '', 'count'), tag = el('p', ''); add(num, tag); let fired = false;
    const tick = () => { const left = Math.max(0, Math.ceil((st.endsAt - (Date.now() + (S._skew || 0))) / 1000)); num.textContent = left;
      if (left > 0 && left <= 5 && hooks.onTick) hooks.onTick(left);
      if (left === 0) { tag.textContent = 'Time is up. Play them off!'; if (!fired) { fired = true; hooks.onTimeUp && hooks.onTimeUp(); } clearInterval(iv); } };
    const iv = setInterval(tick, 250); tick(); stop(() => clearInterval(iv));
  } else if (T === 'ad') add(el('p', 'A word from our sponsors'), el('h2', st.text));
  else if (T === 'quiz') add(el('h1', 'Quiz leaderboard'), st.leaders.length ? lb(st.leaders, (r) => `${r.n} / ${r.total}`) : el('p', 'Nobody has played yet. Open the quiz on your phone!'));
  else if (T === 'caption') {
    add(el('h1', 'Caption battle'), el('p', 'Write the funniest caption. Open the show page on your phone.')); if (st.photo) { const i = el('img', undefined, 'slide'); i.src = st.photo; add(i); }
    add(el('p', `${st.count} caption${st.count === 1 ? '' : 's'} in`));
    if (hooks.caption) { const inp = el('input'); inp.maxLength = 80; inp.placeholder = 'Your caption'; const b = el('button', 'Send caption', 'btn'), m = el('p', '', 'err'); b.style.marginTop = '.6rem';
      b.onclick = async () => { try { await hooks.caption(inp.value); m.style.color = 'var(--gold)'; m.textContent = 'Sent! You can send again to replace it.'; } catch (e) { m.style.color = ''; m.textContent = e.message; } }; add(inp, b, m); }
  } else if (T === 'captionvote') {
    add(el('h1', 'Vote for the best caption')); if (st.photo) { const i = el('img', undefined, 'slide'); i.src = st.photo; add(i); }
    const list = el('div', undefined, 'caps'), m = el('p', '', 'err');
    st.captions.forEach((c) => { if (hooks.vote) { const b = el('button', c.text, 'cap'); b.onclick = async () => { try { await hooks.vote(c.id); list.querySelectorAll('.cap').forEach((x) => x.classList.remove('on')); b.classList.add('on'); m.style.color = 'var(--gold)'; m.textContent = 'Vote counted.'; } catch (e) { m.style.color = ''; m.textContent = e.message; } }; list.append(b); } else list.append(el('div', c.text, 'cap')); });
    add(list, m); if (!st.captions.length) add(el('p', 'No captions were sent.'));
  } else if (T === 'captionwin') {
    add(el('h1', 'Caption of the night')); if (st.photo) { const i = el('img', undefined, 'slide'); i.src = st.photo; add(i); }
    add(st.win ? el('h2', `"${st.win.text}"`) : el('p', 'No captions.'), st.win ? el('p', `by ${st.win.author}, ${st.win.votes} vote${st.win.votes === 1 ? '' : 's'}`) : '');
  } else if (T === 'oracle') {
    add(el('h1', 'The Best Oracle'), el('p', 'Who predicted the winners?')); const L = st.leaders;
    add(L.length ? lb(L, (r) => `${r.score} / ${r.of}`) : el('p', 'Nobody made predictions.')); if (L.length) add(el('h2', `${L[0].name}!`), el('p', 'Oracle of the Year'));
  } else if (T === 'hype') {
    add(el('h1', 'Hype Man of the Night'), el('p', 'Most reactions sent.')); const L = st.leaders;
    add(L.length ? lb(L, (r) => `${r.n} reactions`) : el('p', 'Nobody reacted. Cold crowd.')); if (L.length) add(el('h2', `${L[0].name}!`));
  } else if (T === 'recap') {
    add(el('h1', '2026 in memories'), el('p', '', 'roast')); const img = el('img', undefined, 'slide'); add(img);
    api('/api/moments').then((list) => { const pics = list.filter((m) => m.type === 'image'); if (!pics.length) return; box.querySelector('.roast').textContent = `2026 presents ${list.length} amazing memories of the boys.`;
      let i = 0; const show = () => { img.src = pics[i++ % pics.length].src; hooks.onSlide && hooks.onSlide(i); }; show(); const iv = setInterval(show, 2400); stop(() => clearInterval(iv)); }).catch(() => {});
  } else if (T === 'teaser') {
    if (role === 'stage') { const f = el('iframe'); f.src = '/boysdor.html'; f.style.cssText = 'width:100%;height:80vh;border:0'; f.title = "Boys d'Or"; add(f); }
    else { add(el('h1', "BOYS D'OR"), el('p', 'Something is coming. 2027.')); const a = el('a', 'See the teaser', 'btn'); a.href = '/boysdor.html'; add(a); }
  } else if (T === 'end') {
    add(crown(), el('h1', 'Thank you for 2026'), el('p', 'You made it the best year of the group chat.')); const a = el('a', 'See all the results', 'btn'); a.href = '/results.html'; a.style.display = 'inline-block'; add(a);
  }
  return box;
}

// ---- the winner card: a gold certificate drawn on a canvas, ready to post ----
async function makeCert(w, catName) {
  try { await document.fonts.load('700 80px "Cormorant Garamond"'); } catch {}
  const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  const bg = g.createRadialGradient(W / 2, H * .42, 60, W / 2, H * .42, H * .85); bg.addColorStop(0, '#3a1013'); bg.addColorStop(1, '#040302'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#b98d45'; g.lineWidth = 3; g.strokeRect(40, 40, W - 80, H - 80); g.strokeRect(58, 58, W - 116, H - 116);
  g.save(); g.translate(W / 2 - 80, 100); g.scale(1.33, 1.33); g.strokeStyle = '#e8cf9a'; g.lineWidth = 2.2; g.lineJoin = 'round';
  g.stroke(new Path2D('M14 70 L8 24 L38 47 L60 12 L82 47 L112 24 L106 70 Z M14 78 H106 M20 86 H100')); [[8, 19], [60, 7], [112, 19]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 4, 0, 7); g.stroke(); }); g.restore();
  g.textAlign = 'center'; g.fillStyle = '#e8cf9a'; g.font = '300 30px Lora, serif'; g.fillText("THE BOYS' CHOICE AWARDS 2026", W / 2, 310);
  g.font = 'italic 400 54px "Cormorant Garamond", Georgia, serif'; g.fillText(catName, W / 2, 385);
  await new Promise((r) => { const img = new Image(); img.onload = () => { const s = Math.min(img.width, img.height), x = W / 2 - 270;
    g.fillStyle = '#b98d45'; g.fillRect(x - 14, 430 - 14, 568, 568); g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, 430, 540, 540); r(); }; img.onerror = r; img.src = w.photo; });
  g.fillStyle = '#e8cf9a'; g.font = '300 34px Lora, serif'; g.fillText('WINNER', W / 2, 1050);
  let size = 110; g.font = `700 ${size}px "Cormorant Garamond", Georgia, serif`; while (g.measureText(w.name).width > W - 200 && size > 40) { size -= 6; g.font = `700 ${size}px "Cormorant Garamond", Georgia, serif`; }
  g.fillText(w.name, W / 2, 1160); if (w.tag) { g.font = 'italic 400 34px Lora, serif'; g.globalAlpha = .8; g.fillText(w.tag, W / 2, 1215); g.globalAlpha = 1; }
  g.font = '300 24px Lora, serif'; g.globalAlpha = .6; g.fillText(location.host, W / 2, 1275); g.globalAlpha = 1;
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}
async function shareCert(w, catName) {
  const blob = await makeCert(w, catName), file = new File([blob], `${w.name.replace(/\W+/g, '-')}-winner.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: `${w.name}, ${catName}` }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();   // phones without sharing just download it
}

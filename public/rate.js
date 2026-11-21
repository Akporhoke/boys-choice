// Shared by the voting page and the results page: a 5-star rating box with an optional note.
// Each device gets one secret token, so it can send one rating per type (a new one replaces the old).
function deviceToken() {
  let t = localStorage.getItem('bc_token');
  if (!t) { t = crypto.randomUUID(); localStorage.setItem('bc_token', t); }
  return t;
}

// type is 'process' (after voting) or 'ceremony' (on the results page)
function makeRater(type, heading) {
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; };
  const box = el('section', '', 'panel rate'), title = el('h3', heading);
  const thanks = () => el('p', 'Thanks, your feedback is in.');
  if (localStorage.getItem('fb_' + type)) { box.append(title, thanks()); return box; }   // already sent from this device

  let rating = 0; const row = el('div', '', 'stars'), stars = [];
  for (let i = 1; i <= 5; i++) {
    const b = el('button', '★'); b.type = 'button'; b.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
    b.onclick = () => { rating = i; stars.forEach((s, j) => s.classList.toggle('on', j < i)); send.disabled = false; };
    stars.push(b); row.append(b);
  }
  const note = el('textarea'); note.maxLength = 500; note.rows = 3; note.placeholder = 'Any complaint or suggestion? (optional)';
  const err = el('p', '', 'err'), send = el('button', 'Send feedback', 'go'); send.type = 'button'; send.disabled = true;
  send.onclick = async () => {
    send.disabled = true; err.textContent = '';
    try {
      const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: deviceToken(), type, rating, note: note.value }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not send. Try again.');
      localStorage.setItem('fb_' + type, '1'); box.replaceChildren(title, thanks());
    } catch (e) { err.textContent = e.message; send.disabled = false; }
  };
  box.append(title, row, note, err, send);
  return box;
}

// sfx.js: the ceremony's sound effects, made live in the browser (no audio files). Shared by stage.html and show.html.
// The building blocks are the same ones used in the Boys d'Or teaser; below them are the ceremony sounds.
// ---- SOUND: a small film score played live by the browser (no audio files to download). ----
// The pieces: a dark pad that grows with the speech, a heartbeat that speeds up, a whoosh and a glass ping on every line,
// a riser that builds during the last line, a sudden drop, then a huge impact with a choir chord, bells and sparkles.
let sound = true, ac, master, curBus = null;
function audio() {                                   // starts only after the first tap, which phones require
  ac = ac || new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  if (!master) { master = ac.createGain(); master.gain.value = sound ? 1 : 0; master.connect(ac.destination); }
  return ac;
}
const noiseCache = new WeakMap(), irCache = new WeakMap();
function noiseBuf(c) {                               // 4 seconds of white noise, made once and reused
  let b = noiseCache.get(c);
  if (!b) { b = c.createBuffer(1, c.sampleRate * 4, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; noiseCache.set(c, b); }
  return b;
}
const noiseSrc = (c) => { const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true; return s; };
function impulse(c) {                                // a made-up concert hall: noise that fades away over 3.4 seconds = the echo
  let b = irCache.get(c);
  if (!b) { const len = Math.floor(c.sampleRate * 3.4); b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    irCache.set(c, b); }
  return b;
}
// One "bus" per playthrough: every sound goes in at bus.input; it gets echo, is kept from clipping, then goes out at bus.out.
function makeBus(c, dest) {
  const input = c.createGain(), comp = c.createDynamicsCompressor(), out = c.createGain();
  comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.008; comp.release.value = 0.3;
  const conv = c.createConvolver(), send = c.createGain(), wet = c.createGain();
  conv.buffer = impulse(c); send.gain.value = 0.34; wet.gain.value = 0.9;
  input.connect(comp); input.connect(send); send.connect(conv); conv.connect(wet); wet.connect(comp);
  const lim = c.createDynamicsCompressor();            // a final safety limiter so the big hit never distorts on a phone speaker
  lim.threshold.value = -4; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
  out.gain.value = 0.8; comp.connect(lim); lim.connect(out); out.connect(dest);
  return { input, out };
}
function killBus(b) {                                // quick fade-out, used by Skip and Replay
  if (!b || !ac) return;
  b.out.gain.setTargetAtTime(0, ac.currentTime, 0.06);
  setTimeout(() => { try { b.out.disconnect(); } catch {} }, 900);
}

// ---- building blocks ----
function adsr(g, t, a, peak, hold, r) {              // volume shape: quick rise to peak, hold, then fade out
  g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
}
function osc(c, type, f, t, dur, dest, o = {}) {     // one oscillator, optionally gliding to o.to
  const x = c.createOscillator(); x.type = type; x.frequency.setValueAtTime(f, t);
  if (o.to) x.frequency.exponentialRampToValueAtTime(o.to, t + (o.over || dur));
  if (o.detune) x.detune.value = o.detune;
  x.connect(dest); x.start(t); x.stop(t + dur + 0.1); return x;
}
function whoosh(c, dest, t, dur, from, to, vol) {    // noise sweeping up in pitch = a rush of air
  const n = noiseSrc(c), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.Q.value = 1.1; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  adsr(g, t, dur * 0.45, vol, 0, dur * 0.55);
  n.connect(f); f.connect(g); g.connect(dest); n.start(t, Math.random() * 2); n.stop(t + dur + 0.1);
}
function bell(c, dest, t, f, vol, ring) {            // a struck glass bell: one tone shaking another (FM) plus a quiet overtone
  const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), h2 = c.createOscillator(), hg = c.createGain();
  car.frequency.value = f; mod.frequency.value = f * 3.5;
  mg.gain.setValueAtTime(f * 2.4, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.3);   // the shimmer fades like a real bell
  mod.connect(mg); mg.connect(car.frequency);
  h2.frequency.value = f * 2.01; hg.gain.value = 0.25; h2.connect(hg); car.connect(g); hg.connect(g);
  adsr(g, t, 0.004, vol, 0, ring); g.connect(dest);
  [car, mod, h2].forEach((o) => { o.start(t); o.stop(t + ring + 0.1); });
}
function thump(c, dest, t, vol) {                    // one soft heartbeat knock
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(78, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.2);
  adsr(g, t, 0.006, vol, 0, 0.22); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3);
}
const heartbeat = (c, dest, t, vol) => { thump(c, dest, t, vol); thump(c, dest, t + 0.21, vol * 0.65); };   // lub-dub
function tick(c, dest, t, vol) {                     // a tiny click, used in the riser
  const n = noiseSrc(c), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 3; adsr(g, t, 0.002, vol, 0, 0.07);
  n.connect(f); f.connect(g); g.connect(dest); n.start(t, Math.random() * 2); n.stop(t + 0.12);
}
function pad(c, dest, t, dur, notes, vol, cuts, fade) {   // a dark held chord; cuts = [[seconds, brightness Hz]...] opens it up over time
  const f = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
  f.type = 'lowpass'; f.Q.value = 0.8; f.frequency.setValueAtTime(cuts[0][1], t + cuts[0][0]);
  cuts.slice(1).forEach(([dt, hz]) => f.frequency.exponentialRampToValueAtTime(hz, t + dt));
  lfo.frequency.value = 0.11; lg.gain.value = 140; lfo.connect(lg); lg.connect(f.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);   // slow breathing
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 5); g.gain.setValueAtTime(vol, t + dur - fade); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  notes.forEach((n) => [-7, 7].forEach((d) => osc(c, 'sawtooth', n, t, dur, f, { detune: d })));   // two slightly detuned saws per note = thick
  f.connect(g); g.connect(dest);
}
function choir(c, dest, t, dur, notes, vol) {        // an "ahh" chord: saw waves through two vowel filters, with a little vibrato
  const g = c.createGain(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), mix = c.createGain();
  f1.type = f2.type = 'bandpass'; f1.frequency.value = 800; f1.Q.value = 5; f2.frequency.value = 1250; f2.Q.value = 6;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 2.6); g.gain.setValueAtTime(vol, t + dur - 3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  notes.forEach((n, i) => {
    const o = osc(c, 'sawtooth', n, t, dur, mix, { detune: i % 2 ? 5 : -5 });
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5.2 + i * 0.3; lg.gain.value = 9; l.connect(lg); lg.connect(o.detune); l.start(t); l.stop(t + dur + 0.1);
  });
  mix.connect(f1); mix.connect(f2); f1.connect(g); f2.connect(g); g.connect(dest);
}
function riser(c, dest, t, dur) {                    // tension: rushing noise + a climbing tone + faster and faster clicks, cut dead just before the hit
  const n = noiseSrc(c), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.Q.value = 0.9; f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur - 0.05);
  n.connect(f); f.connect(g); g.connect(dest); n.start(t, 1); n.stop(t + dur + 0.1);
  const lp = c.createBiquadFilter(), tg = c.createGain(); lp.type = 'lowpass'; lp.frequency.value = 2500;
  osc(c, 'sawtooth', 90, t, dur, lp, { to: 1400, over: dur });
  tg.gain.setValueAtTime(0.0001, t); tg.gain.exponentialRampToValueAtTime(0.09, t + dur - 0.25); tg.gain.linearRampToValueAtTime(0.0001, t + dur - 0.05);
  lp.connect(tg); tg.connect(dest);
  let x = t, gap = 0.55; while (x < t + dur - 0.3) { tick(c, dest, x, 0.12 + 0.5 * ((x - t) / dur)); x += gap; gap = Math.max(0.05, gap * 0.86); }
}
function impact(c, dest, t) {                        // the big hit: deep boom + body + thud + metal crash
  const g1 = c.createGain(); adsr(g1, t, 0.004, 0.75, 0.05, 2.6); osc(c, 'sine', 150, t, 2.8, g1, { to: 30, over: 2.2 }); g1.connect(dest);
  const g2 = c.createGain(); adsr(g2, t, 0.004, 0.4, 0, 1.4); osc(c, 'triangle', 95, t, 1.6, g2, { to: 48, over: 1.2 }); g2.connect(dest);
  const n = noiseSrc(c), lp = c.createBiquadFilter(), ng = c.createGain();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.7);
  adsr(ng, t, 0.003, 0.5, 0, 0.8); n.connect(lp); lp.connect(ng); ng.connect(dest); n.start(t, 2); n.stop(t + 1);
  const n2 = noiseSrc(c), hp = c.createBiquadFilter(), cg = c.createGain();
  hp.type = 'highpass'; hp.frequency.value = 3500; adsr(cg, t, 0.005, 0.26, 0, 3.2); n2.connect(hp); hp.connect(cg); cg.connect(dest); n2.start(t, 1); n2.stop(t + 3.4);
}

// Part 2: the hit and everything after it: boom, a bright D major choir chord, a bell run, then drifting sparkles.
function scoreReveal(c, dest, t) {
  impact(c, dest, t);
  choir(c, dest, t + 0.1, 11, [146.83, 220, 293.66, 369.99, 440], 0.5);
  [587.33, 739.99, 880, 1174.66, 1479.98, 880, 1174.66].forEach((f, i) => bell(c, dest, t + 0.25 + i * 0.17, f, 0.13, 4.2));
  const sparkle = [1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32];
  let x = t + 1.8; while (x < t + 10) { bell(c, dest, x, sparkle[Math.random() * sparkle.length | 0], 0.035 + Math.random() * 0.03, 2.2); x += 0.22 + Math.random() * 0.5; }
  const low = c.createGain(); adsr(low, t + 0.2, 2.5, 0.18, 5, 4); osc(c, 'sine', 73.42, t + 0.2, 12, low); low.connect(dest);
}

// ---- ceremony sounds ----
function snare(c, dest, t, vol) {                    // one hit of a snare drum roll
  const n = noiseSrc(c), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8; adsr(g, t, 0.002, vol, 0, 0.1);
  n.connect(f); f.connect(g); g.connect(dest); n.start(t, Math.random() * 2); n.stop(t + 0.15);
}
function drumrollScore(c, dest, t, sec) {            // a roll that gets faster and louder, with a low rumble and a cymbal swell underneath
  let x = t, gap = 0.13;
  while (x < t + sec - 0.1) { snare(c, dest, x, 0.1 + 0.4 * ((x - t) / sec)); x += gap; gap = Math.max(0.032, gap * 0.965); }
  const g = c.createGain(); adsr(g, t, sec * 0.9, 0.22, 0, 0.15); osc(c, 'sine', 55, t, sec + 0.2, g, { to: 82, over: sec }); g.connect(dest);
  const n = noiseSrc(c), hp = c.createBiquadFilter(), ng = c.createGain();
  hp.type = 'highpass'; hp.frequency.setValueAtTime(2500, t); hp.frequency.exponentialRampToValueAtTime(7000, t + sec);
  adsr(ng, t, sec * 0.95, 0.12, 0, 0.1); n.connect(hp); hp.connect(ng); ng.connect(dest); n.start(t, 1); n.stop(t + sec + 0.3);
}
function playoffScore(c, dest, t) {                  // "your time is up": a sad falling horn plus a gong
  const lp = c.createBiquadFilter(), g = c.createGain(); lp.type = 'lowpass'; lp.frequency.value = 900;
  adsr(g, t, 0.05, 0.22, 0.5, 1.4); osc(c, 'sawtooth', 392, t, 2, lp, { to: 98, over: 1.8 }); osc(c, 'sawtooth', 396, t, 2, lp, { to: 99, over: 1.8 });
  lp.connect(g); g.connect(dest); bell(c, dest, t + 0.1, 110, 0.3, 4);
}
const SFX = (() => {
  let on = false, bus = null, roll = null;
  const ready = () => { const c = audio(); if (!bus) bus = makeBus(c, master); return c; };
  return {
    unlock() { ready(); },
    get on() { return on; },
    set(v) { on = v; if (master) master.gain.setTargetAtTime(v ? 1 : 0, ac.currentTime, 0.05); },
    drumroll(sec) { if (!on) return; const c = ready(); this.stopRoll(); roll = makeBus(c, master); drumrollScore(c, roll.input, c.currentTime + 0.05, sec); },
    stopRoll() { if (roll) { killBus(roll); roll = null; } },
    winner() { if (!on) return; const c = ready(); this.stopRoll(); scoreReveal(c, bus.input, c.currentTime + 0.05); },
    playoff() { if (!on) return; const c = ready(); playoffScore(c, bus.input, c.currentTime + 0.05); },
    whoosh() { if (!on) return; const c = ready(); whoosh(c, bus.input, c.currentTime, 1.2, 300, 2400, 0.14); },
    jingle() { if (!on) return; const c = ready(), t = c.currentTime + 0.05; [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(c, bus.input, t + i * 0.11, f, 0.1, 2.4)); },
    bingo() { if (!on) return; const c = ready(), t = c.currentTime + 0.02; [1046.5, 1318.5, 1568, 2093, 2637].forEach((f, i) => bell(c, bus.input, t + i * 0.06, f, 0.12, 2)); },
    tick() { if (!on) return; const c = ready(); tick(c, bus.input, c.currentTime, 0.5); },
    welcome() { if (!on) return; const c = ready(), t = c.currentTime + 0.05; choir(c, bus.input, t, 6, [146.83, 220, 293.66, 369.99], 0.4); [587.33, 739.99, 880, 1174.66].forEach((f, i) => bell(c, bus.input, t + 0.2 + i * 0.2, f, 0.1, 3)); },
  };
})();

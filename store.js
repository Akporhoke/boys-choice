// store.js: where ALL the site's data lives.
//   * With MONGODB_URI set, everything is saved in MongoDB, so updates, restarts and Render's sleeping never lose anything.
//   * Without it, data is kept in files under data/ (only meant for testing on your own computer).
// How it works: the server keeps a copy in memory (reads are instant) and writes every change to the database.
// A VOTE IS ONLY CONFIRMED TO THE VOTER AFTER MongoDB HAS SAVED IT, and the database itself refuses a second ballot
// for the same name or device, even if two people tap Submit at the same moment.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = async function createStore(dataDir) {
  const uri = (process.env.MONGODB_URI || '').trim();
  const cache = { votes: [], docs: {} };                 // the in-memory copy
  let votesCol = null, docsCol = null, audioCol = null, client = null, chain = Promise.resolve();
  let audioMeta = [];                                    // list of audio clips (without the sound itself)

  // files: only used in test mode, and to copy old data in the very first time MongoDB is empty
  const file = (n) => path.join(dataDir, n + '.json');
  const readFile = (n, fallback) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return fallback; } };
  const writeFile = (n, v) => { fs.writeFileSync(file(n) + '.tmp', JSON.stringify(v)); fs.renameSync(file(n) + '.tmp', file(n)); };
  // a vote as stored in MongoDB: the device token is the document id, so one device can only ever have one ballot
  const toDoc = (v) => ({ _id: v.token, name: v.name, display: v.display, picks: v.picks, at: v.at });
  const fromDoc = ({ _id, ...v }) => ({ ...v, token: _id });

  if (uri) {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
    try { await client.connect(); }                      // fails if the address, password or network access is wrong
    catch (e) { throw new Error('Could not connect to MongoDB: ' + e.message); }
    const db = client.db(process.env.MONGODB_DB || 'boyschoice');
    votesCol = db.collection('votes'); docsCol = db.collection('docs'); audioCol = db.collection('audio');
    audioMeta = (await audioCol.find({}, { projection: { data: 0 } }).toArray()).map(({ _id, ...m }) => ({ id: _id, ...m }));
    await votesCol.createIndex({ name: 1 }, { unique: true });          // one ballot per name, enforced by the database
    cache.votes = (await votesCol.find({}).toArray()).map(fromDoc).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const d of await docsCol.find({}).toArray()) cache.docs[d._id] = d.value;
    // First run only: if MongoDB is empty and old files exist (for example when testing locally), copy them in
    const old = readFile('votes', []);
    if (!cache.votes.length && old.length) { await votesCol.insertMany(old.map(toDoc), { ordered: false }); cache.votes = old; console.log(`Copied ${old.length} old votes into MongoDB.`); }
    for (const n of ['settings', 'feedback', 'quiz', 'show']) {
      if (n in cache.docs) continue;
      const f = readFile(n, undefined);
      if (f !== undefined) { cache.docs[n] = f; await docsCol.replaceOne({ _id: n }, { _id: n, value: f }, { upsert: true }); }
    }
    console.log(`MongoDB connected: ${cache.votes.length} votes loaded.`);
  } else {
    cache.votes = readFile('votes', []); audioMeta = readFile('audio-index', []);
    console.warn('WARNING: MONGODB_URI is not set. Data is saved in files, which Render wipes on every update.');
  }

  const votes = {
    all: () => cache.votes,
    // Saves first, remembers second. A duplicate name or device makes MongoDB throw error code 11000.
    async add(v) {
      if (votesCol) await votesCol.insertOne(toDoc(v)); else writeFile('votes', [...cache.votes, v]);
      cache.votes.push(v);
    },
    async remove(name) {                                  // delete one person's ballot (the admin "retake" button)
      if (votesCol) { const r = await votesCol.deleteOne({ name }); if (!r.deletedCount) return false; }
      const rest = cache.votes.filter((v) => v.name !== name);
      if (rest.length === cache.votes.length) return false;
      if (!votesCol) writeFile('votes', rest);
      cache.votes = rest; return true;
    },
    async clear() {                                       // delete every ballot (the admin "clear all votes" button)
      if (votesCol) await votesCol.deleteMany({}); else writeFile('votes', []);
      cache.votes = [];
    },
  };

  // ---- audio clips: the nominees' recorded speeches ----
  // Each clip is ONE document with the sound inside (clips are small, under 3 MB). Listing never loads the sound itself.
  const audioDir = path.join(dataDir, 'audio'), audioCache = new Map();
  const audio = {
    list: () => audioMeta,
    async add(buf, meta) {
      const id = crypto.randomBytes(8).toString('hex'), rec = { ...meta, size: buf.length, at: new Date().toISOString() };
      if (audioCol) await audioCol.insertOne({ _id: id, ...rec, data: buf });
      else { fs.mkdirSync(audioDir, { recursive: true }); fs.writeFileSync(path.join(audioDir, id + '.bin'), buf); }
      audioMeta.push({ id, ...rec }); if (!audioCol) writeFile('audio-index', audioMeta);
      return id;
    },
    async get(id) {                                       // returns { buf, meta } or null. Recent clips are kept in memory.
      const meta = audioMeta.find((m) => m.id === id); if (!meta) return null;
      if (audioCache.has(id)) return { buf: audioCache.get(id), meta };
      let buf;
      if (audioCol) { const d = await audioCol.findOne({ _id: id }); if (!d) return null; const b = d.data.buffer; buf = Buffer.from(b.subarray(0, d.data.position ?? b.length)); }
      else buf = fs.readFileSync(path.join(audioDir, id + '.bin'));
      if (audioCache.size > 30) audioCache.delete(audioCache.keys().next().value);
      audioCache.set(id, buf); return { buf, meta };
    },
    async remove(id) {
      if (!audioMeta.some((m) => m.id === id)) return false;
      if (audioCol) await audioCol.deleteOne({ _id: id }); else { try { fs.unlinkSync(path.join(audioDir, id + '.bin')); } catch {} }
      audioMeta = audioMeta.filter((m) => m.id !== id); audioCache.delete(id); if (!audioCol) writeFile('audio-index', audioMeta);
      return true;
    },
  };

  // A "doc" is one small named JSON value: settings, feedback, quiz questions, live-show data.
  function doc(name, fallback) {
    if (!(name in cache.docs)) cache.docs[name] = readFile(name, fallback);
    return {
      get: () => cache.docs[name],
      set(value) {
        cache.docs[name] = value;
        const copy = JSON.parse(JSON.stringify(value));    // a snapshot, so later changes cannot sneak into an older save
        if (docsCol) chain = chain.then(() => docsCol.replaceOne({ _id: name }, { _id: name, value: copy }, { upsert: true })).catch((e) => console.error(`MongoDB save failed for "${name}":`, e.message));
        else writeFile(name, copy);
        return chain;                                       // callers can await this to be SURE it is saved before they answer
      },
    };
  }

  return { mode: uri ? 'mongodb' : 'files', votes, doc, audio, async close() { await chain; if (client) await client.close(); } };
};

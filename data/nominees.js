// Single source of truth for categories and nominees.
// n(id, display name, caption from the slide). Photos live in public/img/<id>.jpg
// 4th argument true = video sticker: plays /img/<id>.mp4 on the ballot, with /img/<id>.jpg as its still picture.
const n = (id, name, tag, video) => ({ id, name, tag, photo: `/img/${id}.jpg`, ...(video && { video: `/img/${id}.mp4` }) });

// A person can appear in several categories: the same id is reused.
// CHANGED: every category now has an `info` string (the award description).
// It reaches the browser through /api/ballot automatically, so server.js needs no change.
const categories = [
  { id: 'leadership', name: 'The Leadership Award',
    info: "Who leads from the front? The one who organises, takes decisions and keeps the group moving.", nominees: [
    n('oteme', 'Oteme Fejiro', 'Dr Headboy'), n('iguma', 'Iguma Emmanuel', "Jeff's Apparel"),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('obor', 'Obor Israel', 'Giver') ] },
  { id: 'comedy', name: 'Comedy Excellence Award',
    info: "Who made the group laugh the most this year? Jokes, pranks and voice notes all count.", nominees: [
    n('eboh', 'Eboh Something', 'Ololoooo'), n('ogor', 'Ogor', 'Edo Batman'),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('ekpekpe', 'Ekpekpe Evans', 'Group Clown') ] },
  // Digital Presence: add nominees here when known. Categories with no nominees are hidden automatically.
  { id: 'digital', name: 'Digital Presence',
    info: "Who is the most active and noticed online? Posts, status, chats and content all count.", nominees: [
    n('oteme', 'Oteme Fejiro', 'Dr Headboy'), n('iguma', 'Iguma Emmanuel', "Jeff's Apparel"),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('ekpekpe', 'Ekpekpe Evans', 'Group Clown') ] },
  { id: 'intellectual', name: 'Intellectual Excellence Award',
    info: "The sharpest mind in the group. The one everyone asks when they need an answer.", nominees: [
    n('oteme', 'Oteme Fejiro', 'Medical Fact Series') ] },
  { id: 'redflag', name: 'Certified Red Flags',
    info: "The one whose behaviour makes people say 'run'. All in good fun.", nominees: [
    n('elvis', 'Elvis-Zini Tega', 'Ololoooo'), n('ebube', 'Ebube Grandeur', 'Ololololo Pro Max'),
    n('eboh', 'Eboh Something', 'Ololoooo'), n('adubah', 'Adubah Destiny', 'He would take a bullet for Queen') ] },
  { id: 'bachelor', name: "Eligible Bachelor's Award",
    info: "The boy most likely to be picked as a catch.", nominees: [
    n('umuero', 'Umuero', 'Dark Shadow'), n('evans', 'Evans', 'Find babe for me'),
    n('emmy', 'Emmy', 'Emma No Well'), n('tejiri', 'Gay Tejiri', 'Find babe for me') ] },
  { id: 'support', name: 'Outstanding Support',
    info: "Who shows up for the others? The one who helps, encourages and never leaves you hanging.", nominees: [
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('obor', 'Obor Israel', 'Giver'),
    n('ugboka', 'Ugboka Bill', 'Wetin we dey think tho'), n('ofa', 'Ofa Marvel', 'O.M.O') ] },
  { id: 'financial', name: 'Financially Challenged',
    info: "The one whose pocket is permanently on break. Vote with love.", nominees: [
    n('evanss', 'Evanss', 'Monkey dey work, monkey still poor'), n('otems', 'Otems', 'Headboy wey nor get money'),
    n('emmy', 'Emmy', 'Emma No Well'), n('hottest', 'Hottest', 'Opay') ] },
  { id: 'ghost', name: 'Group Chat Ghost',
    info: "Reads everything, replies to nothing. Who disappears from the group chat the most?", nominees: [
    n('hyacinth', 'Hyacinth', ''), n('courage', 'Courage', ''), n('joshua', 'Joshua', ''),
    n('mene', 'Mene', ''), n('pako', 'Pako', '') ] },
  { id: 'sticker', name: 'Sticker of the Year',
    info: "The best WhatsApp sticker of 2026. Vote for the picture that says it all.", nominees: [
    n('sticker1', 'Sticker 1', ''), n('sticker2', 'Sticker 2', ''), n('sticker3', 'Sticker 3', ''),
    n('sticker4', 'Sticker 4', ''), n('sticker5', 'Sticker 5', ''), n('sticker6', 'Sticker 6', ''),
    n('sticker7', 'Sticker 7', ''), n('sticker8', 'Sticker 8', ''), n('sticker9', 'Sticker 9', ''),
    n('sticker10', 'Sticker 10', '') ] },
  { id: 'videosticker', name: 'Video Sticker of the Year',
    info: "The best moving sticker of 2026. Vote for the one that makes you laugh every time.", nominees: [
    n('vsticker1', 'Video Sticker 1', '', true), n('vsticker2', 'Video Sticker 2', '', true),
    n('vsticker3', 'Video Sticker 3', '', true), n('vsticker4', 'Video Sticker 4', '', true),
    n('vsticker5', 'Video Sticker 5', '', true) ] },
];
// Hide categories that have no nominees yet so voters never see an empty screen
module.exports = { categories: categories.filter((c) => c.nominees.length) };

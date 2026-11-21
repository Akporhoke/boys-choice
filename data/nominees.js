// Single source of truth for categories and nominees.
// n(id, display name, caption from the slide). Photos live in public/img/<id>.jpg
// 4th argument true = video sticker: plays /img/<id>.mp4 on the ballot, with /img/<id>.jpg as its still picture.
const n = (id, name, tag, video) => ({ id, name, tag, photo: `/img/${id}.jpg`, ...(video && { video: `/img/${id}.mp4` }) });

// A person can appear in several categories: the same id is reused.
const categories = [
  { id: 'leadership', name: 'The Leadership Award', nominees: [
    n('oteme', 'Oteme Fejiro', 'Dr Headboy'), n('iguma', 'Iguma Emmanuel', "Jeff's Apparel"),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('obor', 'Obor Israel', 'Giver') ] },
  { id: 'comedy', name: 'Comedy Excellence Award', nominees: [
    n('eboh', 'Eboh Something', 'Ololoooo'), n('ogor', 'Ogor', 'Edo Batman'),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('ekpekpe', 'Ekpekpe Evans', 'Group Clown') ] },
  // Digital Presence: add nominees here when known. Categories with no nominees are hidden automatically.
  { id: 'digital', name: 'Digital Presence', nominees: [
    n('oteme', 'Oteme Fejiro', 'Dr Headboy'), n('iguma', 'Iguma Emmanuel', "Jeff's Apparel"),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('ekpekpe', 'Ekpekpe Evans', 'Group Clown') ] },
  { id: 'intellectual', name: 'Intellectual Excellence Award', nominees: [
    n('oteme', 'Oteme Fejiro', 'Medical Fact Series') ] },
  { id: 'redflag', name: 'Certified Red Flags', nominees: [
    n('elvis', 'Elvis-Zini Tega', 'Ololoooo'), n('ebube', 'Ebube Grandeur', 'Ololololo Pro Max'),
    n('eboh', 'Eboh Something', 'Ololoooo'), n('adubah', 'Adubah Destiny', 'He would take a bullet for Queen') ] },
  { id: 'bachelor', name: "Eligible Bachelor's Award", nominees: [
    n('umuero', 'Umuero', 'Dark Shadow'), n('evans', 'Evans', 'Find babe for me'),
    n('emmy', 'Emmy', 'Emma No Well'), n('tejiri', 'Gay Tejiri', 'Find babe for me') ] },
  { id: 'support', name: 'Outstanding Support', nominees: [
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('obor', 'Obor Israel', 'Giver'),
    n('ugboka', 'Ugboka Bill', 'Wetin we dey think tho'), n('ofa', 'Ofa Marvel', 'O.M.O') ] },
  { id: 'financial', name: 'Financially Challenged', nominees: [
    n('evanss', 'Evanss', 'Monkey dey work, monkey still poor'), n('otems', 'Otems', 'Headboy wey nor get money'),
    n('emmy', 'Emmy', 'Emma No Well'), n('hottest', 'Hottest', 'Opay') ] },
  { id: 'ghost', name: 'Group Chat Ghost', nominees: [
    n('hyacinth', 'Hyacinth', ''), n('courage', 'Courage', ''), n('joshua', 'Joshua', ''),
    n('mene', 'Mene', ''), n('pako', 'Pako', '') ] },
  { id: 'sticker', name: 'Sticker of the Year', nominees: [
    n('sticker1', 'Sticker 1', ''), n('sticker2', 'Sticker 2', ''), n('sticker3', 'Sticker 3', ''),
    n('sticker4', 'Sticker 4', ''), n('sticker5', 'Sticker 5', ''), n('sticker6', 'Sticker 6', ''),
    n('sticker7', 'Sticker 7', ''), n('sticker8', 'Sticker 8', ''), n('sticker9', 'Sticker 9', ''),
    n('sticker10', 'Sticker 10', '') ] },
  { id: 'videosticker', name: 'Video Sticker of the Year', nominees: [
    n('vsticker1', 'Video Sticker 1', '', true), n('vsticker2', 'Video Sticker 2', '', true),
    n('vsticker3', 'Video Sticker 3', '', true), n('vsticker4', 'Video Sticker 4', '', true),
    n('vsticker5', 'Video Sticker 5', '', true) ] },
];
// Hide categories that have no nominees yet so voters never see an empty screen
module.exports = { categories: categories.filter((c) => c.nominees.length) };

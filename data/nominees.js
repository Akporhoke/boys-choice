// Single source of truth for categories and nominees.
// n(id, display name, caption from the slide). Photos live in public/img/<id>.jpg
const n = (id, name, tag) => ({ id, name, tag, photo: `/img/${id}.jpg` });

// A person can appear in several categories: the same id is reused.
const categories = [
  { id: 'leadership', name: 'The Leadership Award', nominees: [
    n('oteme', 'Oteme Fejiro', 'Dr Headboy'), n('iguma', 'Iguma Emmanuel', "Jeff's Apparel"),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('obor', 'Obor Israel', 'Giver') ] },
  { id: 'comedy', name: 'Comedy Excellence Award', nominees: [
    n('eboh', 'Eboh Something', 'Ololoooo'), n('ogor', 'Ogor', 'Edo Batman'),
    n('agba', 'Agba-Baller', 'Hottest, Hotspot, Girls Dem Daddy'), n('ekpekpe', 'Ekpekpe Evans', 'Group Clown') ] },
  // Digital Presence: add nominees here when known. Categories with no nominees are hidden automatically.
  { id: 'digital', name: 'Digital Presence', nominees: [] },
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
];
// Hide categories that have no nominees yet so voters never see an empty screen
module.exports = { categories: categories.filter((c) => c.nominees.length) };

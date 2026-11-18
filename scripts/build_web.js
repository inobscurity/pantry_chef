#!/usr/bin/env node
/*
 * Builds data/web/ (read by js/web.js) from recipes in the Common Crawl web archive, as
 * extracted by Web Data Commons (schema.org "Recipe" subset, October 2024 crawl) and reduced to
 * English recipes by wdc_parse.py: one JSON file per part, each a list of
 * { u: address, h: host, n: name, i: [ingredient lines], c: [categories] }.
 *
 *   node scripts/build_web.js <folder with part_*.json> [--max N]
 *
 * Two kinds of file:
 *   s/<word>.json  for searching: each recipe's name, address, course and what its ingredients
 *                  are (matched the same way the app matches them), one file per ingredient word,
 *                  so the app downloads only the files for your ingredients;
 *   d/<n>.json     for reading, fetched when a recipe is opened: the ingredient lines with amounts
 *                  (a list of ingredients is facts, not writing), time, serves and author, and the
 *                  method only for sites whose recipes are free to reuse (OPEN_SITES). Every other
 *                  recipe links to its site, and to the Internet Archive's copy, for the method.
 */

// Sites whose recipes may be copied, with credit. US federal government work is public domain;
// USDA asks for MyPlate Kitchen recipes to be credited.
const OPEN_SITES = {
  'www.myplate.gov': 'Public domain: MyPlate Kitchen, U.S. Department of Agriculture',
  'myplate.gov': 'Public domain: MyPlate Kitchen, U.S. Department of Agriculture',
  'www.nutrition.gov': 'Public domain: Nutrition.gov, U.S. Department of Agriculture',
  'nutrition.gov': 'Public domain: Nutrition.gov, U.S. Department of Agriculture',
};
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../js/core.js');
const Wiki = require('../js/wikibooks.js');

const OUT = path.join(__dirname, '..', 'data', 'web');
const MIN_SHARD = 15;      // ingredient words in fewer recipes than this get no file
// Only these words get a file: the things people pick as a main ingredient. Seasonings and
// everyday basics (garlic, onion, butter, flour) don't, nor describing words ("black",
// "powder"); filing every recipe under every word made the data far too big. A search for
// something without a file still finds recipes through your other ingredients.
const MAIN_WORDS = new Set(`
  chicken beef pork lamb mutton veal goat turkey duck goose venison kangaroo rabbit quail
  bacon ham prosciutto pancetta chorizo salami sausage mince steak brisket rib chop cutlet
  fillet thigh drumstick wing breast liver kidney oxtail meatball
  fish salmon tuna cod barramundi snapper trout mackerel sardine anchovy haddock hake whiting
  flathead tilapia swordfish basa bream perch kingfish prawn crab lobster scallop mussel
  clam oyster squid calamari octopus seafood
  egg tofu tempeh paneer feta haloumi halloumi ricotta mozzarella parmesan cheddar brie
  camembert gruyere mascarpone bocconcini burrata gorgonzola pecorino
  potato kumara pumpkin squash zucchini eggplant capsicum carrot broccoli broccolini
  cauliflower cabbage spinach kale lettuce cucumber celery leek mushroom pea bean corn
  asparagus beetroot artichoke fennel radish turnip parsnip okra chard choy sprout
  tomato avocado rocket watercress chilli jalapeno shallot
  rice pasta spaghetti penne fettuccine linguine macaroni lasagne gnocchi noodle couscous
  quinoa barley polenta lentil chickpea bread tortilla wrap oat
  apple banana pear peach plum mango pineapple strawberry blueberry raspberry cherry
  orange apricot fig date grape rhubarb nectarine passionfruit pomegranate melon
  watermelon almond walnut pecan cashew peanut hazelnut pistachio chocolate
`.trim().split(/\s+/));
// Courses kept: what the app shows by default (mains, soups), and sides and starters.
const KEEP_COURSES = new Set(['main', 'soup', 'side', 'starter']);
// Copies of other sites, and hosts that aren't recipe sites.
// Sites that have closed since the crawl (tablespoon.com now redirects to General Mills' brands page).
const BAD_HOST = /tablespoon\.com$|pinterest\.|kxcdn|cloudfront|azureedge|b-cdn|akamai|xtgem|blogspot\.(?!com$)|translate\.goog|webcache|^\d+\.\d+\.\d+\.\d+$|^localhost/;

function decode(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'").replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8212;|&mdash;/g, '—').replace(/&frac12;/g, '½').replace(/&frac14;/g, '¼').replace(/&frac34;/g, '¾')
    .replace(/&deg;/g, '°').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  return s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

// "Veg Spring Rolls Recipe | How to Make The Best Spring Rolls" → "Veg Spring Rolls Recipe"
function cleanName(raw) {
  let n = decode(raw).split(/\s+[|•»]\s+|\s+[–—]\s+/)[0].trim();
  n = n.replace(/^recipe:\s*/i, '').replace(/\s*\(\s*\)\s*$/, '').trim();
  if (n.length > 6 && n === n.toUpperCase()) n = titleCase(n);
  return n;
}

// What an ingredient line is, for matching: "2 garlic cloves, unpeeled" → "garlic cloves".
// Measuring words a line's quantity can leave in front of the name: "1 medium size winter melon".
const LEFTOVER = new Set(['size', 'sized', 'info', 'oz', 'ounce', 'lb', 'pound', 'g', 'gram', 'kg', 'ml', 'cup',
  'tbsp', 'tsp', 'tablespoon', 'teaspoon', 'can', 'tin', 'packet', 'pkg', 'package', 'bunch', 'handful', 'inch', 'cm',
  'x', 'small', 'medium', 'big', 'extra', 'approx', 'approximately', 'heaping', 'scant', 'generous', 'cupful']);

// Where a preparation note starts when there's no comma: "green beans ends removed".
const PREP_TAIL = new Set(['removed', 'washed', 'thoroughly', 'scrambled', 'end', 'trimmed', 'divided', 'separated',
  'squeezed', 'drained', 'rinsed', 'soaked', 'thawed', 'defrosted', 'cubed', 'julienned', 'halved', 'quartered',
  'deveined', 'shelled', 'pitted', 'cored', 'deseeded', 'seeded', 'zested', 'juiced', 'cleaned', 'patted',
  'at', 'cut', 'sliced', 'diced', 'minced', 'grated', 'chopped', 'shredded', 'crushed', 'mashed', 'beaten',
  'softened', 'melted', 'warmed', 'toasted', 'blanched', 'steamed', 'boiled', 'cooled', 'chilled', 'leftover',
  'homemade', 'store', 'bought', 'such', 'like', 'eg', 'plus', 'more', 'extra', 'reserved', 'about']);

// "Salt and pepper to season", "pinch salt pepper": only seasoning words.
const SEASONING_WORDS = new Set(['salt', 'pepper', 'sea', 'black', 'white', 'kosher', 'season', 'seasoning', 'seasoned',
  'each', 'pinch', 'with', 'oil', 'water', 'and', 'or', 'to', 'for', 'dash', 'freshly', 'cracked', 'ground']);

function ingredientKey(line) {
  const text = decode(line).replace(/[®™©]/g, '')
    .replace(/\b(?:home-?made|store-?bought|shop-?bought|bought)(?:\s*(?:or|\/)\s*(?:home-?made|store-?bought|shop-?bought|bought))?\s+/gi, '');
  if (!text || text.length > 200 || /:$/.test(text) || /^for the\b/i.test(text)) return null;
  const parsed = Wiki._internal.parseIngredient(text);
  if (!parsed) return null;
  let key = Core.shortName(Core.nameOf(parsed)).toLowerCase()
    .replace(/^(?:of|a|an|the)\s+/, '')
    .replace(/\s+/g, ' ').trim();
  // In the app's own simplified form: "boneless, skinless chicken thighs" → "chicken thigh".
  // Alternatives stay alternatives: "lemon or lime juice".
  // "Salt and pepper" stays two things, so your basics cover it.
  const simplify = (alt) => alt.split(/\s+(?:and|&)\s+/)
    .map((part) => {
      let t = Core.tokens(part).filter((w, i, all) => !(LEFTOVER.has(w) && i < all.length - 1));
      const cut = t.findIndex((w, i) => i > 0 && PREP_TAIL.has(w));   // "leek washed thoroughly"
      if (cut > 0) t = t.slice(0, cut);
      return t.slice(-4).join(' ');
    })
    .filter(Boolean).join(' and ');
  key = [...new Set(Core.alternatives(key).map(simplify).filter(Boolean))].slice(0, 2).join(' or ');
  if (!/[a-z]{2}/.test(key)) return null;
  return { key, optional: Core.isOptional({ name: text, measure: parsed.measure }) };
}

const COURSE_CODES = { main: 'm', side: 's', soup: 'p', starter: 't', sauce: 'x', dessert: 'd', other: 'o' };

// The method as steps: "Step 1" labels and headings ("Make the Gravy:") dropped, a wall of text
// split up the way the app splits other recipes' methods.
function methodSteps(raw) {
  const text = (raw || []).filter((x) => typeof x === 'string' && !x.startsWith('§'))
    .map((x) => x.split('\n').map(decode).join('\n')).join('\n');
  return Core.splitSteps(text)
    .filter((step) => !(step.length < 60 && /:$/.test(step)) && !/^step\s*\d+[.:]?$/i.test(step))
    .map((step) => (step.length > 1500 ? step.slice(0, 1500).replace(/\s+\S*$/, '') + '…' : step))
    .slice(0, 30);
}

// The same as js/web.js: which details file a recipe's address is in.
const DETAIL_FILES = 1024;
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

function region(host) {
  if (OPEN_SITES[host]) return -1;
  if (/\.(?:au|nz)$/.test(host)) return 0;
  if (/\.(?:uk|ie)$/.test(host)) return 1;
  return 2;
}

function main(argv) {
  const dir = argv[0];
  const maxAt = argv.indexOf('--max');
  const MAX = maxAt >= 0 ? Number(argv[maxAt + 1]) : Infinity;
  const files = fs.readdirSync(dir).filter((f) => /^part_\d+\.json$/.test(f)).sort();

  // 1. Read, tidy and drop duplicates.
  const byUrl = new Map();
  const byName = new Set();
  let read = 0;
  for (const f of files) {
    for (const r of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      read++;
      const host = String(r.h || '').toLowerCase();
      if (!host || BAD_HOST.test(host)) continue;
      let url;
      try { url = new URL(r.u); } catch (_) { continue; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      const address = url.hostname + url.pathname;
      if (byUrl.has(address)) continue;
      const name = cleanName(r.n);
      if (name.length < 3 || name.length > 120 || /[^\u0000-\u024f\u2000-\u206f\u2100-\u214f]/.test(name)) continue;
      // English only: Dutch or Norwegian recipes can pass the ingredient check ("olive oil", "salt").
      const method = methodSteps(r.s);
      if (method.length && (method.join(' ').match(/\b(?:the|and|with|until|into|minutes|add|heat|stir|of)\b/gi) || []).length < 3) continue;
      const nameKey = host.replace(/^www\./, '') + '|' + Core.normalize(name);
      if (byName.has(nameKey)) continue;
      const seen = new Map();
      const ingredients = [];
      const lines = [];   // [name, amount, which of `ingredients` it is (-1: a basic, not searched)]
      for (const line of r.i || []) {
        const text = decode(line);
        const parsed = text && text.length <= 200 && Wiki._internal.parseIngredient(text.replace(/[®™©]/g, ''));
        if (!parsed) continue;
        const k = ingredientKey(line);
        let at = -1;
        // Salt, pepper, oil and water are everyone's basics: leaving them out saves a lot of room.
        if (k && !(Core.coveredByBasics(Core.DEFAULT_BASICS, k.key) || k.key.split(/\s+/).every((w) => SEASONING_WORDS.has(w)))) {
          if (!seen.has(k.key)) { seen.set(k.key, ingredients.length); ingredients.push(k); }
          at = seen.get(k.key);
        }
        lines.push([parsed.name.slice(0, 120), parsed.measure.slice(0, 40), at]);
      }
      if (ingredients.length < 2 || ingredients.length > 40) continue;
      const courseHint = Core.courseFromLabel((r.c || []).map(decode).join(', '));
      const course = Core.courseOf({ name, courseHint, ingredients: ingredients.map((i) => ({ name: i.key, optional: i.optional })) });
      if (!KEEP_COURSES.has(course)) continue;
      byName.add(nameKey);
      byUrl.set(address, {
        host: url.hostname, path: url.pathname + (url.search.length < 40 ? url.search : ''), name, ingredients,
        course: COURSE_CODES[course] || '',
        details: OPEN_SITES[url.hostname]
          ? [lines.slice(0, 50), method, decode(r.t).slice(0, 30), decode(r.y).slice(0, 40), decode(r.a).slice(0, 80), OPEN_SITES[url.hostname]]
          : [lines.slice(0, 50), [], decode(r.t).slice(0, 30), decode(r.y).slice(0, 40), decode(r.a).slice(0, 80)],
      });
    }
  }
  let recipes = [...byUrl.values()];
  console.log(`${read} read, ${recipes.length} kept after tidying and duplicates`);

  // 2. A site with one or two recipes is usually a stray page, not a recipe site.
  const perHost = new Map();
  for (const r of recipes) perHost.set(r.host, (perHost.get(r.host) || 0) + 1);
  recipes = recipes.filter((r) => perHost.get(r.host) >= 3);
  // Australian and New Zealand sites first, then British and Irish, then the rest, bigger sites first.
  recipes.sort((a, b) => region(a.host) - region(b.host) || perHost.get(b.host) - perHost.get(a.host)
    || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  if (recipes.length > MAX) recipes = recipes.slice(0, MAX);
  console.log(`${recipes.length} recipes from ${new Set(recipes.map((r) => r.host)).size} sites`);

  // 3. Which ingredient words get a file.
  const tokensOf = (r) => [...new Set(r.ingredients.filter((i) => !i.optional).flatMap((i) => Core.tokens(i.key)))];
  const counts = new Map();
  for (const r of recipes) { r.tokens = tokensOf(r); for (const t of r.tokens) counts.set(t, (counts.get(t) || 0) + 1); }
  const shards = {};
  for (const [t, n] of counts) if (n >= MIN_SHARD && MAIN_WORDS.has(t)) shards[t] = n;

  // 4. Write.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 's'), { recursive: true });
  // Each site's addresses share a beginning ("/recipes/recipe/en-AU/r"), kept once in the index.
  const sitePaths = new Map();
  for (const r of recipes) { if (!sitePaths.has(r.host)) sitePaths.set(r.host, []); sitePaths.get(r.host).push(r.path); }
  const sites = [...sitePaths.keys()].sort();
  const prefixes = sites.map((host) => {
    const paths = sitePaths.get(host);
    let p = paths[0];
    for (const q of paths) { let i = 0; while (i < p.length && p[i] === q[i]) i++; p = p.slice(0, i); }
    return paths.length > 1 ? p : '';
  });
  const prefixOf = new Map(sites.map((s, i) => [s, prefixes[i]]));
  for (const r of recipes) r.path = r.path.slice(prefixOf.get(r.host).length);
  const siteIndex = new Map(sites.map((s, i) => [s, i]));
  const rowsByShard = new Map(Object.keys(shards).map((t) => [t, []]));
  for (const r of recipes) for (const t of r.tokens) if (rowsByShard.has(t)) rowsByShard.get(t).push(r);
  let bytes = 0;
  for (const [t, rows] of rowsByShard) {
    const words = [];
    const wordIndex = new Map();
    const id = (w) => { if (!wordIndex.has(w)) { wordIndex.set(w, words.length); words.push(w); } return wordIndex.get(w); };
    const r = rows.map((x) => {
      const keys = x.ingredients.map((i) => (i.optional ? -id(i.key) - 1 : id(i.key)));
      const row = [x.name, siteIndex.get(x.host), x.path, keys];
      if (x.course) row.push(x.course);
      return row;
    });
    const text = JSON.stringify({ w: words, r });
    bytes += text.length;
    fs.writeFileSync(path.join(OUT, 's', t + '.json'), text);
  }
  // The details, by address.
  fs.mkdirSync(path.join(OUT, 'd'), { recursive: true });
  const detailFiles = new Map();
  for (const r of recipes) {
    const h = hash('https://' + r.host + prefixOf.get(r.host) + r.path);
    const n = h % DETAIL_FILES;
    if (!detailFiles.has(n)) detailFiles.set(n, {});
    detailFiles.get(n)[h.toString(36)] = r.details;
  }
  let detailBytes = 0;
  for (const [n, entries] of detailFiles) {
    const text = JSON.stringify(entries);
    detailBytes += text.length;
    fs.writeFileSync(path.join(OUT, 'd', n + '.json'), text);
  }
  console.log(`details: ${detailFiles.size} files, ${(detailBytes / 1e6).toFixed(1)} MB, ${recipes.filter((r) => r.details[1].length).length} recipes with a method (free to reuse)`);
  const built = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built, count: recipes.length, detailFiles: DETAIL_FILES, sites: sites.map((s, i) => (prefixes[i] ? [s, prefixes[i]] : s)), shards }));
  const big = Object.entries(shards).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t} ${n}`).join(', ');
  const rows = Object.values(shards).reduce((a, b) => a + b, 0);
  console.log(`${Object.keys(shards).length} files, ${(bytes / 1e6).toFixed(1)} MB, ${(rows / recipes.length).toFixed(1)} files per recipe. Biggest: ${big}`);
}

main(process.argv.slice(2));

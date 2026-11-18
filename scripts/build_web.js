#!/usr/bin/env node
/*
 * Builds data/web/ (read by js/web.js) from recipes in the Common Crawl web archive, as
 * extracted by Web Data Commons (schema.org "Recipe" subset, October 2024 crawl) and reduced to
 * English recipes by wdc_parse.py: one JSON file per part, each a list of
 * { u: address, h: host, n: name, i: [ingredient lines], c: [categories] }.
 *
 *   node scripts/build_web.js <folder with part_*.json> [--max N]
 *
 * Keeps each recipe's name, address, course and what its ingredients are (matched the same way
 * the app matches them), never the method. Recipes are written into one file per ingredient
 * word, so the app downloads only the files for your ingredients.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../js/core.js');
const Wiki = require('../js/wikibooks.js');

const OUT = path.join(__dirname, '..', 'data', 'web');
const MIN_SHARD = 15;      // ingredient words in fewer recipes than this get no file
// Words never given a file: everyone has them, so they never pick out a recipe.
const NO_SHARD = new Set(['salt', 'pepper', 'water', 'oil']);
// Copies of other sites, and hosts that aren't recipe sites.
const BAD_HOST = /kxcdn|cloudfront|azureedge|b-cdn|akamai|xtgem|blogspot\.(?!com$)|translate\.goog|webcache|^\d+\.\d+\.\d+\.\d+$|^localhost/;

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
function ingredientKey(line) {
  const text = decode(line).replace(/[®™©]/g, '');
  if (!text || text.length > 200 || /:$/.test(text) || /^for the\b/i.test(text)) return null;
  const parsed = Wiki._internal.parseIngredient(text);
  if (!parsed) return null;
  let key = Core.shortName(Core.nameOf(parsed)).toLowerCase()
    .replace(/^(?:of|a|an|the)\s+/, '')
    .replace(/\s+/g, ' ').trim();
  if (!/[a-z]{2}/.test(key)) return null;
  if (key.length > 60) key = key.slice(0, 60).replace(/\s+\S*$/, '');
  return { key, optional: Core.isOptional({ name: text, measure: parsed.measure }) };
}

const COURSE_CODES = { main: 'm', side: 's', soup: 'p', starter: 't', sauce: 'x', dessert: 'd', other: 'o' };

function region(host) {
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
      if (name.length < 3 || name.length > 120) continue;
      const nameKey = host.replace(/^www\./, '') + '|' + Core.normalize(name);
      if (byName.has(nameKey)) continue;
      const seen = new Set();
      const ingredients = [];
      for (const line of r.i || []) {
        const k = ingredientKey(line);
        if (!k || seen.has(k.key)) continue;
        seen.add(k.key);
        ingredients.push(k);
      }
      if (ingredients.length < 3 || ingredients.length > 40) continue;
      const course = Core.courseFromLabel((r.c || []).map(decode).join(', '));
      byName.add(nameKey);
      byUrl.set(address, { host: url.hostname, path: url.pathname + (url.search.length < 40 ? url.search : ''), name, ingredients, course: COURSE_CODES[course] || '' });
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
  for (const [t, n] of counts) if (n >= MIN_SHARD && !NO_SHARD.has(t) && /^[a-z]{2,30}$/.test(t)) shards[t] = n;

  // 4. Write.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 's'), { recursive: true });
  const sites = [...new Set(recipes.map((r) => r.host))].sort();
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
  const built = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ built, count: recipes.length, sites, shards }));
  const big = Object.entries(shards).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t, n]) => `${t} ${n}`).join(', ');
  console.log(`${Object.keys(shards).length} files, ${(bytes / 1e6).toFixed(1)} MB. Biggest: ${big}`);
}

main(process.argv.slice(2));

/*
 * Recipes from food websites, from the Common Crawl web archive (via Web Data Commons, who
 * pulled out the recipe details that sites publish for search engines). Built into data/web/
 * by scripts/build_web.js.
 *
 * Only each recipe's name, what its ingredients are and its address are kept: the method stays
 * on the website, and opening a recipe links there (in the Android app, its browser can save the
 * full recipe to My recipes).
 *
 * The recipes are split into files by ingredient word (data/web/s/pork.json holds every recipe
 * with pork), so a search only downloads the files for your ingredients.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const BASE = 'data/web/';
  const MAX_MISSING = 5;        // shortlist recipes needing up to this many things (the app shows up to 3)
  const MAX_CANDIDATES = 4000;  // safety limit on the shortlist

  let indexLoading = null;
  const shardLoading = new Map();

  function getJSON(path, fetchImpl) {
    return (fetchImpl || root.fetch.bind(root))(path).then((res) => {
      if (!res.ok) throw new Error(`Website recipe data answered ${res.status}`);
      return res.json();
    });
  }

  function loadIndex(fetchImpl) {
    if (!indexLoading) {
      indexLoading = getJSON(BASE + 'index.json' + version(), fetchImpl)
        .catch((e) => { indexLoading = null; throw e; });
    }
    return indexLoading;
  }

  let built = '';
  function version() { return built ? '?b=' + built : ''; }

  function loadShard(token, fetchImpl) {
    if (!shardLoading.has(token)) {
      shardLoading.set(token, getJSON(`${BASE}s/${token}.json${version()}`, fetchImpl)
        .catch((e) => { shardLoading.delete(token); throw e; }));
    }
    return shardLoading.get(token);
  }

  // The ingredient words whose files may hold recipes matching `name`. An ingredient matches
  // when one name's words are all in the other's, so the two always share a word.
  function tokensFor(name, shards) {
    const names = [name, ...Core.alsoCovers(name)];
    return [...new Set(names.flatMap((n) => Core.tokens(n)))].filter((t) => shards[t]);
  }

  /*
   * Which files to download. With a main ingredient (★), only its files: every recipe shown
   * uses it. Otherwise one set per main ingredient; since a recipe must use at least two of
   * your listed ingredients, the biggest set can be left out without losing any.
   */
  function shardsToLoad(mains, shards, main) {
    if (main) return tokensFor(main, shards);
    const sets = mains.map((m) => tokensFor(m, shards)).filter((s) => s.length);
    if (sets.length > 1) {
      const size = (s) => s.reduce((n, t) => n + shards[t], 0);
      let biggest = 0;
      sets.forEach((s, i) => { if (size(s) > size(sets[biggest])) biggest = i; });
      sets.splice(biggest, 1);
    }
    return [...new Set(sets.flat())];
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  const COURSE_CODES = { m: 'main', s: 'side', p: 'soup', t: 'starter', x: 'sauce', d: 'dessert', o: 'other' };

  function toRecipe(index, words, row) {
    const [name, siteIndex, path, keys, course] = row;
    const host = index.sites[siteIndex];
    const site = host.replace(/^www\./, '');
    const url = 'https://' + host + path;
    return {
      id: 'web-' + hash(url),
      dedupeKey: `${site}|${Core.normalize(name)}`,
      sourceName: site,
      sourceGroup: 'Recipe websites',
      name,
      image: '',
      thumb: '',
      area: '',
      category: '',
      tags: [],
      courseHint: COURSE_CODES[course] || '',
      source: url,
      sourceLabel: `Open on ${site} ↗`,
      youtube: '',
      credit: null,
      methodOn: site,
      steps: [],
      ingredients: keys.map((key) => {
        const optional = key < 0;
        const word = words[optional ? -key - 1 : key];
        return { name: capitalise(word), match: word, measure: '', optional };
      }),
      complete: true,
    };
  }

  /*
   * Website recipes that use at least one of your main ingredients and need few others.
   *   mains: your main ingredients; options.pantry / options.basics: everything you have;
   *   options.main: the main ingredient (★), if chosen.
   */
  async function findRecipes(mains, { fetchImpl, pantry, basics, main } = {}) {
    const index = await loadIndex(fetchImpl);
    built = index.built || '';
    const tokens = shardsToLoad(mains, index.shards, main);
    const files = await Promise.all(tokens.map((t) => loadShard(t, fetchImpl)));
    const all = pantry || mains;
    const myBasics = basics || [];
    const seen = new Set();
    const shortlist = [];
    for (const file of files) {
      // Each file has its own list of ingredient names; check each name once.
      const isMain = new Uint8Array(file.w.length);
      const covered = new Uint8Array(file.w.length);
      file.w.forEach((w, i) => {
        if (mains.some((m) => Core.ingredientMatches(m, w))) isMain[i] = 1;
        if (all.some((p) => Core.ingredientMatches(p, w)) || Core.coveredByBasics(myBasics, w)) covered[i] = 1;
      });
      for (const row of file.r) {
        const key = row[1] + row[2];
        if (seen.has(key)) continue;
        seen.add(key);
        let usesMain = 0;
        let missing = 0;
        for (const k of row[3]) {
          if (k < 0) continue; // optional
          if (isMain[k]) usesMain++;
          if (!covered[k]) missing++;
        }
        if (usesMain && missing <= MAX_MISSING) shortlist.push({ row, words: file.w, missing, usesMain });
      }
    }
    shortlist.sort((a, b) => a.missing - b.missing || b.usesMain - a.usesMain);
    return shortlist.slice(0, MAX_CANDIDATES).map((s) => toRecipe(index, s.words, s.row));
  }

  const api = { findRecipes, _internal: { shardsToLoad, tokensFor, hash, reset: () => { indexLoading = null; shardLoading.clear(); } } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WebRecipes = api;
})(typeof self !== 'undefined' ? self : this);

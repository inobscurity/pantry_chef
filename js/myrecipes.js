/*
 * My recipes: recipes you saved yourself from a website, with the "Save to Pantry Chef" bookmark.
 *
 * The bookmark runs on a recipe page you're reading. It reads that one page's recipe details,
 * which recipe sites publish for search engines (schema.org "Recipe", as JSON-LD), and opens
 * Pantry Chef with them in the address: …/pantry_chef/#save=<details>. The app then keeps the
 * recipe in this browser (localStorage). Nothing is collected automatically: one page, when you
 * tap the bookmark.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const KEY = 'pantrychef:myrecipes';

  // ---- the bookmark -----------------------------------------------------------------

  /* eslint-disable */
  // Reads the recipe on the page it runs on: the bookmark runs it on a recipe site, and so does the
  // Android app's Save button. It uses nothing from this file. Returns the details, or null.
  function extract() {
    function list(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
    function isRecipe(o) { return o && list(o['@type']).some(function (t) { return /Recipe$/i.test(String(t)); }); }
    function find(o) {
      if (!o || typeof o !== 'object') return null;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) { var r = find(o[i]); if (r) return r; } return null; }
      if (isRecipe(o)) return o;
      return find(o['@graph']) || find(o.mainEntity) || null;
    }
    var recipe = null;
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length && !recipe; i++) { try { recipe = find(JSON.parse(scripts[i].textContent)); } catch (e) {} }
    if (!recipe) return null;
    function text(x) {   // plain text from text that may hold HTML; DOMParser runs no scripts
      var doc = new DOMParser().parseFromString(String(x == null ? '' : x), 'text/html');
      return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function steps(x) {
      var out = [];
      list(x).forEach(function (s) {
        if (typeof s === 'string') s.split(/\n+/).forEach(function (l) { if (text(l)) out.push(text(l)); });
        else if (s && s.itemListElement) out = out.concat(steps(s.itemListElement));
        else if (s && (s.text || s.name)) out.push(text(s.text || s.name));
      });
      return out;
    }
    function image(x) { x = list(x)[0]; return typeof x === 'string' ? x : (x && (x.url || x.contentUrl)) || ''; }
    return {
      n: text(recipe.name),
      i: list(recipe.recipeIngredient || recipe.ingredients).map(text).filter(Boolean),
      s: steps(recipe.recipeInstructions),
      p: image(recipe.image),
      u: location.href.split('#')[0],
      h: location.hostname.replace(/^www\./, ''),
      c: list(recipe.recipeCategory).map(text).join(', '),
      y: text(list(recipe.recipeYield)[0]),
      t: text(recipe.totalTime),
    };
  }
  /* eslint-enable */

  // The bookmark's address (a javascript: link): read the page, then open Pantry Chef at `appUrl`.
  function bookmarkHref(appUrl) {
    const code = '(function () { var d = (' + extract.toString() + ')();'
      + " if (!d) { alert('Pantry Chef: no recipe found on this page.'); return; }"
      + ' var url = ' + JSON.stringify(appUrl) + " + '#save=' + encodeURIComponent(JSON.stringify(d));"
      + " var w = window.open(url, '_blank'); if (!w) location.href = url; })()";
    return 'javascript:' + encodeURIComponent(code);
  }

  // For the Android app's Save button: code that reads the page and gives back the details as
  // JSON text ('' if there's no recipe).
  function extractorCode() {
    return '(function () { var d = (' + extract.toString() + ')(); return d ? JSON.stringify(d) : \'\'; })()';
  }

  // ---- saved recipes ----------------------------------------------------------------

  function load(storage) {
    try {
      const list = JSON.parse((storage || root.localStorage).getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (_) { return []; }
  }

  function store(list, storage) {
    try { (storage || root.localStorage).setItem(KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
  }

  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const short = (s, n) => String(s == null ? '' : s).slice(0, n);

  // "PT1H30M" → "1 hr 30 min"
  function duration(iso) {
    const m = String(iso || '').match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
    if (!m || (!m[1] && !m[2])) return /^P/i.test(String(iso || '')) ? '' : short(iso, 30);
    return [m[1] ? `${Number(m[1])} hr` : '', m[2] ? `${Number(m[2])} min` : ''].filter(Boolean).join(' ');
  }

  /*
   * Checks and tidies what the bookmark sent (it comes from another website), and saves it.
   * Returns the saved recipe, or null if it isn't a usable recipe. Saving the same page again
   * replaces the earlier copy.
   */
  function save(details, { storage, parseIngredient } = {}) {
    if (!details || typeof details !== 'object') return null;
    const name = short(details.n, 150).trim();
    const lines = Array.isArray(details.i) ? details.i.slice(0, 60).map((x) => short(x, 200).trim()).filter(Boolean) : [];
    if (!name || !lines.length) return null;
    const parse = parseIngredient || ((line) => ({ name: line, measure: '' }));
    const url = safeUrl(details.u);
    const recipe = {
      id: 'my-' + (url || name).replace(/[^a-z0-9]+/gi, '-').slice(-60).replace(/^-|-$/g, '').toLowerCase(),
      name,
      ingredients: lines.map((line) => parse(line) || { name: line, measure: '' }),
      steps: Array.isArray(details.s) ? details.s.slice(0, 60).map((x) => short(x, 1200).trim()).filter(Boolean) : [],
      image: safeUrl(details.p),
      url,
      site: short(details.h, 80),
      category: short(details.c, 80),
      serves: short(details.y, 40),
      time: duration(details.t),
      saved: new Date().toISOString(),
    };
    const list = load(storage).filter((r) => r.id !== recipe.id);
    list.unshift(recipe);
    return store(list, storage) ? recipe : null;
  }

  function remove(id, storage) {
    store(load(storage).filter((r) => r.id !== id), storage);
  }

  // A recipe site's list often ends with a garnish section ("Cream for drizzling", "Finely
  // chopped parsley", "Garlic bread for dunking"), but the heading is lost. Lines at the end
  // with no amount, in a run that includes a garnish or "to serve" line, are taken as garnish.
  function markGarnish(ingredients) {
    const out = ingredients.map((ing) => Object.assign({}, ing));
    let start = out.length;
    while (start > 0 && !String(out[start - 1].measure || '').trim()) start--;
    const tail = out.slice(start);
    if (tail.length && tail.length < out.length && tail.some((ing) => Core.isOptional(ing))) {
      tail.forEach((ing) => { ing.optional = true; });
    }
    return out;
  }

  function toRecipe(r) {
    return {
      id: r.id,
      dedupeKey: 'my|' + Core.normalize(r.name),
      sourceName: r.site ? `My recipes · ${r.site}` : 'My recipes',
      sourceGroup: 'My recipes',
      name: r.name,
      image: r.image,
      thumb: r.image,
      area: '',
      category: r.time ? `Takes ${r.time}` : '',
      tags: r.serves ? [`Serves ${r.serves.replace(/^serves\s*/i, '')}`] : [],
      courseHint: Core.courseFromLabel(r.category),
      source: r.url,
      sourceLabel: r.site ? `Open on ${r.site} ↗` : 'Original recipe ↗',
      youtube: '',
      credit: r.site ? { text: `Saved by you from ${r.site}.`, licence: 'for your own use', licenceUrl: '' } : null,
      steps: r.steps,
      ingredients: markGarnish(r.ingredients),
      complete: true,
    };
  }

  function all(storage) {
    return load(storage).map(toRecipe);
  }

  // Saved recipes that use at least one of your main ingredients.
  async function findRecipes(mains, { storage } = {}) {
    return all(storage).filter((r) => r.ingredients.some((ing) => mains.some((m) => Core.ingredientMatches(m, ing.name))));
  }

  const api = { bookmarkHref, extractorCode, save, remove, all, findRecipes, _internal: { extract, duration, load, markGarnish } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MyRecipes = api;
})(typeof self !== 'undefined' ? self : this);

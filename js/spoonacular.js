/*
 * Finds recipes through Spoonacular (https://spoonacular.com/food-api), which gathers
 * recipes from many websites and food blogs. It needs an API key, which the user enters
 * in the app and which stays in their browser.
 *
 * Spoonacular charges "points" per request against a daily allowance, so this uses two
 * kinds of request:
 *  - one search per "Find recipes": recipes that use your ingredients, with the
 *    ingredients you have and the ones you'd need to buy;
 *  - one lookup per recipe you open, for its quantities and method.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const BASE = 'https://api.spoonacular.com/';
  const RESULTS = 60;

  class SpoonacularError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  const memory = new Map();
  function cacheGet(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = root.sessionStorage && root.sessionStorage.getItem('spoon:' + key);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* storage blocked */ }
    return undefined;
  }
  function cacheSet(key, value) {
    memory.set(key, value);
    try { root.sessionStorage && root.sessionStorage.setItem('spoon:' + key, JSON.stringify(value)); } catch (_) { /* full */ }
  }

  let lastQuotaLeft = null; // points left today, when Spoonacular tells us

  async function getJSON(path, params, key, fetchImpl) {
    const query = new URLSearchParams(params).toString();
    const cacheKey = path + '?' + query; // never includes the key
    const cached = cacheGet(cacheKey);
    if (cached !== undefined) return cached;

    const url = BASE + path + '?' + query + '&apiKey=' + encodeURIComponent(key);
    let res;
    try {
      res = await (fetchImpl || root.fetch.bind(root))(url);
    } catch (e) {
      throw new SpoonacularError("Couldn't reach Spoonacular.", 0);
    }
    const left = res.headers && res.headers.get && res.headers.get('X-API-Quota-Left');
    if (left != null && left !== '') lastQuotaLeft = Number(left);

    if (res.status === 401) throw new SpoonacularError('Spoonacular did not accept the API key.', 401);
    if (res.status === 402) throw new SpoonacularError("Today's Spoonacular allowance is used up. It resets daily.", 402);
    if (!res.ok) throw new SpoonacularError(`Spoonacular answered ${res.status}.`, res.status);
    const data = await res.json();
    cacheSet(cacheKey, data);
    return data;
  }

  // 236.588 → "237", 0.3333 → "0.33", 2 → "2"
  function amountText(amount) {
    if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) return '';
    const digits = amount >= 10 ? 0 : amount >= 1 ? 1 : 2;
    return String(Number(amount.toFixed(digits)));
  }

  function measureText(amount, unit) {
    return [amountText(amount), unit || ''].filter(Boolean).join(' ');
  }

  function capitalise(s) {
    s = String(s || '').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function optional(i) {
    return /\boptional\b/i.test(i.original || '') || (i.meta || []).some((m) => /optional/i.test(m));
  }

  function searchResultToRecipe(r) {
    const ing = (list, have) => (list || []).map((i) => ({
      id: i.id,
      name: capitalise(i.name),
      measure: measureText(i.amount, i.unitShort || i.unit),
      have,
      optional: optional(i),
    }));
    return {
      id: 'spoon-' + r.id,
      spoonId: r.id,
      sourceName: 'Spoonacular',
      name: r.title,
      image: r.image || '',
      thumb: r.image || '',
      category: '',
      area: '',
      tags: [],
      source: '',
      youtube: '',
      steps: [],
      ingredients: ing(r.usedIngredients, true).concat(ing(r.missedIngredients, false)),
      complete: false, // quantities and method are fetched when the recipe is opened
    };
  }

  /*
   * Returns recipes that use at least one pantry ingredient. Spoonacular decides which
   * ingredients you have, so each ingredient carries `have`.
   */
  async function findRecipes(pantry, key, { fetchImpl } = {}) {
    const data = await getJSON('recipes/findByIngredients', {
      ingredients: pantry.join(','),
      number: RESULTS,
      ranking: 2,          // fewest missing ingredients first
      ignorePantry: false, // we handle basics ourselves, with the "I have the basics" switch
    }, key, fetchImpl);
    return (Array.isArray(data) ? data : []).map(searchResultToRecipe);
  }

  function decodeEntities(s) {
    return s
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&deg;/g, '°')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&');
  }

  // Some recipes have only an HTML method, like "<ol><li>Boil…</li></ol>".
  function htmlToText(html) {
    return decodeEntities(String(html || '')
      .replace(/<\s*(li|p|br|div|h\d)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''));
  }

  function stepsFrom(info) {
    const sections = (info.analyzedInstructions || []).filter((s) => s.steps && s.steps.length);
    if (sections.length) {
      return sections.flatMap((section) => section.steps.map((s, i) => {
        const text = String(s.step || '').trim();
        return i === 0 && section.name && sections.length > 1 ? `${capitalise(section.name)}: ${text}` : text;
      })).filter(Boolean);
    }
    return Core.splitSteps(htmlToText(info.instructions));
  }

  /*
   * Adds quantities, method and details to a recipe from the search.
   * Ingredients keep the have / need decision the search made, matched by ingredient id.
   */
  async function completeRecipe(recipe, key, { fetchImpl } = {}) {
    if (recipe.complete) return recipe;
    const info = await getJSON(`recipes/${recipe.spoonId}/information`, { includeNutrition: false }, key, fetchImpl);

    const known = new Map(recipe.ingredients.map((i) => [i.id, i.have]));
    const knownNames = new Map(recipe.ingredients.map((i) => [Core.normalize(i.name), i.have]));
    const seen = new Set();
    const ingredients = [];
    for (const e of info.extendedIngredients || []) {
      const name = capitalise(e.nameClean || e.name || e.originalName);
      const dupKey = e.id + '|' + name;
      if (!name || seen.has(dupKey)) continue;
      seen.add(dupKey);
      const metric = e.measures && e.measures.metric;
      const measure = metric ? measureText(metric.amount, metric.unitShort) : measureText(e.amount, e.unit);
      let have = known.has(e.id) ? known.get(e.id) : knownNames.get(Core.normalize(e.name));
      ingredients.push({ id: e.id, name, measure, have, optional: optional(e) });
    }

    const tags = [...(info.dishTypes || []), ...(info.diets || [])].slice(0, 3);
    return Object.assign({}, recipe, {
      image: info.image || recipe.image,
      area: (info.cuisines || []).join(', '),
      category: info.readyInMinutes ? `Ready in ${info.readyInMinutes} min` : '',
      tags: info.servings ? [`Serves ${info.servings}`, ...tags] : tags,
      source: info.sourceUrl || info.spoonacularSourceUrl || '',
      sourceName: info.sourceName ? `${info.sourceName} via Spoonacular` : 'Spoonacular',
      steps: stepsFrom(info),
      ingredients: ingredients.length ? ingredients : recipe.ingredients,
      complete: true,
    });
  }

  const api = {
    findRecipes,
    completeRecipe,
    quotaLeft: () => lastQuotaLeft,
    SpoonacularError,
    _internal: { searchResultToRecipe, stepsFrom, htmlToText, measureText },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Spoonacular = api;
})(typeof self !== 'undefined' ? self : this);

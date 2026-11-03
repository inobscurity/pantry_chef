/*
 * Finds recipes online through TheMealDB (https://www.themealdb.com), a free recipe
 * database that needs no account. "1" is its public test key.
 *
 * TheMealDB can search by one ingredient at a time, so for each ingredient you have we
 * look up which recipes use it, rank the recipes that use the most of your ingredients,
 * then fetch their full ingredient lists and instructions.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const BASE = 'https://www.themealdb.com/api/json/v1/1/';
  const MAX_DETAILS = 80; // full recipes fetched per search
  const VARIANTS_PER_INGREDIENT = 8; // "chicken" → Chicken, Chicken Breast, Chicken Thighs…

  const memory = new Map();

  function cacheGet(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const raw = root.sessionStorage && root.sessionStorage.getItem('mealdb:' + key);
      if (raw) {
        const value = JSON.parse(raw);
        memory.set(key, value);
        return value;
      }
    } catch (_) { /* storage blocked: memory cache only */ }
    return undefined;
  }

  function cacheSet(key, value) {
    memory.set(key, value);
    try {
      root.sessionStorage && root.sessionStorage.setItem('mealdb:' + key, JSON.stringify(value));
    } catch (_) { /* full or blocked */ }
  }

  async function getJSON(path, fetchImpl) {
    const cached = cacheGet(path);
    if (cached !== undefined) return cached;
    const res = await (fetchImpl || root.fetch.bind(root))(BASE + path);
    if (!res.ok) throw new Error(`Recipe service answered ${res.status}`);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { meals: null }; } // "no data" replies
    cacheSet(path, data);
    return data;
  }

  // Runs fn over items with at most `limit` requests in flight.
  async function pool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        try { results[i] = await fn(items[i], i); } catch (e) { results[i] = e; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  function toRecipe(meal) {
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
      const name = (meal['strIngredient' + i] || '').trim();
      if (name) ingredients.push({ name, measure: (meal['strMeasure' + i] || '').trim() });
    }
    return {
      id: 'mealdb-' + meal.idMeal,
      sourceName: 'TheMealDB',
      name: meal.strMeal,
      image: meal.strMealThumb,
      thumb: meal.strMealThumb ? meal.strMealThumb + '/medium' : '',
      category: meal.strCategory || '',
      courseHint: Core.courseFromLabel(meal.strCategory), // Side, Starter, Dessert, Beef, Seafood…
      area: meal.strArea || '',
      tags: (meal.strTags || '').split(',').map((t) => t.trim()).filter(Boolean),
      source: meal.strSource || '',
      youtube: meal.strYoutube || '',
      steps: Core.splitSteps(meal.strInstructions),
      ingredients,
      complete: true, // ingredients and steps are all here; nothing more to fetch
    };
  }

  async function ingredientNames(fetchImpl) {
    const data = await getJSON('list.php?i=list', fetchImpl);
    return (data.meals || []).map((m) => m.strIngredient).filter(Boolean);
  }

  // The database names an ingredient might go by, closest first.
  function variantsFor(item, known) {
    const target = Core.normalize(item);
    const matches = known.filter((k) => Core.ingredientMatches(item, k));
    matches.sort((a, b) => {
      const ea = Core.normalize(a) === target ? 0 : 1;
      const eb = Core.normalize(b) === target ? 0 : 1;
      return ea - eb || a.length - b.length;
    });
    const picked = matches.slice(0, VARIANTS_PER_INGREDIENT);
    return picked.length ? picked : [item];
  }

  /*
   * pantry: ingredient names the user has.
   * onProgress(message, fraction) reports how far along the search is.
   * Returns full recipes that use at least one of the pantry ingredients.
   */
  async function findRecipes(pantry, { onProgress, fetchImpl } = {}) {
    const progress = onProgress || (() => {});
    progress('Looking up your ingredients…', 0.05);

    let known = [];
    try { known = await ingredientNames(fetchImpl); } catch (_) { /* fall back to names as typed */ }

    const queries = []; // { pantryIndex, name }
    pantry.forEach((item, pantryIndex) => {
      for (const name of variantsFor(item, known)) queries.push({ pantryIndex, name });
    });

    const hits = new Map(); // mealId → Set of pantry indexes it uses
    let done = 0;
    const listed = await pool(queries, 6, async (q) => {
      const data = await getJSON('filter.php?i=' + encodeURIComponent(q.name.replace(/ /g, '_')), fetchImpl);
      done++;
      progress('Searching recipes…', 0.05 + 0.35 * (done / queries.length));
      for (const meal of data.meals || []) {
        if (!hits.has(meal.idMeal)) hits.set(meal.idMeal, new Set());
        hits.get(meal.idMeal).add(q.pantryIndex);
      }
    });
    if (queries.length && listed.every((r) => r instanceof Error)) throw listed[0];

    const ids = [...hits.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, MAX_DETAILS)
      .map(([id]) => id);

    done = 0;
    const details = await pool(ids, 8, async (id) => {
      const data = await getJSON('lookup.php?i=' + encodeURIComponent(id), fetchImpl);
      done++;
      progress(`Reading recipes (${done} of ${ids.length})…`, 0.4 + 0.6 * (done / ids.length));
      return data.meals && data.meals[0] ? toRecipe(data.meals[0]) : null;
    });
    if (ids.length && details.every((r) => r instanceof Error)) throw details[0];

    return details.filter((r) => r && !(r instanceof Error));
  }

  const api = { findRecipes, toRecipe, variantsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MealDB = api;
})(typeof self !== 'undefined' ? self : this);

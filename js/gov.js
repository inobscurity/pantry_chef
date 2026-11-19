/*
 * Public-domain recipes from US Government health agencies: the National Heart, Lung, and Blood
 * Institute's "Healthy Eating Recipes" (from its heart-healthy cookbooks). Read by
 * scripts/build_gov.py into data/gov/recipes.json, which is small and loaded whole.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const Wiki = root.Wikibooks || (typeof require !== 'undefined' ? require('./wikibooks.js') : null);
  let loading = null;

  function load(fetchImpl) {
    if (!loading) {
      loading = (fetchImpl || root.fetch.bind(root))('data/gov/recipes.json')
        .then((res) => { if (!res.ok) throw new Error(`Government recipes answered ${res.status}`); return res.json(); })
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  // "15 minutes" + "20 minutes" → "35 min"
  function totalTime(prep, cook) {
    const mins = (t) => {
      const h = String(t || '').match(/(\d+)\s*h/i);
      const m = String(t || '').match(/(\d+)\s*m/i);
      return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
    };
    const n = mins(prep) + mins(cook);
    if (!n) return '';
    return [Math.floor(n / 60) ? `${Math.floor(n / 60)} hr` : '', n % 60 ? `${n % 60} min` : ''].filter(Boolean).join(' ');
  }

  function toRecipe(r) {
    const time = totalTime(r.prep, r.cook);
    return {
      id: 'gov-nhlbi-' + r.id,
      dedupeKey: 'nhlbi|' + Core.normalize(r.n),
      sourceName: 'NHLBI Healthy Eating Recipes',
      sourceGroup: 'US Government recipes',
      name: r.n,
      image: '',
      thumb: '',
      area: r.src,
      category: time ? `Takes ${time}` : '',
      tags: r.y ? [`Serves ${r.y.replace(/\s*servings?$/i, '')}`] : [],
      courseHint: '',
      source: r.u,
      sourceLabel: 'Open on nhlbi.nih.gov ↗',
      youtube: '',
      note: r.d,
      credit: {
        text: `From the National Heart, Lung, and Blood Institute${r.src ? `, “${r.src}”` : ''}.`,
        licence: 'Public domain (US Government work)',
        licenceUrl: '',
      },
      steps: r.s,
      ingredients: r.i.map((line) => Wiki._internal.parseIngredient(line) || { name: line, measure: '' }),
      complete: true,
    };
  }

  // Recipes that use at least one of your main ingredients.
  async function findRecipes(mains, { fetchImpl } = {}) {
    const data = await load(fetchImpl);
    return (data.nhlbi || []).map(toRecipe)
      .filter((r) => r.ingredients.some((ing) => mains.some((m) => Core.ingredientMatches(m, Core.nameOf(ing)))));
  }

  async function recipeById(id, { fetchImpl } = {}) {
    const data = await load(fetchImpl);
    const r = (data.nhlbi || []).find((x) => 'gov-nhlbi-' + x.id === id);
    return r ? toRecipe(r) : null;
  }

  const api = { findRecipes, recipeById, _internal: { totalTime, reset: () => { loading = null; } } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GovRecipes = api;
})(typeof self !== 'undefined' ? self : this);

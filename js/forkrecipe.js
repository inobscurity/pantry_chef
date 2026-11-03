/*
 * Recipes from the ForkRecipe open dataset, bundled with the app in data/forkrecipe.json
 * (CC BY-SA 4.0, see data/README.md). No network service or key: the file is downloaded
 * once, on the first search, and searched in the browser.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const CREDIT = {
    text: 'Adapted from the ForkRecipe open recipe dataset by FoodML and contributors.',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  };

  let loading = null;

  function load(fetchImpl) {
    if (!loading) {
      loading = (fetchImpl || root.fetch.bind(root))('data/forkrecipe.json')
        .then((res) => {
          if (!res.ok) throw new Error(`Recipe data answered ${res.status}`);
          return res.json();
        })
        .then((data) => (data.recipes || []).map(toRecipe))
        .catch((e) => { loading = null; throw e; });
    }
    return loading;
  }

  function toRecipe(r) {
    return {
      id: r.id,
      sourceName: 'ForkRecipe',
      name: r.name,
      image: '',
      thumb: '',
      area: r.cuisine || '',
      category: r.time ? `Takes ${r.time}` : '',
      courseHint: Core.courseFromLabel(r.category), // proteins, seafood, vegetables, grains, desserts…
      tags: [],
      source: r.link || '',
      youtube: '',
      note: r.note || '',
      credit: CREDIT,
      steps: r.steps || [],
      ingredients: r.ingredients || [],
      complete: true,
    };
  }

  // Recipes that use at least one pantry ingredient.
  async function findRecipes(pantry, { fetchImpl } = {}) {
    const all = await load(fetchImpl);
    return all.filter((r) => r.ingredients.some((ing) => pantry.some((p) => Core.ingredientMatches(p, ing.name))));
  }

  const api = { findRecipes, _reset: () => { loading = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ForkRecipe = api;
})(typeof self !== 'undefined' ? self : this);

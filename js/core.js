/*
 * Pure logic for the recipe finder: matching ingredients, grouping recipes by how many
 * ingredients are missing, and turning a recipe's instructions into numbered steps.
 * No network or DOM here, so it runs in the browser and in Node tests alike.
 */
(function (root) {
  'use strict';

  // Things most kitchens already have. When "Assume I have basics" is on, a recipe
  // needing these doesn't count them as missing. Matched exactly, so "pepper" covers
  // black pepper but not "red pepper".
  const STAPLES = [
    'salt', 'sea salt', 'kosher salt', 'pepper', 'black pepper', 'ground black pepper',
    'water', 'boiling water', 'cold water', 'ice', 'oil', 'olive oil', 'extra virgin olive oil',
    'vegetable oil', 'sunflower oil', 'canola oil', 'rapeseed oil', 'cooking spray',
  ];

  // Words that describe how an ingredient is prepared, not what it is.
  const NOISE = new Set([
    'fresh', 'freshly', 'chopped', 'diced', 'sliced', 'minced', 'grated', 'ground', 'large',
    'small', 'medium', 'whole', 'dried', 'raw', 'cooked', 'boneless', 'skinless', 'organic',
    'finely', 'roughly', 'peeled', 'of', 'and', 'or', 'to', 'taste', 'a', 'the',
  ]);

  function singular(word) {
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries
    if (word.length > 4 && /(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2); // tomatoes
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // eggs
    return word;
  }

  function normalize(name) {
    return String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // jalapeño -> jalapeno
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(singular)
      .join(' ');
  }

  function tokens(name) {
    const all = normalize(name).split(' ').filter(Boolean);
    const meaningful = all.filter((w) => !NOISE.has(w));
    return meaningful.length ? meaningful : all;
  }

  // Words that turn an ingredient into a different product: chicken isn't chicken stock.
  const DERIVED = new Set([
    'stock', 'broth', 'powder', 'sauce', 'paste', 'cube', 'extract', 'essence', 'oil',
    'vinegar', 'flour', 'milk', 'cream', 'butter', 'syrup', 'ketchup', 'jam', 'puree',
  ]);

  // "chicken" matches "chicken breast" and "chicken breast" matches "chicken":
  // one name's words all appear in the other, and the extra words don't make it a
  // different product.
  function ingredientMatches(have, needed) {
    const a = tokens(have);
    const b = tokens(needed);
    if (!a.length || !b.length) return false;
    const within = (x, y) =>
      x.every((w) => y.includes(w)) && !y.some((w) => !x.includes(w) && DERIVED.has(w));
    return within(a, b) || within(b, a);
  }

  const STAPLE_SET = new Set(STAPLES.map(normalize));
  function isStaple(name) {
    return STAPLE_SET.has(normalize(name));
  }

  /*
   * recipe: { ingredients: [{ name, measure }] }
   * Returns each ingredient tagged as 'have' | 'staple' | 'need'.
   */
  function classifyIngredients(recipe, pantry, assumeStaples) {
    return recipe.ingredients.map((ing) => {
      let status = 'need';
      if (pantry.some((p) => ingredientMatches(p, ing.name))) status = 'have';
      else if (assumeStaples && isStaple(ing.name)) status = 'staple';
      return Object.assign({}, ing, { status });
    });
  }

  const GROUP_TITLES = [
    'Make it now',
    'Buy 1 ingredient',
    'Buy 2 ingredients',
    'Buy 3 ingredients',
  ];

  /*
   * Puts recipes into four groups by how many ingredients you'd need to buy (0–3).
   * Recipes missing more than 3 are left out. Within a group, recipes that use more of
   * your ingredients come first.
   */
  function groupRecipes(recipes, pantry, assumeStaples, maxMissing) {
    const limit = maxMissing == null ? 3 : maxMissing;
    const groups = [];
    for (let i = 0; i <= limit; i++) {
      groups.push({ missing: i, title: GROUP_TITLES[i] || `Buy ${i} ingredients`, recipes: [] });
    }
    for (const recipe of recipes) {
      const items = classifyIngredients(recipe, pantry, assumeStaples);
      const need = items.filter((i) => i.status === 'need');
      const used = items.filter((i) => i.status === 'have').length;
      if (used === 0 || need.length > limit) continue;
      groups[need.length].recipes.push({ recipe, items, need, used });
    }
    for (const g of groups) {
      g.recipes.sort((x, y) => y.used - x.used || x.recipe.name.localeCompare(y.recipe.name));
    }
    return groups;
  }

  const STEP_LABEL = /^\s*(step\s*\d+\s*[:.)-]?|\d+\s*[.):-]|\d+\s*$)\s*/i;

  function sentences(text) {
    return text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
  }

  /*
   * Recipe sites write instructions as numbered lines, "STEP 1" headings, or one long
   * paragraph. This returns a clean list of steps in every case.
   */
  function splitSteps(instructions) {
    const lines = String(instructions || '')
      .replace(/\r/g, '')
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    let steps = [];
    for (const line of lines) {
      const text = line.replace(STEP_LABEL, '').replace(/^[-•*▢]\s*/, '').trim();
      if (text) steps.push(text);
    }

    // Also split "1. Do this. 2. Do that." written on one line.
    steps = steps.flatMap((s) => s.split(/\s(?=\d+\.\s+[A-Z])/).map((p) => p.replace(STEP_LABEL, '').trim()));

    // One wall of text: break it into steps of about two sentences.
    if (steps.length === 1 && steps[0].length > 280) {
      const parts = sentences(steps[0]);
      steps = [];
      for (let i = 0; i < parts.length; i += 2) steps.push(parts.slice(i, i + 2).join(' '));
    }
    return steps.filter(Boolean);
  }

  const api = {
    STAPLES, normalize, tokens, ingredientMatches, isStaple,
    classifyIngredients, groupRecipes, splitSteps,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecipeCore = api;
})(typeof self !== 'undefined' ? self : this);

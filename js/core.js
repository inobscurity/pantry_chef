/*
 * Pure logic for the recipe finder: matching ingredients, grouping recipes by how many
 * ingredients are missing, and turning a recipe's instructions into numbered steps.
 * No network or DOM here, so it runs in the browser and in Node tests alike.
 */
(function (root) {
  'use strict';

  // Basics most kitchens have. The user can edit this list in the app.
  const DEFAULT_BASICS = ['salt', 'pepper', 'oil', 'water'];

  // Words that describe how an ingredient is prepared, not what it is.
  const NOISE = new Set([
    'fresh', 'freshly', 'chopped', 'diced', 'sliced', 'minced', 'grated', 'ground', 'large',
    'small', 'medium', 'whole', 'dried', 'raw', 'cooked', 'boneless', 'skinless', 'organic',
    'finely', 'roughly', 'thinly', 'peeled', 'crushed', 'beaten', 'softened', 'melted', 'cut',
    'into', 'piece', 'about', 'plus', 'for', 'serving', 'garnish', 'needed', 'optional',
    'room', 'temperature', 'packed', 'heaped', 'level', 'good', 'quality', 'cubed', 'frying',
    'deep', 'shallow', 'greasing', 'drizzling', 'nonfat', 'lowfat', 'sodium',
    'of', 'and', 'or', 'to', 'taste', 'a', 'an', 'the', 'some',
  ]);

  // Words that don't change what a basic is: "fine sea salt" is still salt, "olive oil" is
  // still oil. Anything else does: "red pepper" isn't pepper, "brown sugar" isn't sugar.
  const BASIC_MODIFIERS = new Set([
    'black', 'white', 'sea', 'kosher', 'table', 'fine', 'coarse', 'flaky', 'rock', 'cracked',
    'plain', 'all', 'purpose', 'self', 'raising', 'rising', 'unsalted', 'salted', 'extra',
    'virgin', 'olive', 'vegetable', 'sunflower', 'canola', 'rapeseed', 'neutral', 'cooking',
    'light', 'mild', 'caster', 'granulated', 'cold', 'boiling', 'warm', 'lukewarm', 'iced',
    'tap', 'filtered', 'spray', 'free', 'range', 'clove', 'peppercorn', 'leaf',
    // cream, milk and sugar
    'heavy', 'double', 'single', 'thickened', 'pouring', 'whipping', 'full', 'fat', 'skim',
    'skimmed', 'low', 'reduced',
  ]);

  // Typed on their own, these are vague ("pepper" might be black pepper or a red pepper), so
  // they only cover the everyday kinds, using the same rule as basics.
  const STRICT = new Set(['salt', 'pepper', 'oil', 'water', 'sugar', 'flour', 'cream', 'milk', 'vinegar']);

  // Different names for the same thing, including Australian ones. Applied before matching.
  const SYNONYMS = [
    [/\bbroth\b/g, 'stock'],
    [/\bpeppercorns?\b/g, 'pepper'],
    [/\bsoured cream\b/g, 'sour cream'],
    [/\bbutternut squash\b/g, 'butternut pumpkin'],
    [/\bsweet potato(e?s)?\b/g, 'kumara'],
    [/\bpur[eé]e\b/g, 'puree'],
    [/\b(?:kabocha|winter) squash\b/g, 'pumpkin'],
    [/\bcapsicums?\b/g, 'bell pepper'],
    [/\baubergines?\b/g, 'eggplant'],
    [/\bcourgettes?\b/g, 'zucchini'],
    [/\bcilantro\b/g, 'coriander'],
    [/\b(?:scallions?|green onions?)\b/g, 'spring onion'],
    [/\bshrimps?\b/g, 'prawn'],
    [/\b(?:powdered|confectioners'?) sugar\b/g, 'icing sugar'],
    [/\bheavy cream\b|\bthickened cream\b/g, 'cream'],
    [/\bminced (beef|pork|lamb|chicken|turkey)\b/g, '$1 mince'],
    [/\bground (beef|pork|lamb|chicken|turkey)\b/g, '$1 mince'],
  ];

  // Words that turn an ingredient into a different product: chicken isn't chicken stock.
  // Pumpkin isn't pumpkin seeds, potato isn't sweet potato, milk isn't coconut milk.
  const DERIVED = new Set([
    'stock', 'broth', 'powder', 'sauce', 'paste', 'extract', 'essence', 'oil',
    'vinegar', 'flour', 'milk', 'cream', 'butter', 'syrup', 'ketchup', 'jam',
    'seed', 'pepita', 'spice', 'flake', 'pie', 'sour', 'coconut', 'almond', 'oat',
    'soy', 'condensed', 'evaporated', 'powdered', 'icing', 'liqueur', 'wine',
  ]);

  const IRREGULAR = { leaves: 'leaf', loaves: 'loaf', halves: 'half', calves: 'calf', knives: 'knife', sheaves: 'sheaf' };
  function singular(word) {
    if (IRREGULAR[word]) return IRREGULAR[word];
    if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y'; // berries
    if (word.length > 4 && /(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2); // tomatoes
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // eggs
    return word;
  }

  // The same names are compared thousands of times in a search, so results are remembered.
  function remember(fn, limit) {
    const cache = new Map();
    return (key) => {
      let v = cache.get(key);
      if (v === undefined) {
        if (cache.size > limit) cache.clear();
        v = fn(key);
        cache.set(key, v);
      }
      return v;
    };
  }

  const normalize = remember(normalizeNow, 200000);
  function normalizeNow(name) {
    let s = String(name || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, ''); // jalapeño -> jalapeno
    for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement);
    return s
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map(singular)
      .join(' ');
  }

  const tokens = remember(tokensNow, 200000);
  function tokensNow(name) {
    const all = normalize(name).split(' ').filter(Boolean);
    const meaningful = all.filter((w) => !NOISE.has(w));
    return meaningful.length ? meaningful : all;
  }

  // What a recipe's ingredient is, without notes: "Garlic (grated to a paste)" → "Garlic".
  // "Water or dashi" and "lemon/lime juice" give each alternative.
  const alternatives = remember(alternativesNow, 200000);
  function alternativesNow(name) {
    const core = String(name || '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .split(/\s[—–]\s|:/)[0];
    const parts = core.split(/\s+or\s+|\s*\/\s*/i).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return [String(name || '')];
    // "Turkey or chicken broth" also means "turkey broth".
    const last = parts[parts.length - 1].split(',')[0].trim().split(/\s+/);
    if (parts.length > 1 && last.length > 1) {
      const noun = last[last.length - 1];
      for (const p of parts.slice(0, -1)) if (!/\s/.test(p)) parts.push(p + ' ' + noun);
    }
    return parts;
  }

  // A short label: "Waxy potatoes (Yukon Gold), peeled and sliced" → "Waxy potatoes".
  function shortName(name) {
    return String(name || '')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .split(/\s[—–]\s|:|,\s*(?=(?:peeled|sliced|chopped|diced|cut|crushed|grated|minced|halved|quartered|trimmed|drained|rinsed|softened|melted|beaten|at|finely|thinly|roughly|to|for|plus|about|or|if|cored|seeded|deseeded|torn|shredded)\b)/i)[0]
      .replace(/\s+/g, ' ')
      .replace(/[\s,;.]+$/, '')
      .trim() || String(name || '');
  }

  // "chicken" matches "chicken breast" and "chicken breast" matches "chicken":
  // one name's words all appear in the other, and the extra words don't make it a
  // different product.
  // Leaves, flowers and shoots are a different ingredient from the plant's usual part:
  // pumpkin leaves aren't pumpkin, zucchini flowers aren't zucchini. Except for plants whose
  // leaves are what you'd normally buy: basil leaves are basil.
  const PLANT_PARTS = new Set(['leaf', 'flower', 'blossom', 'shoot', 'tendril', 'vine']);
  const LEAFY = new Set([
    'basil', 'mint', 'parsley', 'coriander', 'sage', 'thyme', 'bay', 'curry', 'oregano', 'tarragon',
    'dill', 'rosemary', 'marjoram', 'sorrel', 'chive', 'lettuce', 'spinach', 'cabbage', 'kale',
    'celery', 'rocket', 'watercress', 'cress', 'chard', 'silverbeet', 'lemongrass', 'fenugreek',
    'lovage', 'chervil', 'savory', 'kaffir', 'makrut', 'pandan', 'shiso', 'herb', 'salad',
  ]);

  function namesMatch(a, b) {
    const x = tokens(a);
    const y = tokens(b);
    if (!x.length || !y.length) return false;
    const changes = (w, shared) => DERIVED.has(w) || (PLANT_PARTS.has(w) && !shared.some((s) => LEAFY.has(s)));
    const within = (p, q) =>
      p.every((w) => q.includes(w)) && !q.some((w) => !p.includes(w) && changes(w, p));
    return within(x, y) || within(y, x);
  }

  // Does something you have (`have`) cover a recipe ingredient (`needed`)?
  const matchCache = new Map();
  function ingredientMatches(have, needed) {
    const key = have + '\u0000' + needed;
    let v = matchCache.get(key);
    if (v === undefined) {
      if (matchCache.size > 500000) matchCache.clear();
      v = STRICT.has(normalize(have)) ? basicMatches(have, needed) : alternatives(needed).some((alt) => namesMatch(have, alt));
      matchCache.set(key, v);
    }
    return v;
  }

  // Is a recipe ingredient one of your basics? Stricter than ingredientMatches.
  function basicMatches(basic, needed) {
    const b = tokens(basic);
    if (!b.length) return false;
    return alternatives(needed).some((alt) => {
      const t = tokens(alt);
      return b.every((w) => t.includes(w)) && t.every((w) => b.includes(w) || BASIC_MODIFIERS.has(w));
    });
  }

  // Is a recipe ingredient covered by your basics? "Salt and pepper" needs both.
  function coveredByBasics(basics, needed) {
    return alternatives(needed).some((alt) =>
      alt.split(/\s+(?:and|&)\s+/i).every((part) => basics.some((b) => basicMatches(b, part))));
  }

  const OPTIONAL = /\boptional\b|\bto serve\b|\bfor serving\b|\bto garnish\b|\bfor garnish\b|\bgarnish\b/i;
  function isOptional(ing) {
    return ing.optional === true || OPTIONAL.test(ing.name || '') || OPTIONAL.test(ing.measure || '');
  }

  /*
   * recipe: { ingredients: [{ name, measure, have?, optional? }] }
   * Returns each ingredient tagged as 'have' | 'optional' | 'staple' | 'need'.
   * A source that matches ingredients itself (Spoonacular) sets `have`; otherwise we match.
   * Only 'need' counts as something to buy.
   */
  function classifyIngredients(recipe, pantry, basics) {
    const myBasics = basics || [];
    return recipe.ingredients.map((ing) => {
      // A source's own "you have this" is trusted; otherwise we check ourselves, because a
      // source is only searched with your main ingredients.
      const status = ing.have === true ? 'have' : statusOf(ing, pantry, myBasics);
      return Object.assign({}, ing, { status });
    });
  }

  function rest(ing, basics) {
    if (isOptional(ing)) return 'optional';
    if (basics && coveredByBasics(basics, ing.name)) return 'staple';
    return 'need';
  }

  // "Kosher salt and vanilla extract" is only covered if both parts are.
  function statusOf(ing, pantry, basics) {
    // Parts that only describe ("nonfat and low-sodium broth", "peeled and cubed") are ignored.
    const describes = (part) => normalize(part).split(' ').every((w) => !w || NOISE.has(w) || BASIC_MODIFIERS.has(w));
    const parts = shortName(ing.name).split(/\s+(?:and|&)\s+/i).filter((p) => p && !describes(p));
    if (parts.length > 1) {
      const has = parts.map((part) => pantry.some((p) => ingredientMatches(p, part)));
      const covered = parts.every((part, i) => has[i] || coveredByBasics(basics, part));
      if (covered) return has.some(Boolean) ? 'have' : 'staple';
      return isOptional(ing) ? 'optional' : 'need';
    }
    if (pantry.some((p) => ingredientMatches(p, ing.name))) return 'have';
    return rest(ing, basics);
  }

  // Several sources can carry the same recipe. Keep the first of each name.
  function dedupe(recipes) {
    const seen = new Set();
    return recipes.filter((r) => {
      const key = r.dedupeKey || normalize(r.name); // books may share dish names, so they say what counts
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const GROUP_TITLES = [
    'Make it now',
    'Buy 1 ingredient',
    'Buy 2 ingredients',
    'Buy 3 ingredients',
  ];

  // Seasonings and fats that go into almost everything. They count as things you have,
  // but a recipe that only uses these isn't a match for your ingredients.
  const MINOR = new Set(['butter', 'margarine', 'ghee', 'lard']);

  /*
   * Your main ingredients: the ones a recipe should be built around. Leaves out salt,
   * pepper, oil, water, sugar, flour, butter and anything in your basics. If everything you
   * listed is minor, all of it counts.
   */
  function mainIngredients(pantry, basics) {
    const mains = pantry.filter((p) => {
      const n = normalize(p);
      return !STRICT.has(n) && !MINOR.has(n) && !coveredByBasics(basics || [], p);
    });
    return mains.length ? mains : pantry.slice();
  }

  /*
   * Puts recipes into four groups by how many ingredients you'd need to buy (0–3).
   * A recipe must use at least one of your main ingredients; ones it doesn't use are
   * ignored. Recipes missing more than 3 are left out. Within a group, the closest matches
   * come first: recipes that use more of the ingredients you listed, then more of your main
   * ones, then simpler ones. A recipe using just one of yours comes last.
   *
   * Two more rules:
   *  - A recipe with more than twice as many ingredients as it takes from the ingredients
   *    you listed is left out. Basics (salt, pepper… whatever is in your basics, even if you
   *    also listed it) and optional ingredients don't count on either side.
   *  - A recipe must use at least half of the ingredients you listed, not counting basics:
   *    the point is to cook with what you have, not to buy most of a dish.
   *  - options.main: the ingredient you chose as the main one. Only recipes using it are shown.
   */
  function groupRecipes(recipes, pantry, basics, maxMissing, options) {
    const main = options && options.main;
    const myBasics = basics || [];
    const listed = pantry.filter((p) => !coveredByBasics(myBasics, p));      // your list, without basics
    const mains = mainIngredients(pantry, basics);
    const limit = maxMissing == null ? 3 : maxMissing;
    const groups = [];
    for (let i = 0; i <= limit; i++) {
      groups.push({ missing: i, title: GROUP_TITLES[i] || `Buy ${i} ingredients`, recipes: [] });
    }
    for (const recipe of recipes) {
      const items = classifyIngredients(recipe, pantry, basics);
      const need = items.filter((i) => i.status === 'need');
      const used = items.filter((i) => i.status === 'have').length;
      if (need.length > limit) continue;
      if (main && !recipe.ingredients.some((i) => ingredientMatches(main, i.name))) continue;
      const counted = items.filter((i) => i.status !== 'optional' && i.status !== 'staple' && !coveredByBasics(myBasics, i.name));
      const fromYours = counted.filter((i) => i.status === 'have').length;
      if (counted.length > 2 * fromYours) continue;
      const usesListed = listed.filter((p) => recipe.ingredients.some((i) => ingredientMatches(p, i.name))).length;
      if (usesListed * 2 < listed.length) continue;
      const usedMain = mains.filter((m) => recipe.ingredients.some((i) => ingredientMatches(m, i.name))).length;
      if (usedMain === 0) continue;
      const usedYours = pantry.filter((p) => recipe.ingredients.some((i) => ingredientMatches(p, i.name))).length;
      groups[need.length].recipes.push({ recipe, items, need, used, usedMain, usedYours });
    }
    // Between equally close recipes, ones using your less common ingredients come first:
    // for pumpkin and onion, a pumpkin dish before one more onion dish.
    const uses = new Map(pantry.map((p) => [p, 0]));
    for (const g of groups) for (const e of g.recipes) for (const p of pantry) if (e.recipe.ingredients.some((i) => ingredientMatches(p, i.name))) uses.set(p, uses.get(p) + 1);
    const total = groups.reduce((n, g) => n + g.recipes.length, 0) + 1;
    for (const g of groups) {
      for (const e of g.recipes) {
        e.rarity = pantry.reduce((sum, p) => sum + (e.recipe.ingredients.some((i) => ingredientMatches(p, i.name)) ? Math.log(total / (1 + uses.get(p))) : 0), 0);
      }
      g.recipes.sort((x, y) => y.usedYours - x.usedYours
        || y.rarity - x.rarity
        || y.usedMain - x.usedMain
        || y.used - x.used
        || x.recipe.ingredients.length - y.recipe.ingredients.length
        || x.recipe.name.localeCompare(y.recipe.name));
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
    DEFAULT_BASICS, normalize, tokens, alternatives, ingredientMatches, basicMatches, coveredByBasics, isOptional, shortName, mainIngredients,
    classifyIngredients, groupRecipes, splitSteps, dedupe,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RecipeCore = api;
})(typeof self !== 'undefined' ? self : this);

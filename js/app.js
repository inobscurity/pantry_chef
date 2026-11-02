/* Screens and interaction for the recipe finder. */
(function () {
  'use strict';

  const Core = window.RecipeCore;
  const $ = (id) => document.getElementById(id);
  const SHOW_PER_GROUP = 12;

  const state = {
    pantry: load('pantry', []),
    assumeStaples: load('staples', true),
    spoonKey: load('spoonKey', ''),
    recipes: [],   // recipes from the last search, from every source
    groups: [],
    notices: [],   // e.g. a source that failed
    searched: false,
    stale: false,  // ingredients changed since the last search
  };

  // ---- small helpers ----------------------------------------------------------------

  function load(key, fallback) {
    try {
      const v = localStorage.getItem('pantrychef:' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem('pantrychef:' + key, JSON.stringify(value)); } catch (_) { /* ignore */ }
  }
  function forget(key) {
    try { localStorage.removeItem('pantrychef:' + key); } catch (_) { /* ignore */ }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function listText(items) {
    const names = items.map((i) => i.name.toLowerCase());
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // ---- recipe sources ---------------------------------------------------------------

  function renderSources() {
    const on = !!state.spoonKey;
    $('sources-summary').textContent = on ? 'TheMealDB and Spoonacular' : 'TheMealDB only';
    $('spoon-key').value = '';
    $('spoon-key').placeholder = on ? 'Key saved in this browser' : 'Paste your Spoonacular API key';
    $('remove-key').hidden = !on;
  }

  function saveKey() {
    const key = $('spoon-key').value.trim();
    if (!key) return;
    state.spoonKey = key;
    save('spoonKey', key);
    renderSources();
    $('key-msg').textContent = 'Saved. Spoonacular will be searched too.';
  }

  function removeKey() {
    state.spoonKey = '';
    forget('spoonKey');
    renderSources();
    $('key-msg').textContent = 'Removed. Only TheMealDB will be searched.';
  }

  // ---- pantry -----------------------------------------------------------------------

  function pantryChanged() {
    save('pantry', state.pantry);
    renderPantry();
    if (state.searched) { state.stale = true; renderResults(); }
  }

  function addIngredients(text) {
    const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    let added = false;
    for (const p of parts) {
      const exists = state.pantry.some((x) => Core.normalize(x) === Core.normalize(p));
      if (!exists) { state.pantry.push(p); added = true; }
    }
    if (added) pantryChanged();
  }

  function removeIngredient(i) {
    state.pantry.splice(i, 1);
    pantryChanged();
  }

  function renderPantry() {
    const chips = $('chips');
    chips.replaceChildren(...state.pantry.map((name, i) =>
      el('li', null, name,
        el('button', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => removeIngredient(i) }, '×'))));
    $('find').disabled = state.pantry.length === 0 && !$('ingredient-input').value.trim();
    $('clear').hidden = state.pantry.length === 0;
  }

  // ---- search -----------------------------------------------------------------------

  function setStatus(text, fraction) {
    $('status').hidden = !text;
    $('status-text').textContent = text || '';
    $('status-bar').style.width = Math.round((fraction || 0) * 100) + '%';
  }

  async function search() {
    if (!state.pantry.length) return;
    $('find').disabled = true;
    $('results').replaceChildren();
    setStatus('Starting…', 0);

    const pantry = state.pantry.slice();
    const useSpoon = !!state.spoonKey;
    const [mealdb, spoon] = await Promise.allSettled([
      window.MealDB.findRecipes(pantry, { onProgress: setStatus }),
      useSpoon ? window.Spoonacular.findRecipes(pantry, state.spoonKey) : Promise.resolve([]),
    ]);

    state.notices = [];
    if (mealdb.status === 'rejected') state.notices.push("TheMealDB couldn't be reached, so its recipes are missing.");
    if (spoon.status === 'rejected') {
      const e = spoon.reason || {};
      state.notices.push((e.message || "Spoonacular couldn't be reached.") +
        (e.status === 401 ? ' Check the key under Recipe sources.' : ' Only TheMealDB recipes are shown.'));
    } else if (useSpoon) {
      const left = window.Spoonacular.quotaLeft();
      if (left != null) state.notices.push(`Spoonacular points left today: ${Math.max(0, Math.floor(left))}.`);
    } else {
      state.notices.push('Add a Spoonacular key under Recipe sources to search many more recipes.');
    }

    setStatus('');
    $('find').disabled = state.pantry.length === 0;

    if (mealdb.status === 'rejected' && (spoon.status === 'rejected' || !useSpoon)) {
      $('results').replaceChildren(el('div', { class: 'card error' },
        el('strong', null, "Couldn't reach the recipe services. "),
        'Check your internet connection and try again.',
        state.notices.map((n) => el('div', { class: 'meta' }, n))));
      return;
    }

    // TheMealDB first: its recipes are complete and cost no Spoonacular points to open.
    state.recipes = Core.dedupe([
      ...(mealdb.status === 'fulfilled' ? mealdb.value : []),
      ...(spoon.status === 'fulfilled' ? spoon.value : []),
    ]);
    state.searched = true;
    state.stale = false;
    regroup();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function regroup() {
    state.groups = Core.groupRecipes(state.recipes, state.pantry, state.assumeStaples, 3);
    renderResults();
  }

  const GROUP_SUBTITLES = [
    'Everything you need is in your list.',
    'One more ingredient to buy.',
    'Two more ingredients to buy.',
    'Three more ingredients to buy.',
  ];

  function recipeCard(entry) {
    const { recipe, need, used } = entry;
    const thumb = recipe.thumb || recipe.image;
    return el('button', {
      type: 'button',
      class: 'card recipe-card',
      onclick: () => { location.hash = 'recipe/' + recipe.id; },
    },
    el('img', { src: thumb, alt: '', loading: 'lazy', onerror: (e) => { if (e.target.src !== recipe.image) e.target.src = recipe.image; } }),
    el('div', { class: 'body' },
      el('h3', null, recipe.name),
      el('div', { class: 'meta' }, `Uses ${used} of yours · ${plural(recipe.ingredients.length, 'ingredient')}`),
      need.length ? el('div', { class: 'buy' }, el('strong', null, 'Buy: '), listText(need)) : null,
      el('div', { class: 'source-tag' }, recipe.sourceName)));
  }

  function renderGroup(group) {
    const visible = group.recipes.slice(0, SHOW_PER_GROUP);
    const grid = el('div', { class: 'grid' }, visible.map(recipeCard));
    const rest = group.recipes.length - visible.length;
    const more = rest > 0 ? el('button', {
      type: 'button',
      class: 'btn secondary more',
      onclick: (e) => {
        group.recipes.slice(SHOW_PER_GROUP).forEach((r) => grid.append(recipeCard(r)));
        e.target.remove();
      },
    }, `Show ${rest} more`) : null;

    return el('section', { class: 'group', 'data-missing': group.missing },
      el('div', { class: 'group-head' },
        el('span', { class: 'badge', 'aria-hidden': 'true' }, group.missing === 0 ? '✓' : '+' + group.missing),
        el('h2', null, group.title),
        el('span', { class: 'group-sub' }, `${GROUP_SUBTITLES[group.missing]} ${plural(group.recipes.length, 'recipe')}.`)),
      group.recipes.length ? grid : el('p', { class: 'empty' }, 'No recipes in this group.'),
      more);
  }

  function renderResults() {
    if (!state.searched) return;
    const top = [];
    if (state.stale) {
      top.push(el('div', { class: 'card notice stale' },
        'Your ingredients have changed. ',
        el('button', { type: 'button', class: 'btn link inline', onclick: search }, 'Find recipes again'),
        ' to update the list.'));
    }
    if (state.notices.length) {
      top.push(el('div', { class: 'card notice' }, state.notices.map((n) => el('div', null, n))));
    }

    const total = state.groups.reduce((n, g) => n + g.recipes.length, 0);
    if (!total) {
      $('results').replaceChildren(...top, el('div', { class: 'card error' },
        el('strong', null, 'No recipes found within 3 extra ingredients. '),
        'Try adding more ingredients, or more general names, such as "chicken" rather than "chicken thighs".'));
      return;
    }
    $('results').replaceChildren(...top, ...state.groups.map(renderGroup));
  }

  // ---- recipe screen ----------------------------------------------------------------

  function entryFor(recipe) {
    const items = Core.classifyIngredients(recipe, state.pantry, state.assumeStaples);
    return { recipe, items };
  }

  function ingredientList(items, cls) {
    return el('ul', { class: 'ing ' + cls }, items.map((i) =>
      el('li', null, el('span', { class: 'name' }, i.name), el('span', { class: 'qty' }, i.measure))));
  }

  const backButton = () =>
    el('button', { type: 'button', class: 'btn secondary back', onclick: () => { location.hash = ''; } }, '← Back to recipes');

  let openToken = 0;

  async function openRecipe(id) {
    const recipe = state.recipes.find((r) => r.id === id);
    if (!recipe) { location.hash = ''; return; }
    if (recipe.complete) { renderRecipe(recipe); return; }

    const token = ++openToken;
    $('recipe-view').replaceChildren(backButton(),
      el('div', { class: 'card panel loading' }, `Loading ${recipe.name}…`));
    try {
      const full = await window.Spoonacular.completeRecipe(recipe, state.spoonKey);
      const i = state.recipes.findIndex((r) => r.id === id);
      if (i >= 0) state.recipes[i] = full;
      regroup(); // the full ingredient list can change which group it belongs in
      if (token === openToken) renderRecipe(full);
    } catch (e) {
      if (token !== openToken) return;
      renderRecipe(recipe, (e && e.message) || "Couldn't load this recipe's method.");
    }
  }

  function renderRecipe(recipe, loadError) {
    const view = $('recipe-view');
    const { items } = entryFor(recipe);
    const have = items.filter((i) => i.status === 'have');
    const need = items.filter((i) => i.status === 'need');
    const basics = items.filter((i) => i.status === 'staple');
    const steps = recipe.steps || [];
    const done = new Set(load('done:' + recipe.id, []));

    const copyBtn = need.length ? el('button', {
      type: 'button',
      class: 'btn secondary copy',
      onclick: async (e) => {
        const text = need.map((i) => `- ${i.name}${i.measure ? ' (' + i.measure + ')' : ''}`).join('\n');
        try { await navigator.clipboard.writeText(`Shopping list for ${recipe.name}:\n${text}`); e.target.textContent = 'Copied'; }
        catch (_) { e.target.textContent = "Couldn't copy"; }
        setTimeout(() => { e.target.textContent = 'Copy shopping list'; }, 1800);
      },
    }, 'Copy shopping list') : null;

    let method;
    if (loadError) {
      method = el('div', null,
        el('p', { class: 'empty' }, loadError),
        el('button', { type: 'button', class: 'btn secondary', onclick: () => openRecipe(recipe.id) }, 'Try again'));
    } else if (steps.length) {
      method = el('ol', { class: 'steps' }, steps.map((text, i) =>
        el('li', null, el('label', null,
          el('input', {
            type: 'checkbox',
            checked: done.has(i),
            onchange: (e) => {
              e.target.checked ? done.add(i) : done.delete(i);
              save('done:' + recipe.id, [...done]);
            },
          }),
          el('span', null, text)))));
    } else {
      method = el('p', { class: 'empty' }, 'This recipe has no written method. Try the original recipe link.');
    }

    view.replaceChildren(
      backButton(),

      el('div', { class: 'card hero' }, el('div', { class: 'hero-inner' },
        el('img', { src: recipe.image, alt: recipe.name }),
        el('div', { class: 'hero-text' },
          el('h2', null, recipe.name),
          el('div', { class: 'meta' }, [recipe.area, recipe.category, ...recipe.tags].filter(Boolean).join(' · ')),
          el('ul', { class: 'stats' },
            el('li', null, el('strong', null, items.length), 'ingredients'),
            el('li', null, el('strong', null, have.length), 'you have'),
            el('li', null, el('strong', null, need.length), 'to buy'),
            el('li', null, el('strong', null, steps.length), steps.length === 1 ? 'step' : 'steps')),
          el('div', { class: 'meta from' }, 'From ' + recipe.sourceName),
          el('div', { class: 'links' },
            recipe.source ? el('a', { href: recipe.source, target: '_blank', rel: 'noopener' }, 'Original recipe ↗') : null,
            recipe.youtube ? el('a', { href: recipe.youtube, target: '_blank', rel: 'noopener' }, 'Video ↗') : null)))),

      el('div', { class: 'detail-grid' },
        el('section', { class: 'card panel' },
          el('h3', null, 'Ingredients'),
          need.length ? [el('h4', null, `To buy (${need.length})`), ingredientList(need, 'need'), copyBtn] : null,
          have.length ? [el('h4', null, `You have (${have.length})`), ingredientList(have, 'have')] : null,
          basics.length ? [el('h4', null, `Basics (${basics.length})`), ingredientList(basics, 'staple')] : null),

        el('section', { class: 'card panel' },
          el('h3', null, 'Method'),
          steps.length && !loadError ? el('p', { class: 'steps-note' }, 'Tick each step off as you go.') : null,
          method)));
  }

  // ---- routing ----------------------------------------------------------------------

  function route() {
    const m = location.hash.match(/^#recipe\/(.+)$/);
    const showRecipe = !!m && state.recipes.length > 0;
    $('search-view').hidden = showRecipe;
    $('recipe-view').hidden = !showRecipe;
    if (showRecipe) {
      openRecipe(decodeURIComponent(m[1]));
      window.scrollTo(0, 0);
    } else {
      openToken++;
      if (m) history.replaceState(null, '', location.pathname); // stale link after a reload
    }
  }

  // ---- wire up ----------------------------------------------------------------------

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addIngredients($('ingredient-input').value);
    $('ingredient-input').value = '';
    $('ingredient-input').focus();
    renderPantry();
  });
  $('ingredient-input').addEventListener('input', (e) => {
    if (e.target.value.includes(',')) {
      const parts = e.target.value.split(',');
      e.target.value = parts.pop();
      addIngredients(parts.join(','));
    }
    renderPantry();
  });
  $('find').addEventListener('click', () => {
    const pending = $('ingredient-input').value.trim();
    if (pending) { $('ingredient-input').value = ''; addIngredients(pending); }
    search();
  });
  $('clear').addEventListener('click', () => {
    state.pantry = [];
    save('pantry', state.pantry);
    state.searched = false;
    state.stale = false;
    renderPantry();
    $('results').replaceChildren();
  });
  $('staples').checked = state.assumeStaples;
  $('staples').addEventListener('change', (e) => {
    state.assumeStaples = e.target.checked;
    save('staples', state.assumeStaples);
    if (state.searched) regroup();
  });
  $('save-key').addEventListener('click', saveKey);
  $('spoon-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } });
  $('remove-key').addEventListener('click', removeKey);
  window.addEventListener('hashchange', route);

  renderSources();
  renderPantry();
  route();
})();

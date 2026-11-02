/* Screens and interaction for the recipe finder. */
(function () {
  'use strict';

  const Core = window.RecipeCore;
  const $ = (id) => document.getElementById(id);
  const SHOW_PER_GROUP = 12;

  const state = {
    pantry: load('pantry', []),
    assumeStaples: load('staples', true),
    recipes: [],   // full recipes from the last search
    groups: [],
    searched: false,
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

  // ---- pantry -----------------------------------------------------------------------

  function addIngredients(text) {
    const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const exists = state.pantry.some((x) => Core.normalize(x) === Core.normalize(p));
      if (!exists) state.pantry.push(p);
    }
    save('pantry', state.pantry);
    renderPantry();
  }

  function removeIngredient(i) {
    state.pantry.splice(i, 1);
    save('pantry', state.pantry);
    renderPantry();
    if (state.searched) regroup();
  }

  function renderPantry() {
    const chips = $('chips');
    chips.replaceChildren(...state.pantry.map((name, i) =>
      el('li', null, name,
        el('button', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => removeIngredient(i) }, '×'))));
    $('find').disabled = state.pantry.length === 0;
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
    try {
      state.recipes = await window.MealDB.findRecipes(state.pantry.slice(), { onProgress: setStatus });
      state.searched = true;
      regroup();
      setStatus('');
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setStatus('');
      $('results').replaceChildren(el('div', { class: 'card error' },
        el('strong', null, "Couldn't reach the recipe service. "),
        'Check your internet connection and try again.',
        el('div', { class: 'meta' }, String(err && err.message || err))));
    } finally {
      $('find').disabled = state.pantry.length === 0;
    }
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
    return el('button', {
      type: 'button',
      class: 'card recipe-card',
      onclick: () => { location.hash = 'recipe/' + recipe.id; },
    },
    el('img', { src: recipe.image + '/medium', alt: '', loading: 'lazy', onerror: (e) => { e.target.src = recipe.image; } }),
    el('div', { class: 'body' },
      el('h3', null, recipe.name),
      el('div', { class: 'meta' }, `Uses ${used} of yours · ${plural(recipe.ingredients.length, 'ingredient')}`),
      need.length ? el('div', { class: 'buy' }, el('strong', null, 'Buy: '), listText(need)) : null));
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
    const total = state.groups.reduce((n, g) => n + g.recipes.length, 0);
    if (!total) {
      $('results').replaceChildren(el('div', { class: 'card error' },
        el('strong', null, 'No recipes found within 3 extra ingredients. '),
        'Try adding more ingredients, or more general names, such as "chicken" rather than "chicken thighs".'));
      return;
    }
    $('results').replaceChildren(...state.groups.map(renderGroup));
  }

  // ---- recipe screen ----------------------------------------------------------------

  function findEntry(id) {
    for (const g of state.groups) {
      const hit = g.recipes.find((r) => r.recipe.id === id);
      if (hit) return hit;
    }
    const recipe = state.recipes.find((r) => r.id === id);
    if (!recipe) return null;
    const items = Core.classifyIngredients(recipe, state.pantry, state.assumeStaples);
    return { recipe, items, need: items.filter((i) => i.status === 'need'), used: items.filter((i) => i.status === 'have').length };
  }

  function ingredientList(items, cls) {
    return el('ul', { class: 'ing ' + cls }, items.map((i) =>
      el('li', null, el('span', { class: 'name' }, i.name), el('span', { class: 'qty' }, i.measure))));
  }

  function renderRecipe(id) {
    const entry = findEntry(id);
    const view = $('recipe-view');
    if (!entry) { location.hash = ''; return; }
    const { recipe, items } = entry;
    const have = items.filter((i) => i.status === 'have');
    const need = items.filter((i) => i.status === 'need');
    const basics = items.filter((i) => i.status === 'staple');
    const steps = Core.splitSteps(recipe.instructions);
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

    view.replaceChildren(
      el('button', { type: 'button', class: 'btn secondary back', onclick: () => { location.hash = ''; } }, '← Back to recipes'),

      el('div', { class: 'card hero' }, el('div', { class: 'hero-inner' },
        el('img', { src: recipe.image, alt: recipe.name }),
        el('div', { class: 'hero-text' },
          el('h2', null, recipe.name),
          el('div', { class: 'meta' }, [recipe.area, recipe.category, ...recipe.tags].filter(Boolean).join(' · ')),
          el('ul', { class: 'stats' },
            el('li', null, el('strong', null, items.length), 'ingredients'),
            el('li', null, el('strong', null, have.length), 'you have'),
            el('li', null, el('strong', null, need.length), 'to buy'),
            el('li', null, el('strong', null, steps.length), plural(steps.length, 'step').replace(/^\d+ /, ''))),
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
          el('p', { class: 'steps-note' }, 'Tick each step off as you go.'),
          steps.length
            ? el('ol', { class: 'steps' }, steps.map((text, i) =>
              el('li', null, el('label', null,
                el('input', {
                  type: 'checkbox',
                  checked: done.has(i),
                  onchange: (e) => {
                    e.target.checked ? done.add(i) : done.delete(i);
                    save('done:' + recipe.id, [...done]);
                  },
                }),
                el('span', null, text)))))
            : el('p', { class: 'empty' }, 'This recipe has no written method. Try the original recipe link.'))));
  }

  // ---- routing ----------------------------------------------------------------------

  function route() {
    const m = location.hash.match(/^#recipe\/(.+)$/);
    const showRecipe = !!m && state.recipes.length > 0;
    $('search-view').hidden = showRecipe;
    $('recipe-view').hidden = !showRecipe;
    if (showRecipe) {
      renderRecipe(decodeURIComponent(m[1]));
      window.scrollTo(0, 0);
    } else if (m) {
      history.replaceState(null, '', location.pathname); // stale link after a reload
    }
  }

  // ---- wire up ----------------------------------------------------------------------

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addIngredients($('ingredient-input').value);
    $('ingredient-input').value = '';
    $('ingredient-input').focus();
  });
  $('ingredient-input').addEventListener('input', (e) => {
    $('find').disabled = !state.pantry.length && !e.target.value.trim();
    if (e.target.value.includes(',')) {
      const parts = e.target.value.split(',');
      e.target.value = parts.pop();
      addIngredients(parts.join(','));
    }
  });
  $('find').addEventListener('click', () => {
    const pending = $('ingredient-input').value.trim();
    if (pending) { addIngredients(pending); $('ingredient-input').value = ''; }
    search();
  });
  $('clear').addEventListener('click', () => {
    state.pantry = [];
    save('pantry', state.pantry);
    renderPantry();
    $('results').replaceChildren();
    state.searched = false;
  });
  $('staples').checked = state.assumeStaples;
  $('staples').addEventListener('change', (e) => {
    state.assumeStaples = e.target.checked;
    save('staples', state.assumeStaples);
    if (state.searched) regroup();
  });
  window.addEventListener('hashchange', route);

  renderPantry();
  route();
})();

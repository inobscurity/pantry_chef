/* Screens and interaction for the recipe finder. */
(function () {
  'use strict';

  const Core = window.RecipeCore;
  const $ = (id) => document.getElementById(id);
  const SHOW_PER_GROUP = 12;

  const state = {
    pantry: load('pantry', []),
    basics: load('basics', Core.DEFAULT_BASICS.slice()),
    spoonKey: load('spoonKey', ''),
    main: load('main', ''),  // the ingredient chosen as the main one; only recipes using it are shown
    courses: load('courses', Core.DEFAULT_COURSES.slice()), // which courses are shown: mains and soups at first
    recipes: [],   // recipes from the last search, from every source
    groups: [],
    found: [],     // per source: { name, count } or { name, error }
    notices: [],
    searched: false,
    stale: false,  // ingredients changed since the last search
  };

  // The old on/off switch for basics: off meant no basics.
  if (load('staples', true) === false && load('basics', null) === null) state.basics = [];

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
    const names = items.map((i) => Core.shortName(i.name).toLowerCase());
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  function splitList(text) {
    return text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  }

  function chipList(items, onRemove, label) {
    return items.map((name, i) =>
      el('li', null, name,
        el('button', { type: 'button', 'aria-label': `Remove ${name}${label}`, onclick: () => onRemove(i) }, '×')));
  }

  // A recipe photo, or the app's pot when a source has none.
  function picture(src, alt, cls) {
    if (!src) return el('div', { class: 'no-photo ' + (cls || ''), role: 'img', 'aria-label': alt || 'No photo' });
    return el('img', {
      src, alt: alt || '', loading: 'lazy', class: cls || null,
      onerror: (e) => e.target.replaceWith(el('div', { class: 'no-photo ' + (cls || '') })),
    });
  }

  // ---- recipe sources ---------------------------------------------------------------

  function renderSources() {
    const on = !!state.spoonKey;
    $('sources-summary').textContent = on ? '5 sources, including Spoonacular' : '4 free sources';
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
    $('key-msg').textContent = 'Removed. Spoonacular will no longer be searched.';
  }

  // ---- basics -----------------------------------------------------------------------

  function renderBasics() {
    $('basics-chips').replaceChildren(...chipList(state.basics, removeBasic, ' from basics'));
    $('basics-summary').textContent = state.basics.length ? state.basics.join(', ') : 'none';
  }

  function basicsChanged() {
    save('basics', state.basics);
    renderBasics();
    if (state.searched) regroup();
  }

  function addBasics(text) {
    for (const b of splitList(text)) {
      if (!state.basics.some((x) => Core.normalize(x) === Core.normalize(b))) state.basics.push(b);
    }
    basicsChanged();
  }

  function removeBasic(i) {
    state.basics.splice(i, 1);
    basicsChanged();
  }

  // ---- pantry -----------------------------------------------------------------------

  function pantryChanged() {
    save('pantry', state.pantry);
    renderPantry();
    if (state.searched) { state.stale = true; renderResults(); }
  }

  function addIngredients(text) {
    let added = false;
    for (const p of splitList(text)) {
      const exists = state.pantry.some((x) => Core.normalize(x) === Core.normalize(p));
      if (!exists) { state.pantry.push(p); added = true; }
    }
    if (added) pantryChanged();
  }

  function removeIngredient(i) {
    if (Core.normalize(state.pantry[i]) === Core.normalize(state.main)) setMain('');
    state.pantry.splice(i, 1);
    pantryChanged();
  }

  // Tap an ingredient to make it the main one; tap it again to clear it.
  function setMain(name) {
    state.main = name;
    if (name) save('main', name); else forget('main');
  }

  function toggleMain(name) {
    setMain(Core.normalize(state.main) === Core.normalize(name) ? '' : name);
    renderPantry();
    if (state.searched) regroup(); // the search covers every ingredient, so no new search is needed
  }

  function renderPantry() {
    if (state.main && !state.pantry.some((p) => Core.normalize(p) === Core.normalize(state.main))) setMain('');
    const isMain = (name) => state.main && Core.normalize(name) === Core.normalize(state.main);
    $('chips').replaceChildren(...state.pantry.map((name, i) =>
      el('li', { class: isMain(name) ? 'main' : null },
        el('button', {
          type: 'button',
          class: 'chip-name',
          'aria-pressed': isMain(name) ? 'true' : 'false',
          title: isMain(name) ? 'Main ingredient. Tap to clear.' : 'Tap to make this the main ingredient',
          onclick: () => toggleMain(name),
        }, isMain(name) ? '★ ' : '', name),
        el('button', { type: 'button', 'aria-label': `Remove ${name}`, onclick: () => removeIngredient(i) }, '×'))));
    $('main-hint').textContent = state.main
      ? `Only recipes with ${state.main} are shown. Tap it again to show all.`
      : 'Tap an ingredient to make it the main one: only recipes using it will be shown.';
    $('main-hint').hidden = state.pantry.length === 0;
    $('find').disabled = state.pantry.length === 0 && !$('ingredient-input').value.trim();
    $('clear').hidden = state.pantry.length === 0;
  }

  // ---- search -----------------------------------------------------------------------

  function setStatus(text, fraction) {
    $('status').hidden = !text;
    $('status-text').textContent = text || '';
    $('status-bar').style.width = Math.round((fraction || 0) * 100) + '%';
  }

  function sources() {
    // Order matters for duplicates: the first source's version of a recipe is kept.
    const list = [
      { name: 'TheMealDB', find: (p) => window.MealDB.findRecipes(p, { onProgress: setStatus }) },
      { name: 'Wikibooks Cookbook', find: (p) => window.Wikibooks.findRecipes(p) },
      { name: 'ForkRecipe', find: (p) => window.ForkRecipe.findRecipes(p) },
      { name: 'Classic cookbooks', find: (p) => window.Books.findRecipes(p, { pantry: state.pantry, basics: state.basics }) },
    ];
    if (state.spoonKey) list.push({ name: 'Spoonacular', find: (p) => window.Spoonacular.findRecipes(p, state.spoonKey) });
    return list;
  }

  async function search() {
    if (!state.pantry.length) return;
    $('find').disabled = true;
    $('results').replaceChildren();
    setStatus('Searching recipes…', 0.02);

    // Search with your main ingredients: salt, butter and basics would otherwise pull in
    // every recipe that happens to use them.
    // Always search with all your main ingredients, so recipes that use more of yours are found.
    // The main ingredient, if chosen, only filters what's shown (in regroup), so it never finds
    // fewer recipes than a search without it.
    const mains = Core.mainIngredients(state.pantry, state.basics);
    if (state.main && !mains.some((m) => Core.normalize(m) === Core.normalize(state.main))) mains.unshift(state.main);
    const list = sources();
    const results = await Promise.allSettled(list.map((s) => s.find(mains)));

    state.notices = [];
    state.found = list.map((s, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') return { name: s.name, recipes: r.value };
      const e = r.reason || {};
      let error = e.message || "couldn't be reached";
      if (s.name === 'Spoonacular' && e.status === 401) error += ' Check the key under Recipe sources.';
      return { name: s.name, error };
    });
    if (!state.spoonKey) state.notices.push('Add a Spoonacular key under Recipe sources to search more recipes from food websites and blogs.');
    const left = state.spoonKey && window.Spoonacular.quotaLeft();
    if (left != null && left !== '' && left !== false) state.notices.push(`Spoonacular points left today: ${Math.max(0, Math.floor(left))}.`);

    setStatus('');
    $('find').disabled = state.pantry.length === 0;

    if (state.found.every((f) => f.error)) {
      $('results').replaceChildren(el('div', { class: 'card error' },
        el('strong', null, "Couldn't reach any recipe source. "),
        'Check your internet connection and try again.',
        state.found.map((f) => el('div', { class: 'meta' }, `${f.name}: ${f.error}`))));
      return;
    }

    state.recipes = Core.dedupe(state.found.flatMap((f) => f.recipes || []));
    state.searched = true;
    state.stale = false;
    regroup();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function regroup() {
    state.groups = Core.groupRecipes(state.recipes, state.pantry, state.basics, 3, { main: state.main });
    renderResults();
  }

  const GROUP_SUBTITLES = [
    'Everything you need is in your list or your basics.',
    'One more ingredient to buy.',
    'Two more ingredients to buy.',
    'Three more ingredients to buy.',
  ];

  function recipeCard(entry) {
    const { recipe, need, usedYours } = entry;
    return el('button', {
      type: 'button',
      class: 'card recipe-card',
      onclick: () => { location.hash = 'recipe/' + encodeURIComponent(recipe.id); },
    },
    picture(recipe.thumb || recipe.image, '', 'thumb'),
    el('div', { class: 'body' },
      el('h3', null, recipe.name),
      el('div', { class: 'meta' }, `Uses ${usedYours} of your ${state.pantry.length} · ${plural(recipe.ingredients.length, 'ingredient')}`),
      need.length ? el('div', { class: 'buy' }, el('strong', null, 'Buy: '), listText(need)) : null,
      el('div', { class: 'source-tag' }, `${courseLabel(courseOf(recipe))} · ${recipe.sourceName}`)));
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

  // "Searched: TheMealDB 4 · Wikibooks Cookbook 7 · ForkRecipe 12 · Spoonacular failed"
  // ---- courses ----------------------------------------------------------------------

  const courseCache = new WeakMap();
  function courseOf(recipe) {
    if (!courseCache.has(recipe)) courseCache.set(recipe, Core.courseOf(recipe));
    return courseCache.get(recipe);
  }
  const COURSE_LABEL = { main: 'Main', soup: 'Soup', side: 'Side', starter: 'Starter', sauce: 'Sauce or extra', dessert: 'Dessert or baking', other: 'Other' };
  const courseLabel = (id) => COURSE_LABEL[id] || '';

  // The groups, with only the courses you've chosen.
  function visibleGroups() {
    return state.groups.map((g) => Object.assign({}, g, { recipes: g.recipes.filter((e) => state.courses.includes(courseOf(e.recipe))) }));
  }

  function toggleCourse(id) {
    state.courses = state.courses.includes(id) ? state.courses.filter((c) => c !== id) : [...state.courses, id];
    save('courses', state.courses);
    renderResults();
  }

  // "Show: [Mains 24] [Soups 3] [Sides 40] …": mains and soups are on at first.
  function courseButtons() {
    const counts = new Map();
    for (const g of state.groups) for (const e of g.recipes) counts.set(courseOf(e.recipe), (counts.get(courseOf(e.recipe)) || 0) + 1);
    return el('div', { class: 'card notice courses' },
      el('div', null, el('strong', null, 'Show'), ' (tap to choose):'),
      el('div', { class: 'course-buttons' }, Core.COURSES.map((c) => {
        const on = state.courses.includes(c.id);
        return el('button', {
          type: 'button',
          class: 'course' + (on ? ' on' : ''),
          'aria-pressed': on ? 'true' : 'false',
          onclick: () => toggleCourse(c.id),
        }, c.label, el('span', { class: 'count' }, String(counts.get(c.id) || 0)));
      })));
  }

  function searchedLine(groups) {
    const shown = new Map();
    for (const g of groups) {
      for (const r of g.recipes) {
        const key = r.recipe.sourceGroup || r.recipe.sourceName;
        shown.set(key, (shown.get(key) || 0) + 1);
      }
    }
    const parts = state.found.map((f) => {
      if (f.error) return el('li', { class: 'failed' }, `${f.name}: ${f.error}`);
      return el('li', null, `${f.name}: ${plural(shown.get(f.name) || 0, 'recipe')}`);
    });
    return el('div', { class: 'card notice searched' },
      el('div', null, el('strong', null, 'Searched'), ' (recipes within 3 extra ingredients):'),
      el('ul', null, parts),
      state.notices.map((n) => el('div', null, n)));
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
    const groups = visibleGroups();
    top.push(searchedLine(groups));
    top.push(courseButtons());
    if (state.main) {
      top.push(el('div', { class: 'card notice stale' },
        el('div', null,
          el('strong', null, `★ ${state.main}`), ': only recipes using it are shown. ',
          el('button', { type: 'button', class: 'btn link inline', onclick: () => toggleMain(state.main) }, 'Show all'))));
    }

    const total = groups.reduce((n, g) => n + g.recipes.length, 0);
    const hidden = state.groups.reduce((n, g) => n + g.recipes.length, 0) - total;
    if (!total) {
      $('results').replaceChildren(...top, el('div', { class: 'card error' },
        hidden
          ? [el('strong', null, `No recipes of the kinds you've chosen. `), `${plural(hidden, 'other recipe')} matched: tap a kind above to see them.`]
          : [el('strong', null, 'No recipes found within 3 extra ingredients. '),
            'Try adding more ingredients or basics, or more general names, such as "chicken" rather than "chicken thighs".',
            state.main ? ` Or clear ${state.main} as the main ingredient.` : '']));
      return;
    }
    $('results').replaceChildren(...top, ...groups.map(renderGroup));
  }

  // ---- recipe screen ----------------------------------------------------------------

  function ingredientList(items, cls) {
    return el('ul', { class: 'ing ' + cls }, items.map((i) =>
      el('li', null, el('span', { class: 'name' }, i.name), el('span', { class: 'qty' }, i.measure))));
  }

  const backButton = () =>
    el('button', { type: 'button', class: 'btn secondary back', onclick: () => { location.hash = ''; } }, '← Back to recipes');

  let openToken = 0;

  const linked = new Map(); // recipes opened by following a link, not part of the results

  async function openRecipe(id) {
    const token = ++openToken;
    let recipe = state.recipes.find((r) => r.id === id) || linked.get(id);
    if (!recipe && /^book-/.test(id)) {
      $('recipe-view').replaceChildren(backButton(), el('div', { class: 'card panel loading' }, 'Loading…'));
      try { recipe = await window.Books.recipeById(id); } catch (_) { recipe = null; }
      if (token !== openToken) return;
      if (recipe) linked.set(id, recipe);
    }
    if (!recipe) { location.hash = ''; return; }
    if (recipe.complete) { renderRecipe(recipe); return; }

    $('recipe-view').replaceChildren(backButton(),
      el('div', { class: 'card panel loading' }, `Loading ${recipe.name}…`));
    try {
      const full = recipe.completeWith === 'books'
        ? await window.Books.completeRecipe(recipe)
        : await window.Spoonacular.completeRecipe(recipe, state.spoonKey);
      const i = state.recipes.findIndex((r) => r.id === id);
      if (i >= 0) {
        state.recipes[i] = full;
        regroup(); // the full ingredient list can change which group it belongs in
      } else {
        linked.set(id, full);
      }
      if (token === openToken) renderRecipe(full);
    } catch (e) {
      if (token !== openToken) return;
      renderRecipe(recipe, (e && e.message) || "Couldn't load this recipe's method.");
    }
  }

  function renderRecipe(recipe, loadError) {
    const view = $('recipe-view');
    const items = Core.classifyIngredients(recipe, state.pantry, state.basics);
    const by = (s) => items.filter((i) => i.status === s);
    const have = by('have');
    const need = by('need');
    const basics = by('staple');
    const optional = by('optional');
    const fromRecipes = by('recipe');
    const openLink = (link) => el('a', { href: '#recipe/' + encodeURIComponent(link.id), class: 'recipe-link' }, link.name);
    // "Boil the carrots in white broth ⟦12⟧" → "… white broth (see Bouillon Blanc)"
    const stepText = (text) => text.split(/\u27e6(\d+)\u27e7/).map((part, i) => {
      if (i % 2 === 0) return part;
      const link = recipe.links && recipe.links[part];
      return link ? el('span', null, '(see ', openLink(link), ')') : '';
    });
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
          el('span', null, stepText(text))))));
    } else {
      method = el('p', { class: 'empty' }, 'This recipe has no written method. Try the original recipe link.');
    }

    const credit = recipe.credit ? el('p', { class: 'credit' },
      recipe.credit.text + ' ',
      recipe.source ? el('a', { href: recipe.source, target: '_blank', rel: 'noopener' }, 'Original') : null,
      recipe.credit.licenceUrl
        ? [' · Licensed ', el('a', { href: recipe.credit.licenceUrl, target: '_blank', rel: 'noopener' }, recipe.credit.licence)]
        : ` · ${recipe.credit.licence}`,
      recipe.sourceName === 'ForkRecipe' ? '. Not affiliated with ForkRecipe.' : '.') : null;

    view.replaceChildren(
      backButton(),

      el('div', { class: 'card hero' + (recipe.image ? '' : ' no-image') }, el('div', { class: 'hero-inner' },
        recipe.image ? picture(recipe.image, recipe.name) : null,
        el('div', { class: 'hero-text' },
          el('h2', null, recipe.name),
          el('div', { class: 'meta' }, [courseLabel(courseOf(recipe)), recipe.area, recipe.category, ...recipe.tags].filter(Boolean).join(' · ')),
          el('ul', { class: 'stats' },
            el('li', null, el('strong', null, items.length), 'ingredients'),
            el('li', null, el('strong', null, have.length), 'you have'),
            el('li', null, el('strong', null, need.length), 'to buy'),
            el('li', null, el('strong', null, steps.length), steps.length === 1 ? 'step' : 'steps')),
          el('div', { class: 'meta from' }, 'From ' + recipe.sourceName),
          el('div', { class: 'links' },
            recipe.source ? el('a', { href: recipe.source, target: '_blank', rel: 'noopener' }, recipe.sourceLabel || 'Original recipe ↗') : null,
            recipe.youtube ? el('a', { href: recipe.youtube, target: '_blank', rel: 'noopener' }, 'Video ↗') : null)))),

      el('div', { class: 'detail-grid' },
        el('section', { class: 'card panel' },
          el('h3', null, 'Ingredients'),
          recipe.note ? el('p', { class: 'steps-note' }, recipe.note) : null,
          need.length ? [el('h4', null, `To buy (${need.length})`), ingredientList(need, 'need'), copyBtn] : null,
          have.length ? [el('h4', null, `You have (${have.length})`), ingredientList(have, 'have')] : null,
          basics.length ? [el('h4', null, `Your basics (${basics.length})`), ingredientList(basics, 'staple')] : null,
          optional.length ? [el('h4', null, `Optional (${optional.length})`), ingredientList(optional, 'optional')] : null,
          fromRecipes.length ? [
            el('h4', null, `Made from other recipes (${fromRecipes.length})`),
            el('ul', { class: 'ing recipe' }, fromRecipes.map((i) => el('li', null,
              el('span', { class: 'name' }, i.name, ': ', openLink(i.subRecipe)),
              el('span', { class: 'qty' }, i.measure)))),
            el('p', { class: 'steps-note' }, "These are made with their own recipe from the same book. Their ingredients aren't counted above."),
          ] : null),

        el('section', { class: 'card panel' },
          el('h3', null, 'Method'),
          steps.length && !loadError ? el('p', { class: 'steps-note' }, 'Tick each step off as you go.') : null,
          method)),
      credit);
  }

  // ---- routing ----------------------------------------------------------------------

  function route() {
    const m = location.hash.match(/^#recipe\/(.+)$/);
    const showRecipe = !!m && (state.recipes.length > 0 || /^#recipe\/book-/.test(location.hash));
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
    setMain('');
    state.pantry = [];
    save('pantry', state.pantry);
    state.searched = false;
    state.stale = false;
    renderPantry();
    $('results').replaceChildren();
  });
  const addBasicFromInput = () => {
    addBasics($('basic-input').value);
    $('basic-input').value = '';
  };
  $('add-basic').addEventListener('click', addBasicFromInput);
  $('basic-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addBasicFromInput(); } });
  $('reset-basics').addEventListener('click', () => { state.basics = Core.DEFAULT_BASICS.slice(); basicsChanged(); });
  $('save-key').addEventListener('click', saveKey);
  $('spoon-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } });
  $('remove-key').addEventListener('click', removeKey);
  window.addEventListener('hashchange', route);

  renderSources();
  renderBasics();
  renderPantry();
  route();
})();

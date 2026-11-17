// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
global.self = global;
const Core = require('../js/core.js');
global.RecipeCore = Core;
const Wiki = require('../js/wikibooks.js');
const My = require('../js/myrecipes.js');

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const parseIngredient = Wiki._internal.parseIngredient;
const details = {
  n: 'Pumpkin Soup', u: 'https://www.recipetineats.com/pumpkin-soup/', h: 'recipetineats.com', p: 'https://img.example/soup.jpg',
  i: ['1.2 kg butternut pumpkin, peeled and chopped', '1 onion, chopped', '3 cups chicken stock', '1/2 cup sour cream', 'Salt and pepper'],
  s: ['Put the pumpkin, onion and stock in a pot.', 'Simmer for 15 minutes, then blend.', 'Stir in the sour cream.'],
  c: 'Soup', y: '4', t: 'PT30M',
};

test('a recipe from the bookmark is checked, tidied and saved', () => {
  const storage = memory();
  const saved = My.save(details, { storage, parseIngredient });
  assert.equal(saved.name, 'Pumpkin Soup');
  assert.deepEqual(saved.ingredients.slice(0, 3).map((i) => [i.name, i.measure]),
    [['Butternut pumpkin, peeled and chopped', '1.2 kg'], ['Onion, chopped', '1'], ['Chicken stock', '3 cups']]);
  assert.equal(saved.time, '30 min');
  assert.equal(My.all(storage).length, 1);
  My.save(details, { storage, parseIngredient });            // saving the same page again replaces it
  assert.equal(My.all(storage).length, 1);
  const r = My.all(storage)[0];
  assert.equal(r.sourceGroup, 'My recipes');
  assert.equal(Core.courseOf(r), 'soup');
  My.remove(r.id, storage);
  assert.equal(My.all(storage).length, 0);
});

test('only http(s) addresses are kept, and a page without ingredients is refused', () => {
  const storage = memory();
  const bad = My.save(Object.assign({}, details, { u: 'javascript:alert(1)', p: 'data:image/png;base64,xx' }), { storage, parseIngredient });
  assert.equal(bad.url, '');
  assert.equal(bad.image, '');
  assert.equal(My.save({ n: 'Nothing', i: [] }, { storage }), null);
  assert.equal(My.save('not an object', { storage }), null);
});

test('saved recipes join searches and follow the rules', async () => {
  const storage = memory();
  My.save(details, { storage, parseIngredient });
  const pantry = ['pumpkin', 'onion', 'chicken stock', 'sour cream'];
  const found = await My.findRecipes(Core.mainIngredients(pantry, Core.DEFAULT_BASICS), { storage });
  const groups = Core.groupRecipes(found, pantry, Core.DEFAULT_BASICS, 3);
  assert.deepEqual(groups[0].recipes.map((e) => e.recipe.name), ['Pumpkin Soup']); // make it now
});

test('times read as hours and minutes', () => {
  assert.equal(My._internal.duration('PT1H30M'), '1 hr 30 min');
  assert.equal(My._internal.duration('PT45M'), '45 min');
  assert.equal(My._internal.duration('P0DT2H'), '2 hr');
  assert.equal(My._internal.duration(''), '');
});

test('the bookmark is a javascript: link that opens Pantry Chef', () => {
  const href = My.bookmarkHref('https://inobscurity.github.io/pantry_chef/');
  assert.match(href, /^javascript:/);
  const code = decodeURIComponent(href.slice('javascript:'.length));
  assert.ok(code.includes('"https://inobscurity.github.io/pantry_chef/"'));
  assert.ok(!code.includes('__APP__'));
  assert.doesNotThrow(() => new Function(code)); // it's valid code
});

test('the Android app gets reader code that returns the recipe as JSON text', () => {
  const code = My.extractorCode();
  assert.doesNotThrow(() => new Function('return ' + code));
  assert.match(code, /JSON\.stringify\(d\)/);
});

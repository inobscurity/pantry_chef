// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Spoon = require('../js/spoonacular.js');

function fakeFetch(routes, calls) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    const [status, body, headers] = routes(u);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (headers || {})[h.toLowerCase()] ?? null },
      json: async () => body,
    };
  };
}

const search = [{
  id: 101, title: 'Chicken Rice Bowl', image: 'https://img.spoonacular.com/recipes/101-312x231.jpg',
  usedIngredientCount: 2, missedIngredientCount: 1,
  usedIngredients: [{ id: 5006, name: 'chicken breast', amount: 2, unitShort: '' }, { id: 20444, name: 'rice', amount: 1, unitShort: 'cup' }],
  missedIngredients: [{ id: 11215, name: 'garlic', amount: 3, unitShort: 'cloves' }],
}];

const info = {
  id: 101, title: 'Chicken Rice Bowl', image: 'https://img.spoonacular.com/recipes/101-556x370.jpg',
  servings: 2, readyInMinutes: 25, sourceName: 'Example Kitchen', sourceUrl: 'https://example.com/bowl',
  cuisines: ['Asian'], dishTypes: ['lunch'], diets: [],
  extendedIngredients: [
    { id: 5006, name: 'chicken breast', nameClean: 'chicken breast', amount: 2, unit: '', measures: { metric: { amount: 2, unitShort: '' } } },
    { id: 20444, name: 'rice', nameClean: 'rice', amount: 1, unit: 'cup', measures: { metric: { amount: 236.588, unitShort: 'ml' } } },
    { id: 11215, name: 'garlic', nameClean: 'garlic', amount: 3, unit: 'cloves', measures: { metric: { amount: 3, unitShort: 'cloves' } } },
  ],
  analyzedInstructions: [
    { name: '', steps: [{ number: 1, step: 'Cook the rice.' }, { number: 2, step: 'Fry the chicken with garlic.' }] },
    { name: 'to serve', steps: [{ number: 1, step: 'Spoon into bowls.' }] },
  ],
};

test('search marks used and missed ingredients, and keeps the key out of the cache', async () => {
  const calls = [];
  const fetchImpl = fakeFetch((u) => {
    assert.equal(u.pathname, '/recipes/findByIngredients');
    assert.equal(u.searchParams.get('ingredients'), 'chicken,rice');
    assert.equal(u.searchParams.get('apiKey'), 'KEY');
    return [200, search, { 'x-api-quota-left': '148.4' }];
  }, calls);
  const recipes = await Spoon.findRecipes(['chicken', 'rice'], 'KEY', { fetchImpl });
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].id, 'spoon-101');
  assert.deepEqual(recipes[0].ingredients.map((i) => [i.name, i.have]),
    [['Chicken breast', true], ['Rice', true], ['Garlic', false]]);
  assert.equal(Spoon.quotaLeft(), 148.4);

  await Spoon.findRecipes(['chicken', 'rice'], 'KEY', { fetchImpl });
  assert.equal(calls.length, 1, 'second identical search comes from the cache');
});

test('opening a recipe adds metric quantities and steps', async () => {
  const calls = [];
  const fetchImpl = fakeFetch((u) => [200, info], calls);
  const [recipe] = await Spoon.findRecipes(['chicken', 'rice'], 'KEY', { fetchImpl: fakeFetch(() => [200, search], []) });
  const full = await Spoon.completeRecipe(recipe, 'KEY', { fetchImpl });
  assert.match(calls[0], /recipes\/101\/information\?includeNutrition=false&apiKey=KEY/);
  assert.equal(full.complete, true);
  assert.deepEqual(full.ingredients.map((i) => [i.name, i.measure, i.have]),
    [['Chicken breast', '2', true], ['Rice', '237 ml', true], ['Garlic', '3 cloves', false]]);
  assert.deepEqual(full.steps, ['Cook the rice.', 'Fry the chicken with garlic.', 'To serve: Spoon into bowls.']);
  assert.equal(full.source, 'https://example.com/bowl');
  assert.equal(full.sourceName, 'Example Kitchen via Spoonacular');
});

test('falls back to the HTML method when there are no analysed steps', () => {
  const steps = Spoon._internal.stepsFrom({ analyzedInstructions: [], instructions: '<ol><li>Heat &amp; stir.</li><li>Serve.</li></ol>' });
  assert.deepEqual(steps, ['Heat & stir.', 'Serve.']);
});

test('reports a rejected key and a used-up allowance clearly', async () => {
  const bad = fakeFetch(() => [401, { status: 'failure' }], []);
  await assert.rejects(Spoon.findRecipes(['x401'], 'BAD', { fetchImpl: bad }), (e) => e.status === 401 && /key/.test(e.message));
  const spent = fakeFetch(() => [402, { status: 'failure' }], []);
  await assert.rejects(Spoon.findRecipes(['x402'], 'KEY', { fetchImpl: spent }), (e) => e.status === 402 && /allowance/.test(e.message));
});

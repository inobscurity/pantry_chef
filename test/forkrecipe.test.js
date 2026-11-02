// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Fork = require('../js/forkrecipe.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'forkrecipe.json'), 'utf8'));
const fetchImpl = async () => ({ ok: true, status: 200, json: async () => data });

test('the bundled data is complete and credited', () => {
  assert.ok(data.recipes.length > 500);
  assert.match(data.license, /CC BY-SA 4\.0/);
  for (const r of data.recipes) {
    assert.ok(r.name && r.ingredients.length && r.steps.length, r.id);
  }
});

test('finds recipes that use any of your ingredients', async () => {
  Fork._reset();
  const recipes = await Fork.findRecipes(['eggs'], { fetchImpl });
  assert.ok(recipes.length > 5);
  assert.ok(recipes.every((r) => r.sourceName === 'ForkRecipe' && r.credit.licence === 'CC BY-SA 4.0'));
  assert.ok(recipes.some((r) => /egg/i.test(r.name)));
});

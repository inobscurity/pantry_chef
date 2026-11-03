// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.self = global;
const Core = require('../js/core.js');
global.RecipeCore = Core;
const Books = require('../js/books.js');

const DATA = path.join(__dirname, '..');
const fetchImpl = async (url) => {
  const file = path.join(DATA, decodeURIComponent(url));
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

test('the cookbook data is complete and credited', () => {
  const index = JSON.parse(fs.readFileSync(path.join(DATA, 'data/books/index.json'), 'utf8'));
  assert.ok(index.books.length > 200);
  assert.equal(index.books.reduce((n, b) => n + b.count, 0), index.recipes.length);
  assert.ok(index.books.some((b) => b.id === 'glasse-1747' && b.via === 'the Internet Archive'));
  for (const b of index.books) assert.ok(b.title && b.link && fs.existsSync(path.join(DATA, `data/books/${b.id}.json`)), b.id);
});

test('a pumpkin soup search finds the old pumpkin soups, closest first', async () => {
  Books._internal.reset();
  const pantry = ['pumpkin', 'onion', 'butter', 'sour cream', 'chicken stock', 'salt', 'pepper'];
  const started = Date.now();
  const found = await Books.findRecipes(Core.mainIngredients(pantry, Core.DEFAULT_BASICS), { fetchImpl, pantry, basics: Core.DEFAULT_BASICS });
  const groups = Core.groupRecipes(found, pantry, Core.DEFAULT_BASICS, 3);
  const ms = Date.now() - started;
  const all = groups.flatMap((g) => g.recipes);
  const soups = all.filter((e) => /pumpkin soup/i.test(e.recipe.name));
  assert.ok(soups.length >= 3, `found ${soups.length} pumpkin soups`);
  assert.ok(soups.some((e) => /Australia/.test(e.recipe.sourceName)), 'Muskett\'s Australian pumpkin soup');
  for (const g of groups) {
    for (let i = 1; i < g.recipes.length; i++) assert.ok(g.recipes[i - 1].usedYours >= g.recipes[i].usedYours, 'closest first');
  }
  assert.ok(ms < 8000, `search took ${ms} ms`);
});

test('opening a book recipe loads its quantities and method', async () => {
  Books._internal.reset();
  const pantry = ['pumpkin', 'onion', 'butter', 'milk', 'carrot', 'lemon'];
  const found = await Books.findRecipes(['pumpkin'], { fetchImpl, pantry, basics: Core.DEFAULT_BASICS });
  const muskett = found.find((r) => r.name === 'Pumpkin Soup' && /Australia/.test(r.sourceName));
  const full = await Books.completeRecipe(muskett, { fetchImpl });
  assert.equal(full.complete, true);
  assert.deepEqual(full.ingredients.slice(0, 2).map((i) => [i.name, i.measure]), [['Pumpkin', '1 small'], ['Butter', '2 oz.']]);
  assert.match(full.steps[0], /^Peel and slice up the pumpkin/);
  assert.equal(full.credit.licence, 'Public domain');
  assert.match(full.credit.text, /Muskett/);
});

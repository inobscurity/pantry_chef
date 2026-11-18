'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');
global.RecipeCore = Core;
const Web = require('../js/web.js');

const index = { built: '20261118', sites: ['www.example.com.au'], shards: { pork: 2, ginger: 1, rice: 2, onion: 3 } };
const shards = {
  pork: { w: ['pork mince', 'ginger', 'rice', 'parsley', 'salt'], r: [['Ginger Pork Rice', 0, '/gpr', [0, 1, 2, -4, 4], 'm'], ['Pork Hash', 0, '/ph', [0, 3]]] },
  rice: { w: ['rice', 'onion', 'pork mince'], r: [['Ginger Pork Rice', 0, '/gpr', [2, 0, 1]], ['Onion Rice', 0, '/or', [0, 1]]] },
  ginger: { w: ['ginger', 'pork mince'], r: [['Ginger Pork Rice', 0, '/gpr', [0, 1]]] },
  onion: { w: ['onion', 'rice'], r: [['Onion Rice', 0, '/or', [0, 1]]] },
};
const fetched = [];
const fetchImpl = async (p) => {
  fetched.push(p);
  const m = p.match(/data\/web\/(?:s\/(\w+)|index)\.json/);
  const body = m[1] ? shards[m[1]] : index;
  return { ok: !!body, status: body ? 200 : 404, json: async () => body };
};

test('website recipes: only the main ingredient\'s file is fetched, and recipes link to the site', async () => {
  Web._internal.reset(); fetched.length = 0;
  const found = await Web.findRecipes(['pork', 'ginger', 'rice'], { fetchImpl, pantry: ['pork', 'ginger', 'rice'], basics: ['salt'], main: 'pork' });
  assert.deepEqual(fetched.map((p) => p.replace(/\?.*/, '')), ['data/web/index.json', 'data/web/s/pork.json']);
  const gpr = found.find((r) => r.name === 'Ginger Pork Rice');
  assert.equal(gpr.source, 'https://www.example.com.au/gpr');
  assert.equal(gpr.sourceName, 'example.com.au');
  assert.equal(gpr.courseHint, 'main');
  assert.equal(gpr.ingredients[3].optional, true);
  const groups = Core.groupRecipes(found, ['pork', 'ginger', 'rice'], ['salt'], 3, { main: 'pork' });
  assert.equal(groups[0].recipes[0].recipe.name, 'Ginger Pork Rice');
});

test('website recipes: without a main ingredient, the biggest file is left out', () => {
  assert.deepEqual(Web._internal.shardsToLoad(['pork', 'onion', 'ginger'], index.shards, '').sort(), ['ginger', 'pork']);
  assert.deepEqual(Web._internal.shardsToLoad(['shallot'], { spring: 5, onion: 9 }, ''), ['spring', 'onion']);
});

test('website recipes: a main ingredient without its own file is found through the others', () => {
  const shards = { pork: 5, rice: 9 };
  assert.deepEqual(Web._internal.shardsToLoad(['onion', 'pork', 'rice'], shards, 'onion').sort(), ['pork', 'rice']);
  assert.deepEqual(Web._internal.shardsToLoad(['onion', 'pork', 'rice'], shards, '').sort(), ['pork', 'rice']);
  assert.deepEqual(Web._internal.shardsToLoad(['pork', 'rice'], shards, ''), ['pork']);
});

test('website recipes: opening one adds amounts, method and credit from its details file', async () => {
  const url = 'https://www.example.com.au/gpr';
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h * 33) ^ url.charCodeAt(i)) >>> 0;
  const detail = { [h.toString(36)]: [[['Pork mince', '500 g', 0], ['Ginger, grated', '2 cm', 1], ['Rice', '1 cup', 2], ['Salt', '', -1]],
    ['Fry the pork.', 'Add ginger and rice.'], 'PT30M', '4', 'Jo Cook', 'Public domain'] };
  const fetchDetail = async (p) => {
    if (/\/d\//.test(p)) return { ok: true, json: async () => detail };
    return fetchImpl(p);
  };
  Web._internal.reset();
  index.detailFiles = 16;
  try {
    const found = await Web.findRecipes(['pork'], { fetchImpl: fetchDetail, pantry: ['pork', 'ginger', 'rice'], basics: ['salt'], main: 'pork' });
    const gpr = found.find((r) => r.name === 'Ginger Pork Rice');
    assert.equal(gpr.complete, false);
    const full = await Web.completeRecipe(gpr, { fetchImpl: fetchDetail });
    assert.deepEqual(full.steps, ['Fry the pork.', 'Add ginger and rice.']);
    assert.equal(full.ingredients[0].measure, '500 g');
    assert.equal(full.ingredients[0].match, 'pork mince');
    assert.equal(full.category, 'Takes 30 min');
    assert.match(full.credit.text, /example\.com\.au, by Jo Cook/);
    assert.equal(full.credit.licence, 'Public domain');
    assert.equal(full.methodOn, '');
  } finally { delete index.detailFiles; }
});

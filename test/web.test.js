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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.RecipeCore = require('../js/core.js');
global.Wikibooks = require('../js/wikibooks.js');
const Gov = require('../js/gov.js');
const fs = require('fs');

const fetchImpl = async (p) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', p), 'utf8')) });

test('NHLBI recipes: found by main ingredient, with method, amounts and public-domain credit', async () => {
  Gov._internal.reset();
  const found = await Gov.findRecipes(['salmon'], { fetchImpl });
  assert.ok(found.length >= 2);
  const r = found.find((x) => x.name === 'Asian-Style Steamed Salmon');
  assert.ok(r.steps.length >= 3);
  assert.ok(r.ingredients.some((i) => i.measure === '1 C'));
  assert.match(r.credit.licence, /Public domain/);
  assert.equal(Gov._internal.totalTime('15 minutes', '1 hour 10 minutes'), '1 hr 25 min');
});

// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

test('matches general and specific names both ways', () => {
  assert.ok(Core.ingredientMatches('chicken', 'Chicken Breast'));
  assert.ok(Core.ingredientMatches('chicken breasts', 'Chicken'));
  assert.ok(Core.ingredientMatches('tomatoes', 'Chopped Tomatoes'));
  assert.ok(Core.ingredientMatches('eggs', 'Egg'));
  assert.ok(Core.ingredientMatches('berries', 'Berry'));
});

test('does not treat a derived product as the ingredient', () => {
  assert.ok(!Core.ingredientMatches('chicken', 'Chicken Stock'));
  assert.ok(!Core.ingredientMatches('chicken stock', 'Chicken'));
  assert.ok(!Core.ingredientMatches('garlic', 'Garlic Powder'));
  assert.ok(!Core.ingredientMatches('egg', 'Eggplant'));
  assert.ok(!Core.ingredientMatches('coconut', 'Coconut Milk'));
});

test('staples match exactly', () => {
  assert.ok(Core.isStaple('Salt'));
  assert.ok(Core.isStaple('Olive Oil'));
  assert.ok(!Core.isStaple('Red Pepper'));
});

const R = (name, ...ings) => ({ id: name, name, ingredients: ings.map((n) => ({ name: n, measure: '1' })) });

test('groups by number of ingredients to buy', () => {
  const recipes = [
    R('Exact', 'Chicken Breast', 'Rice', 'Salt'),
    R('PlusOne', 'Chicken', 'Rice', 'Onion'),
    R('PlusTwo', 'Rice', 'Milk', 'Sugar'),
    R('PlusThree', 'Chicken', 'Leek', 'Cream', 'Thyme'),
    R('PlusFour', 'Rice', 'A', 'B', 'C', 'D'),
    R('NoneOfMine', 'Beef', 'Salt'),
  ];
  const groups = Core.groupRecipes(recipes, ['chicken', 'rice'], true, 3);
  assert.deepEqual(groups.map((g) => g.recipes.map((r) => r.recipe.name)),
    [['Exact'], ['PlusOne'], ['PlusTwo'], ['PlusThree']]);
  assert.deepEqual(groups[1].recipes[0].need.map((i) => i.name), ['Onion']);

  const noStaples = Core.groupRecipes(recipes, ['chicken', 'rice'], false, 3);
  assert.equal(noStaples[1].recipes[0].recipe.name, 'Exact');
});

test('splits instructions into steps', () => {
  assert.deepEqual(Core.splitSteps('STEP 1\r\nBoil water.\r\n\r\nSTEP 2\r\nAdd pasta.'), ['Boil water.', 'Add pasta.']);
  assert.deepEqual(Core.splitSteps('1. Heat oil.\n2) Fry onion.\nStep 3: Serve.'), ['Heat oil.', 'Fry onion.', 'Serve.']);
  assert.deepEqual(Core.splitSteps('1. Heat the oil. 2. Fry the onion.'), ['Heat the oil.', 'Fry the onion.']);
  const wall = Array.from({ length: 6 }, (_, i) => `This is a fairly long sentence number ${i + 1} about cooking things well.`).join(' ');
  assert.equal(Core.splitSteps(wall).length, 3);
  assert.deepEqual(Core.splitSteps(''), []);
});

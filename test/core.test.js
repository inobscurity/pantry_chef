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
  assert.ok(Core.ingredientMatches('garlic', 'Garlic cloves, crushed whole'));
});

test('does not treat a derived product as the ingredient', () => {
  assert.ok(!Core.ingredientMatches('chicken', 'Chicken Stock'));
  assert.ok(!Core.ingredientMatches('chicken stock', 'Chicken'));
  assert.ok(!Core.ingredientMatches('garlic', 'Garlic Powder'));
  assert.ok(!Core.ingredientMatches('egg', 'Eggplant'));
  assert.ok(!Core.ingredientMatches('coconut', 'Coconut Milk'));
});

test('ignores notes in brackets and accepts any alternative', () => {
  assert.ok(!Core.ingredientMatches('pepper', 'Seven-spice (allspice, cinnamon, black pepper)'));
  assert.ok(Core.ingredientMatches('dashi', 'Warm water or dashi (around 60°C)'));
  assert.ok(Core.ingredientMatches('lime', 'Lemon/lime juice'.replace(' juice', '')));
  assert.ok(Core.ingredientMatches('cream', 'Cream — heavy or double'));
});

test('basics cover their everyday variants, but not different foods', () => {
  const basics = Core.DEFAULT_BASICS;
  const isBasic = (name) => Core.coveredByBasics(basics, name);
  for (const yes of ['Salt', 'Fine sea salt', 'Kosher salt', 'Black pepper', 'Freshly ground black pepper',
    'Olive oil', 'Extra virgin olive oil', 'Neutral oil', 'Vegetable oil', 'Water', 'Warm water', 'Boiling water',
    'Salt and pepper', 'Warm water or dashi']) assert.ok(isBasic(yes), yes);
  for (const no of ['Red pepper', 'Bell pepper', 'Sesame oil', 'Chilli oil', 'Celery salt', 'Coconut water', 'Garlic', 'Salt and sugar'])
    assert.ok(!isBasic(no), no);
  assert.ok(Core.basicMatches('flour', 'Plain flour'));
  assert.ok(Core.basicMatches('butter', 'Unsalted butter'));
  assert.ok(Core.basicMatches('garlic', 'Garlic cloves'));
  assert.ok(!Core.basicMatches('sugar', 'Brown sugar'));
});

test('optional ingredients are recognised', () => {
  assert.ok(Core.isOptional({ name: 'Parsley (optional)' }));
  assert.ok(Core.isOptional({ name: 'Coriander', measure: 'to garnish' }));
  assert.ok(Core.isOptional({ name: 'Lemon wedges, to serve' }));
  assert.ok(Core.isOptional({ name: 'Chives', optional: true }));
  assert.ok(!Core.isOptional({ name: 'Onion', measure: '1' }));
});

const R = (name, ...ings) => ({ id: name, name, ingredients: ings.map((n) => (typeof n === 'string' ? { name: n, measure: '1' } : n)) });

test('groups by number of ingredients to buy', () => {
  const recipes = [
    R('Exact', 'Chicken Breast', 'Rice', 'Salt'),
    R('PlusOne', 'Chicken', 'Rice', 'Onion'),
    R('PlusTwo', 'Rice', 'Milk', 'Sugar'),
    R('PlusThree', 'Chicken', 'Leek', 'Cream', 'Thyme'),
    R('PlusFour', 'Rice', 'A', 'B', 'C', 'D'),
    R('NoneOfMine', 'Beef', 'Salt'),
    R('WithGarnish', 'Chicken', 'Rice', { name: 'Parsley', optional: true }, { name: 'Lime', measure: 'to serve' }),
  ];
  const groups = Core.groupRecipes(recipes, ['chicken', 'rice'], Core.DEFAULT_BASICS, 3);
  assert.deepEqual(groups.map((g) => g.recipes.map((r) => r.recipe.name)),
    [['Exact', 'WithGarnish'], ['PlusOne'], ['PlusTwo'], ['PlusThree']]);
  assert.deepEqual(groups[1].recipes[0].need.map((i) => i.name), ['Onion']);

  const noBasics = Core.groupRecipes(recipes, ['chicken', 'rice'], [], 3);
  assert.equal(noBasics[1].recipes[0].recipe.name, 'Exact');

  const moreBasics = Core.groupRecipes(recipes, ['chicken', 'rice'], ['salt', 'onion', 'milk', 'sugar'], 3);
  assert.deepEqual(moreBasics[0].recipes.map((r) => r.recipe.name), ['Exact', 'PlusOne', 'WithGarnish', 'PlusTwo']);
});

test('a recipe only has to use one of your ingredients', () => {
  const groups = Core.groupRecipes([R('Plain rice', 'Rice', 'Water', 'Salt')], ['chicken', 'rice', 'onion', 'carrot', 'cheese'], Core.DEFAULT_BASICS);
  assert.equal(groups[0].recipes[0].recipe.name, 'Plain rice');
});

test('a source can decide which ingredients you have', () => {
  const recipe = { ingredients: [
    { name: 'Chicken thighs', have: true },
    { name: 'Rice', have: false },
    { name: 'Salt', have: false },
    { name: 'Onion' },
  ] };
  const items = Core.classifyIngredients(recipe, ['onion'], Core.DEFAULT_BASICS);
  assert.deepEqual(items.map((i) => i.status), ['have', 'need', 'staple', 'have']);
});

test('dedupe keeps the first recipe of each name', () => {
  const out = Core.dedupe([{ name: 'Chicken Curry', id: 1 }, { name: 'chicken  curry!', id: 2 }, { name: 'Pie', id: 3 }]);
  assert.deepEqual(out.map((r) => r.id), [1, 3]);
});

test('splits instructions into steps', () => {
  assert.deepEqual(Core.splitSteps('STEP 1\r\nBoil water.\r\n\r\nSTEP 2\r\nAdd pasta.'), ['Boil water.', 'Add pasta.']);
  assert.deepEqual(Core.splitSteps('1. Heat oil.\n2) Fry onion.\nStep 3: Serve.'), ['Heat oil.', 'Fry onion.', 'Serve.']);
  assert.deepEqual(Core.splitSteps('1. Heat the oil. 2. Fry the onion.'), ['Heat the oil.', 'Fry the onion.']);
  const wall = Array.from({ length: 6 }, (_, i) => `This is a fairly long sentence number ${i + 1} about cooking things well.`).join(' ');
  assert.equal(Core.splitSteps(wall).length, 3);
  assert.deepEqual(Core.splitSteps(''), []);
});

test('short names drop notes and preparation', () => {
  assert.equal(Core.shortName('Waxy potatoes (Yukon Gold or similar), peeled and sliced 3 mm thin'), 'Waxy potatoes');
  assert.equal(Core.shortName('Bone-in, skin-on chicken pieces (thighs and drumsticks)'), 'Bone-in, skin-on chicken pieces');
  assert.equal(Core.shortName('Garlic cloves, crushed whole'), 'Garlic cloves');
  assert.equal(Core.shortName('Seven-spice (baharat — allspice, clove)'), 'Seven-spice');
  assert.equal(Core.shortName('Onion'), 'Onion');
});

test('matches the cases from a pumpkin soup search', () => {
  const yes = [['chicken stock', 'Turkey or chicken broth, warm'], ['pumpkin', 'Butternut squash'],
    ['pepper', 'Freshly ground black pepper'], ['pepper', 'Black peppercorns'], ['sour cream', 'Soured cream'],
    ['capsicum', 'Red bell pepper'], ['beef mince', 'Ground beef'], ['chicken stock', 'Chicken stock cube'],
    ['cream', 'Heavy cream'], ['butter', 'Unsalted butter']];
  const no = [['pumpkin', 'Pumpkin seeds'], ['pumpkin', 'Pumpkin pie spice'], ['pepper', 'Red pepper flakes'],
    ['pepper', 'Red pepper'], ['potato', 'Sweet potato'], ['milk', 'Coconut milk'], ['sour cream', 'Cream'],
    ['chicken stock', 'Vegetable stock'], ['pepper', 'Sichuan peppercorns']];
  for (const [a, b] of yes) assert.ok(Core.ingredientMatches(a, b), `${a} should cover ${b}`);
  for (const [a, b] of no) assert.ok(!Core.ingredientMatches(a, b), `${a} should not cover ${b}`);
});

test('an "X and Y" ingredient needs both parts', () => {
  const pantry = ['pumpkin', 'salt', 'pepper'];
  const status = (name) => Core.classifyIngredients({ ingredients: [{ name }] }, pantry, []).map((i) => i.status)[0];
  assert.equal(status('Kosher salt and vanilla extract'), 'need');
  assert.equal(status('Salt and freshly ground black pepper'), 'have');
  assert.equal(status('Waxy potatoes, peeled and sliced'), 'need');
  assert.equal(status('Pumpkin, peeled and diced'), 'have');
});

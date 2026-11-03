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
    R('PlusTwo', 'Chicken', 'Rice', 'Milk', 'Sugar'),
    R('PlusThree', 'Chicken', 'Rice', 'Salt', 'Leek', 'Cream', 'Thyme'),
    R('PlusFour', 'Chicken', 'Rice', 'Salt', 'Water', 'A', 'B', 'C', 'D'),
    R('NoneOfMine', 'Beef', 'Salt'),
    R('WithGarnish', 'Chicken', 'Rice', { name: 'Parsley', optional: true }, { name: 'Lime', measure: 'to serve' }),
  ];
  const groups = Core.groupRecipes(recipes, ['chicken', 'rice'], Core.DEFAULT_BASICS, 3);
  assert.deepEqual(groups.map((g) => g.recipes.map((r) => r.recipe.name)),
    [['Exact', 'WithGarnish'], ['PlusOne'], ['PlusTwo'], []]); // PlusThree: 5 counted, only 2 yours
  assert.deepEqual(groups[1].recipes[0].need.map((i) => i.name), ['Onion']);

  const noBasics = Core.groupRecipes(recipes, ['chicken', 'rice'], [], 3);
  assert.equal(noBasics[1].recipes[0].recipe.name, 'Exact');

  const moreBasics = Core.groupRecipes(recipes, ['chicken', 'rice'], ['salt', 'onion', 'milk', 'sugar'], 3);
  assert.deepEqual(moreBasics[0].recipes.map((r) => r.recipe.name).sort(), ['Exact', 'PlusOne', 'PlusTwo', 'WithGarnish']);
});

test('a recipe with more than twice as many ingredients as it takes from yours is left out', () => {
  const recipes = [
    R('Twice', 'Chicken', 'Leek', 'Cream', 'Thyme', 'Salt', 'Water'), // 4 counted (basics ignored), 2 yours: kept
    R('More', 'Chicken', 'Leek', 'Cream', 'Thyme', 'Bacon'),        // 5 counted, 2 yours: left out
    R('Garnish', 'Chicken', 'Leek', { name: 'Parsley', optional: true }), // optional doesn't count: kept
    R('OnlyBasics', 'Chicken', 'Salt', 'Pepper', 'Oil', 'Water'),   // 1 counted, 1 yours: kept
  ];
  // You listed chicken, leek and salt; salt is a basic, so it doesn't count on either side.
  const names = Core.groupRecipes(recipes, ['chicken', 'leek', 'salt'], Core.DEFAULT_BASICS, 3).flatMap((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(names.sort(), ['Garnish', 'OnlyBasics', 'Twice']);
});

test('with a main ingredient chosen, only recipes using it are shown', () => {
  const recipes = [R('Pumpkin Soup', 'Pumpkin', 'Onion', 'Butter'), R('Onion Sauce', 'Onion', 'Butter', 'Salt')];
  const pantry = ['pumpkin', 'onion', 'butter'];
  const all = Core.groupRecipes(recipes, pantry, Core.DEFAULT_BASICS, 3).flatMap((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(all.sort(), ['Onion Sauce', 'Pumpkin Soup']);
  const main = Core.groupRecipes(recipes, pantry, Core.DEFAULT_BASICS, 3, { main: 'pumpkin' }).flatMap((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(main, ['Pumpkin Soup']);
});

test('ingredients a recipe doesn\'t use are fine, as long as it uses half of yours', () => {
  const pantry = ['chicken', 'rice', 'onion', 'carrot', 'cheese'];
  const recipes = [R('Plain rice', 'Rice', 'Water', 'Salt'), R('Chicken pilaf', 'Chicken', 'Rice', 'Onion', 'Carrot', 'Stock')];
  const names = Core.groupRecipes(recipes, pantry, Core.DEFAULT_BASICS).flatMap((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(names, ['Chicken pilaf']); // plain rice uses only 1 of your 5
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

test('recipes are built around your main ingredients, not your salt and butter', () => {
  const pantry = ['Pumpkin', 'onion', 'butter', 'sour cream', 'chicken stock', 'salt', 'pepper'];
  assert.deepEqual(Core.mainIngredients(pantry, Core.DEFAULT_BASICS), ['Pumpkin', 'onion', 'sour cream', 'chicken stock']);
  const recipes = [
    R('Rösti', 'Waxy potatoes', 'Butter', 'Salt', 'Pepper'),
    R('Chapati', 'Atta', 'Salt', 'Water'),
    R('Pumpkin Soup', 'Pumpkin', 'Onion', 'Butter', 'Chicken stock', 'Sour cream', 'Nutmeg'),
    R('Butter Baked Onion', 'Onion', 'Butter', 'Bouillon cube'),
  ];
  const groups = Core.groupRecipes(recipes, pantry, Core.DEFAULT_BASICS, 3);
  const names = groups.map((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(names, [[], ['Pumpkin Soup'], [], []]); // butter baked onion uses only 2 of your 5
});

test('only minor ingredients listed: they all count', () => {
  assert.deepEqual(Core.mainIngredients(['butter', 'salt'], Core.DEFAULT_BASICS), ['butter', 'salt']);
});

test('real lines from Wikibooks pumpkin soups are read fairly', () => {
  const pantry = ['pumpkin', 'onion', 'butter', 'sour cream', 'chicken stock', 'salt', 'pepper'];
  const status = (name) => Core.classifyIngredients({ ingredients: [{ name }] }, pantry, Core.DEFAULT_BASICS)[0].status;
  assert.equal(status('Nonfat and low-sodium chicken broth or vegetable stock'), 'have');
  assert.equal(status('Medium sweet onion, chopped'), 'have');
  assert.equal(status('Pumpkin purée'), 'have');
  assert.equal(status('Oil for frying'), 'staple');
  assert.equal(status('Peeled and cubed sweet potato'), 'need');
  assert.equal(status('Cream'), 'need');
  assert.ok(!Core.ingredientMatches('potato', 'Sweet potatoes'));
  assert.ok(Core.ingredientMatches('kumara', 'Sweet potato'));
});

test('a recipe must use at least half of the ingredients you listed, not counting basics', () => {
  // 5 listed ingredients that aren't basics (salt and pepper are): a recipe needs 3 of them.
  const pantry = ['pumpkin', 'onion', 'butter', 'sour cream', 'chicken stock', 'salt', 'pepper'];
  const recipes = [
    R('Three of yours', 'Pumpkin', 'Onion', 'Butter', 'Milk', 'Salt'),
    R('Two of yours', 'Pumpkin', 'Onion', 'Milk', 'Salt', 'Pepper'),
    R('Two plus basics', 'Pumpkin', 'Butter', 'Salt', 'Pepper', 'Water'),
  ];
  const names = Core.groupRecipes(recipes, pantry, Core.DEFAULT_BASICS, 3).flatMap((g) => g.recipes.map((r) => r.recipe.name));
  assert.deepEqual(names, ['Three of yours']);
});

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

test('leaves and flowers are a different ingredient, except for herbs and leafy greens', () => {
  for (const [a, b] of [['pumpkin', 'Pumpkin leaves'], ['pumpkin', 'Cassava leaves or pumpkin leaves'],
    ['zucchini', 'Zucchini flowers'], ['pumpkin', 'Pumpkin flowers'], ['grape', 'Vine leaves']]) {
    assert.ok(!Core.ingredientMatches(a, b), `${a} should not cover ${b}`);
  }
  for (const [a, b] of [['basil', 'Basil leaves'], ['mint', 'Fresh mint leaves'], ['bay leaf', 'Bay leaves'],
    ['spinach', 'Spinach leaves'], ['parsley', 'Parsley leaves'], ['pumpkin leaves', 'Pumpkin leaves'], ['pumpkin', 'Pumpkin']]) {
    assert.ok(Core.ingredientMatches(a, b), `${a} should cover ${b}`);
  }
});

test('different names for the same ingredient match both ways', () => {
  const pairs = [
    ['butternut pumpkin', 'Butternut squash'], ['butternut pumpkin', '2 butternut squashes'], ['pumpkin', 'Butternut squash'],
    ['pumpkin', 'Kabocha squash'], ['kumara', 'Sweet potatoes'], ['capsicum', 'Red bell pepper'], ['eggplant', 'Aubergine'],
    ['zucchini', 'Courgettes'], ['coriander', 'Fresh cilantro'], ['spring onion', 'Scallions'], ['spring onion', 'Green onions'],
    ['prawns', 'Shrimp'], ['rocket', 'Arugula'], ['silverbeet', 'Swiss chard'], ['snow peas', 'Mangetout'],
    ['rockmelon', 'Cantaloupe'], ['beetroot', 'Beets'], ['swede', 'Rutabaga'], ['pawpaw', 'Papaya'], ['bok choy', 'Pak choi'],
    ['wombok', 'Napa cabbage'], ['chickpeas', 'Garbanzo beans'], ['broad beans', 'Fava beans'], ['green beans', 'French beans'],
    ['corn', 'Sweetcorn'], ['chilli', 'Red chili'], ['yoghurt', 'Greek yogurt'], ['chicken stock', 'Chicken broth'],
    ['sour cream', 'Soured cream'], ['cream', 'Double cream'], ['cream', 'Heavy cream'], ['cornflour', 'Cornstarch'],
    ['plain flour', 'All-purpose flour'], ['self-raising flour', 'Self-rising flour'], ['bicarbonate of soda', 'Baking soda'],
    ['icing sugar', 'Powdered sugar'], ['caster sugar', 'Superfine sugar'], ['tomato paste', 'Tomato purée'],
    ['beef mince', 'Ground beef'], ['beef mince', 'Minced beef'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(Core.ingredientMatches(a, b), `${a} should cover ${b}`);
    assert.ok(Core.ingredientMatches(b, a), `${b} should cover ${a}`);
  }
  // ...without mixing up different things
  for (const [a, b] of [['pumpkin', 'Zucchini'], ['corn', 'Cornstarch'], ['cream', 'Sour cream'], ['beef mince', 'Pork mince'],
    ['chilli', 'Bell pepper'], ['potato', 'Sweet potato']]) {
    assert.ok(!Core.ingredientMatches(a, b), `${a} should not cover ${b}`);
  }
});

test('tomato sauce in your list counts as ketchup, the Australian way', () => {
  for (const b of ['Ketchup', 'Tomato ketchup', 'Catsup', 'Tomato sauce']) {
    assert.ok(Core.ingredientMatches('tomato sauce', b), `tomato sauce should cover ${b}`);
    assert.ok(Core.coveredByBasics(['tomato sauce'], b), `tomato sauce as a basic should cover ${b}`);
  }
  for (const b of ['Mushroom ketchup', 'Walnut ketchup', 'Tomatoes']) {
    assert.ok(!Core.ingredientMatches('tomato sauce', b), `tomato sauce should not cover ${b}`);
  }
  // Only your list is read the Australian way: ketchup in your list isn't a recipe's tomato sauce.
  assert.ok(!Core.ingredientMatches('ketchup', 'Tomato sauce'));
});

test('shallot in your list counts as spring onion, the Australian way', () => {
  for (const b of ['Spring onions', 'Scallions', 'Green onions, sliced', 'Shallots, finely chopped']) {
    assert.ok(Core.ingredientMatches('shallots', b), `shallots should cover ${b}`);
    assert.ok(Core.coveredByBasics(['shallot'], b), `shallot as a basic should cover ${b}`);
  }
  assert.ok(!Core.ingredientMatches('shallots', 'Onion'));
  assert.ok(!Core.ingredientMatches('spring onion', 'Shallots')); // only your list is read this way
  // Spring onions and onions are different ingredients
  assert.ok(!Core.ingredientMatches('spring onion', 'Onion'));
  assert.ok(!Core.ingredientMatches('onion', 'Spring onions'));
  assert.ok(Core.ingredientMatches('onion', 'Brown onion'));
  assert.ok(Core.coveredByBasics(Core.DEFAULT_BASICS, 'Spring water'));
});

test('capsicums of every colour are one ingredient, and "red pepper" is one when it\'s the vegetable', () => {
  const have = (pantry, name, measure) => Core.classifyIngredients({ ingredients: [{ name, measure: measure || '' }] }, pantry, []).map((i) => i.status)[0] === 'have';
  // colours
  for (const n of ['Red capsicum', 'Green capsicums', 'Yellow bell pepper', 'Orange bell peppers', 'Capsicum']) {
    assert.ok(have(['red capsicum'], n), `red capsicum should cover ${n}`);
    assert.ok(have(['capsicum'], n), `capsicum should cover ${n}`);
  }
  // the vegetable
  assert.ok(have(['capsicum'], 'Red peppers', '2'));
  assert.ok(have(['capsicum'], 'Red pepper, seeded and sliced'));
  assert.ok(have(['capsicum'], 'Green peppers'));
  assert.ok(have(['capsicum'], 'Stuffed green peppers'));
  assert.ok(have(['capsicum'], 'Sweet pepper', '1 large'));
  // the spice
  assert.ok(!have(['capsicum'], 'Red pepper', '1/4 teaspoon'));
  assert.ok(!have(['capsicum'], 'Red pepper', 'few grains'));
  assert.ok(!have(['capsicum'], 'Red pepper'));
  assert.ok(!have(['capsicum'], 'Crushed red pepper'));
  assert.ok(!have(['capsicum'], 'Red pepper flakes'));
  assert.ok(!have(['capsicum'], 'Cayenne pepper'));
  assert.ok(!have(['capsicum'], 'Green peppercorns'));
  // and the spice still counts as the spice
  assert.ok(have(['cayenne'], 'Cayenne pepper'));
  // capsicum is never black pepper, either way round
  assert.ok(!have(['capsicum'], 'Pepper'));
  assert.ok(!have(['red capsicum'], 'Black pepper'));
  assert.ok(!have(['pepper'], 'Red capsicum'));
  assert.ok(!have(['pepper'], 'Bell pepper'));
});

test('kinds of pumpkin are pumpkin, and squash is the Australian pattypan kind', () => {
  const pumpkins = ['Butternut pumpkin', 'Butternut squash', 'Jap pumpkin', 'Kent pumpkin', 'Kabocha squash', 'Queensland Blue pumpkin',
    'Jarrahdale pumpkin', 'Golden nugget pumpkins', 'Acorn squash', 'Buttercup squash', 'Hubbard squash', 'Sugar pumpkin', 'Winter squash'];
  for (const b of pumpkins) {
    assert.ok(Core.ingredientMatches('pumpkin', b), `pumpkin should cover ${b}`);
    assert.ok(!Core.ingredientMatches('squash', b), `squash should not cover ${b}`);
  }
  // A particular kind covers a recipe that just says pumpkin
  for (const a of ['butternut', 'butternut pumpkin', 'butternut squash', 'jap pumpkin', 'kent pumpkin']) {
    assert.ok(Core.ingredientMatches(a, 'Pumpkin, peeled and diced'), `${a} should cover pumpkin`);
  }
  assert.ok(!Core.ingredientMatches('butternut', 'Jap pumpkin')); // different kinds stay different
  for (const b of ['Pattypan squash', 'Patty pans', 'Scallop squash', 'Button squash', 'Yellow squash', 'Summer squash', 'Squash']) {
    assert.ok(Core.ingredientMatches('squash', b), `squash should cover ${b}`);
  }
  assert.ok(!Core.ingredientMatches('pumpkin', 'Pattypan squash'));
  assert.ok(!Core.ingredientMatches('squash', 'Zucchini'));
  assert.ok(!Core.ingredientMatches('pumpkin', 'Spaghetti squash'));
});

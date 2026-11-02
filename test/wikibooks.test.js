// Run with: node --test test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Wiki = require('../js/wikibooks.js');
const { parseIngredient, parsePage, clean } = Wiki._internal;

test('cleans wiki markup', () => {
  assert.equal(clean("2 [[Cookbook:Onion|onions]], [[Cookbook:Chopping|chopped]]"), '2 onions, chopped');
  assert.equal(clean("'''Fry''' the [[Cookbook:Garlic]]<ref>note</ref> {{nowrap|now}}"), 'Fry the Garlic');
  assert.equal(clean('{{convert|200|g|oz}} flour'), '200 g flour');
  assert.equal(clean('{{frac|1|2}} cup'), '1/2 cup');
});

test('splits quantity from ingredient name', () => {
  const p = (s) => parseIngredient(s);
  assert.deepEqual(p('500 [[Cookbook:Gram|g]] [[Cookbook:Chicken|chicken]], cut into pieces'), { name: 'Chicken, cut into pieces', measure: '500 g' });
  assert.deepEqual(p('2 [[Cookbook:Onion|onions]]'), { name: 'Onions', measure: '2' });
  assert.deepEqual(p('1 ½ cups plain flour'), { name: 'Plain flour', measure: '1 1/2 cups' });
  assert.deepEqual(p('2-3 cloves of garlic'), { name: 'Garlic', measure: '2-3 cloves' });
  assert.deepEqual(p('500g minced beef'), { name: 'Minced beef', measure: '500 g' });
  assert.deepEqual(p('[[Cookbook:Salt|Salt]] to taste'), { name: 'Salt', measure: 'to taste' });
  assert.deepEqual(p('Avocado'), { name: 'Avocado', measure: '' });
  assert.deepEqual(p('a pinch of nutmeg'), { name: 'Nutmeg', measure: 'a pinch' });
});

const BULLETS = `{{Recipe summary
| category = Chicken recipes
| servings = 4
| time = 1 hour
| difficulty = 2
| image = [[File:Chicken curry.jpg|300px]]
}}
{{recipe}}

'''Chicken curry''' is a simple curry.

== Ingredients ==
* 500 [[Cookbook:Gram|g]] [[Cookbook:Chicken|chicken]], cut into pieces
* 2 [[Cookbook:Onion|onions]], chopped
* 1 [[Cookbook:Tablespoon|tbsp]] [[Cookbook:Oil|oil]]
* [[Cookbook:Salt|Salt]] to taste
* Fresh [[Cookbook:Coriander|coriander]] for garnish (optional)

== Procedure ==
# Heat the oil in a pan.
# Add the onions and [[Cookbook:Frying|fry]] until golden.
#: Stir often.
# Add the chicken and cook for 20 minutes.

== Notes, tips, and variations ==
* Use lamb instead.
`;

test('reads a recipe written with lists', () => {
  const r = parsePage('Cookbook:Chicken Curry', BULLETS);
  assert.equal(r.name, 'Chicken Curry');
  assert.equal(r.sourceName, 'Wikibooks Cookbook');
  assert.deepEqual(r.ingredients.map((i) => [i.name, i.measure]), [
    ['Chicken, cut into pieces', '500 g'], ['Onions, chopped', '2'], ['Oil', '1 tbsp'],
    ['Salt', 'to taste'], ['Fresh coriander for garnish (optional)', ''],
  ]);
  assert.deepEqual(r.steps, ['Heat the oil in a pan.', 'Add the onions and fry until golden. Stir often.', 'Add the chicken and cook for 20 minutes.']);
  assert.equal(r.category, 'Takes 1 hour');
  assert.deepEqual(r.tags, ['Serves 4']);
  assert.equal(r.image, 'https://en.wikibooks.org/wiki/Special:FilePath/Chicken_curry.jpg?width=480');
  assert.equal(r.source, 'https://en.wikibooks.org/wiki/Cookbook:Chicken_Curry');
});

test('reads a recipe written with an ingredient table', () => {
  const text = `== Ingredients ==
{| class="wikitable"
!Ingredient
!Count
!Volume
!Weight
|-
|[[Cookbook:Rice|Rice]]
|
|1 cup
|200 g
|-
| Eggs || 2 || ||
|}

== Procedure ==
# Cook the rice.
# Fry the eggs and stir through.`;
  const r = parsePage('Cookbook:Egg Fried Rice', text, { source: 'https://upload.example/thumb.jpg' });
  assert.deepEqual(r.ingredients.map((i) => [i.name, i.measure]), [['Rice', '1 cup / 200 g'], ['Eggs', '2']]);
  assert.equal(r.image, 'https://upload.example/thumb.jpg');
});

test('skips pages that are not recipes', () => {
  assert.equal(parsePage('Cookbook:Onion', "'''Onions''' are a vegetable.\n== Selection ==\nPick firm ones."), null);
});

test('searches per ingredient and reads the best pages', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    let body;
    if (p.list === 'search') {
      body = { query: { search: p.srsearch.startsWith('chicken') ? [{ title: 'Cookbook:Chicken Curry' }, { title: 'Cookbook:Onion' }] : [{ title: 'Cookbook:Chicken Curry' }] } };
    } else {
      body = { query: { pages: p.titles.split('|').map((t) => ({
        title: t,
        revisions: [{ slots: { main: { content: t === 'Cookbook:Chicken Curry' ? BULLETS : "'''Onion''' article" } } }],
      })) } };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  const recipes = await Wiki.findRecipes(['chicken', 'onion'], { fetchImpl });
  assert.deepEqual(recipes.map((r) => r.name), ['Chicken Curry']);
  const search = new URL(urls[0]);
  assert.equal(search.searchParams.get('srnamespace'), '102');
  assert.equal(search.searchParams.get('origin'), '*');
  assert.equal(search.searchParams.get('srsearch'), 'chicken ingredients');
});

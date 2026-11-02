"""Builds data/forkrecipe.json from the ForkRecipe open recipe dataset.

    git clone --depth 1 https://github.com/futurechef/forkrecipe-recipes /tmp/forkrecipe
    python3 -I scripts/build_forkrecipe.py /tmp/forkrecipe

The dataset's recipe files are JavaScript, but only data: scripts/jslit.py reads them
without running them, and rejects any file that isn't plain data.

The recipes are CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), from the
ForkRecipe dataset by FoodML and contributors. The output keeps that licence.
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from jslit import parse  # noqa: E402

# Components rather than dishes: they'd crowd out meals in the results.
SKIP_CATEGORIES = {'stocks', 'condiments', 'fermented', 'beverages'}
REPO = 'https://github.com/futurechef/forkrecipe-recipes/blob/main/recipes/'
QUANTITY_NOTES = {
    'parts': 'Quantities are proportions by weight (parts). Scale them to the amount you want to make.',
    'bakers_percentage': 'Quantities are percentages by weight of the main ingredient (the one at 100%). Scale them to the amount you want to make.',
}


def amount(value):
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value)


def measure(ing):
    unit = (ing.get('defaultUnit') or '').strip()
    value = ing.get('ratioValue')
    if unit in ('to taste', 'as needed'):
        return unit
    if value in (None, 0):
        return unit
    if unit == '%':
        return amount(value) + '%'
    if unit in ('part', 'parts'):
        unit = 'part' if value == 1 else 'parts'
    return f'{amount(value)} {unit}'.strip()


def note(r):
    units = {(i.get('defaultUnit') or '').strip() for i in r.get('ingredients', [])}
    if units & {'part', 'parts'}:
        return QUANTITY_NOTES['parts']
    if '%' in units:
        return QUANTITY_NOTES['bakers_percentage']
    return ''


def convert(r):
    ingredients = []
    for ing in r.get('ingredients', []):
        name = re.sub(r'\s+', ' ', ing.get('name', '')).strip()
        if not name:
            continue
        item = {'name': name, 'measure': measure(ing)}
        if ing.get('role') == 'Garnish' or re.search(r'\boptional\b', name, re.I):
            item['optional'] = True
        ingredients.append(item)
    steps = [re.sub(r'\s+', ' ', n.get('instructions', '')).strip() for n in r.get('processNodes', [])]
    return {
        'id': 'fork-' + r['slug'],
        'name': r['title'],
        'cuisine': r.get('cuisine', ''),
        'category': r.get('category', ''),
        'time': r.get('totalTime', ''),
        'note': note(r),
        'link': REPO + r['slug'] + '.js',
        'ingredients': ingredients,
        'steps': [s for s in steps if s],
    }


def main(repo):
    out, rejected = [], []
    for path in sorted(pathlib.Path(repo, 'recipes').glob('*.js')):
        if path.name in ('_template.js', 'index.js'):
            continue
        try:
            r = parse(path.read_text(encoding='utf-8'))
        except ValueError as e:
            rejected.append(f'{path.name}: {e}')
            continue
        if r.get('parentRepoId') or r.get('category') in SKIP_CATEGORIES:
            continue  # forks are variations of a recipe already included
        recipe = convert(r)
        if recipe['ingredients'] and recipe['steps']:
            out.append(recipe)
    dest = pathlib.Path(__file__).parent.parent / 'data' / 'forkrecipe.json'
    dest.write_text(json.dumps({
        'source': 'ForkRecipe dataset by FoodML and contributors (https://github.com/futurechef/forkrecipe-recipes)',
        'license': 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
        'recipes': out,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)} recipes written to {dest}')
    for line in rejected:
        print('rejected', line)


if __name__ == '__main__':
    main(sys.argv[1])

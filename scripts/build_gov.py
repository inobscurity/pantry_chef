#!/usr/bin/env python3
"""Builds data/gov/recipes.json from NHLBI's "Healthy Eating Recipes" pages (US Government work,
public domain), saved as HTML in one folder:

    python3 -I scripts/build_gov.py <folder of saved pages>

Each page has the recipe's name, a description, "Recipe Source: …", the ingredient list, the
directions, prep and cook time, and servings.
"""
import html
import json
import pathlib
import re
import sys

BASE = 'https://www.nhlbi.nih.gov/health/heart-healthy-living/healthy-foods/healthy-eating-recipes/'


def lines_of(page):
    s = page[page.find('<main'):]
    s = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
    s = re.sub(r'<(h\d|li|p|div|dt|dd|span)[^>]*>', r'\n', s)
    s = html.unescape(re.sub(r'<[^>]+>', '', s))
    return [re.sub(r'\s+', ' ', l).strip() for l in s.split('\n') if l.strip()]


def section(lines, start, ends):
    try:
        i = lines.index(start) + 1
    except ValueError:
        return []
    out = []
    for l in lines[i:]:
        if l in ends:
            break
        out.append(l)
    return out


def after(lines, label):
    try:
        return lines[lines.index(label) + 1]
    except (ValueError, IndexError):
        return ''


def main(folder):
    recipes = []
    for f in sorted(pathlib.Path(folder).glob('*.html')):
        lines = lines_of(f.read_text(encoding='utf-8', errors='replace'))
        try:
            k = lines.index('Ingredients')
        except ValueError:
            continue
        head = lines[:k]
        source = next((l.split(':', 1)[1].strip() for l in head if l.startswith('Recipe Source:')), '')
        # The name is the heading just before the description; the description is the line before the source.
        src_at = next((i for i, l in enumerate(head) if l.startswith('Recipe Source:')), len(head))
        description = head[src_at - 1] if src_at >= 2 else ''
        name = head[src_at - 2] if src_at >= 2 else head[-1]
        ingredients = section(lines, 'Ingredients', {'Directions'})
        steps = section(lines, 'Directions', {'Prep Time', 'Cook Time', 'Yields', 'Serving Size', 'Nutritional Facts'})
        times = [after(lines, 'Prep Time'), after(lines, 'Cook Time')]
        if not ingredients or not steps:
            continue
        recipes.append({
            'id': f.stem, 'n': name, 'd': description, 'src': source, 'u': BASE + f.stem,
            'i': ingredients, 's': steps, 'prep': times[0], 'cook': times[1], 'y': after(lines, 'Yields'),
        })
    out = pathlib.Path(__file__).resolve().parent.parent / 'data' / 'gov' / 'recipes.json'
    out.write_text(json.dumps({'nhlbi': recipes}, ensure_ascii=False), encoding='utf-8')
    print(len(recipes), 'NHLBI recipes')


main(sys.argv[1])

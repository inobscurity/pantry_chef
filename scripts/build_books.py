"""Builds data/books/ from public-domain cookbooks (Project Gutenberg plain-text files).

    python3 -I scripts/build_books.py TEXTS_DIR CATALOG_JSON [--only ID,ID] [--report]

TEXTS_DIR holds <gutenberg id>.txt files. CATALOG_JSON is a list of
{"Text#", "Title", "Authors"} entries (from Gutenberg's pg_catalog.csv).

Each book lays its recipes out differently, so the reader looks for a few common shapes:
  * a heading on its own line ("PUMPKIN SOUP", "Pumpkin Soup.", a centred title,
    "_To make a Pease Soup._"), followed by the recipe;
  * a heading that starts the paragraph ("PUMPKIN SOUP.--Peel…", "59. =Boiled Rice.=--Wash…");
  * an ingredient list as lines, or Mrs Beeton's "INGREDIENTS.--a, b, c." paragraph;
    otherwise ingredients are picked out of the method by name (scripts/ingredients.txt).

Only the recipes are kept, never the books. Output:
  data/books/index.json   - books, and per recipe: name, ingredients, book
  data/books/<id>.json    - each book's methods, loaded when a recipe is opened
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
OUT = HERE.parent / 'data' / 'books'

# ---------------------------------------------------------------- vocabulary ----------

def load_vocab():
    words = []
    for line in (HERE / 'ingredients.txt').read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            words.append(line)
    words.sort(key=len, reverse=True)
    def plural(w):
        last = w.split(' ')[-1]
        if last.endswith('y') and not last.endswith(('ey', 'ay', 'oy')):
            return w[:-1] + '(?:y|ies)'
        if last.endswith(('o', 'ch', 'sh', 's', 'x')):
            return re.escape(w) + '(?:es|s)?'
        if last.endswith('f'):
            return re.escape(w[:-1]) + '(?:f|ves|fs)'
        return re.escape(w) + 's?'
    pattern = r"(?<![\w'-])(" + '|'.join(plural(w).replace(r'\ ', r'[\s-]+') for w in words) + r")(?![\w-])"
    return re.compile(pattern, re.I)

VOCAB = load_vocab()
SIZE_OF = re.compile(r'(?:the )?size of an? (?:egg|walnut|nutmeg|hazel-?nut|pea|bean|nut|orange)', re.I)


def capital(name):
    small = {'a', 'an', 'and', 'or', 'of', 'the', 'in', 'on', 'with', 'to', 'for', 'a la', 'au', 'de', 'en'}
    words = name.lower().split()
    return ' '.join(w if (i and w in small) else w[:1].upper() + w[1:] for i, w in enumerate(words))


def ingredients_in_prose(text):
    """Ingredient names mentioned in a paragraph, in order, without repeats."""
    text = SIZE_OF.sub(' ', text)
    seen, out = set(), []
    last = None
    for m in VOCAB.finditer(text):
        if last is not None and re.fullmatch(r',?\s+or\s+', text[last.end():m.start()], re.I) and out:
            alt = re.sub(r'[\s-]+', ' ', m.group(1).lower())                # "pumpkin or squash": one choice
            seen.add(re.sub(r'(ies|es|s)$', '', alt))
            if not out[-1][0].lower().endswith(' or ' + alt):
                out[-1][0] = f'{out[-1][0]} or {alt}'
            last = m
            continue
        last = m
        if re.search(r'\b(?:no|without|instead of|not)\s+(?:\w+\s+)?$', text[max(0, m.start() - 20):m.start()], re.I):
            continue                                                      # "but no butter"
        name = re.sub(r'[\s-]+', ' ', m.group(1).lower())
        key = re.sub(r'(ies|es|s)$', '', name)
        if key in seen:
            continue
        seen.add(key)
        ref = NUM_REF.match(text[m.end():].lstrip())
        if ref:
            out.append([capital(name), '', '#' + (ref.group(1) or ref.group(2))])
        else:
            out.append([capital(name), ''])
    return out

# ---------------------------------------------------------------- ingredient lines ----

NUMBER = r"(?:\d+(?:\.\d+)?(?:\s*-\s*|\s+)?(?:\d+/\d+)?|\d+/\d+|[¼½¾⅓⅔⅛]|\d+\s*[¼½¾⅓⅔⅛]|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|half|a half|a quarter of)"
UNIT = (r"(?:cups?|cupfuls?|breakfast-?cups?(?:fuls?)?|tea-?cups?(?:fuls?)?|tablespoons?(?:fuls?)?|table-spoons?(?:fuls?)?|"
        r"dessert-?spoons?(?:fuls?)?|teaspoons?(?:fuls?)?|tea-spoons?(?:fuls?)?|salt-?spoons?(?:fuls?)?|wine-?glass(?:es|fuls?)?|"
        r"tbsps?|tsps?|gills?|pints?|quarts?|gallons?|lbs?\.?|pounds?|ozs?\.?|ounces?|drachms?|dozen|grains?|"
        r"pinch(?:es)?|dash(?:es)?|handfuls?|bunch(?:es)?|heads?|sticks?|slices?|pieces?|sprigs?|cloves?|cans?|tins?|jars?|"
        r"pennyworth|small|large|medium|good-sized|grams?|g|kilos?|kg|ml|litres?|liters?)")
QUANTITY = re.compile(rf"^((?:about\s+)?{NUMBER}(?:\s*(?:to|-|or)\s*{NUMBER})?(?:\s*{UNIT}\b\.?)?(?:\s*{UNIT}\b\.?)?)\s+(?:of\s+)?(.+)$", re.I)
LIST_LINE = re.compile(rf"^(?:[*•-]\s*)?(?:{NUMBER}\b|[A-Z][a-z]+)")


PREP_ONLY = re.compile(r'(?i)^(?:melted|beaten|chopped|sifted|grated|minced|sliced|diced|softened|warmed|scalded|'
                       r'well beaten|finely chopped|to taste|or more|if liked|optional|if in season|when in season|'
                       r'seasoning to taste|seasoning|seasoning of salt and pepper|to serve|for serving)$')


# References to another recipe in the same book: "white broth (No. 99)", "stock No. 105",
# "Béchamel (see Sauces)", "beef stock, page 88". The reference is taken out of the name and kept
# as a third item: "#99" (a recipe number) or "see" (find it by name).
NUM_REF = re.compile(r'\(\s*(?:see\s+)?(?:No|Nos|Number|Recipe|Receipt)\.?\s*(\d{1,4})\s*\)|\b(?:see\s+)?No\.\s*(\d{1,4})\b', re.I)
SEE_REF = re.compile(r'\(\s*see\s+[^)]{2,40}\)|,?\s*\(?\s*(?:see\s+)?(?:page|p\.)\s*\d{1,4}\s*\)?', re.I)


def take_reference(text):
    """(text without the reference, "#N" | "see" | None)"""
    m = NUM_REF.search(text)
    if m:
        return (text[:m.start()] + text[m.end():]).strip(' ,;.'), '#' + (m.group(1) or m.group(2))
    m = SEE_REF.search(text)
    if m:
        return (text[:m.start()] + text[m.end():]).strip(' ,;.'), 'see'
    return text, None


def parse_line(line):
    text = re.sub(r'^[*•\-]\s*', '', line.replace('\xa0', ' ')).strip()
    text, ref = take_reference(text)
    text = re.sub(r'--\s*(?:\d+/\d+|\d+(?:\s+\d+/\d+)?)\s*[sd]\.?\s*$', '', text)  # Muskett's prices: "--4d."
    text = re.sub(r'\s*\.\s*$', '', text).strip(' ,;')
    text = re.sub(r'(?i)^(?:and|or|with)\s+', '', text)
    if not text:
        return None
    m = QUANTITY.match(text)
    measure, name = (m.group(1).strip(), m.group(2).strip()) if m else ('', text)
    if re.fullmatch(r'(?i)a|an', measure):
        measure, name = '', text
    if not re.search(r'[a-z]', name, re.I) or PREP_ONLY.match(name.strip()):
        return None
    item = [name[:1].upper() + name[1:], measure]
    return item + [ref] if ref else item


def parse_list_line(line):
    """One list line, which may hold several items: "1 C butter, 2 c sugar, 2 eggs"."""
    t = re.sub(r'^[*•\-]\s*', '', line).strip()
    if re.search(r'\S\s{4,}\S', t):                                    # two columns
        return [p for part in re.split(r'\s{4,}', t) for p in parse_list_line(part)]
    if t.count(',') >= 2 or re.search(r'(?<!No)\.\s+[A-Z0-9]', t):        # not after "No." in "(No. 99)"
        return [p for p in (parse_line(x) for x in re.split(r',\s*|(?<!No)\.\s+(?=[A-Z0-9])', t)) if p]
    item = parse_line(t)
    return [item] if item else []


def split_list_paragraph(text):
    """Mrs Beeton: 'INGREDIENTS.--1 breast of lamb, a few slices of bacon, 1 lemon.'"""
    parts = re.split(r',\s*|;\s*|\s+and\s+(?=\d|a\s|an\s|some\s)', text)
    return [p for p in (parse_line(x) for x in parts) if p]

# ---------------------------------------------------------------- recipe headings -----

SKIP_HEADINGS = re.compile(
    r'^(?:chapter|chap\b|part\b|book\b|contents|index|preface|introduct|illustration|fig\b|plate\b|table\b|menu|'
    r'bill of fare|section|vol\b|volume|appendix|general|remarks|observations|note\b|notes\b|hints|rules|'
    r'the end|transcriber|footnote|ingredients|mode|time|average cost|sufficient|seasonable|directions|'
    r'method|to serve|for the|or,|or\b|another way|another\b|the same|ditto|also|n\.b|p\.s)', re.I)
CATEGORY = re.compile(r'^(soups?|fish|meats?|poultry|game|vegetables?|salads?|sauces?|puddings?|pastry|pies|cakes?|'
                      r'breads?|biscuits|preserves|pickles|jellies|creams|beverages|drinks|sweets|confectionery|'
                      r'entrees|entrées|eggs|cheese|desserts|savouries|savories|miscellaneous|invalid cookery|'
                      r'cookery for invalids|sandwiches|beef|mutton|veal|pork|lamb)$', re.I)
NOT_FOOD = re.compile(r'\b(wash|washing|soap|polish|stains?|ink|clean|cleaning|starch|fluid|remed|cure|lotion|toilet|'
                      r'hair|teeth|tooth|perfume|cologne|cement|glue|moths?|insects?|bugs|rats|mice|flies|disinfect|'
                      r'bleach|dye|varnish|blacking|furniture|carpets?|silver|brass|linen|laundry|poultice|salve|'
                      r'ointment|plaster|medicine|liniment|gargle|monday|tuesday|wednesday|thursday|friday|'
                      r'saturday|sunday|breakfast|luncheon|dinner|supper|menu|description|mixture for|cough|'
                      r'colds?|odou?rs?|differences|component|treatise|properties|adulterat|mould for|moulds|'
                      r'utensils|kitchen|marketing|carving|to carve|choosing|to choose|selection|serving of|'
                      r'variety|variations?|preparation|process|general|directions|uses of|use of|treatment|'
                      r'value of|food value|digestion|nutrition|economy)\b', re.I)
COOKING = re.compile(r'\b(boil|bake|fry|stew|roast|simmer|stir|mix|beat|add|put|cut|chop|slice|season|serve|cook|'
                     r'pour|place|take|melt|grate|peel|strain|rub|whisk|steam|broil|grill|toast|knead|roll|soak|'
                     r'wash|pare|mince|pound|sift|blend|heat|brown|bring|lay|let|set|dress|garnish)', re.I)


def clean_markup(line):
    line = re.sub(r'[│┃|}{✠†‡§¶]+', ' ', line)                             # Fannie Farmer's bracketed tables
    line = re.sub(r'(?<![\w_])_([^_\n]+)_(?![\w_])', r'\1', line)
    line = re.sub(r'=([^=\n]+)=', r'\1', line)
    return line


# Chapter headings say what kind of dish follows: "SOUPS", "CHAPTER IX. FISH", "PUDDINGS AND PIES".
# Stored as a one-letter course for each recipe (see COURSE_CODES in js/books.js).
CHAPTER_WORDS = {
    'p': {'soup', 'soups', 'broth', 'broths', 'potages', 'consommes', 'chowders'},
    'x': {'sauces', 'sauce', 'gravies', 'gravy', 'stuffings', 'forcemeats', 'forcemeat', 'garnishes', 'stocks',
          'relishes', 'dressings', 'marinades', 'seasonings'},
    'd': {'puddings', 'pudding', 'tarts', 'pastry', 'pastries', 'cakes', 'cake', 'biscuits', 'cookies', 'breads',
          'bread', 'rolls', 'creams', 'ices', 'jellies', 'confectionery', 'sweets', 'desserts', 'dessert',
          'sweet', 'candies', 'candy', 'icings', 'fritters', 'pancakes', 'muffins', 'gingerbread', 'baking'},
    'o': {'preserves', 'pickles', 'jams', 'beverages', 'drinks', 'invalids', 'invalid', 'sick', 'canning',
          'wines', 'cordials'},
    # Old cookbooks' "entrées" are made dishes of meat (Fillet of Beef, Larded): mains for us. Starters
    # are what Australians call entrées: hors d'oeuvres, savouries, appetisers.
    't': {'hors', "d'oeuvres", 'oeuvres', 'savouries', 'savories', 'sandwiches', 'appetizers', 'appetisers'},
    's': {'vegetables', 'vegetable', 'salads', 'salad', 'cereals', 'potatoes'},
    'm': {'fish', 'shellfish', 'oysters', 'meats', 'meat', 'beef', 'mutton', 'veal', 'lamb', 'pork', 'poultry',
          'game', 'curries', 'eggs', 'cheese', 'joints', 'roasts', 'fowls', 'birds', 'venison', 'rabbits',
          'macaroni', 'omelets', 'omelettes', 'made', 'dishes', 'pies', 'entrees', 'entrées', 'entree', 'entrée',
          'relevés', 'releves', 'luncheon'},
}
CHAPTER_JOINERS = {'and', 'of', 'the', 'for', '&', 'with', 'etc', 'other', 'various', 'cold', 'hot', 'how', 'to',
                   'cook', 'cookery', 'dressed', 'dressing', 'recipes', 'receipts', 'miscellaneous', 'a', 'in',
                   'their', 'garnish', 'boiled', 'roast', 'roasted', 'fried'}


SINGULAR_DISHES = {'soup', 'broth', 'sauce', 'gravy', 'forcemeat', 'pudding', 'cake', 'bread', 'salad', 'dessert',
                   'sweet', 'candy', 'vegetable', 'entree', 'entrée', 'stuffing', 'dressing'}
# (Kept for the check above: a lone "ENTRÉE" in capitals is a recipe's heading, not a chapter.)


def chapter_course(raw):
    """The course a chapter heading announces, as one letter, or '' if `raw` isn't one."""
    t = clean_markup(raw).strip()
    prefixed = re.match(r'(?i)^(?:chapter|chap\.?|part|section)\s+[ivxlc\d]+\b', t) is not None
    t = re.sub(r'(?i)^(?:chapter|chap\.?|part|section)\s+[ivxlc\d]+\.?\s*[-—–:.]*\s*', '', t)
    t = t.strip(' .:')
    words = [w for w in re.split(r"[\s,;.—–-]+", t.lower()) if w]
    if not words or len(words) > 8 or not re.sub(r'[^A-Za-z]', '', t).isupper():
        return ''
    found = [code for code, vocab in CHAPTER_WORDS.items() for w in words if w in vocab]
    if not found or any(w not in CHAPTER_JOINERS and not any(w in v for v in CHAPTER_WORDS.values()) for w in words):
        return ''
    # "FISH SAUCE" or "BREAD SAUCE" in capitals is a recipe; chapters are plural ("SAUCES").
    if not prefixed and any(w in SINGULAR_DISHES for w in words):
        return ''
    if words in (['made', 'dishes'],) or set(words) <= {'made', 'dishes'}:
        return 'm'
    for code in 'pxdots m'.replace(' ', ''):                       # soup, sauce, dessert, other, starter, side, main
        if code in found:
            return code
    return ''


def heading_number(raw):
    """The recipe's number, if its heading starts with one: "99. Bouillon Blanc", "51—PROVENÇALE"."""
    m = re.match(r'^\s*(?:No\.\s*)?(\d{1,4})[a-z]?\s*(?:\.|—|–|--)\s*\S', clean_markup(raw))
    return int(m.group(1)) if m else None


def heading_text(raw):
    """The recipe name if `raw` (a one-line paragraph) is a heading, else None."""
    italic = bool(re.match(r'^\s*_[^_]+_\s*$', raw))
    indented = len(raw) - len(raw.lstrip(' ')) >= 6
    s = clean_markup(raw).strip()
    if s.rstrip().endswith(':'):
        return None
    s = re.sub(r'^(?:No\.\s*)?\d+[a-z]?\.\s*(?:--|—)?\s*', '', s)      # "744." "No. 81." "No. 1.--"
    s = re.sub(r'^[-—–]+\s*', '', s)
    s = re.sub(r'^\d+\s*[—–-]+\s*', '', s)                              # Escoffier: "274—"
    if re.fullmatch(r'(?i)[ivxlc]+\.?', s.strip()):
        return None
    s = re.sub(r'\s*[.:]\s*$', '', s)
    s = re.sub(r'\s*\((?:No\.\s*)?\d+\)$', '', s)
    if not 3 <= len(s) <= 70 or re.search(r'\d+\s*$', s) or SKIP_HEADINGS.match(s) or CATEGORY.match(s):
        return None
    letters = re.sub(r'[^A-Za-z]', '', s)
    if len(letters) < 3 or len(s.split()) > 12:
        return None
    main = re.sub(r'\([^)]*\)', '', s)
    upper = re.sub(r'[^A-Za-z]', '', main).isupper() if re.sub(r'[^A-Za-z]', '', main) else False
    if upper or italic or indented or re.match(r'^To [a-z]', s):
        return capital(s) if upper else s
    if raw.strip().endswith('.') and all(w[:1].isupper() for w in s.split() if len(w) > 3):
        return s
    return None


INLINE = re.compile(r'^(?:No\.\s*)?(?:\d+[a-z]?\.\s*)?([A-Z][^\n]{2,70}?)\.?\s*(?:--|—|\.—|\.–)\s*(.+)$', re.S)


def inline_heading(text):
    m = INLINE.match(text)
    if not m:
        return None
    name = re.sub(r'^[-—–]+\s*', '', m.group(1).strip().rstrip('.'))
    if re.fullmatch(r'(?i)[ivxlc]+', name) or name.endswith(':'):
        return None
    if SKIP_HEADINGS.match(name) or CATEGORY.match(name) or len(name.split()) > 10:
        return None
    letters = re.sub(r'[^A-Za-z]', '', name)
    words = [w for w in name.split() if len(w) > 3]
    numbered = heading_number(text) is not None                 # "100. Consommé pure--…" is reliable
    if not (letters.isupper() or numbered and name[:1].isupper() or (words and all(w[:1].isupper() for w in words))):
        return None
    return (capital(name) if letters.isupper() else name), m.group(2)

# ---------------------------------------------------------------- book → recipes ------


def gutenberg_body(text):
    start = re.search(r'\*\*\*\s*START OF[^\n]*\n', text)
    end = re.search(r'\*\*\*\s*END OF', text)
    return text[start.end() if start else 0: end.start() if end else len(text)]


def paragraphs(text):
    for block in re.split(r'\n[ \t]*\n', text):
        lines = [l.rstrip() for l in block.split('\n') if l.strip()]
        if lines:
            yield lines


def to_steps(paras):
    steps = []
    for p in paras:
        p = re.sub(r'\s+', ' ', p).strip()
        if not p:
            continue
        if len(p) <= 320:
            steps.append(p)
            continue
        # Don't end a step at an abbreviation: "(No. 99)", "2 oz. butter", "1 lb. of beef".
        p = re.sub(r'\b(No|Nos|oz|ozs|lb|lbs|tsp|tbsp|doz|pt|qt|gal|Mr|Mrs|Dr|St|fig|vol|pp?)\.(?=\s)', '\\1\u2024', p)
        sentences = [s.replace('\u2024', '.') for s in re.findall(r'[^.!?]+[.!?]+(?:["\')\]]+)?|[^.!?]+$', p)]
        chunk = ''
        for s in sentences:
            if chunk and len(chunk) + len(s) > 260:
                steps.append(chunk.strip())
                chunk = ''
            chunk += s
        if chunk.strip():
            steps.append(chunk.strip())
    return steps


SEASONINGS = {'salt', 'pepper', 'black pepper', 'white pepper', 'cayenne', 'nutmeg', 'mace', 'sugar', 'water',
              'lemon juice', 'vinegar', 'mustard', 'parsley', 'paprika', 'clove', 'cinnamon', 'ginger',
              'allspice', 'bay leaf', 'thyme', 'sweet herb'}


def finish(recipe):
    """Turns a collected heading + paragraphs into a recipe, or None."""
    if not recipe or not recipe['paras'] and not recipe['list']:
        return None
    if NOT_FOOD.search(recipe['name']):
        return None
    if re.match(r"(?i)^(?:from|by|contributed|mrs\.?|miss|mr\.?)\s|^\d|^quantit|^(?:for|enough for|serves)\s+\w+\s+persons", recipe['name']):
        return None                                                       # a contributor's name
    if re.search(r"\b(?:co\.|company|ltd|inc|st\.,|street|mass\.?$|lea & perrins|improved with)", recipe['name'], re.I):
        return None                                                       # adverts in magazine issues
    method = [p for p in recipe['paras'] if p]
    text = ' '.join(method)
    if not (40 <= len(text) <= 6000) or not COOKING.search(text):
        return None
    ingredients = recipe['list'] or ingredients_in_prose(text)
    if not recipe['list'] and len(ingredients) > 16:
        return None                                                       # an essay, not a recipe
    # A list sometimes leaves out seasonings added in the method ("a little salt"); add those.
    # Nothing else: the method also names the dish itself ("pour in the broth").
    if recipe['list']:
        have = {re.sub(r'(ies|es|s)$', '', i[0].lower()) for i in ingredients}
        for item in ingredients_in_prose(text):
            name = item[0]
            key = re.sub(r'(ies|es|s)$', '', name.lower())
            if key not in SEASONINGS:
                continue
            if not any(key in h or h in key for h in have):
                ingredients.append([name, ''])
                have.add(key)
    if len(ingredients) < 2:
        return None
    name = re.sub(r'\.\s+(?:Mrs|Miss|Mr|Dr|Madame|Mme)\b\.?\s.*$', '', recipe['name'])   # ". Mrs. G. H. Wright"
    name = re.sub(r"[\s,.;:'’\"*•\-]+$", '', name).strip()
    # Mrs Beeton's notes after the method aren't steps: "Seasonable from May to October.",
    # "Sufficient for 8 persons." (kept as how many it serves), "Average cost, 1s."
    steps = []
    for step in to_steps(method):
        note = re.match(r'(?i)^_?(seasonable|sufficient|average cost|time)\b[\s_.,:-]*(.*)$', step)
        if note:
            if note.group(1).lower() == 'sufficient' and not recipe.get('serves'):
                recipe['serves'] = note.group(2).strip(' ._')[:60]
            continue
        steps.append(step)
    out = {'n': name, 'i': ingredients[:30], 'steps': steps}
    if recipe.get('time'):
        out['t'] = recipe['time']
    if recipe.get('serves'):
        out['s'] = recipe['serves']
    if recipe.get('num'):
        out['num'] = recipe['num']
    return out


def read_book(text):
    text = gutenberg_body(text.replace('\r', ''))
    recipes, current = [], None
    chapter = ''

    def close():
        nonlocal current
        r = finish(current)
        if r:
            if current.get('chapter'):
                r['c'] = current['chapter']
            recipes.append(r)
        current = None

    for lines in paragraphs(text):
        joined = clean_markup(' '.join(l.strip() for l in lines))
        indented = all(len(l) - len(l.lstrip(' ')) >= 4 for l in lines)

        if len(lines) == 2 and re.match(r'^\s*\(.*\)\s*$', clean_markup(lines[1])):
            lines = lines[:1]                                             # "PUMPKIN SOUP" / "(Zuppa di Zucca)"
            joined = clean_markup(lines[0])
        if len(lines) <= 2:
            course = chapter_course(' '.join(lines))
            if course:
                close()
                chapter = course
                continue
            if re.match(r'(?i)^\s*(?:index|contents)\b', joined):
                chapter = ''
        if len(lines) == 1:
            name = heading_text(lines[0])
            if name:
                close()
                current = {'name': name, 'paras': [], 'list': [], 'num': heading_number(lines[0]), 'chapter': chapter}
                continue
            if re.match(r'^\(.*\)$', joined.strip()) and current and not current['paras']:
                continue                                                  # "(Zuppa di Zucca)"

        label = re.match(r'^(?:(\d+)\.\s*)?(INGREDIENTS|Ingredients)\s*[.:]*\s*(?:--|—|:)\s*(.+)$', joined, re.S)
        if label and current is not None:
            if label.group(1) and not current.get('num'):
                current['num'] = int(label.group(1))          # Mrs Beeton numbers her INGREDIENTS line
            raw = [clean_markup(l).replace('\xa0', ' ').strip() for l in lines]
            if len(raw) > 1 and all(l.endswith('.') for l in raw) and all(l.count(',') < 2 for l in raw):
                # One per line: "Ingredients--4 oz. of Scotch barley. / 4 oz. of sliced onions."
                raw[0] = re.sub(r'^(?:\d+\.\s*)?ingredients\s*[.:]*\s*(?:--|—|:)\s*', '', raw[0], flags=re.I)
                current['list'] = [item for l in raw for item in parse_list_line(l)]
            else:
                current['list'] = split_list_paragraph(label.group(3).replace('\xa0', ' '))
            continue
        meta = re.match(r'^(Mode|Method|Directions|Time|Average cost|Sufficient|Seasonable)\s*[.,]*\s*(?:--|—|:)\s*(.*)$', joined, re.S | re.I)
        if meta and current is not None:
            kind, rest = meta.group(1).lower(), meta.group(2)
            if kind in ('mode', 'method', 'directions'):
                current['paras'].append(rest)
            elif kind == 'time':
                current['time'] = re.split(r'(?<=\.)\s+_?[A-Z]', rest)[0].strip(' ._')[:60]
            elif kind == 'sufficient':
                current['serves'] = rest.strip(' ._')[:60]
            continue

        inline = inline_heading(joined) if not indented or len(lines) > 1 else None
        if inline and len(inline[1]) > 40:
            close()
            current = {'name': inline[0], 'paras': [inline[1]], 'list': [], 'num': heading_number(joined), 'chapter': chapter}
            continue

        if current is None:
            continue

        # Muskett: bullet lines, then the method in the same paragraph.
        if len(lines) > 1 and re.match(r'^\s*\*', lines[0]) and not current['paras']:
            k = 0
            while k < len(lines) and re.match(r'^\s*\*', lines[k]):
                t2 = re.sub(r'^[*•\-]\s*', '', clean_markup(lines[k]).strip())
                tm = re.match(r'(?i)^time\s*--?\s*(.+)$', t2)
                if tm:
                    current['time'] = tm.group(1).strip(' .')[:60]
                elif t2 and not re.match(r'(?i)^total cost', t2):
                    current['list'].extend(split_list_paragraph(t2))
                k += 1
            rest = clean_markup(' '.join(l.strip() for l in lines[k:]))
            if rest:
                current['paras'].append(rest)
            continue

        # Muskett: one bullet per paragraph ("* 1 small Pumpkin--4d.").
        if len(lines) == 1 and re.match(r'^\s*\*', lines[0]) and not current['paras']:
            t2 = re.sub(r'^[*•\-]\s*', '', clean_markup(lines[0]).strip())
            tm = re.match(r'(?i)^time\s*--?\s*(.+)$', t2)
            if tm:
                current['time'] = tm.group(1).strip(' .')[:60]
            elif t2 and not re.match(r'(?i)^total cost', t2):
                current['list'].extend(split_list_paragraph(t2) if ',' in t2 else [x for x in [parse_line(t2)] if x])
            continue

        # An ingredient list: several short lines, most starting with a quantity or a name.
        if len(lines) >= 2 and not current['paras'] and all(len(l.strip()) <= 75 for l in lines):
            items = [l for l in lines if l.strip() not in ('*', '-')]
            listish = [l for l in items if LIST_LINE.match(clean_markup(l).strip())]
            if items and len(listish) >= max(2, len(items) * 0.7):
                for l in items:
                    t = clean_markup(l).strip()
                    t2 = re.sub(r'^[*•\-]\s*', '', t)
                    tm = re.match(r'(?i)^time\s*--?\s*(.+)$', t2)
                    if tm:
                        current['time'] = tm.group(1).strip(' .')[:60]
                        continue
                    if re.match(r'(?i)^total cost', t2):
                        continue
                    current['list'].extend(parse_list_line(t))
                continue

        if indented and len(lines) > 2 and current['paras']:
            close()                                                       # Mrs Beeton's history notes
            continue
        current['paras'].append(joined)
        if len(' '.join(current['paras'])) > 6000:
            close()
    close()
    return recipes

# ---------------------------------------------------------------- main ---------------


OPTIONAL = re.compile(r'(?i)\boptional\b|\bif liked\b|\bto serve\b|\bfor serving\b|\bto garnish\b|\bfor garnish\b')


# Same rule as nameOf() in js/core.js: "red pepper" is a capsicum only when it's clearly the
# vegetable (counted or prepared); otherwise, in these books, it's cayenne.
COLOUR_PEPPER = re.compile(r'\b(red|green|yellow|orange|sweet)\s+peppers?\b(?!\s*(?:flakes?|corns?|sauce|paste|powder))', re.I)
SPICE_CLUE = re.compile(r'\b(?:cayenne|flakes?|crushed|ground|powder(?:ed)?|dried|grains?|dash|pinch|sprinkl\w*|to taste|'
                        r'a little|saltspoon\w*|teaspoon\w*|tea-spoon\w*|tsp|tablespoon\w*|table-spoon\w*|tbsp|'
                        r'dessert-?spoon\w*|spoonful\w*)\b', re.I)
VEG_CLUE = re.compile(r'\b(?:sliced|chopped|diced|stuffed|roasted|seeded|deseeded|halved|quartered|strips?|rings?|cut|'
                      r'large|medium|small|whole|fresh|cored)\b', re.I)
COUNT = re.compile(r'^\s*(?:\d+(?:[./]\d+)?|[½¼¾]|a|an|one|two|three|four|five|six|half)\s*(?:large|medium|small|whole)?\s*$', re.I)


def pepper_as_capsicum(name, measure=''):
    m = COLOUR_PEPPER.search(name)
    if not m:
        return name
    veg = (not SPICE_CLUE.search(f'{name} {measure}')
           and (COUNT.match(measure or '') or VEG_CLUE.search(name) or m.group(1).lower() in ('green', 'yellow', 'orange', 'sweet')))
    return COLOUR_PEPPER.sub('capsicum', name) if veg else name


SUMMER_SQUASH_DISH = re.compile(r'(?i)\b(?:summer|yellow|button|scallop(?:ed|ini)?|crookneck|patty ?pans?|cymling)\b')


def match_name(name, measure='', recipe_name=''):
    """What an ingredient is, for searching: "Squash, steamed and strained" → "squash"."""
    n = re.sub(r'\([^)]*\)', ' ', pepper_as_capsicum(name, measure))
    n = re.split(r',|;|\s[—–]\s', n)[0]
    n = re.sub(r'\s+', ' ', n).strip().lower() or name.lower()
    # Old American books mean a winter squash by plain "squash": in Australian terms, pumpkin.
    # Summer, yellow, pattypan, scallop, button, crookneck and spaghetti squash keep their names,
    # and so does a plain "squash" in a summer squash dish ("Summer Squash Bujea").
    if re.fullmatch(r'(?:(?:fresh|young|ripe|winter|cooked|stewed|boiled|mashed|strained|sifted|steamed|baked|dry|nice|good|large|small)\s+)*squash(?:es)?', n):
        return 'squash' if SUMMER_SQUASH_DISH.search(recipe_name) else 'pumpkin'
    return n


LINK = '\u27e6{}\u27e7'   # ⟦k⟧ in a method: a link to recipe k of the same book


def name_words(name):
    words = re.findall(r'[a-z]+', name.lower().replace('é', 'e').replace('è', 'e'))
    stop = ('a', 'an', 'the', 'of', 'and', 'or', 'to', 'make', 'some', 'little')
    return [re.sub(r'(?<=[^s])s$', '', w) for w in words if w not in stop]


def link_references(recipes):
    """Turns references into links to recipes of the same book, by number or by name.

    An ingredient that is another recipe becomes [name, measure, k]; one whose recipe can't be
    found stays an ordinary ingredient. In methods, a resolved "(No. 99)" becomes ⟦k⟧."""
    by_num = {}
    for k, r in enumerate(recipes):
        if r.get('num') and r['num'] not in by_num:
            by_num[r['num']] = k
    names = [(k, name_words(r['n'])) for k, r in enumerate(recipes)]

    def by_name(name, own):
        """A recipe named like the reference: "Béchamel" → "Béchamel Sauce", "Espagnole" →
        "Espagnole, or Brown Spanish Sauce". Its name must start with the referenced words, or
        add at most two others."""
        want = name_words(name)
        if not want:
            return -1
        found = []
        for k, words in names:
            if k == own or not set(want) <= set(words):
                continue
            starts = words[:len(want)] == want
            extra = len(words) - len(set(want))
            if starts or extra <= 2:
                found.append((0 if starts else 1, extra, k))
        return min(found)[2] if found else -1

    for own, r in enumerate(recipes):
        items = []
        for item in r['i']:
            if len(item) < 3:
                items.append(item)
                continue
            name, measure, ref = item
            k = -1
            if ref.startswith('#'):
                k = by_num.get(int(ref[1:]), -1)                  # by number only: names are too loose
                if k == own:
                    k = -1
            else:
                k = by_name(name, own)
            # Linked: [name, measure, k]. Not found: an ordinary ingredient, so nothing you'd need
            # to buy is hidden.
            items.append([name, measure, k] if k >= 0 else [name, measure])
        r['i'] = items

        def to_link(m):
            k = by_num.get(int(m.group(1) or m.group(2)))
            return LINK.format(k) if k is not None and k != own else m.group(0)
        r['steps'] = [NUM_REF.sub(to_link, step) for step in r['steps']]
    return recipes


def readable(recipe, counts):
    """For scanned books: are the name and method made of real words?"""
    def ratio(text, minimum):
        words = re.findall(r"[A-Za-z]+", text)
        words = [w for w in words if len(w) > 2]
        if len(words) < minimum:
            return 0.0
        return sum(1 for w in words if counts.get(w.lower(), 0) >= 3) / len(words)
    method = ' '.join(recipe['steps'])
    if re.search(r'\bib\b|\bibid\b', method) or len(re.findall(r'\d', method)) > len(method) * 0.05:
        return False                                                      # a page of the index
    return (ratio(recipe['n'], 1) >= 0.99 and not re.search(r'[^A-Za-z ,\'’\-&().]', recipe['n'])
            and ratio(method, 8) >= 0.93)


def main(argv):
    texts, catalog = pathlib.Path(argv[0]), json.loads(pathlib.Path(argv[1]).read_text(encoding='utf-8'))
    only = None
    if '--only' in argv:
        only = set(argv[argv.index('--only') + 1].split(','))
    extra = []
    if '--extra' in argv:                                     # non-Gutenberg books, e.g. Hannah Glasse
        extra = json.loads(pathlib.Path(argv[argv.index('--extra') + 1]).read_text(encoding='utf-8'))
    report = '--report' in argv
    min_recipes = 10

    books, index = [], []
    words, word_ids = [], {}
    counts = None

    def word_id(w):
        if w not in word_ids:
            word_ids[w] = len(words)
            words.append(w)
        return word_ids[w]
    OUT.mkdir(parents=True, exist_ok=True)
    entries = [dict(c, source='gutenberg') for c in catalog] + extra
    for book in entries:
        bid = str(book['Text#'])
        if only and bid not in only:
            continue
        path = pathlib.Path(book['path']) if book.get('path') else texts / f'{bid}.txt'
        if not path.exists():
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        if book.get('ocr'):
            text = re.sub(r'\b([Tt]o|a) flew\b', r'\1 stew', text).replace('flew-pan', 'stew-pan')
        recipes = read_book(text)
        if book.get('ocr'):                                       # scanned, not proofread
            if counts is None:
                sys.path.insert(0, str(HERE))
                from fix_long_s import word_counts
                counts = word_counts(texts)
            recipes = [r for r in recipes if readable(r, counts)]
        recipes = link_references(recipes)
        if report:
            print(f'{bid}\t{len(recipes)}\t{book["Title"][:70]!r}')
        if len(recipes) < min_recipes:
            continue
        b = len(books)
        authors = re.sub(r',\s*(?:active\s+)?\d{0,4}\??\s*-\s*\d{0,4}\??|\s*\[[^\]]*\]', '', book.get('Authors') or '').strip(' ;,')
        books.append({
            'id': bid,
            'title': re.sub(r'\s+', ' ', book['Title'].strip().split('\n')[0]).strip(),   # without the subtitle
            'author': authors,
            'link': book.get('link') or f'https://www.gutenberg.org/ebooks/{bid}',
            'via': book.get('via') or 'Project Gutenberg',
        })
        books[-1]['count'] = len(recipes)
        details = []
        for r in recipes:
            # Search needs only the name and what each ingredient is; quantities and the method
            # are in the book's own file, loaded when a recipe is opened.
            keys = []
            for item in r['i']:
                if len(item) > 2:
                    continue                          # another recipe, not an ingredient to match
                name, measure = item
                k = word_id(match_name(name, measure, r['n']))
                keys.append(-k - 1 if OPTIONAL.search(name + ' ' + measure) else k)
            index.append([r['n'], keys, r['c']] if r.get('c') else [r['n'], keys])
            details.append([r['i'], r['steps'], r.get('t', ''), r.get('s', '')])
        (OUT / f'{bid}.json').write_text(json.dumps(details, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (OUT / 'index.json').write_text(json.dumps({
        'note': 'Recipes from public-domain cookbooks. Each book entry says where it came from.',
        'books': books, 'words': words, 'recipes': index,
    }, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{len(books)} books, {len(index)} recipes, {len(words)} ingredient names')


if __name__ == '__main__':
    main(sys.argv[1:])

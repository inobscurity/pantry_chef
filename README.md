# Pantry Chef

Type the ingredients you have, and Pantry Chef finds recipes online and groups them by how many
more ingredients you'd need to buy:

| Group | Meaning |
| --- | --- |
| ✓ **Make it now** | Uses only what you have. |
| +1 **Buy 1 ingredient** | Needs one ingredient you don't have. |
| +2 **Buy 2 ingredients** | Needs two. |
| +3 **Buy 3 ingredients** | Needs three. Recipes needing more are left out. |

Pick a recipe to see:

- **Ingredients**, split into *To buy*, *You have* and *Basics*, each with its quantity, plus a
  **Copy shopping list** button for the ones to buy.
- **Method**, as numbered steps you can tick off as you cook. Your ticks are remembered.
- A count of ingredients, how many you have, how many to buy, and the number of steps, plus links
  to the original recipe and video.

The **I have the basics** switch (on by default) treats salt, pepper, cooking oil and water as
things you already have, so they don't push a recipe into a lower group.

## Run it

It's a static page with no build step and no account or API key.

- Open `index.html` in a browser, or
- serve the folder: `npx serve .` or `python3 -m http.server`, or
- turn on GitHub Pages (Settings → Pages → Deploy from a branch → `main`, `/ (root)`), which
  publishes it at `https://inobscurity.github.io/pantry_chef/`.

## How it works

```
 your ingredients ──▶ match to the database's ingredient names ("chicken" → Chicken, Chicken Breast…)
                  ──▶ for each, list recipes that use it               (filter.php?i=…)
                  ──▶ rank recipes by how many of yours they use, keep the top 80
                  ──▶ fetch each one's ingredients and method          (lookup.php?i=…)
                  ──▶ count what's missing, group into 0 / 1 / 2 / 3
```

Recipes come from [TheMealDB](https://www.themealdb.com), a free recipe database that answers
browsers directly. Responses are cached for the browser session, so changing your ingredients or the
basics switch regroups instantly, and searches that reuse ingredients are fast.

**Matching ingredients.** Names are compared word by word after lower-casing, removing plurals
("tomatoes" → "tomato") and dropping preparation words ("chopped", "fresh"). "Chicken" matches
"Chicken Breast", and the other way round. Words that make a different product stop a match, so
"chicken" doesn't match "Chicken Stock" and "garlic" doesn't match "Garlic Powder".

**Steps.** Recipes write their method as numbered lines, "STEP 1" headings or one paragraph. The
method is split on lines, labels like "Step 2:" or "3." are removed, and a long single paragraph is
broken into steps of about two sentences.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | The page. Works on phones, follows light and dark mode. |
| `js/core.js` | Matching, grouping and step splitting. No network or page code. |
| `js/mealdb.js` | Searches TheMealDB and turns its answers into recipes. |
| `js/app.js` | The two screens: search with grouped results, and the recipe. |
| `test/core.test.js` | Tests for `core.js`: `node --test test/*.test.js` |

## Ideas for later

- **Bigger recipe source.** TheMealDB has a few hundred recipes. Spoonacular's
  `findByIngredients` searches hundreds of thousands and returns the missing-ingredient count
  itself, but needs an API key, so it would need a small server to keep the key private. Only
  `js/mealdb.js` would change.
- Let people edit the list of basics.
- Filters for diet, cuisine or cooking time.

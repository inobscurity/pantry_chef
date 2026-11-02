# Pantry Chef

Type the ingredients you have, and Pantry Chef finds recipes online and groups them by how many
more ingredients you'd need to buy. It searches two sources at once:

- **[TheMealDB](https://www.themealdb.com)**: a few hundred recipes, always searched, no setup.
- **[Spoonacular](https://spoonacular.com/food-api)**: hundreds of thousands of recipes gathered
  from food websites and blogs. Searched when you add your free API key under **Recipe sources**.

The same recipe from both sources is shown once. Each card says where it came from.

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

It's a static page with no build step and no server.

- Open `index.html` in a browser, or
- serve the folder: `npx serve .` or `python3 -m http.server`, or
- turn on GitHub Pages (Settings → Pages → Deploy from a branch → `main`, `/ (root)`), which
  publishes it at `https://inobscurity.github.io/pantry_chef/`.

## The Spoonacular key

Get a free key from your [Spoonacular console](https://spoonacular.com/food-api/console) (Profile →
Show API key), then paste it into **Recipe sources** in the app and press **Save**.

- The key is saved only in that browser (its local storage). It is never in this repository, so
  enter it once on each device you use.
- The free plan has a daily allowance of "points". A search costs roughly 1–2 points, and opening
  a Spoonacular recipe costs about 1 more (TheMealDB recipes cost nothing). After a search, the app
  shows the points left today when Spoonacular reports them.
- When the allowance is used up, or the key is rejected, the app says so and still shows
  TheMealDB's recipes.

## How it works

```
 your ingredients ──▶ match to the database's ingredient names ("chicken" → Chicken, Chicken Breast…)
                  ──▶ for each, list recipes that use it               (filter.php?i=…)
                  ──▶ rank recipes by how many of yours they use, keep the top 80
                  ──▶ fetch each one's ingredients and method          (lookup.php?i=…)
                  ──▶ count what's missing, group into 0 / 1 / 2 / 3
```

Spoonacular is searched at the same time with one request (`findByIngredients`), which returns
recipes with the ingredients you have and the ones you'd need. Its quantities and method are
fetched only when you open one of its recipes (`/recipes/{id}/information`), to save points.

Both sources answer browsers directly, so there is no server. Answers are cached for the browser
session, so repeating a search or reopening a recipe is instant and costs no points. Changing the
basics switch regroups straight away; changing your ingredients asks you to search again.

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
| `js/spoonacular.js` | Searches Spoonacular, and fetches a recipe's details when it's opened. |
| `js/app.js` | The two screens: search with grouped results, and the recipe. |
| `test/` | Tests, with the recipe services faked: `node --test test/*.test.js` |

## Ideas for later

- Add Edamam as a third source (about 2 million recipes; it gives ingredients but not the method).
- Let people edit the list of basics.
- Filters for diet, cuisine or cooking time.

# Pantry Chef

Type the ingredients you have, and Pantry Chef finds recipes and groups them by how many more
ingredients you'd need to buy. A recipe must use at least half of the ingredients you listed
(see the rules below); ones it doesn't use are ignored.

| Group | Meaning |
| --- | --- |
| ✓ **Make it now** | Everything it needs is in your list or your basics. |
| +1 **Buy 1 ingredient** | Needs one ingredient you don't have. |
| +2 **Buy 2 ingredients** | Needs two. |
| +3 **Buy 3 ingredients** | Needs three. Recipes needing more are left out. |

Your **main ingredients** drive the search: everything you list except salt, pepper, oil, water,
sugar, flour, butter and your basics. Those still count as things you have, but a recipe has to use
at least one main ingredient to be shown. Within a group, the closest matches come first: recipes that
use more of the ingredients you listed, and between equally close ones, those using your less
common ingredients (pumpkin before onion), then simpler ones. A recipe using just one of yours
comes last.

Pick a recipe to see:

- **Ingredients**, split into *To buy*, *You have*, *Your basics* and *Optional*, each with its
  quantity, plus a **Copy shopping list** button.
- **Method**, as numbered steps you can tick off as you cook. Your ticks are remembered.
- A count of ingredients, how many you have, how many to buy, and the number of steps, plus a link
  to the original recipe and, for openly licensed recipes, its credit and licence.

**Main ingredient**: tap one of your ingredients to make it the main one (it gets a ★). Only
recipes using it are shown, and the sources are searched for it. Tap it again to show everything.

**Uses at least half of yours**: a recipe must use at least half of the ingredients you listed
(basics in your list don't count). The aim is to cook with what you have, not to buy most of a dish.

**Too many extra ingredients**: a recipe with more than twice as many ingredients as it takes from
your list is left out. Basics (in the recipe or in your list) and optional ingredients don't count
either way. So a recipe using 3 of your ingredients may have at most 6.

**Basics I always have** is your own list of things that never count as "to buy". It starts as
salt, pepper, oil and water; add butter, flour, garlic or whatever is always in your kitchen.
"Oil" covers olive and vegetable oil, and "pepper" covers black pepper but not red peppers.

**Optional ingredients** (marked optional, or "to serve" / "to garnish") never count as "to buy".

## Recipe sources

All are searched at once; the same recipe from two sources is shown once. After each search the
app lists how many recipes each source contributed, and says if a source couldn't be reached.

| Source | Recipes | Setup | Licence |
| --- | --- | --- | --- |
| [TheMealDB](https://www.themealdb.com) | A few hundred | None (uses the public test key, fine for personal use) | Its API terms |
| [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Recipes) | A few thousand, simple and classic | None | CC BY-SA 4.0 |
| [ForkRecipe open dataset](https://github.com/futurechef/forkrecipe-recipes) | 721 dishes, bundled in the app | None | CC BY-SA 4.0 |
| Classic cookbooks | About 69,000, from 251 books (1747 to the 1950s), bundled in the app | None | Public domain |
| [Spoonacular](https://spoonacular.com/food-api) | Thousands, from food sites and blogs (only 67 with pumpkin, mostly desserts) | Your free API key (50 points a day) | Its API terms |

- **Wikibooks Cookbook** is read through Wikimedia's official API. For each of your ingredients
  the app searches the Cookbook, then reads the best pages' *Ingredients* and *Procedure* sections.
  Volunteers write these pages in different styles, so now and then an ingredient line may be
  read imperfectly.
- **ForkRecipe** is a downloaded copy in `data/forkrecipe.json` (see `data/README.md`): stocks,
  condiments, drinks and forks are left out. About half its recipes give quantities as proportions
  rather than amounts; the recipe screen says so.
- **Classic cookbooks** are out-of-copyright books from [Project Gutenberg](https://www.gutenberg.org),
  plus Hannah Glasse's *The Art of Cookery Made Plain and Easy* (1747) from the
  [Internet Archive](https://archive.org/details/TheArtOfCookery). `scripts/build_books.py` reads
  each book once and keeps only its recipes (see `data/books/README.md`); the books themselves
  aren't stored. Old recipes use old measures ("a gill", "butter the size of an egg") and are
  shown as written. Where a book gives no ingredient list, the ingredients are picked out of the
  method by name, so those recipes show no separate quantities. Scanned books such as Glasse's
  are corrected for the old long s ("falt" → salt) and only clearly readable recipes are kept.
- **Spoonacular**: add your key under **Recipe sources**. It's saved only in that browser, never in
  this repository. Each search costs about 2 of your daily points and opening one of its
  recipes about 1 more. If the key is rejected or the allowance is used up, the other sources
  still work.

## Run it

It's a static site with no build step and no server.

- It's published with GitHub Pages at https://inobscurity.github.io/pantry_chef/
- To run it locally, serve the folder, for example `python3 -m http.server`, and open
  http://localhost:8000. (Opening `index.html` directly works too, but without ForkRecipe, because
  browsers don't let a file opened from disk load the recipe data.)

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | The page. Works on phones, follows light and dark mode. |
| `manifest.webmanifest`, `icons/` | Home-screen name and icon. |
| `js/core.js` | Matching ingredients, basics, optional items, grouping, step splitting. |
| `js/mealdb.js`, `js/wikibooks.js`, `js/forkrecipe.js`, `js/spoonacular.js` | One file per recipe source. |
| `js/app.js` | The two screens: search with grouped results, and the recipe. |
| `data/` | The bundled ForkRecipe data and its licence, and `data/books/` (classic cookbooks). |
| `js/books.js` | Searches the classic cookbooks on the device; loads a book's methods when a recipe is opened. |
| `scripts/` | Rebuild the bundled data: `build_forkrecipe.py`, and `build_books.py` with `fix_long_s.py` and `ingredients.txt` for the cookbooks. |
| `test/` | Tests, with the online services faked: `node --test test/*.test.js` |

## Ideas for later

- Add Edamam as another source (about 2 million recipes; it gives ingredients but not the method).
- Filters for diet, cuisine or cooking time.

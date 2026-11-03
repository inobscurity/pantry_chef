/*
 * Recipes from public-domain cookbooks (Project Gutenberg, and Hannah Glasse's 1747 book from
 * the Internet Archive), read by scripts/build_books.py into data/books/.
 *
 * data/books/index.json is downloaded on the first search and kept by the browser. It lists
 * each recipe's name and what its ingredients are, as numbers into a shared list of names.
 * Quantities and the method are in each book's own file, fetched when a recipe is opened.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const MAX_MISSING = 5;        // shortlist recipes needing up to this many things (the app shows up to 3)
  const MAX_CANDIDATES = 6000;  // safety limit on the shortlist

  let indexLoading = null;
  const bookLoading = new Map();

  function getJSON(path, fetchImpl) {
    return (fetchImpl || root.fetch.bind(root))(path).then((res) => {
      if (!res.ok) throw new Error(`Cookbook data answered ${res.status}`);
      return res.json();
    });
  }

  function loadIndex(fetchImpl) {
    if (!indexLoading) {
      indexLoading = getJSON('data/books/index.json', fetchImpl).then((data) => {
        // Unpack recipes once: [{ book, k, name, keys }]
        const recipes = [];
        let r = 0;
        data.books.forEach((book, b) => {
          book.start = r; // where this book's recipes begin, for following links
          for (let k = 0; k < book.count; k++, r++) {
            const [name, keys, course] = data.recipes[r];
            recipes.push({ b, k, name, keys, course });
          }
        });
        return { books: data.books, words: data.words, recipes };
      }).catch((e) => { indexLoading = null; throw e; });
    }
    return indexLoading;
  }

  function loadBook(id, fetchImpl) {
    if (!bookLoading.has(id)) {
      bookLoading.set(id, getJSON(`data/books/${encodeURIComponent(id)}.json`, fetchImpl)
        .catch((e) => { bookLoading.delete(id); throw e; }));
    }
    return bookLoading.get(id);
  }

  function shortTitle(title) {
    return title.split(/[:;\n]|\s—\s/)[0].replace(/\s*\(\d{4}\)\s*$/, '').trim();
  }

  function authorName(author) {
    // "Beeton, Mrs. (Isabella Mary)" → "Mrs. Beeton"; "Farmer, Fannie Merritt" → "Fannie Merritt Farmer"
    const first = String(author || '').split(';')[0].trim();
    const m = first.match(/^([^,]+),\s*([^(]+?)\s*(?:\(.*\))?$/);
    return m ? `${m[2].trim()} ${m[1].trim()}` : first;
  }

  function credit(book) {
    const by = book.author ? ` by ${authorName(book.author)}` : '';
    return {
      text: `From “${shortTitle(book.title)}”${by}, via ${book.via}.`,
      licence: 'Public domain',
      licenceUrl: '',
    };
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // The course of a recipe's chapter in its book (scripts/build_books.py, CHAPTER_WORDS).
  const COURSE_CODES = { m: 'main', s: 'side', p: 'soup', t: 'starter', x: 'sauce', d: 'dessert', o: 'other' };

  function toRecipe(index, entry) {
    const book = index.books[entry.b];
    return {
      courseHint: COURSE_CODES[entry.course] || '',
      id: `book-${book.id}-${entry.k}`,
      dedupeKey: `${book.id}|${Core.normalize(entry.name)}`,
      sourceName: shortTitle(book.title),
      sourceGroup: 'Classic cookbooks',
      book: book.id,
      k: entry.k,
      name: entry.name,
      image: '',
      thumb: '',
      area: authorName(book.author),
      category: '',
      tags: [],
      source: book.link,
      sourceLabel: 'Read the book ↗',
      youtube: '',
      credit: credit(book),
      steps: [],
      keys: entry.keys,
      ingredients: entry.keys.map((key) => {
        const optional = key < 0;
        const word = index.words[optional ? -key - 1 : key];
        return { name: capitalise(word), match: word, measure: '', optional };
      }),
      complete: false,
      completeWith: 'books',
    };
  }

  /*
   * Recipes that use at least one of your main ingredients and need few others. Each
   * ingredient name in the books is checked once against everything you have, which gives
   * every recipe a quick count of what it would need; the app then matches the shortlist
   * properly.
   *   mains: your main ingredients; options.pantry / options.basics: everything you have.
   */
  async function findRecipes(mains, { fetchImpl, pantry, basics } = {}) {
    const index = await loadIndex(fetchImpl);
    const all = pantry || mains;
    const myBasics = basics || [];
    const mainIds = new Set();
    const covered = new Uint8Array(index.words.length);
    index.words.forEach((w, i) => {
      if (mains.some((m) => Core.ingredientMatches(m, w))) mainIds.add(i);
      if (all.some((p) => Core.ingredientMatches(p, w)) || Core.coveredByBasics(myBasics, w)) covered[i] = 1;
    });
    const shortlist = [];
    for (const entry of index.recipes) {
      let usesMain = 0;
      let missing = 0;
      for (const key of entry.keys) {
        if (key < 0) continue; // optional
        if (mainIds.has(key)) usesMain++;
        if (!covered[key]) missing++;
      }
      if (usesMain && missing <= MAX_MISSING) shortlist.push({ entry, missing, usesMain });
    }
    shortlist.sort((a, b) => a.missing - b.missing || b.usesMain - a.usesMain);
    return shortlist.slice(0, MAX_CANDIDATES).map((s) => toRecipe(index, s.entry));
  }

  /* One of a book's recipes by its id ("book-<book>-<k>"), for following a link. */
  async function recipeById(id, { fetchImpl } = {}) {
    const m = String(id).match(/^book-(.+)-(\d+)$/);
    if (!m) return null;
    const index = await loadIndex(fetchImpl);
    const book = index.books.find((b) => b.id === m[1]);
    const k = Number(m[2]);
    if (!book || k >= book.count) return null;
    return toRecipe(index, index.recipes[book.start + k]);
  }

  /*
   * Adds quantities and the method when a recipe is opened. An ingredient that is another
   * recipe of the book ("white broth (No. 99)") becomes a link, and so does "(No. 99)" in the
   * method: the method holds ⟦k⟧ for those, listed in `links`.
   */
  async function completeRecipe(recipe, { fetchImpl } = {}) {
    if (recipe.complete) return recipe;
    const [index, details] = await Promise.all([loadIndex(fetchImpl), loadBook(recipe.book, fetchImpl)]);
    const [ingredients, steps, time, serves] = details[recipe.k] || [[], [], '', ''];
    const book = index.books.find((b) => b.id === recipe.book);
    const linkTo = (k) => ({ id: `book-${recipe.book}-${k}`, name: index.recipes[book.start + k].name });
    // The book's own wording and quantities, matched by the same names as the search used,
    // so the recipe screen agrees with the card. Linked recipes aren't in the search names.
    const keys = recipe.keys || [];
    let next = 0;
    const links = {};
    for (const step of steps) for (const m of step.matchAll(/\u27e6(\d+)\u27e7/g)) links[m[1]] = linkTo(Number(m[1]));
    return Object.assign({}, recipe, {
      ingredients: ingredients.length
        ? ingredients.map(([name, measure, link]) => {
          if (link !== undefined) return { name, measure, subRecipe: linkTo(link) };
          const key = keys[next++];
          const optional = key !== undefined && key < 0;
          const match = key === undefined ? undefined : index.words[optional ? -key - 1 : key];
          return { name, measure, match, optional: optional || undefined };
        })
        : recipe.ingredients,
      steps,
      links,
      category: time ? `Takes ${/\d/.test(time) ? time.charAt(0).toLowerCase() + time.slice(1) : time.toLowerCase()}` : '',
      tags: serves ? [`Serves ${serves.replace(/^for\s+/i, '')}`] : [],
      complete: true,
    });
  }

  const api = { findRecipes, completeRecipe, recipeById, _internal: { authorName, shortTitle, reset: () => { indexLoading = null; bookLoading.clear(); } } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Books = api;
})(typeof self !== 'undefined' ? self : this);

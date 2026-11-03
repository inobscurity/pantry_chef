/*
 * Recipes from the Wikibooks Cookbook (https://en.wikibooks.org/wiki/Cookbook:Recipes),
 * written by volunteers and licensed CC BY-SA 4.0. Read through Wikimedia's official API,
 * which browsers may call directly. No key needed.
 *
 * For each of your ingredients we search the Cookbook, keep the pages that turn up for
 * the most of your ingredients, then read each page's "Ingredients" and "Procedure"
 * sections. Pages without both (ingredient articles, indexes) are skipped.
 */
(function (root) {
  'use strict';

  const Core = root.RecipeCore || (typeof require !== 'undefined' ? require('./core.js') : null);
  const API = 'https://en.wikibooks.org/w/api.php';
  const WIKI = 'https://en.wikibooks.org/wiki/';
  const COOKBOOK_NAMESPACE = 102;
  const PER_INGREDIENT = 30;
  const MAX_PAGES = 40;
  const CREDIT = {
    text: 'From the Wikibooks Cookbook, written by its contributors.',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  };

  const memory = new Map();

  async function api(params, fetchImpl) {
    const query = new URLSearchParams(Object.assign({ format: 'json', formatversion: 2, origin: '*' }, params)).toString();
    if (memory.has(query)) return memory.get(query);
    const res = await (fetchImpl || root.fetch.bind(root))(API + '?' + query);
    if (!res.ok) throw new Error(`Wikibooks answered ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error('Wikibooks: ' + (data.error.info || data.error.code));
    memory.set(query, data);
    return data;
  }

  // ---- wikitext → plain text --------------------------------------------------------

  const FRACTIONS = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };

  function decodeEntities(s) {
    return s
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&deg;/g, '°').replace(/&frac12;/g, '½')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, '&');
  }

  function clean(text) {
    let s = String(text || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<ref[^>]*\/>/gi, '')
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ');
    // Templates that carry text we want; then drop the rest, innermost first.
    s = s.replace(/\{\{\s*frac\s*\|\s*([^|}]+)\|([^|}]+)\|([^|}]+)\}\}/gi, '$1 $2/$3')
      .replace(/\{\{\s*frac\s*\|\s*([^|}]+)\|([^|}]+)\}\}/gi, '$1/$2')
      .replace(/\{\{\s*(?:convert|cvt)\s*\|\s*([^|}]+)\|([^|}]+)[^}]*\}\}/gi, '$1 $2');
    for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, '');
    s = s
      .replace(/\[\[(?:File|Image|Category):[^\]]*(?:\[\[[^\]]*\]\][^\]]*)*\]\]/gi, '')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, (_, label) => label.replace(/^Cookbook:/i, ''))
      .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
      .replace(/\[(?:https?:)?\/\/[^\]]+\]/g, '')
      .replace(/'{2,}/g, '')
      .replace(/<[^>]+>/g, '');
    return decodeEntities(s).replace(/[ \t]+/g, ' ').trim();
  }

  // ---- ingredient lines -------------------------------------------------------------

  const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛]|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|half)`;
  const UNIT = String.raw`(?:cups?|c\.|tablespoons?|tbsps?|tbs|tbsp|teaspoons?|tsps?|tsp|grams?|g|kilograms?|kg|millilit(?:re|er)s?|ml|lit(?:re|er)s?|l|pounds?|lbs?|ounces?|oz|fl\.?\s*oz|pinch(?:es)?|dash(?:es)?|cloves?|cans?|tins?|jars?|packets?|packages?|pkgs?|sticks?|slices?|bunch(?:es)?|handfuls?|sprigs?|pieces?|heads?|stalks?|sheets?|knobs?|drops?|quarts?|pints?|gallons?)`;
  const QUANTITY = new RegExp(
    String.raw`^(?:(?:about|approx\.?|approximately|around)\s+)?(${NUMBER}(?:\s*(?:-|–|to)\s*${NUMBER})?(?:\s*${UNIT}\b\.?)?)\s+(?:of\s+)?(.+)$`, 'i');

  function capitalise(s) {
    s = String(s || '').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /* "2 cups plain flour, sifted" → { name: "Plain flour, sifted", measure: "2 cups" } */
  function parseIngredient(line) {
    let text = clean(line).replace(/^[-–•]\s*/, '');
    for (const [k, v] of Object.entries(FRACTIONS)) text = text.split(k).join(' ' + v).replace(/^\s+/, '');
    text = text.replace(/(\d)\s+(?=\d\/)/g, '$1 ').replace(/(\d)([a-zA-Z])/, '$1 $2'); // "500g" → "500 g"
    let measure = '';
    let name = text;
    const m = text.match(QUANTITY);
    if (m && !/^(a|an)$/i.test(m[1].trim())) { measure = m[1].trim(); name = m[2]; }
    // "2 cans (28 oz) broth": the bracket belongs to the quantity.
    const size = measure && name.match(/^(\([^)]*\))\s*(.+)$/);
    if (size) { measure += ' ' + size[1]; name = size[2]; }
    const toTaste = /,?\s*\b(to taste|as needed|as required)\b\.?\s*$/i;
    if (toTaste.test(name)) {
      measure = measure || name.match(toTaste)[1].toLowerCase();
      name = name.replace(toTaste, '');
    }
    name = capitalise(name.replace(/^[,;:\s]+|[,;:\s.]+$/g, ''));
    return name ? { name, measure } : null;
  }

  // ---- whole pages ------------------------------------------------------------------

  function sectionKind(heading) {
    if (/ingredient/i.test(heading)) return 'ingredients';
    if (/procedure|method|direction|instruction|preparation|steps/i.test(heading)) return 'procedure';
    return 'other';
  }

  function summaryParams(wikitext) {
    const block = wikitext.match(/\{\{\s*recipe summary([\s\S]*?)\n\s*\}\}/i);
    const out = {};
    if (!block) return out;
    for (const m of block[1].matchAll(/\|\s*(\w+)\s*=\s*([^\n]*)/g)) out[m[1].toLowerCase()] = m[2].trim();
    return out;
  }

  function imageUrl(value) {
    const name = String(value || '').replace(/^\[\[\s*(?:File|Image):/i, '').split('|')[0].replace(/\]\]$/, '').trim();
    if (!name || !/\.(jpe?g|png|gif|webp|svg)$/i.test(name)) return '';
    return WIKI + 'Special:FilePath/' + encodeURIComponent(name.replace(/ /g, '_')) + '?width=480';
  }

  /*
   * Reads a Cookbook page. Returns null unless it has both ingredients and steps.
   */
  function parsePage(title, wikitext, thumbnail) {
    const ingredients = [];
    const steps = [];
    const paragraphs = [];
    let kind = 'other';
    let topLevel = 99;
    let inTable = false;
    let row = [];

    const flushRow = () => {
      const cells = row.map(clean).filter((c, i) => i === 0 || c);
      if (cells.length && cells[0]) {
        const item = parseIngredient(cells[0]);
        if (item) {
          const measures = cells.slice(1).filter(Boolean).join(' / ');
          if (measures) item.measure = measures;
          ingredients.push(item);
        }
      }
      row = [];
    };

    for (const raw of String(wikitext || '').replace(/\r/g, '').split('\n')) {
      const line = raw.trim();
      const h = line.match(/^(={2,6})\s*(.+?)\s*\1$/);
      if (h) {
        if (inTable) { flushRow(); inTable = false; }
        const level = h[1].length;
        if (level <= topLevel) { kind = sectionKind(h[2]); topLevel = level; }
        continue;
      }
      if (kind === 'ingredients') {
        if (line.startsWith('{|')) { inTable = true; row = []; continue; }
        if (inTable) {
          if (line.startsWith('|}')) { flushRow(); inTable = false; } else if (line.startsWith('|-')) flushRow();
          else if (line.startsWith('|+') || line.startsWith('!')) continue;
          else if (line.startsWith('|')) row.push(...line.slice(1).split('||').map((c) => c.replace(/^[^|[]*\|(?!\|)/, (m) => (/=/.test(m) ? '' : m))));
          continue;
        }
        const bullet = line.match(/^\*+\s*(.*)$/);
        if (bullet) {
          const item = parseIngredient(bullet[1]);
          if (item) ingredients.push(item);
        }
      } else if (kind === 'procedure') {
        const numbered = line.match(/^#+([:*]?)\s*(.*)$/);
        const bullet = line.match(/^\*+\s*(.*)$/);
        if (numbered) {
          const text = clean(numbered[2]);
          if (!text) continue;
          if (numbered[1] && steps.length) steps[steps.length - 1] += ' ' + text;
          else steps.push(text);
        } else if (bullet && clean(bullet[1])) {
          paragraphs.push(clean(bullet[1]));
        } else if (line && !/^[{|}!:;]/.test(line) && clean(line)) {
          paragraphs.push(clean(line));
        }
      }
    }
    if (inTable) flushRow();

    const method = steps.length ? steps : paragraphs;
    if (ingredients.length < 2 || !method.length) return null;

    const params = summaryParams(wikitext);
    const name = title.replace(/^Cookbook:/, '');
    const image = (thumbnail && thumbnail.source) || imageUrl(params.image);
    return {
      id: 'wiki-' + name.replace(/\s+/g, '_'),
      sourceName: 'Wikibooks Cookbook',
      name,
      image,
      thumb: image,
      area: '',
      category: params.time ? `Takes ${clean(params.time)}` : '',
      tags: params.servings ? [`Serves ${clean(params.servings)}`] : [],
      source: WIKI + encodeURIComponent(title.replace(/ /g, '_')).replace(/%3A/g, ':'),
      youtube: '',
      credit: CREDIT,
      steps: method,
      ingredients,
      complete: true,
    };
  }

  // ---- search -----------------------------------------------------------------------

  async function findRecipes(pantry, { fetchImpl } = {}) {
    const hits = new Map(); // title → Set of pantry indexes
    const searches = await Promise.allSettled(pantry.map((item) => api({
      action: 'query',
      list: 'search',
      srsearch: `${item} ingredients`,
      srnamespace: COOKBOOK_NAMESPACE,
      srlimit: PER_INGREDIENT,
      srprop: '',
    }, fetchImpl)));
    if (searches.length && searches.every((s) => s.status === 'rejected')) throw searches[0].reason;
    searches.forEach((s, i) => {
      if (s.status !== 'fulfilled') return;
      for (const r of (s.value.query && s.value.query.search) || []) {
        if (!hits.has(r.title)) hits.set(r.title, new Set());
        hits.get(r.title).add(i);
      }
    });

    const titles = [...hits.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, MAX_PAGES).map(([t]) => t);
    const batches = [];
    for (let i = 0; i < titles.length; i += 20) batches.push(titles.slice(i, i + 20));
    const pages = await Promise.allSettled(batches.map((batch) => api({
      action: 'query',
      prop: 'revisions|pageimages',
      rvprop: 'content',
      rvslots: 'main',
      piprop: 'thumbnail',
      pithumbsize: 480,
      titles: batch.join('|'),
    }, fetchImpl)));
    if (pages.length && pages.every((p) => p.status === 'rejected')) throw pages[0].reason;

    const recipes = [];
    for (const p of pages) {
      if (p.status !== 'fulfilled') continue;
      for (const page of (p.value.query && p.value.query.pages) || []) {
        const rev = page.revisions && page.revisions[0];
        const text = rev && ((rev.slots && rev.slots.main && rev.slots.main.content) || rev.content);
        const recipe = text && parsePage(page.title, text, page.thumbnail);
        if (recipe && recipe.ingredients.some((ing) => pantry.some((x) => Core.ingredientMatches(x, ing.name)))) {
          recipes.push(recipe);
        }
      }
    }
    return recipes;
  }

  const api_ = { findRecipes, _internal: { clean, parseIngredient, parsePage } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
  else root.Wikibooks = api_;
})(typeof self !== 'undefined' ? self : this);

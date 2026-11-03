# Classic cookbooks

`index.json` and the `<id>.json` files hold recipes read from out-of-copyright cookbooks by
`scripts/build_books.py`. Only the recipes are kept (name, ingredients, method), not the books.

- Books with a number for an id come from [Project Gutenberg](https://www.gutenberg.org); the
  book is at `https://www.gutenberg.org/ebooks/<id>`.
- `glasse-1747` is Hannah Glasse, *The Art of Cookery Made Plain and Easy* (1747), from the scan at
  https://archive.org/details/TheArtOfCookery, corrected for long-s scanning errors with
  `scripts/fix_long_s.py`.

To rebuild: download the books' plain-text files into a folder named by id, make a catalogue
from Gutenberg's `pg_catalog.csv` (entries with `Text#`, `Title`, `Authors`), and run

    python3 -I scripts/build_books.py TEXTS_DIR CATALOG.json --extra EXTRA.json

where `EXTRA.json` lists non-Gutenberg books, e.g.
`[{"Text#": "glasse-1747", "Title": "...", "Authors": "Glasse, Hannah", "path": "...", "link": "...", "via": "the Internet Archive", "ocr": true}]`.

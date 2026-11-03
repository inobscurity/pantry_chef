"""Corrects the long-s scanning errors in 18th-century books ("falt" for salt, "fifh" for fish).

    python3 -I scripts/fix_long_s.py SCAN.txt REFERENCE_TEXTS_DIR OUT.txt

Old printing used a long s (ſ) that scanners read as "f" (sometimes "l"). For each word containing an "f",
every spelling with some of its f's turned into s's is tried, and the one used most often in
the reference texts (proofread cookbooks) wins. Real words such as "flour" or "of" are far more
common as written, so they stay.
"""
import collections
import itertools
import pathlib
import re
import sys


def word_counts(folder):
    counts = collections.Counter()
    for path in pathlib.Path(folder).glob('*.txt'):
        counts.update(re.findall(r"[a-z]+", path.read_text(encoding='utf-8', errors='replace').lower()))
    return counts


def fix_word(word, counts):
    low = word.lower()
    spots = [i for i, ch in enumerate(low) if ch in 'fl']   # long s is read as f, sometimes as l
    if not spots or len(spots) > 4:
        return word
    best, best_n = low, counts.get(low, 0)
    for k in range(1, len(spots) + 1):
        for chosen in itertools.combinations(spots, k):
            cand = ''.join('s' if i in chosen else ch for i, ch in enumerate(low))
            n = counts.get(cand, 0)
            if n > max(best_n * 5, 2):
                best, best_n = cand, n
    if best == low:
        return word
    return ''.join(b.upper() if w.isupper() else b for w, b in zip(word, best))


def main(scan, reference, out):
    counts = word_counts(reference)
    text = pathlib.Path(scan).read_text(encoding='utf-8', errors='replace').replace('ſ', 's')
    fixed = re.sub(r"[A-Za-z]+", lambda m: fix_word(m.group(0), counts), text)
    pathlib.Path(out).write_text(fixed, encoding='utf-8')


if __name__ == '__main__':
    main(*sys.argv[1:4])

"""Shows which items changed shelf between two dumps made by dump-placement.mjs.
Usage: python3 scripts/catalog-placement/diff-placement.py <before.tsv> <after.tsv> [how many lines]"""
import sys


def load(path):
    rows = {}
    for line in open(path, encoding="utf8"):
        cells = line.rstrip("\n").split("\t")
        # code, shelf, [what decided], name — dumps written before the «source» column have three cells.
        rows[cells[0]] = (cells[1], cells[-1])
    return rows


before, after = load(sys.argv[1]), load(sys.argv[2])
limit = int(sys.argv[3]) if len(sys.argv) > 3 else 40
moved = [(before[code][0], after[code][0], after[code][1]) for code in after if code in before and before[code][0] != after[code][0]]
print(f"moved: {len(moved)}")
pairs = {}
for old, new, name in moved:
    pairs.setdefault((old, new), []).append(name)
shown = 0
for (old, new), names in sorted(pairs.items(), key=lambda pair: -len(pair[1])):
    print(f"--- {old} → {new}: {len(names)}")
    for name in names[:4]:
        print("     ", name[:96])
        shown += 1
    if shown >= limit:
        break

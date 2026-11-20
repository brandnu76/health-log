#!/usr/bin/env python3
"""Fail if public dashboard files name a medication.

Scans every file under docs/ (GitHub Pages). Extend TERMS to cover another
name. Matching is case-insensitive and does not require word boundaries.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

# Add a lowercase name here to extend the guard.
TERMS = (
    "wegovy",
    "semaglutide",
    "ozempic",
    "mounjaro",
    "zepbound",
    "tirzepatide",
    "empagliflozin",
    "jardiance",
    "metformin",
)


def main() -> None:
    if not DOCS.is_dir():
        print(f"missing {DOCS}", file=sys.stderr)
        sys.exit(1)

    hits: list[str] = []
    files = 0
    for path in sorted(DOCS.rglob("*")):
        if not path.is_file():
            continue
        files += 1
        try:
            text = path.read_text(encoding="utf-8", errors="replace").casefold()
        except OSError as exc:
            print(f"{path.relative_to(ROOT)}: {exc}", file=sys.stderr)
            sys.exit(1)
        for term in TERMS:
            if term.casefold() in text:
                hits.append(f"{path.relative_to(ROOT)}: {term}")

    if hits:
        print("medication names found under docs/:", file=sys.stderr)
        for hit in hits:
            print(hit, file=sys.stderr)
        sys.exit(1)

    print(f"no medication names in {files} files under docs/")


if __name__ == "__main__":
    main()

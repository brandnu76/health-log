#!/usr/bin/env python3
"""Confirm docs/sw.js names a health-log cache. Missing name is a warning."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SW_PATH = ROOT / "docs" / "sw.js"
CACHE_RE = re.compile(r"""CACHE\s*=\s*["']health-log-v\d+["']""")


def warn(message: str) -> None:
    # GitHub Actions renders this as a warning annotation. Exit stays 0.
    print(f"::warning::{message}")
    print(f"WARNING: {message}", file=sys.stderr)


def main() -> None:
    if not SW_PATH.is_file():
        warn("docs/sw.js is missing; service worker cache version was not checked")
        return
    text = SW_PATH.read_text(encoding="utf-8")
    match = CACHE_RE.search(text)
    if not match:
        warn("docs/sw.js has no health-log-vN CACHE assignment")
        return
    print(f"service worker cache version present: {match.group(0)}")


if __name__ == "__main__":
    main()

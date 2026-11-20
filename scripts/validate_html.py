#!/usr/bin/env python3
"""Lightweight HTML sanity check for docs/*.html.

Uses the stdlib parser. Void and self-closing tags are ignored. The check
fails on parser exceptions, a missing html/body, or an html/body end tag
with no matching start. It stays tolerant of optional-tag soup that the
current pages use.
"""

from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
REQUIRED = ("html", "body")
TRACKED = ("html", "head", "body")


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.started = {tag: 0 for tag in TRACKED}
        self.ended = {tag: 0 for tag in TRACKED}
        self.errors: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self.started:
            self.started[tag] += 1

    def handle_startendtag(self, tag: str, attrs) -> None:
        # XHTML-style <meta /> / <link /> are starts, not containers.
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag not in self.ended:
            return
        self.ended[tag] += 1
        if self.ended[tag] > self.started[tag]:
            self.errors.append(f"extra </{tag}>")

    def error(self, message: str) -> None:
        self.errors.append(message)


def check_file(path: Path) -> list[str]:
    parser = PageParser()
    try:
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
    except Exception as exc:  # parser or decode failure is fatal for that file
        return [f"parse error: {exc}"]
    problems = list(parser.errors)
    for tag in REQUIRED:
        if parser.started[tag] < 1:
            problems.append(f"missing <{tag}>")
    return problems


def main() -> None:
    pages = sorted(DOCS.glob("*.html"))
    if not pages:
        print("no docs/*.html files found", file=sys.stderr)
        sys.exit(1)
    failed = False
    for path in pages:
        problems = check_file(path)
        rel = path.relative_to(ROOT)
        if problems:
            failed = True
            print(f"{rel}: " + "; ".join(problems), file=sys.stderr)
        else:
            print(f"{rel}: ok")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()

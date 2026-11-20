#!/usr/bin/env python3
"""Validate docs/data.json for the public dashboard.

The dashboard reads these top-level keys:
  meta, goals, scans are required (app.js throws if they are missing).
  program, fuel, lifts, and labs are optional sections; when present they
  must be the types those renderers accept.

Scans must be a non-empty array, and every scan needs a real YYYY-MM-DD date.
Medication fields are not part of the public program card.
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "docs" / "data.json"
DATE_RE_LEN = 10
MEDICATION_KEYS = ("medication", "medicationStartDate", "medicationNote")


def fail(message: str) -> None:
    print(f"data.json: {message}", file=sys.stderr)
    sys.exit(1)


def require_dict(value, label: str) -> dict:
    if not isinstance(value, dict):
        fail(f"{label} must be an object")
    return value


def require_list(value, label: str) -> list:
    if not isinstance(value, list):
        fail(f"{label} must be an array")
    return value


def valid_date(value) -> bool:
    if not isinstance(value, str) or len(value) != DATE_RE_LEN:
        return False
    if value[4] != "-" or value[7] != "-":
        return False
    try:
        year, month, day = (int(value[0:4]), int(value[5:7]), int(value[8:10]))
        dt.date(year, month, day)
    except ValueError:
        return False
    return f"{year:04d}-{month:02d}-{day:02d}" == value


def main() -> None:
    if not DATA_PATH.is_file():
        fail(f"missing {DATA_PATH}")
    try:
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"invalid JSON ({exc})")

    if not isinstance(data, dict):
        fail("top-level value must be an object")

    meta = require_dict(data.get("meta"), "meta")
    ref = require_dict(meta.get("visceralReference"), "meta.visceralReference")
    for key in ("healthy", "excess", "higherRisk"):
        if not isinstance(ref.get(key), str) or not ref[key].strip():
            fail(f"meta.visceralReference.{key} must be a non-empty string")
    if "devices" in meta:
        require_list(meta["devices"], "meta.devices")
    if "subject" in meta and not isinstance(meta["subject"], dict):
        fail("meta.subject must be an object")

    goals = require_dict(data.get("goals"), "goals")
    if "items" in goals:
        require_list(goals["items"], "goals.items")
    if "notes" in goals:
        require_list(goals["notes"], "goals.notes")
    if "targets" in goals and not isinstance(goals["targets"], dict):
        fail("goals.targets must be an object")

    scans = require_list(data.get("scans"), "scans")
    if not scans:
        fail("scans must be a non-empty array")
    for index, scan in enumerate(scans):
        if not isinstance(scan, dict):
            fail(f"scans[{index}] must be an object")
        if not valid_date(scan.get("date")):
            fail(f"scans[{index}] must have a YYYY-MM-DD date")

    if "program" in data:
        program = require_dict(data["program"], "program")
        for key in MEDICATION_KEYS:
            if key in program:
                fail(f"program.{key} must not be published")
    for key in ("fuel", "lifts", "labs"):
        if key in data:
            require_list(data[key], key)

    print(
        f"data.json ok: {len(scans)} scans, "
        f"keys {', '.join(sorted(data))}"
    )


if __name__ == "__main__":
    main()

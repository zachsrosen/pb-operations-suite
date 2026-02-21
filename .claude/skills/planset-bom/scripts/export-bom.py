#!/usr/bin/env python3
"""
PB Operations Suite — Planset BOM Exporter
Exports a BOM dict (produced by Claude from a planset) to CSV, JSON, and Markdown.

Usage:
    # Claude reads the planset and builds the BOM dict, then calls:
    python3 export-bom.py bom.json
    # Outputs: bom.csv, bom.md, bom_pretty.json in the same directory
"""

import json
import csv
import sys
import os
from datetime import datetime

# ── Column order for CSV ──────────────────────────────────────────────────────
CSV_COLUMNS = [
    "category", "brand", "model", "description",
    "qty", "unitSpec", "unitLabel", "source", "flags"
]

# ── Category display order ────────────────────────────────────────────────────
CATEGORY_ORDER = [
    "MODULE",
    "BATTERY",
    "INVERTER",
    "EV_CHARGER",
    "RAPID_SHUTDOWN",
    "RACKING",
    "ELECTRICAL_BOS",
    "MONITORING",
]

CATEGORY_LABELS = {
    "MODULE": "Modules",
    "BATTERY": "Storage & Inverter",
    "INVERTER": "Inverter",
    "EV_CHARGER": "EV Charger",
    "RAPID_SHUTDOWN": "Rapid Shutdown",
    "RACKING": "Racking & Mounting",
    "ELECTRICAL_BOS": "Electrical BOS",
    "MONITORING": "Monitoring & Controls",
}


def load_bom(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


def export_csv(bom: dict, out_path: str):
    items = bom.get("items", [])
    with open(out_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for item in sorted(items, key=lambda x: (CATEGORY_ORDER.index(x["category"]) if x["category"] in CATEGORY_ORDER else 99, x.get("brand") or "")):
            row = {col: item.get(col, "") or "" for col in CSV_COLUMNS}
            if isinstance(row["flags"], list):
                row["flags"] = ", ".join(row["flags"])
            writer.writerow(row)
    print(f"✅ CSV:      {out_path}")


def export_json(bom: dict, out_path: str):
    with open(out_path, "w") as f:
        json.dump(bom, f, indent=2)
    print(f"✅ JSON:     {out_path}")


def export_markdown(bom: dict, out_path: str):
    proj = bom.get("project", {})
    items = bom.get("items", [])
    validation = bom.get("validation", {})

    lines = []

    # Header
    customer = proj.get("customer", "Unknown")
    address = proj.get("address", "")
    rev = proj.get("plansetRev", "")
    stamp = proj.get("stampDate", "")
    kwdc = proj.get("systemSizeKwdc", "")
    kwac = proj.get("systemSizeKwac", "")
    mod_count = proj.get("moduleCount", "")
    utility = proj.get("utility", "")
    ahj = proj.get("ahj", "")

    lines.append(f"# BOM — {customer}")
    lines.append(f"**Address:** {address}  ")
    lines.append(f"**System:** {mod_count} modules | {kwdc} kWdc / {kwac} kWac  ")
    lines.append(f"**Rev:** {rev} | **Stamped:** {stamp}  ")
    lines.append(f"**Utility:** {utility} | **AHJ:** {ahj}  ")
    lines.append(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  ")
    lines.append("")

    # Group items by category
    grouped: dict[str, list] = {}
    for item in items:
        cat = item.get("category", "OTHER")
        grouped.setdefault(cat, []).append(item)

    # Render each category group
    for cat in CATEGORY_ORDER + [c for c in grouped if c not in CATEGORY_ORDER]:
        cat_items = grouped.get(cat)
        if not cat_items:
            continue
        label = CATEGORY_LABELS.get(cat, cat)
        lines.append(f"## {label}")
        lines.append("")
        lines.append("| Brand | Model | Description | Qty | Spec | Source |")
        lines.append("|-------|-------|-------------|-----|------|--------|")
        for item in cat_items:
            brand = item.get("brand") or "—"
            model = item.get("model") or "—"
            desc = item.get("description") or ""
            qty = item.get("qty", "")
            spec = item.get("unitSpec") or ""
            source = item.get("source") or ""
            flags = item.get("flags") or []
            flag_str = f" ⚠️ {', '.join(flags)}" if flags else ""
            lines.append(f"| {brand} | {model} | {desc}{flag_str} | {qty} | {spec} | {source} |")
        lines.append("")

    # Validation section
    lines.append("## Validation")
    lines.append("")
    checks = [
        ("moduleCountMatch", "Module count matches string layout"),
        ("batteryCapacityMatch", "Battery capacity confirmed on PV-6"),
        ("ocpdMatch", "OCPD rating matches AC disconnect"),
    ]
    for key, label in checks:
        val = validation.get(key)
        if val is True:
            lines.append(f"- ✅ {label}")
        elif val is False:
            lines.append(f"- ❌ {label}")
        else:
            lines.append(f"- ⚪ {label} (not checked)")

    warnings = validation.get("warnings", [])
    for w in warnings:
        lines.append(f"- ⚠️ {w}")

    lines.append("")

    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"✅ Markdown: {out_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 export-bom.py <bom.json>")
        print("")
        print("Input: JSON file with BOM structure (see references/bom-schema.md)")
        print("Output: <name>.csv, <name>.md, <name>_pretty.json")
        sys.exit(1)

    input_path = sys.argv[1]
    if not os.path.exists(input_path):
        print(f"Error: {input_path} not found")
        sys.exit(1)

    bom = load_bom(input_path)

    base = os.path.splitext(input_path)[0]
    export_csv(bom, f"{base}.csv")
    export_markdown(bom, f"{base}.md")
    export_json(bom, f"{base}_pretty.json")

    print("")
    print("Done. Files ready for:")
    print(f"  CSV  → import into inventory system or Google Sheets")
    print(f"  MD   → paste into Notion, docs, or job notes")
    print(f"  JSON → POST to /api/inventory/sync-skus")


if __name__ == "__main__":
    main()

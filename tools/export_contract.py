"""Export the four-class CBC contract for the Node backend (and later the frontend).

Everything comes from Module 3: feature/class order, canonical units and plausible
ranges from schema.py, and the accepted unit aliases with their conversion factors
by probing fedhealth_ml.preprocess.normalize_units itself (candidates are the unit
strings found in that function's constants). Nothing is typed in by hand except
display labels, so tests/test_integration_contract.py can fail on any drift.

    python tools/export_contract.py            # write the JSON files
    python tools/export_contract.py --check    # exit 1 if a written file is stale
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fedhealth_ml import schema  # noqa: E402
from fedhealth_ml import preprocess  # noqa: E402

TARGETS = [ROOT / "Module 1-2 Merged Backend/src/contract/cbcContract.json"]

FEATURE_LABELS = {
    "WBC": "White blood cells (WBC / TLC)", "RBC": "Red blood cells (RBC)",
    "HGB": "Haemoglobin (Hb)", "HCT": "Haematocrit (HCT / PCV)",
    "MCV": "Mean corpuscular volume (MCV)", "MCH": "Mean corpuscular haemoglobin (MCH)",
    "MCHC": "Mean corpuscular haemoglobin concentration (MCHC)",
    "RDW": "Red cell distribution width (RDW-CV)", "PLT": "Platelets (PLT)",
    "NEUTp": "Neutrophils (%)",
}
CLASS_LABELS = {"healthy": "Healthy", "anemia": "Anemia", "thalassemia": "Thalassemia", "leukemia": "Leukemia"}
# Fields stored with a report that the trained model never sees.
NOT_MODEL_INPUTS = ["sex", "ageYears", "symptoms", "district", "province", "latitude", "longitude",
                    "collectedAt", "rule_flags"]


def _candidate_units():
    found = set(schema.UNITS.values())
    for const in preprocess.normalize_units.__code__.co_consts:
        values = const if isinstance(const, tuple) else (const,)
        found.update(v for v in values if isinstance(v, str) and len(v) <= 16)
    return sorted(found)


def accepted_units():
    """{feature: {normalized_unit: factor}} exactly as normalize_units accepts them."""
    original = preprocess.clean_ranges
    preprocess.clean_ranges = lambda *a, **k: None  # read raw factors; ranges are exported separately
    try:
        table = {}
        for feature in schema.FEATURES:
            table[feature] = {}
            for unit in _candidate_units():
                try:
                    factor = preprocess.normalize_units({feature: 1.0}, units={feature: unit})[feature]
                except ValueError as exc:
                    if str(exc).startswith("Unsupported unit"):
                        continue
                    raise
                table[feature][preprocess._unit(unit)] = factor
        return table
    finally:
        preprocess.clean_ranges = original


def build():
    units = accepted_units()
    return {
        "generated_by": "tools/export_contract.py",
        "schema_version": schema.SCHEMA_VERSION,
        "model_name": schema.MODEL_NAME,
        "features": schema.FEATURES,
        "classes": schema.CLASSES,
        "class_labels": CLASS_LABELS,
        "feature_labels": FEATURE_LABELS,
        "canonical_units": schema.UNITS,
        "plausible_ranges": {f: list(schema.PLAUSIBLE_RANGES[f]) for f in schema.FEATURES},
        "accepted_units": units,
        "unit_normalization": "strip spaces; lowercase; µ/μ->u; ³->^3; ⁶->^6; mm3->mm^3 (fedhealth_ml.preprocess._unit)",
        "not_model_inputs": NOT_MODEL_INPUTS,
    }


def render():
    return json.dumps(build(), indent=2, ensure_ascii=False) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    text = render()
    stale = []
    for target in TARGETS:
        if args.check:
            # Compare LF-normalized: a Windows checkout may have converted the file to CRLF.
            if not target.exists() or target.read_text(encoding="utf-8").replace("\r\n", "\n") != text:
                stale.append(target)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="\n")
            print(f"wrote {target.relative_to(ROOT)}")
    if stale:
        print("Stale contract file(s): " + ", ".join(str(t.relative_to(ROOT)) for t in stale))
        sys.exit(1)


if __name__ == "__main__":
    main()

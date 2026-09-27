"""The four-class CBC contract; order is part of every artifact.

Single source of truth for the model's input/output contract: the 10 CBC
feature names (and their fixed order, which every array/tensor in the
pipeline relies on), the 4 diagnostic classes, expected units, plausible
value ranges, and the dataset content hashes every run is verified against.
Every other module imports from here instead of hard-coding these values.
"""
FEATURES = ["WBC", "RBC", "HGB", "HCT", "MCV", "MCH", "MCHC", "RDW", "PLT", "NEUTp"]
CLASSES = ["healthy", "anemia", "thalassemia", "leukemia"]  # class index order used everywhere labels are encoded
MODEL_NAME = "cbc_multiclass"
SCHEMA_VERSION = "cbc-four-class-v1"
UNITS = dict(zip(FEATURES, ["10^3/uL", "10^6/uL", "g/dL", "%", "fL", "pg", "g/dL", "%", "10^3/uL", "%"]))
# Sanity bounds per feature; values outside these are rejected/treated as missing (see preprocess.clean_ranges).
PLAUSIBLE_RANGES = {
    "WBC": (0.5, 200.), "RBC": (1., 8.), "HGB": (2., 24.),
    "HCT": (5., 70.), "MCV": (40., 140.), "MCH": (10., 50.),
    "MCHC": (20., 40.), "RDW": (9., 40.), "PLT": (1., 1500.), "NEUTp": (0., 100.),
}
# Compatibility names denote the NEW contract; there is no second model track.
MODEL_A_FEATURES = FEATURES
MODEL_A_CLASSES = CLASSES
MODEL_A_UNITS = UNITS
DATA_COLUMNS = ["row_id", "label", "subtype", *FEATURES, "split"]
# Pinned SHA-256 of the released dataset/provenance CSVs; Dataset() refuses to
# train on a CSV whose content hash does not match (see data.py).
CANONICAL_DATA_SHA256 = "ec5dba6d3a72ae479bac9856ed368128565596fa7353e733531b0c11ee29ff04"
CANONICAL_PROVENANCE_SHA256 = "2237688f1f33a1929b2a6aed66acd2fe0c5ab38bc94e315b2a6137c9bbfdfbbc"


def mentzer_index(mcv, rbc):
    """Classic MCV/RBC ratio used as a manual thalassemia-screening heuristic
    (research-only, see rules.py). Returns None instead of raising on bad input."""
    try:
        return float(mcv) / float(rbc) if float(rbc) > 0 else None
    except (TypeError, ValueError, ZeroDivisionError):
        return None

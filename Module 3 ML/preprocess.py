# ml/fedhealth_ml/preprocess.py
# ---------------------------------------------------------------------------
# Deterministic CBC preprocessing shared by every tier. The KEY invariant for
# federated learning: given the same feature list + the same fitted preprocessor
# (imputer + scaler), every lab node and the inference service turn a raw CBC
# row into the exact same model input vector.
#
# Pipeline:  raw df --clean_ranges--> NaN for impossible values
#                   --median impute (fit on TRAIN only)--> no NaN
#                   --StandardScaler (fit on TRAIN only)--> model-ready matrix
#
# The fitted preprocessor is saved with joblib and shipped to the FL clients +
# inference service so they never re-fit (which would leak / drift).
# ---------------------------------------------------------------------------
import numpy as np
import pandas as pd
import joblib
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split

from . import schema


# --- Cleaning ---------------------------------------------------------------
def clean_ranges(df, features):
    """Return a copy where out-of-range values (per schema.PLAUSIBLE_RANGES)
    are replaced with NaN, to be imputed later. Range lookup is case-insensitive
    so it works for both Model A (UPPER) and Model B (lower) column names."""
    out = df[features].copy().astype(float)
    for col in features:
        # Match the range key whether the feature is UPPER (Model A: 'WBC',
        # 'LYMp'), lower (Model B: 'mcv'), or mixed. Try exact, then upper.
        rng = schema.PLAUSIBLE_RANGES.get(col) or schema.PLAUSIBLE_RANGES.get(col.upper())
        if rng is None:
            continue
        lo, hi = rng
        mask = (out[col] < lo) | (out[col] > hi)
        out.loc[mask, col] = np.nan
    return out


# --- Unit normalization (ingestion only) ------------------------------------
# Real lab reports (IDC, Chughtai, Shaukat Khanum, ...) express some indices in
# different units than the model's training scale. The most common mismatches:
#   * WBC / PLT / absolute counts: reported per µL or per mm³ (e.g. WBC 9,010,
#     PLT 147,000) while the model expects 10^3/µL (9.01, 147)  -> ×1e-3
#   * Haemoglobin: sometimes g/L (e.g. 124) instead of g/dL (12.4)            -> ×0.1
#   * RBC: sometimes per µL (e.g. 4,470,000) instead of 10^6/µL (4.47)        -> ×1e-6
# Candidate conversion factors per feature, tried in order.
_UNIT_CANDIDATE_FACTORS = {
    "WBC":   [1e-3],
    "PLT":   [1e-3],
    "LYMN":  [1e-3],
    "NEUTN": [1e-3],
    "HGB":   [0.1],
    "RBC":   [1e-6, 1e-3],
    "HCT":   [0.01],      # if reported as a fraction (0.38) instead of % (38)
}


def normalize_units(record, features=None):
    """Rescale a single RAW CBC record (dict) into the model's expected units.

    For each feature, if the value already sits inside its physiologically
    plausible range it is left untouched (correctly-scaled inputs are a no-op).
    If it is OUT of range but a standard unit conversion brings it IN range, that
    conversion is applied — so a report giving WBC 9,010 /mm³ becomes 9.01
    10³/µL, PLT 147,000 becomes 147, and so on.

    Applied at INGESTION points (OCR, manual entry, LIMS wrapper) BEFORE
    clean_ranges. It is deliberately NOT applied to the training-data loaders,
    whose values are already canonical — there, an out-of-range value is a data
    error to be nulled, not a unit to be rescued.

    Returns a new dict; unknown keys pass through unchanged.
    """
    out = dict(record)
    feats = features or list(out.keys())
    for f in feats:
        if f not in out or out[f] is None or out[f] == "":
            continue
        try:
            v = float(out[f])
        except (TypeError, ValueError):
            continue
        rng = schema.PLAUSIBLE_RANGES.get(f) or schema.PLAUSIBLE_RANGES.get(f.upper())
        if rng is None:
            out[f] = v
            continue
        lo, hi = rng
        if lo <= v <= hi:
            out[f] = v                      # already correct scale
            continue
        for factor in _UNIT_CANDIDATE_FACTORS.get(f.upper(), []):
            if lo <= v * factor <= hi:
                out[f] = v * factor         # rescued by a known unit conversion
                break
        else:
            out[f] = v                      # leave as-is; clean_ranges will null it
    return out


# --- Dataset loaders --------------------------------------------------------
def load_anemia(path):
    """Load the anemia CBC dataset -> (X_raw, y_keys).
    y_keys are snake_case class keys (schema.ANEMIA_LABEL_MAP). Leukemia rows in
    this file ARE our leukemia signal (the separate biased_leukemia file is
    intentionally NOT used — see notebook 01 for the evidence)."""
    df = pd.read_csv(path)
    X = clean_ranges(df, schema.MODEL_A_FEATURES)
    y = df["Diagnosis"].map(schema.ANEMIA_LABEL_MAP)
    unknown = df["Diagnosis"][y.isna()].unique()
    if len(unknown):
        raise ValueError(f"Unmapped Diagnosis labels: {list(unknown)}")
    return X.reset_index(drop=True), y.reset_index(drop=True)


def load_thal(path, label_col="phenotype", label_map=None, features=None):
    """Load a thalassemia-TRAIT screening dataset -> (X_raw, y_keys).

    Dataset-agnostic so you can drop in whichever beta-thal-trait CBC dataset you
    source (notebook 04 lists options). Override the defaults to match its schema:
      label_col : the column holding the class (default 'phenotype')
      label_map : {raw_label -> class_key}. Defaults to schema.THAL_LABEL_MAP;
                  lookups are lower-cased so 'BTT'/'btt' both match.
      features  : CBC feature columns (default schema.MODEL_B_FEATURES). Only the
                  columns present in the file are used.
    """
    df = pd.read_csv(path)
    feats = [c for c in (features or schema.MODEL_B_FEATURES) if c in df.columns]
    if not feats:
        raise ValueError("None of the expected CBC feature columns are present. "
                         "Pass features=[...] matching your dataset.")
    X = clean_ranges(df, feats)
    lmap = label_map or schema.THAL_LABEL_MAP
    raw = df[label_col].astype(str).str.strip().str.lower()
    y = raw.map({k.lower(): v for k, v in lmap.items()})
    unknown = df[label_col][y.isna()].unique()
    if len(unknown):
        raise ValueError(f"Unmapped {label_col} labels: {list(unknown)}. "
                         "Extend label_map to cover them.")
    return X.reset_index(drop=True), y.reset_index(drop=True)


# --- Fit / transform --------------------------------------------------------
class CBCPreprocessor:
    """Median imputer + StandardScaler bundled together, fit on training data
    only. This object is saved and reused verbatim by the FL clients and the
    inference service."""

    def __init__(self, features):
        self.features = list(features)
        self.imputer = SimpleImputer(strategy="median")
        self.scaler = StandardScaler()
        self._fitted = False

    def fit(self, X):
        X = X[self.features]
        imp = self.imputer.fit_transform(X)
        self.scaler.fit(imp)
        self._fitted = True
        return self

    def transform(self, X):
        if not self._fitted:
            raise RuntimeError("CBCPreprocessor must be fit before transform")
        # Accept a DataFrame or a single dict/row; always output a 2D float array.
        if isinstance(X, dict):
            X = pd.DataFrame([X])
        X = X.reindex(columns=self.features)  # enforce column order
        return self.scaler.transform(self.imputer.transform(X)).astype("float32")

    def save(self, path):
        joblib.dump({"features": self.features,
                     "imputer": self.imputer,
                     "scaler": self.scaler}, path)

    @classmethod
    def load(cls, path):
        blob = joblib.load(path)
        obj = cls(blob["features"])
        obj.imputer = blob["imputer"]
        obj.scaler = blob["scaler"]
        obj._fitted = True
        return obj


# --- Splits -----------------------------------------------------------------
def stratified_split(X, y, test_size=0.2, val_size=0.1, seed=42):
    """Stratified train/val/test split. Returns dict of DataFrames/Series.
    Stratifying preserves the (very imbalanced) class ratios in every split."""
    X_tmp, X_test, y_tmp, y_test = train_test_split(
        X, y, test_size=test_size, stratify=y, random_state=seed)
    # val_size is expressed as a fraction of the ORIGINAL data.
    rel_val = val_size / (1.0 - test_size)
    X_train, X_val, y_train, y_val = train_test_split(
        X_tmp, y_tmp, test_size=rel_val, stratify=y_tmp, random_state=seed)
    return {
        "X_train": X_train, "y_train": y_train,
        "X_val": X_val,     "y_val": y_val,
        "X_test": X_test,   "y_test": y_test,
    }


def encode_labels(y, classes):
    """Map class-key Series -> integer indices aligned to `classes` order."""
    index = {c: i for i, c in enumerate(classes)}
    return y.map(index).to_numpy()

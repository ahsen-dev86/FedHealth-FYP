"""Train-only shared preprocessing and explicit lab-unit conversion."""
import joblib
import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from . import schema


def clean_ranges(df, features=None, *, strict=False):
    features = list(features or schema.FEATURES)
    out = df.reindex(columns=features).apply(pd.to_numeric, errors="raise").astype(float)
    for col in features:
        lo, hi = schema.PLAUSIBLE_RANGES[col]
        invalid = out[col].notna() & (~np.isfinite(out[col]) | (out[col] < lo) | (out[col] > hi))
        if strict and invalid.any():
            raise ValueError(f"{col} outside supported range {lo}..{hi}; verify units/value")
        out.loc[invalid, col] = np.nan
    return out


def _unit(value):
    return str(value).strip().replace("µ", "u").replace("μ", "u").replace("³", "^3").replace("⁶", "^6").replace(" ", "").lower()


def normalize_units(record, features=None, *, units=None):
    """Require units for each supplied value; never infer units from magnitude."""
    features = list(features or schema.FEATURES)
    units = units or {}
    out = {}
    for f in features:
        v = record.get(f)
        if v is None or (isinstance(v, str) and not v.strip()):
            out[f] = np.nan
            continue
        if f not in units:
            raise ValueError(f"Declare the unit for {f}")
        if isinstance(v, (bool, np.bool_)):
            raise ValueError(f"{f} must be numeric")
        v = float(v)
        if not np.isfinite(v):
            raise ValueError(f"{f} must be finite")
        given = _unit(units[f])
        canonical = _unit(schema.UNITS[f])
        factors = {canonical: 1.}
        if f in {"WBC", "PLT"}:
            factors.update({"/ul": .001, "/mm^3": .001, "cells/ul": .001, "10^9/l": 1.})
        if f == "RBC":
            factors.update({"/ul": 1e-6, "/mm^3": 1e-6, "10^12/l": 1.})
        if f in {"HGB", "MCHC"}:
            factors["g/l"] = .1
        if f in {"HCT", "RDW", "NEUTp"}:
            factors.update({"fraction": 100., "l/l": 100.})
        if given not in factors:
            raise ValueError(f"Unsupported unit for {f}: {units[f]}")
        out[f] = v * factors[given]
    clean_ranges(pd.DataFrame([out]), features, strict=True)
    if all(pd.isna(v) for v in out.values()):
        raise ValueError("At least one recognized CBC value is required")
    return out


class CBCPreprocessor:
    def __init__(self, features=None):
        self.features = list(features or schema.FEATURES)
        if self.features != schema.FEATURES:
            raise ValueError("Wrong feature order")
        self.imputer = SimpleImputer(strategy="median", keep_empty_features=True)
        self.scaler = StandardScaler()
        self._fitted = False

    def fit(self, X):
        if self._fitted:
            raise RuntimeError("Shared preprocessor is immutable once fitted")
        X = clean_ranges(X, self.features)
        if X.empty or X.isna().all().any():
            raise ValueError("Training data must contain measured values for every feature")
        imp = self.imputer.fit_transform(X)
        self.scaler.fit(imp)
        self._fitted = True
        self.fit_rows = len(X)
        return self

    def transform(self, X):
        if not self._fitted:
            raise RuntimeError("Fit on training rows before transforming")
        if isinstance(X, dict):
            X = pd.DataFrame([X])
        X = clean_ranges(X, self.features)
        result = self.scaler.transform(self.imputer.transform(X)).astype("float32")
        if not np.isfinite(result).all() or result.shape[1] != len(schema.FEATURES):
            raise ValueError("Invalid preprocessed data")
        return result

    def save(self, path):
        if not self._fitted:
            raise RuntimeError("Cannot save an unfitted preprocessor")
        joblib.dump({"schema_version": schema.SCHEMA_VERSION, "features": self.features,
                     "imputer": self.imputer, "scaler": self.scaler, "fit_rows": self.fit_rows}, path)

    @classmethod
    def load(cls, path):
        blob = joblib.load(path)  # Only load artifacts from a trusted training run.
        if blob.get("schema_version") != schema.SCHEMA_VERSION:
            raise ValueError("Old or incompatible preprocessor")
        obj = cls(blob["features"])
        obj.imputer, obj.scaler = blob["imputer"], blob["scaler"]
        obj.fit_rows, obj._fitted = int(blob["fit_rows"]), True
        for values in [obj.imputer.statistics_, obj.scaler.mean_, obj.scaler.scale_]:
            if np.shape(values) != (10,) or not np.isfinite(values).all():
                raise ValueError("Corrupt fitted preprocessing statistics")
        if (obj.scaler.scale_ <= 0).any():
            raise ValueError("Invalid scaler scale")
        return obj


def encode_labels(y, classes=None):
    classes = list(classes or schema.CLASSES)
    encoded = pd.Series(y).map({c: i for i, c in enumerate(classes)})
    if encoded.isna().any():
        raise ValueError("Unknown/missing label")
    return encoded.to_numpy(dtype="int64")

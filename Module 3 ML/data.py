"""Read the supplied split unchanged; audit metadata separately from inputs.

Loads and strictly validates the four-class CBC dataset (and its optional
provenance file) used by both centralized (Module 3) and federated (Module 4)
training. The train/val/test split shipped in the CSV is treated as fixed and
is never re-shuffled here.
"""
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd  # tabular dataframe handling for the CSV dataset
from . import schema
from .preprocess import clean_ranges, encode_labels


def sha256(path, *, canonical=False):
    """Hash a file's bytes. `canonical=True` normalizes CRLF to LF first, so
    the same content hashes identically regardless of the checkout's line endings."""
    raw = Path(path).read_bytes()
    if canonical:
        raw = raw.replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def validate_frame(df, *, require_all_splits=True):
    """Enforce the dataset contract on a raw dataframe: exact column order,
    no missing values, unique positive row ids, known labels/splits, features
    within plausible clinical ranges, and no identical feature rows carrying
    conflicting labels or straddling two splits. Raises ValueError on any violation."""
    if list(df.columns) != schema.DATA_COLUMNS:
        raise ValueError("Dataset columns/order differ from the four-class contract")
    if df.empty or df.isna().any().any():
        raise ValueError("Dataset is empty or has missing values")
    if df.row_id.duplicated().any() or not pd.api.types.is_integer_dtype(df.row_id) or (df.row_id <= 0).any():
        raise ValueError("row_id must be unique positive integers")
    encode_labels(df.label)
    if not set(df.split) <= {"train", "val", "test"}:
        raise ValueError("Unknown split")
    if require_all_splits and set(df.split) != {"train", "val", "test"}:
        raise ValueError("All three supplied splits are required")
    clean_ranges(df, strict=True)
    groups = df.groupby(schema.FEATURES, dropna=False)
    if (groups.label.nunique() > 1).any():
        raise ValueError("Identical feature records have conflicting labels")
    if (groups.split.nunique() > 1).any():
        raise ValueError("Duplicate feature records cross the supplied splits; rebuild required")
    if require_all_splits:
        for split in ("train", "val", "test"):
            if set(df.loc[df.split == split, "label"]) != set(schema.CLASSES):
                raise ValueError(f"Missing class in {split}")
    return df


class Dataset:
    """Loads the canonical CSV (+ optional provenance CSV), validates it, and
    exposes the frozen train/val/test split. When `verify_release` is True
    (the default for real training) it also pins the dataset to the exact
    hashes/row counts recorded in schema.py, so training never silently runs
    on a different or edited dataset."""

    def __init__(self, csv_path, provenance_path=None, *, verify_release=True):
        self.path = Path(csv_path)
        self.raw_sha256 = sha256(self.path)
        self.sha256 = sha256(self.path, canonical=True)
        self.frame = validate_frame(pd.read_csv(self.path))
        if verify_release:
            if self.sha256 != schema.CANONICAL_DATA_SHA256:
                raise ValueError("Dataset content changed; review a new release before training")
            counts = pd.crosstab(self.frame.label, self.frame.split)
            if len(self.frame) != 3200 or any((counts[s] != n).any() for s, n in [("train", 560), ("val", 120), ("test", 120)]):
                raise ValueError("Unexpected release counts")
        self.provenance = None
        self.provenance_sha256 = None
        if provenance_path is not None:
            self.provenance_sha256 = sha256(provenance_path, canonical=True)
            if verify_release and self.provenance_sha256 != schema.CANONICAL_PROVENANCE_SHA256:
                raise ValueError("Provenance content changed")
            p = pd.read_csv(provenance_path, keep_default_na=False)
            needed = set(schema.DATA_COLUMNS + ["source", "source_row", "label_basis", "imputed"])
            if set(p.columns) != needed or p.row_id.duplicated().any() or set(p.row_id) != set(self.frame.row_id):
                raise ValueError("Provenance rows/columns do not match the dataset")
            p = p.set_index("row_id").loc[self.frame.row_id].reset_index()
            pd.testing.assert_frame_equal(self.frame[schema.DATA_COLUMNS], p[schema.DATA_COLUMNS], check_dtype=False)
            if p.duplicated(["source", "source_row"]).any() or (p.source == "").any():
                raise ValueError("Duplicate or missing source record")
            self.provenance = p

    def rows(self, split):
        """Return a copy of the rows for one split ('train'/'val'/'test')."""
        if split not in {"train", "val", "test"}:
            raise ValueError("Unknown split")
        return self.frame.loc[self.frame.split == split].copy()

    def xy(self, split, prep):
        """Scaled feature matrix X and integer-encoded labels y for one split,
        using an already-fitted CBCPreprocessor (never fit here)."""
        rows = self.rows(split)
        return prep.transform(rows[schema.FEATURES]), encode_labels(rows.label)

    def audit(self):
        """Summary dict (row counts, hashes, class/split crosstab, provenance
        breakdown) used by the EDA notebook and run metadata — never used to feed training."""
        out = {"rows": len(self.frame), "features": schema.FEATURES, "classes": schema.CLASSES,
               "data_sha256": self.sha256, "raw_data_sha256": self.raw_sha256,
               "provenance_sha256": self.provenance_sha256,
               "split_counts": pd.crosstab(self.frame.label, self.frame.split).to_dict(),
               "duplicate_feature_rows": int(self.frame.duplicated(schema.FEATURES).sum())}
        if self.provenance is not None:
            p = self.provenance
            out.update(source_by_label=pd.crosstab(p.source, p.label).to_dict(),
                       label_basis_counts=p.label_basis.value_counts().to_dict(),
                       imputed_rows=int((p.imputed != "").sum()))
        return out

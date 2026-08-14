# fl/client/lims_wrapper.py
# ---------------------------------------------------------------------------
# Module 6.3.1 — LIMS API wrapper & data normalization.
#
# A real lab exposes its Complete Blood Count data through a Laboratory
# Information Management System (e.g. Nexus Pro) over SQL/NoSQL. We can't connect
# to real hospital LIMS, so this class SIMULATES that connector by reading the
# lab's local CSV shard — but it presents the SAME interface a real wrapper
# would (fetch_records -> normalize), so swapping in a real LIMS later means
# reimplementing only fetch_records().
#
# Crucially, normalization + training happen here, inside the lab. The raw
# records returned by fetch_records() never leave this process — only ANN
# weights do (via the Flower client).
# ---------------------------------------------------------------------------
import os
import sys

import pandas as pd

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import schema, preprocess as pp  # noqa: E402


class MockLIMS:
    """Stand-in for a lab's LIMS connector."""

    def __init__(self, shard_csv, lab_id="lab-unknown"):
        self.shard_csv = shard_csv
        self.lab_id = lab_id

    # --- what a REAL wrapper would implement against the lab's DB ------------
    def fetch_records(self):
        """Pull raw CBC records from the (simulated) LIMS. Returns a DataFrame
        of raw rows. In production: a parameterized SQL/NoSQL read."""
        if not os.path.exists(self.shard_csv):
            raise FileNotFoundError(
                f"[{self.lab_id}] LIMS shard not found: {self.shard_csv}")
        return pd.read_csv(self.shard_csv)

    # --- normalization (shared with every tier via fedhealth_ml) ------------
    @staticmethod
    def normalize(df):
        """Rescale real-world report units to the model's scale, then apply
        physiological range-cleaning to the canonical CBC features. Uses the
        SAME shared normalizer as the OCR path and the inference service, so a
        real lab's /mm³-scale WBC/platelet/absolute counts are handled
        consistently everywhere. Returns (X_raw_canonical, y_keys)."""
        df = df.copy()
        feats = [c for c in schema.MODEL_A_FEATURES if c in df.columns]
        if feats:
            # Row-by-row unit normalization (a no-op for already-canonical data).
            normed = [pp.normalize_units(r, feats) for r in df[feats].to_dict("records")]
            df[feats] = pd.DataFrame(normed, index=df.index)[feats]
        X = pp.clean_ranges(df, schema.MODEL_A_FEATURES)
        y = df["Diagnosis"].map(schema.ANEMIA_LABEL_MAP) if "Diagnosis" in df else None
        return X, y

    def summary(self):
        """Lightweight, privacy-safe description of the local silo (row/feature
        counts only — no patient data)."""
        df = self.fetch_records()
        return {"lab_id": self.lab_id, "rows": int(len(df)),
                "has_labels": "Diagnosis" in df.columns}

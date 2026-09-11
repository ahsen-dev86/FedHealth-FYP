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

from fedhealth_ml import schema, preprocess as pp  # noqa: E402
from task import prepare_partition_records  # noqa: E402


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
        """Prepare local raw records with the shared FL training pipeline."""
        return prepare_partition_records(df)

    def summary(self):
        """Lightweight, privacy-safe description of the local silo (row/feature
        counts only — no patient data)."""
        df = self.fetch_records()
        return {"lab_id": self.lab_id, "rows": int(len(df)),
                "has_labels": "Diagnosis" in df.columns}

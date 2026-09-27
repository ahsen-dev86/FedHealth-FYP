"""Mock lab-local LIMS connector; raw records remain in the client process.

Stand-in for a real hospital Laboratory Information Management System (LIMS)
integration: reads a lab's CBC shard from a local CSV as if it came from a
LIMS API. The point is to show that raw records are read and normalized
in-process by the lab, never uploaded anywhere — only the trained model
weights leave the client (see client.py)."""
import pandas as pd
from task import prepare_partition_records


class MockLIMS:
    """Fake LIMS client for one lab's local CSV shard."""

    def __init__(self, shard_csv, lab_id="lab-unknown"):
        self.shard_csv, self.lab_id = shard_csv, lab_id

    def fetch_records(self):
        """Read this lab's raw CBC rows from its local CSV shard."""
        return pd.read_csv(self.shard_csv)

    @staticmethod
    def normalize(df, units):
        """Convert raw records to canonical units/encoded labels via the
        shared task.prepare_partition_records (see task.py)."""
        return prepare_partition_records(df, units=units)

    def summary(self):
        """Cheap diagnostic: row count and whether labels are present, without exposing any patient-level data."""
        df = self.fetch_records()
        return {"lab_id": self.lab_id, "rows": len(df), "has_labels": "label" in df}

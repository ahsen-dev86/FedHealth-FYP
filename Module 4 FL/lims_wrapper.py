"""Mock lab-local LIMS connector; raw records remain in the client process."""
import pandas as pd
from task import prepare_partition_records


class MockLIMS:
    def __init__(self, shard_csv, lab_id="lab-unknown"):
        self.shard_csv, self.lab_id = shard_csv, lab_id

    def fetch_records(self):
        return pd.read_csv(self.shard_csv)

    @staticmethod
    def normalize(df, units):
        return prepare_partition_records(df, units=units)

    def summary(self):
        df = self.fetch_records()
        return {"lab_id": self.lab_id, "rows": len(df), "has_labels": "label" in df}

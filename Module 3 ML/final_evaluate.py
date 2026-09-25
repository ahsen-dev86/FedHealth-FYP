"""One explicit final test phase after every model/configuration is frozen."""
import argparse
import json
import re
from pathlib import Path
import joblib
import numpy as np
from .artifacts import load_bundle, inspect_bundle
from .data import Dataset, sha256
from .models import TemperatureScaler
from .metrics import evaluate
from .runtime import write_json
from .training import DEFAULT_CSV, DEFAULT_PROVENANCE


def final_evaluate(dataset, plan_path, output):
    plan_path, output = Path(plan_path), Path(output)
    plan = json.loads(plan_path.read_text())
    if plan["data_sha256"] != dataset.sha256 or not plan["models"]:
        raise ValueError("Empty or mismatched frozen evaluation plan")
    names = [e["name"] for e in plan["models"]]
    if len(names) != len(set(names)):
        raise ValueError("Duplicate evaluation names")
    if any(not re.fullmatch(r"[a-zA-Z0-9_-]+", name) for name in names):
        raise ValueError("Invalid evaluation output name")
    # Verify the complete plan before opening test predictions.
    for entry in plan["models"]:
        path = Path(entry["path"])
        if sha256(path / "manifest.json") != entry["manifest_sha256"]:
            raise ValueError("Frozen model manifest changed")
        meta, _ = inspect_bundle(path, data_sha256=dataset.sha256)
        if meta["origin"] == "centralized":
            if sha256(path.parent / "baselines_manifest.json") != entry.get("baselines_manifest_sha256"):
                raise ValueError("Frozen baseline manifest changed")
            baselines = json.loads((path.parent / "baselines_manifest.json").read_text())
            for filename, digest in baselines["sha256"].items():
                if Path(filename).name != filename or sha256(path.parent / filename) != digest:
                    raise ValueError("Frozen baseline changed")
    output.mkdir(parents=True, exist_ok=False)
    lock = plan_path.parent / "FINAL_TEST_STARTED.json"
    with lock.open("x", encoding="utf-8") as handle:
        json.dump({"plan_sha256": sha256(plan_path), "data_sha256": dataset.sha256}, handle)
    rows = dataset.rows("test")
    if dataset.provenance is not None:
        rows = rows.merge(dataset.provenance[["row_id", "source"]], on="row_id", validate="one_to_one")
    results = {}
    for entry in plan["models"]:
        path = Path(entry["path"])
        prep, hybrid, meta = load_bundle(path, data_sha256=dataset.sha256)
        X, y = dataset.xy("test", prep)
        temp = TemperatureScaler()
        temp.T = meta["ann_temperature"]
        metrics = {"ann": evaluate(y, temp.transform(np.asarray(hybrid.ann(X, training=False))), rows=rows)}
        if hybrid.xgb is not None:
            metrics["hybrid"] = evaluate(y, hybrid.predict_proba(X), rows=rows)
        if meta["origin"] == "centralized":
            manifest = json.loads((path.parent / "baselines_manifest.json").read_text())
            if manifest["data_sha256"] != dataset.sha256:
                raise ValueError("Baseline dataset mismatch")
            for filename, digest in manifest["sha256"].items():
                if Path(filename).name != filename or sha256(path.parent / filename) != digest:
                    raise ValueError("Baseline checksum mismatch")
                estimator = joblib.load(path.parent / filename)
                metrics[Path(filename).stem] = evaluate(y, estimator.predict_proba(X), rows=rows)
        results[entry["name"]] = {"selected_round": meta.get("selected_round"), "metrics": metrics}
        # A deployable registry payload is written beside the report, not into immutable bundles.
        registry = metrics.get("hybrid", metrics["ann"])
        write_json(output / f"{entry['name']}_metrics.json", {"model_name": meta["model_name"], "version": meta["version"],
                   "features": meta["features"], "classes": meta["classes"], "data_sha256": dataset.sha256,
                   "split": "test", "metrics": registry, "screening_only": True})
    write_json(output / "comparison.json", {"split": "test", "data_sha256": dataset.sha256,
               "plan_sha256": sha256(plan_path), "results": results,
               "limitations": ["Upstream donor imputation occurred before the supplied split.",
                   "Mixed sources and rule labels limit clinical interpretation.",
                   "Warm-start ANN already saw all training rows; federation is fine-tuning."]})
    return results


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--plan", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    final_evaluate(Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE), args.plan, args.out)

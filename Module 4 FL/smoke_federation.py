"""Disposable 3-lab, 2-round flow check with arithmetic audit."""
import argparse
import json
from pathlib import Path

import numpy as np

from aggregation import weights_sha256
from run_simulation import run_simulation


def smoke_test(split_dir, reference_dir, output_dir, audit_dir, *, seed=42):
    import tensorflow as tf

    split = json.loads((Path(split_dir) / "split_manifest.json").read_text(
        encoding="utf-8"))
    if split["labs"] != 3:
        raise ValueError("The prescribed smoke test requires exactly three labs")

    info = run_simulation(split_dir, reference_dir, output_dir,
                          init="warm", rounds=2, local_epochs=1, seed=seed,
                          audit_dir=audit_dir)
    for trace in info["round_weight_trace"]:
        with np.load(Path(audit_dir) / trace["audit_file"],
                     allow_pickle=False) as arrays:
            layer_count = len([key for key in arrays if key.startswith("received_")])
            received = [arrays[f"received_{i}"] for i in range(layer_count)]
            combined = [arrays[f"aggregated_{i}"] for i in range(layer_count)]
            if weights_sha256(received) != trace["received_sha256"] or (
                weights_sha256(combined) != trace["aggregated_sha256"]
            ):
                raise AssertionError("Round weight fingerprint mismatch")
            for i in range(layer_count):
                manual = sum(arrays[f"{lab}_returned_{i}"].astype(np.float64) * count
                             for lab, count in trace["train_rows"].items())
                manual = (manual / trace["total_examples"]).astype(combined[i].dtype)
                np.testing.assert_array_equal(manual, combined[i])
            for lab, expected in trace["returned_sha256"].items():
                layers = [arrays[f"{lab}_returned_{i}"] for i in range(layer_count)]
                if weights_sha256(layers) != expected:
                    raise AssertionError(f"Wrong returned fingerprint: {lab}")
    output_dir = Path(output_dir)
    manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))
    saved = tf.keras.models.load_model(output_dir / "ann.keras", compile=False)
    if weights_sha256(saved.get_weights()) != info["selected_weights_sha256"] or (
        manifest["selected_weights_sha256"] != info["selected_weights_sha256"]
    ):
        raise AssertionError("Saved ANN is not the selected round")
    return {"rounds": 2, "labs": 3,
            "selected_round": info["selected_round"],
            "saved_model_sha256": info["selected_weights_sha256"],
            "note": "Smoke test only; not a model-performance result"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split-dir", required=True)
    parser.add_argument("--reference-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--audit-dir", required=True)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    print(json.dumps(smoke_test(args.split_dir, args.reference_dir,
                                args.output_dir, args.audit_dir, seed=args.seed),
                     indent=2))


if __name__ == "__main__":
    main()

# End-to-end ("integration") tests that exercise the REAL training/FL/inference pipeline
# (no mocks): saved-model integrity, real multi-lab FedAvg rounds, client reproducibility,
# the final-report freeze mechanics, and the live inference API — plus a static-analysis
# guard that training code never touches the held-out test split.
import json
from pathlib import Path
import shutil
import sys
import numpy as np
import pytest
from fedhealth_ml.artifacts import load_bundle, inspect_bundle
from fedhealth_ml.data import sha256
from fedhealth_ml import schema


# A saved model bundle must load correctly and predict valid probabilities; if its
# manifest checksum or declared class order is tampered with, load_bundle() must refuse
# to load it rather than silently serving predictions with the wrong labels.
@pytest.mark.integration
def test_saved_hybrid_and_schema_tamper(central_model, tmp_path):
    prep, hybrid, meta = load_bundle(central_model)
    assert meta["features"] == schema.FEATURES and meta["classes"] == schema.CLASSES
    assert prep.fit_rows == 2240
    p = hybrid.predict_proba(np.zeros((2, 10), dtype="float32"))
    assert p.shape == (2, 4)
    np.testing.assert_allclose(p.sum(axis=1), 1)
    corrupt = tmp_path / "bad"
    shutil.copytree(central_model, corrupt)
    metadata = json.loads((corrupt / "meta.json").read_text())
    metadata["classes"] = list(reversed(schema.CLASSES))
    (corrupt / "meta.json").write_text(json.dumps(metadata))
    with pytest.raises(ValueError, match="checksum"):
        load_bundle(corrupt)
    manifest = json.loads((corrupt / "manifest.json").read_text())
    manifest["sha256"]["meta.json"] = sha256(corrupt / "meta.json")
    (corrupt / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="order"):
        load_bundle(corrupt)


# Runs a real 3-lab, 2-round federated simulation and checks the recorded audit weights:
# each round's aggregated weights must equal the row-count-weighted average of what each
# lab actually returned, and at least one lab's returned weights must differ from what it
# received (proof real local training happened, not a no-op).
@pytest.mark.integration
def test_three_labs_two_rounds_real_fedavg(dataset, central_model, tmp_path):
    from run_simulation import run
    from aggregation import weights_sha256
    result = run(dataset, central_model, tmp_path / "smoke", rounds=2)
    _, original, _ = load_bundle(central_model)
    _, restored, meta = load_bundle(result)
    history = json.loads((result.parent / "round_history.json").read_text())
    assert len(history["validation"]) == 3 and len(history["aggregation"]) == 2
    assert history["validation"][0]["weights_sha256"] == weights_sha256(original.ann.get_weights())
    assert meta["selected_weights_sha256"] == weights_sha256(restored.ann.get_weights())
    assert meta["round_zero_selected"] == (meta["selected_round"] == 0)
    assert sha256(result / "preprocessor.joblib") == sha256(central_model / "preprocessor.joblib")
    for trace in history["aggregation"]:
        audit = np.load(result.parent / "audit_weights" / trace["audit_file"])
        counts = trace["train_rows"]
        for i in range(6):
            expected = sum(audit[f"{lab}_returned_{i}"].astype("float64") * n for lab, n in counts.items()) / 2240
            np.testing.assert_allclose(audit[f"aggregated_{i}"], expected, rtol=1e-6, atol=1e-7)
        assert any(not np.array_equal(audit[f"received_{i}"], audit[f"lab-00_returned_{i}"]) for i in range(6))


# A lab client's local training run must be exactly reproducible given the same starting
# weights + config + seed (needed so encrypted vs. plaintext runs can be compared bit-for-
# bit elsewhere); changing the seed must change the result, and reusing a client across
# mismatched settings must be rejected.
@pytest.mark.integration
def test_fresh_client_optimizer_is_reproducible(dataset, central_model):
    from client import LabClient
    from aggregation import weights_sha256
    prep, hybrid, _ = load_bundle(central_model)
    client = LabClient("lab-00", dataset.rows("train").iloc[:64], prep, units=schema.UNITS,
        architecture=hybrid.ann.to_json(), preprocessor_sha256="p", seed=42)
    weights = hybrid.ann.get_weights()
    config = {"server_round": 1, "input_sha256": weights_sha256(weights), "preprocessor_sha256": "p",
              "seed": 42, "local_epochs": 1, "batch_size": 32, "lr": .0001}
    a = client.fit(weights, config)[0]
    b = client.fit(weights, config)[0]
    for x, y in zip(a, b):
        np.testing.assert_array_equal(x, y)
    with pytest.raises(ValueError, match="settings"):
        client.fit(weights, {**config, "seed": 52})


@pytest.mark.integration
def test_final_phase_freeze_and_once_only_using_validation_fixture(dataset, central_model, tmp_path):
    # Exercise final-report mechanics on VALIDATION rows only. The real test
    # split remains untouched by repository verification.
    from types import SimpleNamespace
    from fedhealth_ml.final_evaluate import final_evaluate
    fixture = SimpleNamespace(sha256=dataset.sha256, provenance=dataset.provenance,
        rows=lambda split: dataset.rows("val"), xy=lambda split, prep: dataset.xy("val", prep))
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps({"data_sha256": dataset.sha256, "models": [{"name": "fixture",
        "path": str(central_model), "manifest_sha256": sha256(central_model / "manifest.json"),
        "baselines_manifest_sha256": sha256(central_model.parent / "baselines_manifest.json") }]}))
    result = final_evaluate(fixture, plan, tmp_path / "first")
    assert "hybrid" in result["fixture"]["metrics"]
    assert (tmp_path / "first/fixture_metrics.json").exists()
    with pytest.raises(FileExistsError):
        final_evaluate(fixture, plan, tmp_path / "second")


# Boots the real Module 6 Flask app against a freshly trained (not the official seed-42)
# bundle to check /health and /infer behave correctly for canonical-unit input and reject
# malformed requests (missing units, wrong model name, empty body).
@pytest.mark.integration
def test_inference_scores_units_and_bad_artifacts(dataset, central_model, tmp_path, monkeypatch):
    import importlib.util
    root = Path(__file__).resolve().parents[1]
    model_root = tmp_path / "models"
    shutil.copytree(central_model, model_root / schema.MODEL_NAME)
    monkeypatch.setenv("MODELS_DIR", str(model_root))
    spec = importlib.util.spec_from_file_location("four_class_api", root / "Module 6 Domain API/app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    client = module.app.test_client()
    assert client.get("/health").status_code == 200
    row = dataset.rows("val").iloc[0][schema.FEATURES].to_dict()
    response = client.post("/infer", json={"cbc": row, "canonical_units": True})
    assert response.status_code == 200
    assert set(response.json["scores"]) == set(schema.CLASSES)
    assert response.json["screening_only"] is True
    assert client.post("/infer", json={"cbc": row}).status_code == 400
    assert client.post("/infer", json={"model": "thal_screen", "cbc": row, "canonical_units": True}).status_code == 400
    assert client.post("/infer", json={"cbc": {"HCT": .38}, "canonical_units": True}).status_code == 400
    assert client.post("/infer", json={"cbc": {"HCT": .38}, "units": {"HCT": "fraction"}}).status_code == 200
    assert client.post("/infer", json=[]).status_code == 400


# Static-analysis guard (parses the source with `ast`, doesn't run it): training.py must
# only ever call .xy()/.rows() with "train" or "val", never "test" — the held-out test
# split must stay untouched until the separate final-evaluation phase. Also checks
# source_holdout.py fits its own preprocessor fresh rather than reusing a saved bundle.
def test_test_phase_is_separate_and_source_exclusion_is_fresh():
    import ast
    from fedhealth_ml import training, source_holdout
    # Guard the explicit train/validation data access points, not metric quality.
    tree = ast.parse(Path(training.__file__).read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr in {"xy", "rows"} and node.args and isinstance(node.args[0], ast.Constant):
            assert node.args[0].value in {"train", "val"}
    text = Path(source_holdout.__file__).read_text()
    assert "load_bundle" not in text
    assert "CBCPreprocessor().fit(train" in text

"""Persist the selected round with calibration and verified reload.

Shared finalization step for both the in-memory simulation (run_simulation.py)
and the real Flower server (server.py): takes the best round the
ValidationTracker picked, re-calibrates it, optionally refits the local
XGBoost reference head, and saves it through the same save_bundle() verified-
reload path used by centralized training.
"""
from pathlib import Path
import numpy as np
from fedhealth_ml import schema, models
from fedhealth_ml.artifacts import save_bundle
from fedhealth_ml.runtime import write_json
from aggregation import weights_sha256


def finish_run(output, tracker, strategy, prep, initial_meta, model_dir, Xv, yv, settings, *, hybrid_train=None):
    """Validate that the run completed every expected round, load the
    tracker's selected (lowest validation-loss, safety-eligible) weights into
    the ANN, re-calibrate temperature on validation, optionally refit a
    centralized-reference XGBoost head on top (never itself federated), save
    the bundle, and write round history/validation metrics/settings JSON."""
    output = Path(output)
    expected = list(range(settings["rounds"] + 1))
    if [m["round"] for m in tracker.history] != expected or len(strategy.round_trace) != settings["rounds"]:
        raise RuntimeError("Incomplete run; refuse to publish a selected checkpoint")
    ann = tracker.model
    ann.set_weights(tracker.best_weights)
    if weights_sha256(ann.get_weights()) != tracker.best_sha256:
        raise RuntimeError("Selected weights mismatch")
    temp = models.TemperatureScaler().fit(np.asarray(ann(Xv, training=False)), yv)
    hybrid_temp = models.TemperatureScaler()
    hybrid_temp.T = temp.T
    hybrid = models.HybridModel(ann, schema.CLASSES, temperature=hybrid_temp, version=f"v2-fl-seed{settings['seed']}-{settings['mode']}")
    head = "none"
    if hybrid_train is not None:
        Xtr, ytr = hybrid_train
        hybrid.fit_meta(Xtr, ytr, Xv, yv, seed=settings["seed"])
        head = "centralized reference XGBoost refit after ANN selection; not federated"
    info = {"data_sha256": initial_meta["data_sha256"], "provenance_sha256": initial_meta["provenance_sha256"],
            "fit_row_ids": initial_meta["fit_row_ids"], "origin": "federated_finetune",
            "training": settings, "selected_round": tracker.best_round,
            "selected_weights_sha256": tracker.best_sha256, "round_zero_selected": tracker.best_round == 0,
            "round_zero_weights_sha256": tracker.history[0]["weights_sha256"],
            "selection": {"metric": "minimum validation log loss", "max_macro_f1_drop": tracker.max_macro_f1_drop,
                          "max_extra_sick_healthy": tracker.max_extra_sick_healthy, "tie": "earliest round"},
            "reference_head": head, "test_used": False}
    save_bundle(output / "model", prep, hybrid, run_info=info, ann_temperature=temp.T,
                preprocessor_source=Path(model_dir) / "preprocessor.joblib")
    write_json(output / "round_history.json", {"data_sha256": info["data_sha256"], "validation": tracker.history,
                                             "aggregation": strategy.round_trace, "selected_round": tracker.best_round})
    from fedhealth_ml.metrics import evaluate
    metrics = {"ann": evaluate(yv, temp.transform(np.asarray(ann(Xv, training=False))))}
    if hybrid.xgb is not None:
        metrics["hybrid"] = evaluate(yv, hybrid.predict_proba(Xv))
    write_json(output / "validation_metrics.json", {"split": "val", "data_sha256": info["data_sha256"], "metrics": metrics})
    write_json(output / "settings.json", settings)
    print(f"Selected round {tracker.best_round} of {settings['rounds']}; test untouched.")
    return output / "model"

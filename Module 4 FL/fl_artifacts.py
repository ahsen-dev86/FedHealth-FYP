
"""Save ANN-only artifacts and verify that they reload correctly."""
import hashlib
import json
from pathlib import Path

import numpy as np
from fedhealth_ml import schema, preprocess as pp


def save_ann_checkpoint(model, preprocessor, output_dir, *, run_info):
    import tensorflow as tf

    assert list(preprocessor.features) == list(schema.MODEL_A_FEATURES)
    assert model.input_shape == (None, len(schema.MODEL_A_FEATURES))
    assert model.output_shape == (None, len(schema.MODEL_A_CLASSES))

    weights = model.get_weights()
    assert all(np.isfinite(w).all() for w in weights)

    output_dir = Path(output_dir)
    # Refuse to overwrite an existing checkpoint directory.
    output_dir.mkdir(parents=True, exist_ok=False)

    ann_path = output_dir / "federated_ann.keras"
    prep_path = output_dir / "preprocessor.joblib"
    model.save(ann_path)
    preprocessor.save(prep_path)

    restored = tf.keras.models.load_model(ann_path, compile=False)
    restored_weights = restored.get_weights()
    assert len(weights) == len(restored_weights)
    for original, loaded in zip(weights, restored_weights):
        np.testing.assert_array_equal(original, loaded)

    # Synthetic scaled inputs test prediction consistency, not accuracy.
    width = len(schema.MODEL_A_FEATURES)
    probe = np.stack([
        np.zeros(width), np.ones(width), -np.ones(width)
    ]).astype("float32")
    before = np.asarray(model(probe, training=False))
    after = np.asarray(restored(probe, training=False))
    assert np.isfinite(before).all() and np.isfinite(after).all()
    np.testing.assert_allclose(before, after, rtol=1e-6, atol=1e-7)

    restored_prep = pp.CBCPreprocessor.load(prep_path)
    assert list(restored_prep.features) == list(preprocessor.features)
    np.testing.assert_array_equal(
        preprocessor.imputer.statistics_,
        restored_prep.imputer.statistics_,
    )
    for attribute in ("mean_", "var_", "scale_", "n_samples_seen_"):
        np.testing.assert_array_equal(
            getattr(preprocessor.scaler, attribute),
            getattr(restored_prep.scaler, attribute),
        )

    metadata = {
        "artifact_type": "ann_only",
        "features": list(schema.MODEL_A_FEATURES),
        "classes": list(schema.MODEL_A_CLASSES),
        "run_info": run_info,
        "reload_verified": True,
        "sha256": {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (ann_path, prep_path)
        },
    }
    # Written last: its presence indicates the reload checks completed.
    (output_dir / "checkpoint_metadata.json").write_text(
        json.dumps(metadata, indent=2), encoding="utf-8"
    )
    return output_dir

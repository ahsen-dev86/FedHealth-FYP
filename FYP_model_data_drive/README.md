# Trained four-class models and run records (`four_class_v1`)

Copied from Google Drive `MyDrive/FYP/four_class/four_class_v1`, produced by running the
Module 3/4 Colab notebooks (01-04) in this repo on 2026-09-26.

- Dataset: `Dataset/fedhealth_cbc_4class.csv`, SHA-256 `ec5dba6d3a72ae479bac9856ed368128565596fa7353e733531b0c11ee29ff04`.
- `preprocessing/` — shared preprocessor fitted on the 2,240 training rows only.
- `seed42|52|62/centralized/model/` — ANN + local XGBoost bundle (`ann.keras`, `preprocessor.joblib`,
  `xgb.json`, `meta.json`, `manifest.json`). Use **`seed42/centralized/model`** as the default model.
- `seed*/{iid,non_iid_05,non_iid_01,source}/` — federated fine-tuning runs (20 rounds, round selected on validation).
- `final_test/` — one-shot test-set scores for all 15 frozen models; `source_holdout/` — source-exclusion check.
- `final_evaluation_plan.json`, `experiment_plan.json`, `validation_comparison.json` — the frozen protocol and results.

Seed-42 centralized test scores: ANN 0.873 accuracy, hybrid 0.888. Source-exclusion accuracy was
0.29-0.87 depending on the excluded source, so these models are a proof of concept and are not validated
on data from unseen labs. See `docs/COLAB_MODULE3_RUN_2026-09-26.md` and `docs/VERIFICATION.md`.

**Security:** `.joblib` files are executable data. Only load bundles that come from this repo's own runs;
the manifest hashes check consistency, not authorship. Model files are force-added because `.gitignore`
excludes `*.keras`, `*.joblib` and `artifacts/` by default; new model files elsewhere will still be ignored.

## Required environment to load these models

The bundles were saved in Colab with Python 3.13, **TensorFlow 2.20.0, Keras 3.15.1**, XGBoost 3.1.1,
scikit-learn 1.7.2, numpy 2.2.6 and joblib 1.5.2 (see `requirements-ml.txt`). Keras 3.14 and older cannot
deserialize `ann.keras` (`GlorotUniform ... unexpected keyword argument 'input_axes'`), so use a
fresh virtual environment with the pinned requirements, not a global Python with a different Keras.

Integrity: `inspect_bundle` (manifest + dataset hash) passed for all 16 model bundles as committed;
`.gitattributes` disables line-ending conversion so the manifest hashes stay valid on Windows checkouts.

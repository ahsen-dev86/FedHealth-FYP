# Module 3 — four-class CBC screening

The active input is `Dataset/fedhealth_cbc_4class.csv` plus its provenance file.
One ordered contract is shared by notebooks, federation and inference:

- Features: WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp.
- Classes: healthy, anemia, thalassemia, leukemia.
- Rows: 2,240 training, 480 validation, 480 test. The supplied split is preserved.
- Model: ANN 10 → 64 → 32 → 4, plus a local XGBoost head on embeddings and CBC.

## Manual Colab workflow

Open `01_eda.ipynb`, `02_preprocess.ipynb`, `03_train_centralized.ipynb`, then
`04_federated.ipynb`. Use the same RUN_ID in each. Follow the pause after Module 3
validation and inspect curves and per-class recall. Test evaluation is a separate
explicit cell, disabled until settings and the comparison plan are frozen.
Generated notebooks contain no invented execution outputs. Regenerate them with
`python "Module 3 ML/build_notebooks.py"` from the repository root.

## Local commands

Use Python 3.12 in an isolated environment and run from the repository root:

```sh
python -m pip install -r "requirements-test.txt"
python -m fedhealth_ml.training audit
python -m fedhealth_ml.training prepare --out artifacts/preprocessing
python -m fedhealth_ml.training train --prepared artifacts/preprocessing --out artifacts/seed42/centralized
python -m pytest
```

Training defaults: seed 42, Adam 0.001, batch 32, up to 100 epochs, early-stop
patience 10, min_delta 0.0001, restore best weights. Dropout 0.30 and L2 0.0001.
The local head uses up to 300 trees, depth 4, learning rate 0.05, subsampling 0.9,
and 20-round validation early stopping. Validation temperatures are separate
for the ANN and hybrid. Logistic regression and random forest use the same split.

## Artifact contract

A successful run produces `model/ann.keras`, `preprocessor.joblib`, `xgb.json`,
`meta.json`, `manifest.json`, and `reload_verified.json`, plus validation metrics,
learning curves, settings, baseline artifacts and provenance in the run directory.
The manifest verifies file hashes before loading, and the completion marker binds
the successful reload to that manifest. Only load trusted artifacts: checksums
provide consistency, not publisher authentication, and joblib is executable data.
Each bundle records source code hashes, dataset hashes, class/feature order,
units, seeds, dependency versions and the training row IDs of this public release.
Raw-file hashes and LF-normalized CSV hashes are recorded separately.

No existing output is overwritten. The preprocessor is fitted only on training
rows and is immutable thereafter. Reports must declare units; impossible values
are rejected. Missing report features are imputed from training medians.

## Evaluation and limitations

All tuning and calibration uses validation. `fedhealth_ml.final_evaluate` reads a
frozen model plan and creates a final-test ledger before computing results. It
reports ANN versus ANN and hybrid versus hybrid, confusion counts, macro-F1,
accuracy, per-class/subtype/source recall and 15-bin ECE. Its registry payloads
contain measured metrics; the database seed contains no performance claims.
`fedhealth_ml.source_holdout` refits both ANN and preprocessor without each source.
Run this sensitivity analysis after freezing and evaluating the main comparison.

1,692 records contain borrowed feature values; 891 labels are rule-derived.
Upstream imputation happened before splitting. The supplied random split is not
an independent original-hospital/cohort holdout. Source and subtype findings,
including poor results, must be reported. There is no verified Pakistani clinical
validation. Confidence scores are screening support, not diagnoses.

Old notebooks and rules are in `archive/pre_four_class`. Rules are research-only
and disabled in inference. See `docs/FOUR_CLASS_SCOPE_RECONCILIATION.md` for how
this replaces the older documents' data assumptions while preserving the hybrid.

# User-run Colab Module 3 record — 2026-09-26

These results were transcribed from the user's Colab cell outputs and training
log shared in the task. The Google Drive artifacts were saved by Colab but are
not mounted in this local workspace, so this report does not claim an independent
inspection of those files. Keep this run separate from the earlier local seed-42
results in [VERIFICATION.md](VERIFICATION.md).

## Run identity and data audit

- Branch: `feat/four-class-ml-federation`.
- Notebook 01 printed commit `38083c6`; Notebook 02 printed `ebf71b7` after
  the private-clone setup fix. The Notebook 03 setup commit was not included in
  the shared output.
- Google Drive run: `MyDrive/FYP/four_class/four_class_v1`.
- Canonical data SHA-256: `ec5dba6d3a72ae479bac9856ed368128565596fa7353e733531b0c11ee29ff04`.
- Provenance SHA-256: `2237688f1f33a1929b2a6aed66acd2fe0c5ab38bc94e315b2a6137c9bbfdfbbc`.
- 3,200 rows; four classes of 800 each; per class, 560 train, 120 validation,
  and 120 test. Ten ordered CBC features; zero duplicate feature rows.
- 1,692 rows have donor-imputed values; 2,309 clinical labels, 619 range-rule
  labels and 272 HbA2-rule labels. This is dataset provenance, not a model score.

Notebook 02 fitted the shared preprocessor on exactly 2,240 training rows and
saved it in `four_class_v1/preprocessing`. Its unit example produced HCT 38%,
HGB 12.4 g/dL and WBC 9.01. The research-only Mentzer rule audit reported
`[[356, 4], [55, 65]]` and a screen-positive fraction of `0.14375`; this rule
is disabled in inference and is not ANN performance.

## Centralized training and validation

Notebook 03 used seed 42, a maximum of 100 ANN epochs and validation-loss early
stopping. The console logged 59 epochs; the lowest *displayed* validation loss
was 0.3902 at epoch 56. It reported:

> Central training complete: `/content/drive/MyDrive/FYP/four_class/four_class_v1/seed42/centralized`; validation only, test untouched.

> Verified model: `/content/drive/MyDrive/FYP/four_class/four_class_v1/seed42/centralized/model`

All scores below are on the 480-row validation split, not the final test split.

| Model | Accuracy | Macro F1 | Log loss | ECE, 15 bins | Correct / 480 |
|---|---:|---:|---:|---:|---:|
| ANN, uncalibrated | 0.866667 | 0.866838 | 0.381065 | 0.038128 | 416 |
| ANN, calibrated | 0.866667 | 0.866838 | 0.380488 | 0.027926 | 416 |
| ANN–XGBoost hybrid | 0.877083 | 0.876911 | 0.358940 | 0.040144 | 421 |
| Logistic regression | 0.800000 | 0.799566 | 0.586337 | 0.037912 | 384 |
| Random forest | 0.872917 | 0.872847 | 0.382540 | 0.053596 | 419 |

| Model | Healthy recall | Anemia recall | Thalassemia recall | Leukemia recall |
|---|---:|---:|---:|---:|
| ANN, uncalibrated | 107/120 | 104/120 | 104/120 | 101/120 |
| ANN, calibrated | 107/120 | 104/120 | 104/120 | 101/120 |
| ANN–XGBoost hybrid | 111/120 | 104/120 | 106/120 | 100/120 |
| Logistic regression | 106/120 | 90/120 | 99/120 | 89/120 |
| Random forest | 110/120 | 104/120 | 105/120 | 100/120 |

The per-class correct counts sum to each reported accuracy. Temperature
calibration improved the ANN's validation log loss and ECE without changing its
class predictions. The hybrid scored five more validation rows correctly than
the ANN, but one fewer leukemia row. Module 4 federates the ANN weights; the
XGBoost head is local.

## Checks and limits at this checkpoint

- Local Python 3.12 test suite rerun: 33 passed, 12 non-failing Keras/NumPy
  deprecation warnings. Dependency check: 85 compatible packages.
- Local dataset audit reproduced the canonical data and provenance hashes,
  3,200 rows, split counts, zero duplicate feature rows and 1,692 imputed rows.
- All current notebook code cells parsed successfully. The training path uses
  only train and validation rows; its save routine reloads and compares the
  model, preprocessor and predictions before writing `reload_verified.json`.
- The actual Google Drive bundle, its manifest, `history.json`, and its full
  confusion matrices were not inspected from this workspace. The user has not
  yet shared the loss plot or those files.
- This is one Colab seed and one supplied random split. Validation was used for
  early stopping, calibration and head selection; these scores are not an
  independent final test. Upstream donor imputation before the split, rule-based
  labels and source/class confounding remain material limitations.
- Colab Module 4, the three-seed federation comparison, source-exclusion
  analysis, final test, Docker deployment, and clinical validation remain open.

No change to the frozen protocol or new training run was made for this report.

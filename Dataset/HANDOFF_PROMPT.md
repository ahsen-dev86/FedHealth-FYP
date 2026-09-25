# Handoff prompt: retrain FedHealth on the new 4-class dataset

> Copy everything below this line and send it to your friend (or paste it into their Claude Code session
> opened at the repo root).

---

You are taking over the **ML training (Module 3) and federated learning (Module 4/5)** parts of the FedHealth FYP
repo. The dataset was rebuilt from scratch, and the old training was built for a different dataset and label set.
Your job: **retrain everything on the new dataset, redo federated learning from scratch, and remove the old
material that no longer applies.**

## 1. The new dataset (what changed and where it is)

- **Repo:** https://github.com/ahsen-dev86/FedHealth-FYP (public), branch `main`
- **File:** `Dataset/fedhealth_cbc_4class.csv`, added in commit `a04aa66`
- **Integrity check:** 3,200 rows, 14 columns, SHA-256 `9a7fbe4d41b88103e56934e10d132aa4c9fdcaafcdc9f3c4014deb859e0437c5`
- **Also in `Dataset/` on `main`:** `DATASET_README.md` and `FedHealth Dataset Construction.pdf` (how the dataset was
  built, sources, limitations), `fedhealth_cbc_4class_provenance.csv` (same rows and `row_id`, plus `source`,
  `source_row`, `label_basis`, `imputed`, which you need for source-holdout tests and source-based FL partitions),
  `build_dataset.py` (the builder) and this file. The raw source files (about 250 MB) are **not** in the repo; the
  README links to every source, and the owner has local copies if you need to rebuild.

| Column | Meaning |
|---|---|
| `row_id` | 1..3200. **Not a feature.** |
| `label` | **Target.** `healthy`, `anemia`, `thalassemia`, `leukemia` (800 each, perfectly balanced) |
| `subtype` | Original detailed label (e.g. `iron_deficiency_anemia`, `alpha_thal_2`). **Never use it as a feature: it leaks the label.** Use it only for per-subtype error analysis. |
| `WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp` | **The 10 features**, in this exact order. Units: WBC and PLT in 10³/µL, RBC in 10⁶/µL, HGB and MCHC in g/dL, HCT / RDW / NEUTp in %, MCV in fL, MCH in pg. No missing values. |
| `split` | `train` / `val` / `test`, stratified by class (560 / 120 / 120 per class). **Use it as given.** |

Where the rows come from (every row is a real patient record from a public dataset; **no SMOTE, GAN or synthetic
patients**, classes were balanced by downsampling):
- **leukemia:** LeukoAlert (Mendeley, 746 rows) + Kaggle *Anemia Types Classification* (54)
- **anemia:** Kaggle *Anemia Types Classification* (588) + LeukoAlert low-Hb non-leukemia patients (212, rule-labelled)
- **thalassemia:** Kaggle plenoi *Thalassemia* (385, alpha) + Kaggle letslive alpha carriers (143) + Mendeley Iraq
  beta trait by HbA2 rule (272)
- **healthy:** plenoi normals (228) + Kaggle Healthy (165) + LeukoAlert normal-range patients (407, rule-labelled)

Links: https://data.mendeley.com/datasets/vc7kwnyppz/1 · https://www.kaggle.com/datasets/ehababoelnaga/anemia-types-classification ·
https://www.kaggle.com/datasets/plenoi/thalassemia · https://www.kaggle.com/datasets/letslive/alpha-thalassemia-dataset ·
https://data.mendeley.com/datasets/p8rv84hrbs/1

## 2. Known limitations. Read before training, and state them in the report

1. **WBC, PLT, RDW and NEUTp are partly borrowed.** Some sources never measured them (all plenoi and Mendeley
   thalassemia rows have no real WBC/PLT). They were copied from the nearest real non-leukemia LeukoAlert
   patient (matched on HGB/MCV/MCH/RBC). The model cannot learn any real effect thalassemia has on WBC/PLT.
2. **Leukemia is mostly one hospital's data** (746 of 800). In a test where the 54 Kaggle leukemia rows were held
   out, a random forest recognised only ~2% of them: it learned LeukoAlert-style severe pancytopenia (median WBC ≈ 3,
   PLT ≈ 60), and Kaggle's milder leukemia (WBC 10 to 27) looks different. Expect weak recall on mild presentations.
3. **891 of 3,200 rows have rule-based labels**, not clinical diagnoses (212 anemia, 407 healthy, 272 thalassemia).
4. **Thalassemia is 528 alpha rows and 272 beta rows.** Alpha-thal-2 carriers look almost normal (median MCV 81), so
   recall on `alpha_thal_2` will be low (~61% in a quick test).
5. **Different labs and populations**, including many children in the Mendeley set. A model can partly learn
   "which source" instead of the disease.
6. A quick centralized random forest (5-fold) gets ~87% accuracy, and every class scores 0.85 to 0.90 F1. This is a
   sanity check, not a target to beat by tricks. If you see >97%, suspect leakage.

## 3. What is in the repo now (old system, built for a different dataset)

- `Module 3 ML/`: `schema.py`, `preprocess.py`, `models.py` (Hybrid ANN→XGBoost, temperature calibration),
  `rules.py` (Mentzer and other thal indices), notebooks `01_eda` to `04_train_modelB`, `_build_notebooks.py`.
  It defines **two tracks**: Model A `cbc_multiclass` (9 classes, 14 features, from the Kaggle anemia CSV only)
  and Model B thalassemia (`thal_carrier` in schema/seed.sql but `thal_screen` in Module 6, which is an inconsistency).
- `Module 4 FL/`: Flower FedAvg on the **Model A ANN**, hard-wired to `schema.MODEL_A_FEATURES / MODEL_A_CLASSES`,
  reading `anemia_diagnosed_cbc_data_v4.csv`, with `prepare_training_split.py` (old seed-42 split of 896/128/257)
  and `partition.py`.
- `Module 5 Encryption/`: Paillier variants of the Module 4 client/strategy/simulation.
- `Module 6 Domain API/`: `app.py` and `predictors.py` load artifacts (`preprocessor.joblib`, `ann.keras`,
  `xgb.json`, `meta.json`) for `cbc_multiclass` and `thal_screen`.
- `Module 1 Database/seed.sql`: `ml_models` rows with the old class lists.
- `Module 9 Docker Compose/`, `Module 10 Documentation/`: paths and docs that mention the old models.

Find every dependency with:
`grep -rIn "MODEL_A\|MODEL_B\|cbc_multiclass\|thal_screen\|thal_carrier\|anemia_diagnosed" --include=*.py --include=*.js --include=*.sql --include=*.yml --include=*.md .`

## 4. What to do

### 4.1 Replace the model design (Module 3)
- **One model, four classes**, fixed order `["healthy", "anemia", "thalassemia", "leukemia"]`, ten fixed features in
  the CSV order. Drop the 9-class Model A and the separate beta-thal Model B track. The user only wants the general
  flag (healthy / anemia / thalassemia / leukemia), not subtypes.
- **Preprocessing:** keep the idea in `schema.py` / `preprocess.py` (plausible ranges → NaN, median imputer,
  standard scaler, **all fitted on train rows only**). Add RDW (9 to 40) and NEUTp (0 to 100) to the ranges; keep
  the real-report unit normalizer (`normalize_units`) for inference, because lab reports use `/mm³` and g/L.
  The imputer stays for inference even though the training CSV has no gaps: real reports often lack RDW or NEUTp.
- **Model:** an ANN (about 64→32, dropout, class-weight optional since classes are balanced) with softmax and
  temperature calibration, because Module 4 federates the ANN weights. Also train **centralized baselines**
  (logistic regression, random forest / XGBoost) on the same split so the FL result has something honest to be
  compared against. The XGBoost head is optional. Module 4 never federated it, so keep it only if it earns its place.
- **Evaluation on the `test` split only, once, at the end:** accuracy, macro-F1, **per-class recall (leukemia recall
  is the priority)**, confusion matrix, calibration (ECE), and recall by `subtype` (especially `alpha_thal_2`,
  `beta_trait`, `iron_deficiency_anemia`). Tune on `val`, never on `test`.
- **Source-holdout check (needs the provenance file from the owner):** train without one source (for example
  Kaggle leukemia, Mendeley beta, plenoi) and test on it. Report the drop honestly.
- Keep `rules.py` (interpretable Mentzer / Shine-Lal thal flag) only if you can validate it on this dataset;
  otherwise drop it and say why.

### 4.2 Redo federated learning from scratch (Module 4, then 5)
- Retrain the centralized ANN first, save `preprocessor.joblib` + `ann.keras` + `meta.json` (features, classes, data
  SHA-256), then use it as the round-zero model. Module 4 refuses to overwrite outputs, so use new output paths.
- Rewrite the data flow: **FL clients only ever see `train` rows.** Delete/replace `prepare_training_split.py`
  (the CSV already carries the `split` column).
- Simulate 3+ labs and compare: **IID**, **label-skewed non-IID** (e.g. Dirichlet α = 0.5 and 0.1), and, if you have
  the provenance file, **source-based** partitioning (each lab ≈ one original dataset), which is the most realistic
  case here. Report centralized vs FedAvg on the same `test` split, plus rounds-to-converge.
- Raw rows must never leave a client; only weights, counts and metrics travel. Re-add the Paillier layer (Module 5)
  only after plain FedAvg works, and check that the encrypted result matches plaintext FedAvg.

### 4.3 Clean up
- **Delete or archive:** the old `01_eda`, `03_train_modelA`, `04_train_modelB` notebooks and `_build_notebooks.py`
  (they teach the 9-class and alpha-carrier stories), `anemia_diagnosed_cbc_data_v4.csv` as a training input, the
  old 896/128/257 split logic, `biased_leukemia_dataset.csv` and `thalassemia/*.csv` as training inputs (they are
  superseded and the leukemia file is not real-CBC-quality). **Ask the owner before deleting anything that has
  evidence value for the report.**
- **Write fresh notebooks**: `01_eda` (dataset EDA + limitations), `02_preprocess`, `03_train_centralized`,
  `04_federated`, generated or hand-written, but reproducible with fixed seeds.
- **Update every consumer** found by the grep above: `seed.sql` `ml_models` class lists and feature lists, Module 6
  `app.py` model config and `predictors.py`, `predictionService.js`, Module 9 compose comments, Module 10 docs,
  READMEs. Resolve the `thal_carrier` / `thal_screen` naming mismatch by removing that model. Keep the package
  name `fedhealth_ml` and its main entry points where possible, so Modules 5, 6 and 9 need only small changes.
- Update the model registry metrics (`metrics.json` → `ml_models`) with the new per-class recall.

## 5. Ground rules
- Work on a branch, open a PR into `main`. Do not push raw source data or large files (`*.zip` is already ignored).
- Fixed seeds everywhere. Log the dataset SHA-256 in every saved artifact.
- Never train on `row_id`, `subtype` or `split`. Never tune on `test`. Do not add synthetic oversampling.
- The dataset is a **screening aid built from public data, not a diagnostic**. Keep that wording in any UI or report.
- Report negative results (weak leukemia recall outside LeukoAlert, weak alpha-thal-2) instead of hiding them.

## 6. Deliverables checklist
1. New `schema.py` / `preprocess.py` / `models.py` for the 4-class, 10-feature design.
2. New notebooks (EDA, preprocess, centralized training, federated training) with outputs and fixed seeds.
3. Saved artifacts + `meta.json` + `metrics.json`.
4. FL results table: centralized vs FedAvg (IID / non-IID / source-based), plus the Paillier check if done.
5. Consumers updated (DB seed, Module 6, docs), old material removed or archived, and a short CHANGELOG of what
   was discarded and why.

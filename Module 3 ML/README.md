# FedHealth — ML Module (Module 3)

Preprocessing + Colab training for the two model tracks. Everything shared by
the notebooks, the Flower FL clients (Module 4), and the inference service
(Module 6) lives in the importable `fedhealth_ml` package, so all tiers turn a
raw CBC into the *identical* model input.

## Layout
```
ml/
├── fedhealth_ml/
│   ├── schema.py      # feature vectors, plausible ranges (cleaning), label maps, classes
│   ├── preprocess.py  # cleaning, loaders, CBCPreprocessor (imputer+scaler), splits
│   ├── models.py      # Hybrid ANN->XGBoost, temperature calibration, metrics, Flower bridge
│   └── rules.py       # interpretable thal-trait discriminant indices (Mentzer et al.)
├── notebooks/
│   ├── 01_eda.ipynb            # EDA + the biased-leukemia & alpha-thal case studies
│   ├── 02_preprocess.ipynb     # fit + save the Model A preprocessor and splits
│   ├── 03_train_modelA.ipynb   # CBC multi-condition model (anemia + leukemia + healthy)
│   ├── 04_train_modelB.ipynb   # beta-thalassemia-trait screener (you supply the dataset)
│   └── _build_notebooks.py     # regenerates the .ipynb files
└── requirements.txt
```

## The two models

**Model A — `cbc_multiclass`** (works today). Trained on the cleaned anemia CBC
dataset, which already contains real *Leukemia* and *Healthy* rows. Outputs a
calibrated per-condition confidence vector over 9 classes (anemia subtypes,
leukemia, thrombocytopenia, healthy). Validated proxy performance on your data:
macro-F1 ≈ 0.88, Healthy recall ≈ 0.96. Never emits a categorical label — the
doctor confirms.

**Model B — `thal_screen`** (beta-thalassemia trait). The original alpha-carrier
dataset is not CBC-separable (AUC ≈ 0.5; see Notebook 01), so Model B targets
**beta-thal trait**, which *is* CBC-detectable. Notebook 04 is dataset-ready:
drop in a beta-thal-trait CBC dataset (options + links listed in the notebook),
and it runs the same Hybrid ANN→XGBoost pipeline. It includes a **separability
guard** that stops you training if the sourced dataset lacks signal.

## Thalassemia strategy = rule layer + ML model (best of both)
- **Rule layer (`rules.py`)** — runs *now* on the same CBC indices Model A uses.
  Computes the Mentzer index and several discrimination formulas (England-Fraser,
  Shine-Lal, Ehsani, Sirdah, Srivastava, and RDW-based Green-King / RDW-index
  when RDW is present), gated to microcytic anemia, and returns an interpretable
  "possible beta-thal trait" flag with its rationale. Validated on your data: it
  correctly restricts to microcytic cases and correctly leans most iron-deficiency
  rows away from thal.
- **ML model (Model B)** — the trained counterpart, once you supply a dataset.
  Notebook 04 even feeds the discriminant-index *values* in as engineered
  features, so the model benefits from the same clinical knowledge.

## Run order in Colab
1. Make `fedhealth_ml` importable (clone repo / upload `ml/` / mount Drive — the
   first cell of each notebook shows all three options).
2. Upload the CSVs (or point `DATA_DIR` at your Drive folder).
3. `01_eda` → `02_preprocess` → `03_train_modelA`. Then `04_train_modelB` once
   you've sourced a beta-thal-trait dataset.

## Artifacts produced (consumed by later modules)
Per model, in `/content/artifacts/<model>/`:
`preprocessor.joblib`, `ann.keras`, `xgb.json`, `meta.json`, `metrics.json`.
- Module 4 (Flower) loads `preprocessor.joblib` + the ANN and federates
  `models.get_ann_weights(ann)`.
- Module 6 (inference) loads all artifacts to serve calibrated confidence scores
  and calls `rules.thalassemia_trait_flag` for the interpretable flag.
- `metrics.json` (per-class recall / macro-F1) is registered into `ml_models` —
  the on-record evidence that the model is balanced across diseases.

#!/usr/bin/env python3
# ml/notebooks/_build_notebooks.py
# Generates the Colab notebooks as valid .ipynb JSON (no nbformat dependency).
import json, os

OUT = os.path.dirname(os.path.abspath(__file__))

def md(src):   return {"cell_type": "markdown", "metadata": {}, "source": src}
def code(src): return {"cell_type": "code", "metadata": {}, "execution_count": None,
                       "outputs": [], "source": src}

def notebook(cells):
    return {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python"},
            "colab": {"provenance": []},
        },
        "nbformat": 4, "nbformat_minor": 5,
    }

def write(name, cells):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(notebook(cells), f, indent=1)
    print("wrote", name)

# Shared setup cell: makes fedhealth_ml importable + points to the data dir.
SETUP = r'''# --- Setup ------------------------------------------------------------------
# Module 3 Colab setup.
#
# Prerequisite:
# Clone the GitHub testing branch into /content/FedHealth-FYP before running
# these notebooks. Dataset CSVs remain in Google Drive at MyDrive/FYP.
#
# This repository stores shared files flat in "Module 3 ML/". The code below
# creates the temporary "fedhealth_ml" package layout expected by the notebooks.

from pathlib import Path
from google.colab import drive
import os
import shutil
import sys

REPO_DIR = Path('/content/FedHealth-FYP')
SOURCE_DIR = REPO_DIR / 'Module 3 ML'
assert SOURCE_DIR.exists(), (
    'Repository files are missing. Clone the GitHub testing branch first.'
)

if not os.path.exists('/content/drive/MyDrive'):
    drive.mount('/content/drive')

!pip -q install -r "/content/FedHealth-FYP/Module 3 ML/requirements.txt"

RUNTIME_DIR = Path('/content/fedhealth_runtime')
PACKAGE_DIR = RUNTIME_DIR / 'fedhealth_ml'
PACKAGE_DIR.mkdir(parents=True, exist_ok=True)

for filename in ['schema.py', 'preprocess.py', 'models.py', 'rules.py']:
    shutil.copy2(SOURCE_DIR / filename, PACKAGE_DIR / filename)

(PACKAGE_DIR / '__init__.py').write_text(
    '# Temporary Colab package for Module 3 validation.\n'
)

if str(RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(RUNTIME_DIR))

DATA_DIR = '/content/drive/MyDrive/FYP'
ANEMIA = f'{DATA_DIR}/anemia_diagnosed_cbc_data_v4.csv'
THAL   = f'{DATA_DIR}/thalassemia_alphanorm.csv'
LEUK   = f'{DATA_DIR}/biased_leukemia_dataset.csv'

for dataset_path in [ANEMIA, THAL, LEUK]:
    assert os.path.exists(dataset_path), f'Dataset not found: {dataset_path}'

import numpy as np, pandas as pd, matplotlib.pyplot as plt
from fedhealth_ml import schema, preprocess as pp

print('fedhealth_ml loaded. Model A features:', len(schema.MODEL_A_FEATURES))
print('All three datasets found in Google Drive.')
'''

# ============================================================================
# 01 — EDA
# ============================================================================
write("01_eda.ipynb", [
    md("# FedHealth — Notebook 01: Exploratory Data Analysis\n"
       "\n"
       "Goals: understand the three CBC datasets, **document the data-quality "
       "decisions** that shape the whole project, and produce the evidence you "
       "can show at defense. Key conclusions reached here:\n"
       "1. The **anemia CBC dataset** is our multi-disease workhorse (it already "
       "contains real *Leukemia* rows) — but it needs cleaning (impossible values).\n"
       "2. `biased_leukemia_dataset.csv` has **no predictive signal** and no "
       "Pakistani data → **excluded** from modelling; kept only as a case study.\n"
       "3. The **alpha-thalassemia** dataset is **not CBC-separable** (AUC ~0.5) → "
       "Model B's dataset choice is a documented open decision."),
    code(SETUP),
    md("## 1. Load all three datasets"),
    code("a = pd.read_csv(ANEMIA)\n"
         "t = pd.read_csv(THAL)\n"
         "l = pd.read_csv(LEUK)\n"
         "print('anemia', a.shape, '| thal', t.shape, '| leukemia', l.shape)"),
    md("## 2. Model A dataset — class distribution\n"
       "Note this file is multi-class and already includes **Leukemia** and "
       "**Healthy** — this is why we source leukemia here rather than from the "
       "biased file."),
    code("counts = a['Diagnosis'].value_counts()\n"
         "print(counts)\n"
         "counts.plot(kind='barh'); plt.title('Model A class distribution'); "
         "plt.xlabel('rows'); plt.gca().invert_yaxis(); plt.tight_layout(); plt.show()"),
    md("## 3. Data-quality: physiologically impossible values\n"
       "Several CBC columns contain impossible entries (negative HGB/MCV, WBC "
       "differentials in the thousands). We quantify them here; `preprocess.py` "
       "turns them into NaN and median-imputes (fit on train only)."),
    code("desc = a[schema.MODEL_A_FEATURES].describe().T[['min','50%','max']]\n"
         "print(desc.round(1))\n"
         "bad = {}\n"
         "for c in schema.MODEL_A_FEATURES:\n"
         "    lo, hi = (schema.PLAUSIBLE_RANGES.get(c) or schema.PLAUSIBLE_RANGES[c.upper()])\n"
         "    bad[c] = int(((a[c] < lo) | (a[c] > hi)).sum())\n"
         "print('\\nout-of-range counts per feature:'); print(pd.Series(bad)[lambda s: s>0])"),
    md("## 4. Case study: why `biased_leukemia_dataset.csv` is excluded\n"
       "If a feature carries signal, its mean should differ between Positive and "
       "Negative cases. Here **every** feature — including bone-marrow-blast %, "
       "the strongest possible marker — is identical across the label. The label "
       "is independent of the features."),
    code("g = l.groupby('Leukemia_Status')\n"
         "for f in ['Bone_Marrow_Blasts','WBC_Count','Platelet_Count','Hemoglobin_Level','Age']:\n"
         "    m = g[f].mean()\n"
         "    print(f'{f:20} pos={m.get(\"Positive\",float(\"nan\")):.1f}  neg={m.get(\"Negative\",float(\"nan\")):.1f}')\n"
         "print('\\nCountries (note: no Pakistan):', list(l['Country'].value_counts().index[:6]))"),
    md("**Conclusion:** no learnable signal + no locally-representative data. "
       "Excluded from training; retained here as a data-validation / fairness "
       "demonstration (ties to the National AI Policy 2025 point in the scope)."),
    md("## 5. Thalassemia dataset — the CBC-separability check\n"
       "We test whether alpha-carrier vs normal can be told apart from CBC "
       "indices. (Requires nothing but sklearn.)"),
    code("from sklearn.model_selection import cross_val_predict, StratifiedKFold\n"
         "from sklearn.pipeline import make_pipeline\n"
         "from sklearn.impute import SimpleImputer\n"
         "from sklearn.preprocessing import StandardScaler\n"
         "from sklearn.linear_model import LogisticRegression\n"
         "from sklearn.metrics import roc_auc_score\n"
         "y = (t['phenotype'] == 'alpha carrier').astype(int)\n"
         "cv = StratifiedKFold(5, shuffle=True, random_state=42)\n"
         "def auc(cols):\n"
         "    pipe = make_pipeline(SimpleImputer(strategy='median'), StandardScaler(),\n"
         "                         LogisticRegression(max_iter=1000))\n"
         "    p = cross_val_predict(pipe, t[cols], y, cv=cv, method='predict_proba')[:,1]\n"
         "    return round(roc_auc_score(y, p), 3)\n"
         "cbc = schema.MODEL_B_FEATURES\n"
         "print('CBC-only AUC          :', auc(cbc))\n"
         "print('CBC + HbA2/HbF AUC    :', auc(cbc + ['hba2','hbf']))\n"
         "print('electrophoresis-only  :', auc(['hba','hba2','hbf']))"),
    md("**Conclusion:** ~0.5 AUC on CBC → alpha *silent carriers* are essentially "
       "invisible on a blood count (clinically expected). Model B needs either a "
       "**beta-thalassemia-trait** CBC dataset (which *is* CBC-detectable) or to "
       "be folded into Model A. Decision tracked in Notebook 04."),
])

# ============================================================================
# 02 — Preprocess
# ============================================================================
write("02_preprocess.ipynb", [
    md("# FedHealth — Notebook 02: Preprocessing & Normalization\n"
       "Produces the artifacts every tier reuses: the **fitted preprocessor** "
       "(median imputer + StandardScaler) and the stratified splits. Fitting "
       "happens on the training split only, so nothing leaks into val/test — and "
       "the FL clients + inference service load this exact object, guaranteeing "
       "identical feature vectors across the federation."),
    code(SETUP),
    md("## 1. Load + clean (impossible values -> NaN)"),
    code("X, y = pp.load_anemia(ANEMIA)\n"
         "print('X', X.shape, '| NaNs introduced by range-cleaning:', int(X.isna().sum().sum()))\n"
         "print('classes present:', sorted(y.unique()))"),
    md("## 2. Stratified train / val / test split\n"
       "Stratification preserves the (very imbalanced) class ratios in each split."),
    code("sp = pp.stratified_split(X, y, test_size=0.2, val_size=0.1, seed=42)\n"
         "for k in ['X_train','X_val','X_test']:\n"
         "    print(f'{k:8}', sp[k].shape)"),
    md("## 3. Fit the preprocessor on TRAIN only, then save it"),
    code("import os\n"
         "ART = '/content/artifacts/modelA'; os.makedirs(ART, exist_ok=True)\n"
         "prep = pp.CBCPreprocessor(schema.MODEL_A_FEATURES).fit(sp['X_train'])\n"
         "prep.save(f'{ART}/preprocessor.joblib')\n"
         "Xtr = prep.transform(sp['X_train']); Xval = prep.transform(sp['X_val']); Xte = prep.transform(sp['X_test'])\n"
         "print('scaled train', Xtr.shape, '| any NaN:', bool(np.isnan(Xtr).any()))\n"
         "print('saved preprocessor ->', f'{ART}/preprocessor.joblib')"),
    md("## 4. Encode labels + inspect class imbalance\n"
       "The class weights below are what the ANN uses to avoid biasing toward "
       "frequent classes (you asked for balanced performance + healthy detection)."),
    code("from fedhealth_ml import models\n"
         "ytr = pp.encode_labels(sp['y_train'], schema.MODEL_A_CLASSES)\n"
         "yval = pp.encode_labels(sp['y_val'], schema.MODEL_A_CLASSES)\n"
         "yte = pp.encode_labels(sp['y_test'], schema.MODEL_A_CLASSES)\n"
         "cw = models.class_weights(ytr, len(schema.MODEL_A_CLASSES))\n"
         "for i, c in enumerate(schema.MODEL_A_CLASSES):\n"
         "    print(f'{c:34} n_train={int((ytr==i).sum()):4d}  weight={cw[i]:.2f}')"),
    md("## 5. Save arrays for the training notebook"),
    code("np.savez(f'{ART}/arrays.npz', Xtr=Xtr, Xval=Xval, Xte=Xte, ytr=ytr, yval=yval, yte=yte)\n"
         "print('saved ->', f'{ART}/arrays.npz')"),
    md("### Thalassemia preprocessing\n"
       "Deferred until the Model B dataset decision (Notebook 04). The same "
       "`pp.load_thal` + `CBCPreprocessor(schema.MODEL_B_FEATURES)` pipeline "
       "applies to whichever dataset is chosen."),
])

# ============================================================================
# 03 — Train Model A
# ============================================================================
write("03_train_modelA.ipynb", [
    md("# FedHealth — Notebook 03: Train Model A (Hybrid ANN -> XGBoost)\n"
       "Trains the CBC multi-condition model **centrally** as the reference model. "
       "The ANN is the component that later gets federated (FedAvg + Paillier, "
       "Modules 4-5); XGBoost is the local meta-head. Output is a **calibrated "
       "per-condition confidence vector** — never a hard label."),
    code(SETUP),
    md("## 1. Load the preprocessed arrays from Notebook 02"),
    code("ART = '/content/artifacts/modelA'\n"
         "d = np.load(f'{ART}/arrays.npz')\n"
         "Xtr, Xval, Xte = d['Xtr'], d['Xval'], d['Xte']\n"
         "ytr, yval, yte = d['ytr'], d['yval'], d['yte']\n"
         "from fedhealth_ml import models, schema\n"
         "classes = schema.MODEL_A_CLASSES; n = len(classes)\n"
         "print('train', Xtr.shape, '| classes', n)"),
    md("## 2. Build + train the ANN (with balanced class weights)"),
    code("ann = models.build_ann(input_dim=Xtr.shape[1], n_classes=n, hidden=(64,32), dropout=0.3)\n"
         "ann.summary()\n"
         "cw = models.class_weights(ytr, n)\n"
         "hist = models.train_ann(ann, Xtr, ytr, Xval, yval, class_weight=cw,\n"
         "                        epochs=200, batch_size=32, patience=20, verbose=0)\n"
         "plt.plot(hist.history['loss'], label='train'); plt.plot(hist.history['val_loss'], label='val')\n"
         "plt.legend(); plt.title('ANN loss'); plt.xlabel('epoch'); plt.show()"),
    md("## 3. Train the XGBoost meta-head on ANN embeddings + calibrate"),
    code("hybrid = models.HybridModel(ann, classes, model_name='cbc_multiclass', version='v1.0.0')\n"
         "hybrid.fit_meta(Xtr, ytr, Xval, yval, n_estimators=300, max_depth=4)\n"
         "print('temperature T =', round(hybrid.temperature.T, 3))"),
    md("## 4. Evaluate on the held-out test set\n"
       "We report **macro-F1** and **per-class recall** — the evidence that the "
       "model is balanced across diseases, not just globally accurate."),
    code("proba = hybrid.predict_proba(Xte)\n"
         "pred = proba.argmax(1)\n"
         "metrics = models.compute_metrics(yte, pred, classes)\n"
         "print('macro-F1          :', metrics['macro_f1'])\n"
         "print('balanced accuracy :', metrics['balanced_accuracy'])\n"
         "print('\\nper-class:')\n"
         "for c in classes:\n"
         "    pc = metrics['per_class'][c]\n"
         "    print(f'  {c:34} recall={pc[\"recall\"]:.2f} precision={pc[\"precision\"]:.2f} support={pc[\"support\"]}')"),
    code("from sklearn.metrics import ConfusionMatrixDisplay\n"
         "ConfusionMatrixDisplay.from_predictions(yte, pred, display_labels=range(n))\n"
         "plt.title('Model A confusion matrix (test)'); plt.show()"),
    md("## 5. Confidence-score output (what the Doctor Portal shows)\n"
       "No categorical diagnosis — just calibrated confidences the doctor then "
       "confirms."),
    code("scores = hybrid.predict_scores(Xte[:3])\n"
         "for i, s in enumerate(scores):\n"
         "    top = sorted(s.items(), key=lambda kv: -kv[1])[:4]\n"
         "    print(f'sample {i}:', {k: round(v,3) for k,v in top}, '...')"),
    md("## 5b. Thalassemia-trait screening flag (rule layer, runs alongside)\n"
       "The interpretable Mentzer/discriminant layer (`fedhealth_ml.rules`) runs "
       "on the same CBC indices and surfaces *possible beta-thalassemia trait* "
       "next to the ML scores. It only fires on microcytic anemia (clinical gate) "
       "and screens — it does not diagnose."),
    code("from fedhealth_ml import rules\n"
         "# Show the flag for the same 3 samples, using their raw (unscaled) CBC.\n"
         "raw_rows = sp['X_test'].iloc[:3].to_dict('records') if 'sp' in dir() else None\n"
         "# If sp isn't in memory (ran 03 standalone), reload raw test rows:\n"
         "if raw_rows is None:\n"
         "    X_raw, y_raw = pp.load_anemia(ANEMIA)\n"
         "    raw_rows = X_raw.iloc[:3].to_dict('records')\n"
         "for i, r in enumerate(raw_rows):\n"
         "    f = rules.thalassemia_trait_flag(r)\n"
         "    print(f'sample {i}: applicable={f[\"applicable\"]} flag={f[\"flag\"]} '\n"
         "          f'mentzer={f[\"mentzer_index\"]} :: {f[\"rationale\"]}')"),
    md("## 6. Save model + preprocessor + metrics (for the FL client, inference "
       "service, and the ml_models registry)"),
    code("hybrid.save(ART)\n"
         "models.write_registry_metrics(ART, metrics)\n"
         "print('saved: ann.keras, xgb.json, meta.json, metrics.json in', ART)\n"
         "# The preprocessor.joblib from Notebook 02 sits alongside these."),
    md("## 7. How this plugs into Flower (Module 4) and the registry\n"
       "```python\n"
       "# FL client: the ANN weights ARE the federated parameters.\n"
       "w = models.get_ann_weights(hybrid.ann)   # list[np.ndarray] -> Flower params\n"
       "# FedAvg averages these across labs; Paillier (Module 5) encrypts them.\n"
       "# models.set_ann_weights(hybrid.ann, global_weights)  # apply the global model\n"
       "```\n"
       "Register the model version by POST-ing `meta.json` + `metrics.json` "
       "to the backend's model-registry route (Module 6), which calls "
       "`MlModels.register(...)` from Module 1. The `metrics.json` per-class "
       "recall is what proves, on the record, that the model isn't disease-biased."),
])

# ============================================================================
# 04 — CBC thalassemia risk-flag validation
# ============================================================================
write("04_train_modelB.ipynb", [
    md("""# FedHealth — Notebook 04: CBC thalassemia risk-flag validation

## Purpose

FedHealth uses a routine CBC to flag **possible thalassemia risk**, alongside
Model A's healthy, anemia, and leukemia-risk outputs. This is an interpretable
screening layer, not a diagnosis and not a thalassemia subtype classifier.

It evaluates the existing CBC discriminant-index rule on `twoalphas.csv`.
Confirmation requires clinical review and haemoglobin electrophoresis."""),
    code(SETUP),

    md("""## 1. Load the validation dataset

`twoalphas.csv` contains known alpha-trait and silent-carrier records. It has no
healthy/control group, so it can evaluate rule behaviour on known
thalassemia-related records only; it cannot measure specificity or false-positive rate."""),
    code("""from pathlib import Path
from fedhealth_ml import rules

THAL_CSV = f"{DATA_DIR}/twoalphas.csv"
assert Path(THAL_CSV).exists(), f"Dataset not found: {THAL_CSV}"

raw = pd.read_csv(THAL_CSV)
required = {"phenotype", "hb", "rbc", "mcv", "mch"}
missing = required - set(raw.columns)
assert not missing, f"Missing required columns: {sorted(missing)}"

print("Dataset:", THAL_CSV)
print("Records:", len(raw))
print("Phenotypes:", raw["phenotype"].value_counts().to_dict())"""),

    md("""## 2. Apply the CBC risk flag

The clinical gate makes the rule applicable only to microcytic CBC patterns.
A positive flag means that a consensus of available indices favours a
thalassemia-trait pattern over iron deficiency. It is not a confirmed diagnosis."""),
    code("""records = []

for _, row in raw.iterrows():
    cbc = {
        key: (None if pd.isna(value) else value)
        for key, value in row.to_dict().items()
    }
    result = rules.thalassemia_trait_flag(cbc)

    records.append({
        "phenotype": cbc["phenotype"],
        "rule_applicable": bool(result["applicable"]),
        "risk_flagged": bool(result["flag"]),
        "consensus": float(result["consensus"]),
        "n_indices": int(result["n_indices"]),
        "mentzer_index": result["mentzer_index"],
        "rationale": result["rationale"],
    })

results = pd.DataFrame(records)

summary = results.groupby("phenotype", dropna=False).agg(
    records=("phenotype", "size"),
    rule_applicable=("rule_applicable", "sum"),
    risk_flagged=("risk_flagged", "sum"),
    mean_consensus=("consensus", "mean"),
)
summary["applicable_rate"] = summary["rule_applicable"] / summary["records"]
summary["flag_rate"] = summary["risk_flagged"] / summary["records"]

print("THALASSEMIA RISK-FLAG VALIDATION")
print(summary.round(3))"""),

    md("""## 3. Strict verification and evidence export

The CSV outputs are saved to Drive as reproducible validation evidence. No model
weights are trained or saved because this notebook validates a transparent rule,
rather than a subtype classifier."""),
    code("""OUT = Path("/content/drive/MyDrive/FYP/validation/module3/thal_risk")
OUT.mkdir(parents=True, exist_ok=True)

results.to_csv(OUT / "twoalphas_rule_results.csv", index=False)
summary.to_csv(OUT / "twoalphas_rule_summary.csv")

assert len(results) == len(raw), "Every input record must receive a rule result."
assert results["rule_applicable"].dtype == bool
assert results["risk_flagged"].dtype == bool
assert results["consensus"].between(0, 1).all()
assert set(summary.index) == set(raw["phenotype"].dropna().unique())

print("NOTEBOOK 04 VALIDATION: PASS")
print("Saved results to:", OUT)
print("Limitation: no healthy/control group; this does not measure specificity.")"""),

    md("""## Conclusion

Notebook 04 provides a transparent CBC-based thalassemia **risk flag** for the
system's screening workflow. It does not claim to diagnose thalassemia, infer a
subtype, or replace confirmatory testing."""),
])

print("done")

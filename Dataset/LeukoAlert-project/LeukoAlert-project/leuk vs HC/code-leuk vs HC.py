# LeukoAlert sub-project: trains and benchmarks binary classifiers (logistic regression,
# lasso, decision tree, gradient boosting, random forest, LightGBM) to distinguish
# Leukemia vs Healthy Control (HC) from CBC + hematology-analyzer features, then reports
# performance split by internal vs external validation sites plus a held-out test set.
# Standalone script; the per-site CSVs it reads/produces are the same LeukoAlert data
# consumed as a leukemia source by Dataset/build_dataset.py.
import argparse
import datetime
import re
import warnings
from pathlib import Path

import lightgbm as lgb
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from imblearn.over_sampling import ADASYN, SMOTE  # minority-class oversampling for the leukemia/healthy imbalance
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    matthews_corrcoef,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

warnings.filterwarnings("ignore")
# Consistent, publication-style plot formatting for the ROC curves this script saves.
plt.rcParams.update(
    {
        "font.family": "Arial",
        "font.size": 12,
        "axes.labelsize": 14,
        "figure.dpi": 300,
        "savefig.dpi": 300,
    }
)
sns.set_palette("husl")


# Fixed knobs: reproducibility seed, CV folds, which lettered sites count as "internal"
# vs "external" validation, the classification decision threshold, and how aggressively
# the majority (healthy) class is downsampled before oversampling the minority class.
class GlobalConfig:
    SEED = 42
    CV_FOLDS = 5
    INTERNAL_SITES = {"A", "B", "C"}
    EXTERNAL_SITES = {"D", "E", "F", "G"}
    THRESHOLD = 0.5
    DOWNSAMPLE_RATIO = 2.0


# Full feature set as named in the source publication (hematology-analyzer research
# parameters plus standard CBC indices and instrument quality flags).
PAPER_FEATURES = [
    "WBC-N", "TNC-N", "TNC", "BA-N#", "BA-N%", "WBC-D", "TNC-D", "NEUT#&", "NEUT%&",
    "LYMPH#&", "LYMPH%&", "HFLC#", "HFLC%", "BA-D#", "BA-D%", "NE-SSC", "NE-SFL", "NE-FSC",
    "LY-X", "LY-Y", "LY-Z", "MO-X", "MO-Y", "MO-Z", "NE-WX", "NE-WY", "NE-WZ", "LY-WX",
    "LY-WY", "LY-WZ", "MO-WX", "MO-WY", "MO-WZ", "MicroR", "MacroR",
    "WBC", "BASO#", "BASO%", "NRBC#", "NRBC%", "NEUT#", "NEUT%", "LYMPH#", "LYMPH%",
    "MONO#", "MONO%", "EO#", "EO%", "IG#", "IG%", "RBC", "HCT", "MCV", "RDW-SD", "RDW-CV",
    "PLT", "PLT-F", "MPV", "PDW", "PCT", "P-LCR", "MCH", "MCHC", "HGB",
    "Left Shift", "Atypical Lympho", "RBC Agglutination", "Turbidity/HGB Interf",
    "Iron Deficiency", "HGB Defect", "Fragments", "PLT Clumps",
]


# Maps each paper feature name to the column name(s) actually present in the public
# (de-identified) release of the dataset, which wraps some columns in brackets/units.
PUBLIC_FEATURE_ALIASES = {
    "WBC-N": ["[WBC-N(10^9/L)]"],
    "TNC-N": ["[TNC-N(10^9/L)]"],
    "TNC": ["[TNC(10^9/L)]"],
    "BA-N#": ["[BA-N#(10^9/L)]"],
    "BA-N%": ["[BA-N%(%)]"],
    "WBC-D": ["[WBC-D(10^9/L)]"],
    "TNC-D": ["[TNC-D(10^9/L)]"],
    "NEUT#&": ["[NEUT#&(10^9/L)]"],
    "NEUT%&": ["[NEUT%&(%)]"],
    "LYMPH#&": ["[LYMP#&(10^9/L)]"],
    "LYMPH%&": ["[LYMP%&(%)]"],
    "HFLC#": ["[HFLC#(10^9/L)]"],
    "HFLC%": ["[HFLC%(%)]"],
    "BA-D#": ["[BA-D#(10^9/L)]"],
    "BA-D%": ["[BA-D%(%)]"],
    "NE-SSC": ["[NE-SSC(ch)]"],
    "NE-SFL": ["[NE-SFL(ch)]"],
    "NE-FSC": ["[NE-FSC(ch)]"],
    "LY-X": ["[LY-X(ch)]"],
    "LY-Y": ["[LY-Y(ch)]"],
    "LY-Z": ["[LY-Z(ch)]"],
    "MO-X": ["[MO-X(ch)]"],
    "MO-Y": ["[MO-Y(ch)]"],
    "MO-Z": ["[MO-Z(ch)]"],
    "NE-WX": ["[NE-WX]"],
    "NE-WY": ["[NE-WY]"],
    "NE-WZ": ["[NE-WZ]"],
    "LY-WX": ["[LY-WX]"],
    "LY-WY": ["[LY-WY]"],
    "LY-WZ": ["[LY-WZ]"],
    "MO-WX": ["[MO-WX]"],
    "MO-WY": ["[MO-WY]"],
    "MO-WZ": ["[MO-WZ]"],
    "MicroR": ["[MicroR(%)]"],
    "MacroR": ["[MacroR(%)]"],
    "WBC": ["WBC(10^9/L)"],
    "BASO#": ["BASO#(10^9/L)"],
    "BASO%": ["BASO%(%)"],
    "NRBC#": ["NRBC#(10^9/L)"],
    "NRBC%": ["NRBC%(/100WBC)"],
    "NEUT#": ["NEUT#(10^9/L)"],
    "NEUT%": ["NEUT%(%)"],
    "LYMPH#": ["LYMPH#(10^9/L)"],
    "LYMPH%": ["LYMPH%(%)"],
    "MONO#": ["MONO#(10^9/L)"],
    "MONO%": ["MONO%(%)"],
    "EO#": ["EO#(10^9/L)"],
    "EO%": ["EO%(%)"],
    "IG#": ["[IG#(10^9/L)]"],
    "IG%": ["[IG%(%)]"],
    "RBC": ["RBC(10^12/L)"],
    "HCT": ["HCT(%)"],
    "MCV": ["MCV(fL)"],
    "RDW-SD": ["RDW-SD(fL)"],
    "RDW-CV": ["RDW-CV(%)"],
    "PLT": ["PLT(10^9/L)"],
    "PLT-F": ["[PLT-I(10^9/L)]"],
    "MPV": ["MPV(fL)"],
    "PDW": ["PDW(fL)"],
    "PCT": ["PCT(%)"],
    "P-LCR": ["P-LCR(%)"],
    "MCH": ["MCH(pg)"],
    "MCHC": ["MCHC(g/L)"],
    "HGB": ["HGB(g/L)"],
    "Left Shift": ["Q-Flag(Left Shift?)"],
    "Atypical Lympho": ["Q-Flag(Atypical Lympho?)"],
    "RBC Agglutination": ["Q-Flag(RBC Agglutination?)"],
    "Turbidity/HGB Interf": ["Q-Flag(Turbidity/HGB Interf?)"],
    "Iron Deficiency": ["Q-Flag(Iron Deficiency?)"],
    "HGB Defect": ["Q-Flag(HGB Defect?)"],
    "Fragments": ["Q-Flag(Fragments?)"],
    "PLT Clumps": ["Q-Flag(PLT Clumps?)"],
}


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)


def log_msg(message):
    stamp = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}")


# Pulls a single-letter site code out of a filename like "leuk_site_D.csv" (case
# insensitive); returns None if the filename carries no site tag.
def extract_site_id(name):
    match = re.search(r"site[_ ]?([A-Z])", name, flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


# Normalizes the label column to 0/1: accepts the text labels "healthy"/"leukemia"
# case/whitespace-insensitively, falls back to parsing an already-numeric column, and
# finally defaults anything still unresolved to 0 (healthy) rather than dropping the row.
def map_labels(series):
    mapped = series.astype(str).str.strip().str.lower().map({"healthy": 0, "leukemia": 1})
    if mapped.isna().any():
        numeric = pd.to_numeric(series, errors="coerce")
        mapped = mapped.fillna(numeric)
    mapped = mapped.fillna(0).astype(int)
    return mapped


# Concatenates every CSV in split_dir (train/validation/test) that actually has the
# label column, tagging each row with its site id and source filename.
def load_split(split_dir, label_col):
    frames = []
    for file_path in sorted(Path(split_dir).glob("*.csv")):
        df = pd.read_csv(file_path)
        if label_col not in df.columns:
            continue
        df = df.copy()
        df["site_id"] = extract_site_id(file_path.stem)
        df["_source_file"] = file_path.name
        frames.append(df)
    if not frames:
        raise ValueError(f"No valid CSV files found in {split_dir}")
    return pd.concat(frames, ignore_index=True)


# Splits the combined validation set into internal-site rows and external-site rows,
# per GlobalConfig.INTERNAL_SITES / EXTERNAL_SITES, so generalization can be reported separately.
def split_validation_cohorts(valid_df):
    internal = valid_df[valid_df["site_id"].isin(GlobalConfig.INTERNAL_SITES)].copy()
    external = valid_df[valid_df["site_id"].isin(GlobalConfig.EXTERNAL_SITES)].copy()
    return internal, external


# For every PAPER_FEATURES entry, finds which (if any) of its known public aliases is
# actually a column in this dataframe.
def resolve_feature_aliases(df):
    resolved = {}
    for feature in PAPER_FEATURES:
        candidates = PUBLIC_FEATURE_ALIASES.get(feature, [])
        resolved[feature] = next((col for col in candidates if col in df.columns), None)
    return resolved


# Builds the fixed-width numeric feature matrix the models expect: a feature with no
# matching column in this dataset is filled with a constant 0.0 (not NaN), so the
# imputer below only fills genuinely missing values, not columns absent for this cohort.
def numeric_frame(df, feature_map):
    frame = pd.DataFrame(index=df.index)
    for feature in PAPER_FEATURES:
        source_col = feature_map.get(feature)
        if source_col is None:
            frame[feature] = 0.0
        else:
            frame[feature] = pd.to_numeric(df[source_col], errors="coerce")
    frame = frame.replace([np.inf, -np.inf], np.nan)
    return frame


# Fits the mean-imputer and scaler on the TRAINING data only, returning the transformed
# training matrix alongside the fitted objects (reused unchanged for validation/test).
def fit_preprocessor(train_df, feature_map):
    imputer = SimpleImputer(strategy="mean")
    scaler = StandardScaler()
    X = imputer.fit_transform(numeric_frame(train_df, feature_map))
    X = scaler.fit_transform(X).astype(np.float32)
    return imputer, scaler, X


# Applies an already-fitted imputer/scaler to a new dataframe (val/test/site subset) —
# never re-fits, to avoid leaking that cohort's statistics into the transform.
def transform_features(df, feature_map, imputer, scaler):
    X = imputer.transform(numeric_frame(df, feature_map))
    X = scaler.transform(X).astype(np.float32)
    y = map_labels(df["leukemia_label"]).to_numpy()
    return X, y


# Randomly drops majority-class rows so its count is at most `ratio` times the minority
# count (e.g. ratio=2.0 caps healthy rows at 2x the leukemia rows), before oversampling
# brings the classes the rest of the way to balance — keeps the training set from being
# almost entirely synthetic when the original imbalance is extreme.
def downsample_majority(X, y, ratio, seed):
    classes, counts = np.unique(y, return_counts=True)
    if len(classes) != 2:
        return X, y

    majority = classes[np.argmax(counts)]
    minority = classes[np.argmin(counts)]
    minority_count = counts[np.argmin(counts)]
    target_majority = min(counts[np.argmax(counts)], int(np.ceil(minority_count * ratio)))

    majority_idx = np.where(y == majority)[0]
    minority_idx = np.where(y == minority)[0]

    rng = np.random.RandomState(seed)
    sampled_majority = rng.choice(majority_idx, size=target_majority, replace=False)
    keep_idx = np.concatenate([sampled_majority, minority_idx])
    rng.shuffle(keep_idx)
    return X[keep_idx], y[keep_idx]


# Builds a minority-class oversampler for the given method name ("adasyn"/"smote"), or
# None to skip oversampling. sampling_strategy=1.0 means fully balance the two classes.
def build_oversampler(method, seed):
    method = method.lower()
    if method == "adasyn":
        return ADASYN(sampling_strategy=1.0, n_neighbors=3, random_state=seed)
    if method == "smote":
        return SMOTE(sampling_strategy=1.0, k_neighbors=3, random_state=seed)
    if method == "none":
        return None
    raise ValueError(f"Unsupported oversampler: {method}")


# Two-stage rebalancing of the training set: downsample the majority class first, then
# oversample the minority class up to parity (see downsample_majority()'s comment for why).
def rebalance_training(X, y, method):
    X_down, y_down = downsample_majority(X, y, GlobalConfig.DOWNSAMPLE_RATIO, GlobalConfig.SEED)
    sampler = build_oversampler(method, GlobalConfig.SEED)
    if sampler is None:
        return X_down, y_down
    X_res, y_res = sampler.fit_resample(X_down, y_down)
    return X_res.astype(np.float32), y_res.astype(int)


# The 6 candidate models and their GridSearchCV hyperparameter grids.
def get_model_config():
    return {
        "Lasso": {
            "model": LogisticRegression(max_iter=5000, penalty="l1", solver="liblinear", random_state=GlobalConfig.SEED),
            "grid": {"C": [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]},
        },
        "Logistic Regression": {
            "model": LogisticRegression(max_iter=5000, random_state=GlobalConfig.SEED),
            "grid": [
                {"solver": ["liblinear"], "penalty": ["l1", "l2"], "C": [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]},
                {"solver": ["saga"], "penalty": ["l1", "l2"], "C": [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0]},
            ],
        },
        "Decision Tree": {
            "model": DecisionTreeClassifier(random_state=GlobalConfig.SEED),
            "grid": {
                "criterion": ["gini", "entropy"],
                "max_depth": [3, 5, 10, 20, 30],
                "min_samples_leaf": [1, 2, 5, 10, 20, 50],
                "min_samples_split": [2, 5, 10, 50, 100, 500],
            },
        },
        "Gradient Boosting Tree": {
            "model": GradientBoostingClassifier(random_state=GlobalConfig.SEED),
            "grid": {
                "n_estimators": [50, 100, 200, 300, 500],
                "learning_rate": [0.001, 0.01, 0.05, 0.1, 0.2],
                "max_depth": [3, 5, 8, 10],
                "subsample": [0.7, 0.8, 1.0],
            },
        },
        "Random Forest": {
            "model": RandomForestClassifier(n_jobs=-1, random_state=GlobalConfig.SEED),
            "grid": {
                "n_estimators": [50, 100, 200, 500],
                "max_depth": [5, 10, 20, 30],
                "min_samples_split": [2, 5, 10],
                "min_samples_leaf": [1, 2, 5],
            },
        },
        "LightGBM": {
            "model": lgb.LGBMClassifier(n_jobs=-1, verbose=-1, random_state=GlobalConfig.SEED),
            "grid": {
                "n_estimators": [100, 300, 500, 1000],
                "learning_rate": [0.01, 0.05, 0.1],
                "max_depth": [3, 5, 10, -1],
                "num_leaves": [31, 63, 127],
                "reg_alpha": [0.0, 0.1, 1.0],
            },
        },
    }


# Standard binary-classification metric set computed from a fixed 0/1 label ordering,
# so tn/fp/fn/tp always line up the same way regardless of which classes are present.
def compute_metrics(y_true, y_pred, y_prob):
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred, labels=[0, 1]).ravel()
    return {
        "AUC": roc_auc_score(y_true, y_prob) if len(np.unique(y_true)) == 2 else np.nan,
        "Accuracy": accuracy_score(y_true, y_pred),
        "Sensitivity": recall_score(y_true, y_pred, zero_division=0),
        "Specificity": tn / (tn + fp) if (tn + fp) > 0 else 0.0,
        "F1_Score": f1_score(y_true, y_pred, zero_division=0),
        "Precision": precision_score(y_true, y_pred, zero_division=0),
        "MCC": matthews_corrcoef(y_true, y_pred),
    }


def evaluate_estimator(model, X, y):
    y_prob = model.predict_proba(X)[:, 1]
    y_pred = (y_prob >= GlobalConfig.THRESHOLD).astype(int)
    return compute_metrics(y, y_pred, y_prob), y_prob


# Saves a labelled ROC curve (with the diagonal chance line) as a PDF for one model on
# one cohort.
def save_roc_plot(y_true, y_prob, model_name, cohort_name, output_dir):
    fpr, tpr, _ = roc_curve(y_true, y_prob)
    auc_value = roc_auc_score(y_true, y_prob)
    plt.figure(figsize=(6, 6))
    plt.plot(fpr, tpr, color="#D32F2F", lw=2, label=f"AUC = {auc_value:.3f}")
    plt.plot([0, 1], [0, 1], color="navy", linestyle="--", lw=1)
    plt.xlabel("False Positive Rate")
    plt.ylabel("True Positive Rate")
    plt.title(f"{model_name} - {cohort_name}")
    plt.legend(loc="lower right", frameon=False)
    plt.grid(False)
    file_name = f"ROC_{model_name.replace(' ', '_')}_{cohort_name}.pdf"
    plt.savefig(Path(output_dir) / file_name, bbox_inches="tight")
    plt.close()


# Evaluates one fitted model separately for each site within a cohort (e.g. each
# external validation site), for a site-level breakdown of generalization.
def evaluate_sites(model_name, model, valid_df, feature_map, imputer, scaler, cohort_name):
    rows = []
    for site_id, site_df in valid_df.groupby("site_id"):
        X_site, y_site = transform_features(site_df, feature_map, imputer, scaler)
        metrics, _ = evaluate_estimator(model, X_site, y_site)
        rows.append({"Model": model_name, "Cohort": cohort_name, "Site": site_id, **metrics})
    return rows


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", default="dataset")
    parser.add_argument("--oversampler", default="adasyn", choices=["adasyn", "smote", "none"])
    return parser.parse_args()


# Full run: load train/validation/test splits, split validation into internal vs
# external sites, fit preprocessing on train only, rebalance the training set, grid-search
# each of the 6 model types (scored by ROC AUC), evaluate every model on every cohort
# (training, internal validation, external validation, real-world test) plus per-site
# breakdowns, saving ROC plots and two summary CSVs.
def main():
    args = parse_args()

    timestamp = datetime.datetime.now().strftime("%Y%m%d")
    output_dir = Path(f"Results_Benchmark_{timestamp}")
    ensure_dir(output_dir)

    dataset_root = Path(args.dataset_root)
    train_df = load_split(dataset_root / "training", "leukemia_label")
    valid_df = load_split(dataset_root / "validation", "leukemia_label")
    test_df = load_split(dataset_root / "test", "leukemia_label")

    internal_valid_df, external_valid_df = split_validation_cohorts(valid_df)
    feature_map = resolve_feature_aliases(train_df)

    imputer, scaler, X_train = fit_preprocessor(train_df, feature_map)
    y_train = map_labels(train_df["leukemia_label"]).to_numpy()

    X_fit, y_fit = rebalance_training(X_train, y_train, args.oversampler)

    X_internal, y_internal = transform_features(internal_valid_df, feature_map, imputer, scaler)
    X_external, y_external = transform_features(external_valid_df, feature_map, imputer, scaler)
    X_test, y_test = transform_features(test_df, feature_map, imputer, scaler)

    mapped_count = sum(source_col is not None for source_col in feature_map.values())
    log_msg(f"Feature count: {len(PAPER_FEATURES)}")
    log_msg(f"Mapped public columns: {mapped_count}/{len(PAPER_FEATURES)}")
    log_msg(
        f"Training class counts: original {np.bincount(y_train)} -> fitted {np.bincount(y_fit)} "
        f"with {args.oversampler}"
    )

    cv = StratifiedKFold(n_splits=GlobalConfig.CV_FOLDS, shuffle=True, random_state=GlobalConfig.SEED)
    configs = get_model_config()
    summary_rows = []
    detail_rows = []

    for model_name, cfg in configs.items():
        log_msg(f"Optimizing {model_name}")
        grid = GridSearchCV(
            estimator=cfg["model"],
            param_grid=cfg["grid"],
            cv=cv,
            n_jobs=-1,
            scoring="roc_auc",
            verbose=1,
            error_score="raise",
        )

        try:
            grid.fit(X_fit, y_fit)
        except Exception as exc:
            log_msg(f"{model_name} failed: {exc}")
            continue

        best_model = grid.best_estimator_

        for cohort_name, X_eval, y_eval in [
            ("Training", X_train, y_train),
            ("Internal_Validation", X_internal, y_internal),
            ("External_Validation", X_external, y_external),
            ("Real_World_Test", X_test, y_test),
        ]:
            metrics, y_prob = evaluate_estimator(best_model, X_eval, y_eval)
            summary_rows.append(
                {
                    "Model": model_name,
                    "Cohort": cohort_name,
                    "Site": "Overall",
                    **metrics,
                    "Best_Params": str(grid.best_params_),
                }
            )
            if cohort_name != "Training":
                save_roc_plot(y_eval, y_prob, model_name, cohort_name, output_dir)

        detail_rows.extend(
            evaluate_sites(model_name, best_model, internal_valid_df, feature_map, imputer, scaler, "Internal_Validation")
        )
        detail_rows.extend(
            evaluate_sites(model_name, best_model, external_valid_df, feature_map, imputer, scaler, "External_Validation")
        )

    if summary_rows:
        pd.DataFrame(summary_rows).to_csv(output_dir / "Overall_Performance.csv", index=False)
    if detail_rows:
        pd.DataFrame(detail_rows).to_csv(output_dir / "Site_Level_Performance.csv", index=False)
    with open(output_dir / "Feature_Manifest.txt", "w", encoding="utf-8") as handle:
        handle.write("\n".join(PAPER_FEATURES))

    log_msg(f"Analysis complete. Results saved to {output_dir}")


if __name__ == "__main__":
    main()

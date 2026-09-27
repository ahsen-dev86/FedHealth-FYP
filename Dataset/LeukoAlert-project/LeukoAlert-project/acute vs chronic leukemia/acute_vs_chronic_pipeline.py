# LeukoAlert sub-project: trains and benchmarks several binary classifiers (logistic
# regression, gradient boosting, random forest, XGBoost, LightGBM, plus a soft-voting
# ensemble) to distinguish Acute vs Chronic Leukemia from CBC + hematology-analyzer
# features. Standalone script (its own CLI, own train/valid CSV layout under
# --data-root); it is a data SOURCE for the main FedHealth dataset build
# (see Dataset/build_dataset.py, which reads LeukoAlert's per-site CSVs), not part of
# the FedHealth model pipeline itself.
import argparse
import datetime
import re
import warnings
from pathlib import Path

import joblib  # serializes trained sklearn/xgboost/lightgbm models to .pkl files
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from imblearn.over_sampling import ADASYN, SMOTE  # minority-class oversampling for imbalanced leukemia subtypes
from lightgbm import LGBMClassifier
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, VotingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, matthews_corrcoef, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_sample_weight
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")
# Consistent, publication-style plot formatting (Arial, high DPI) for any figures saved by this pipeline.
plt.rcParams.update(
    {
        "font.family": "Arial",
        "font.size": 10,
        "axes.labelsize": 12,
        "figure.dpi": 300,
        "savefig.dpi": 300,
    }
)
sns.set_palette("husl")


# Fixed knobs for this run: reproducibility seed, CV fold count, the probability
# threshold used to turn predict_proba into a class label, the std-dev of the Gaussian
# noise added as light data augmentation, and the string->int label encoding.
class GlobalConfig:
    SEED = 42
    CV_FOLDS = 5
    THRESHOLD = 0.5
    NOISE_STD = 0.01
    TARGET_MAP = {"Acute Leukemia": 0, "Chronic Leukemia": 1}


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


def log_msg(message):
    stamp = datetime.datetime.now().strftime("%H:%M:%S")
    print(f"[{stamp}] {message}")


def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)


# Sanitizes analyzer column names (e.g. "[WBC-N(10^9/L)]") into plain identifiers by
# replacing brackets/parens/spaces/slashes/carets with underscores, then collapsing
# repeated underscores.
def clean_feature_names(df):
    df = df.copy()
    df.columns = [re.sub(r"[\[\]\(\)\s/\^]", "_", col) for col in df.columns]
    df.columns = [re.sub(r"_+", "_", col).strip("_") for col in df.columns]
    return df


# Pulls a "Site X" tag out of the filename (e.g. "valid_Site B.csv"); the internal
# training file has no such tag, so it's labelled "Internal_Train".
def extract_site_id(path):
    match = re.search(r"(Site [A-Z])", path.stem)
    if match:
        return match.group(1)
    return "Internal_Train"


# Reads one cohort CSV, keeps only the two target classes (drops any other Group value),
# encodes the label, tags the site, and cleans column names.
def load_cohort_csv(file_path):
    path = Path(file_path)
    df = pd.read_csv(path)
    df = df[df["Group"].isin(GlobalConfig.TARGET_MAP)].copy()
    if df.empty:
        return df
    df["target"] = df["Group"].map(GlobalConfig.TARGET_MAP)
    df["site_id"] = extract_site_id(path)
    return clean_feature_names(df)


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
    y = df["target"].to_numpy(dtype=int)
    return X, y


# Builds a minority-class oversampler for the given method name ("smote"/"adasyn"), or
# None to skip oversampling. sampling_strategy=1.0 means fully balance the two classes.
def build_oversampler(method):
    method = method.lower()
    if method == "smote":
        return SMOTE(sampling_strategy=1.0, k_neighbors=5, random_state=GlobalConfig.SEED)
    if method == "adasyn":
        return ADASYN(sampling_strategy=1.0, n_neighbors=5, random_state=GlobalConfig.SEED)
    if method == "none":
        return None
    raise ValueError(f"Unsupported oversampler: {method}")


# Adds small Gaussian jitter to already-scaled features (cheap data augmentation to
# reduce overfitting on oversampled/duplicated synthetic rows). No-op if noise_std <= 0.
def add_gaussian_noise(X, noise_std):
    if noise_std <= 0:
        return X
    rng = np.random.RandomState(GlobalConfig.SEED)
    noise = rng.normal(loc=0.0, scale=noise_std, size=X.shape).astype(np.float32)
    return (X + noise).astype(np.float32)


# Oversamples the minority class, adds noise, then computes a per-sample weight for
# the (possibly oversampled) training set based on each label's ORIGINAL class balance
# (from `y`, not `y_fit`) — so oversampled rows don't also get double-counted by weighting.
def prepare_training_data(X, y, method, noise_std):
    sampler = build_oversampler(method)
    if sampler is None:
        X_fit, y_fit = X, y
    else:
        X_fit, y_fit = sampler.fit_resample(X, y)
    X_fit = add_gaussian_noise(X_fit, noise_std)

    raw_weights = compute_sample_weight(class_weight="balanced", y=y)
    class_weight_map = {label: raw_weights[y == label].mean() for label in np.unique(y)}
    fit_weights = np.array([class_weight_map[label] for label in y_fit], dtype=np.float32)

    return X_fit.astype(np.float32), y_fit.astype(int), fit_weights


# Factory for one of the 6 benchmarked model types, each seeded for reproducibility.
def build_estimator(model_name):
    if model_name == "lr":
        return LogisticRegression(max_iter=3000, random_state=GlobalConfig.SEED)
    if model_name == "lasso":
        return LogisticRegression(penalty="l1", solver="liblinear", max_iter=3000, random_state=GlobalConfig.SEED)
    if model_name == "gbdt":
        return GradientBoostingClassifier(random_state=GlobalConfig.SEED)
    if model_name == "xgb":
        return XGBClassifier(
            eval_metric="logloss",
            use_label_encoder=False,
            random_state=GlobalConfig.SEED,
            n_jobs=-1,
        )
    if model_name == "rf":
        return RandomForestClassifier(random_state=GlobalConfig.SEED, n_jobs=-1)
    if model_name == "lgb":
        return LGBMClassifier(random_state=GlobalConfig.SEED, n_jobs=-1, verbose=-1)
    raise ValueError(f"Unknown model: {model_name}")


# Hyperparameter search space for GridSearchCV, per model type.
def get_param_grid(model_name):
    if model_name == "lr":
        return {"C": [0.0001, 0.001, 0.01, 0.1, 1, 10, 100], "solver": ["liblinear", "lbfgs"]}
    if model_name == "lasso":
        return {"C": [0.0001, 0.001, 0.01, 0.1, 1, 10, 100]}
    if model_name == "gbdt":
        return {
            "n_estimators": [100, 300, 500],
            "learning_rate": [0.01, 0.05, 0.1, 0.2],
            "max_depth": [3, 5, 8],
            "subsample": [0.8, 1.0],
        }
    if model_name == "xgb":
        return {
            "n_estimators": [100, 300, 500],
            "learning_rate": [0.01, 0.05, 0.1, 0.2],
            "max_depth": [3, 6, 9],
            "gamma": [0, 0.1, 0.5],
            "subsample": [0.8, 1.0],
            "colsample_bytree": [0.8, 1.0],
        }
    if model_name == "rf":
        return {
            "n_estimators": [100, 300, 500, 800],
            "max_depth": [None, 10, 20, 30],
            "min_samples_split": [2, 5, 10],
            "max_features": ["sqrt", "log2"],
        }
    if model_name == "lgb":
        return {
            "n_estimators": [100, 300, 500],
            "num_leaves": [31, 63, 127],
            "max_depth": [-1, 10, 20],
            "learning_rate": [0.01, 0.05, 0.1, 0.2],
            "reg_alpha": [0, 0.1, 1.0],
            "reg_lambda": [0, 0.1, 1.0],
        }
    raise ValueError(f"Unknown model: {model_name}")


# Exhaustive grid search over get_param_grid(), scored by ROC AUC under stratified
# k-fold CV, honoring the per-sample class-balance weights. Returns the best-fitted model.
def fit_estimator(model_name, X, y, sample_weight):
    estimator = build_estimator(model_name)
    grid = GridSearchCV(
        estimator=estimator,
        param_grid=get_param_grid(model_name),
        scoring="roc_auc",
        cv=StratifiedKFold(n_splits=GlobalConfig.CV_FOLDS, shuffle=True, random_state=GlobalConfig.SEED),
        n_jobs=-1,
        verbose=1,
        error_score="raise",
    )
    grid.fit(X, y, sample_weight=sample_weight)
    return grid.best_estimator_, grid.best_params_


# Computes the standard binary-classification metric set at GlobalConfig.THRESHOLD.
# Returns all-NaN if only one class is present (metrics like AUC are undefined then).
def evaluate_model(model, X, y):
    if len(np.unique(y)) < 2:
        return {
            "AUC": np.nan,
            "ACC": np.nan,
            "REC": np.nan,
            "SPE": np.nan,
            "PRE": np.nan,
            "F1": np.nan,
            "MCC": np.nan,
        }

    y_prob = model.predict_proba(X)[:, 1]
    y_pred = (y_prob >= GlobalConfig.THRESHOLD).astype(int)
    tn, fp, fn, tp = pd.crosstab(
        pd.Series(y, name="y_true"),
        pd.Series(y_pred, name="y_pred"),
        dropna=False,
    ).reindex(index=[0, 1], columns=[0, 1], fill_value=0).to_numpy().ravel()

    return {
        "AUC": round(roc_auc_score(y, y_prob), 4),
        "ACC": round(accuracy_score(y, y_pred), 4),
        "REC": round(recall_score(y, y_pred, zero_division=0), 4),
        "SPE": round(tn / (tn + fp) if (tn + fp) > 0 else 0.0, 4),
        "PRE": round(precision_score(y, y_pred, zero_division=0), 4),
        "F1": round(f1_score(y, y_pred, zero_division=0), 4),
        "MCC": round(matthews_corrcoef(y, y_pred), 4),
    }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", default="dataset")
    parser.add_argument("--oversampler", default="smote", choices=["smote", "adasyn", "none"])
    parser.add_argument("--noise-std", type=float, default=GlobalConfig.NOISE_STD)
    return parser.parse_args()


# Full run: load the internal training cohort + external per-site validation cohorts,
# fit preprocessing on train only, oversample+augment the training set, grid-search and
# evaluate each of the 6 model types (overall + per validation site), build a soft-voting
# ensemble of all 6, and write per-model .pkl files plus a CSV performance summary.
def main():
    args = parse_args()
    base_path = Path(__file__).parent
    data_root = base_path / args.data_root
    output_dir = base_path / f"Results_Clinical_Standard_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    ensure_dir(output_dir)

    train_files = sorted((data_root / "train").glob("*.csv"))
    valid_files = sorted((data_root / "valid").glob("valid_Site *.csv"))
    if not train_files or not valid_files:
        raise FileNotFoundError("Training or validation data not found.")

    train_df = load_cohort_csv(train_files[0])
    valid_dfs = [load_cohort_csv(file_path) for file_path in valid_files]
    valid_dfs = [df for df in valid_dfs if not df.empty]
    if train_df.empty or not valid_dfs:
        raise ValueError("No usable data found.")

    feature_map = resolve_feature_aliases(train_df)
    imputer, scaler, X_train = fit_preprocessor(train_df, feature_map)
    y_train = train_df["target"].to_numpy(dtype=int)
    X_fit, y_fit, sample_weight = prepare_training_data(X_train, y_train, args.oversampler, args.noise_std)
    mapped_count = sum(source_col is not None for source_col in feature_map.values())

    log_msg(
        f"Training class counts: original {np.bincount(y_train)} -> fitted {np.bincount(y_fit)} "
        f"with {args.oversampler}"
    )
    log_msg(f"Feature count: {len(PAPER_FEATURES)}")
    log_msg(f"Mapped public columns: {mapped_count}/{len(PAPER_FEATURES)}")

    model_names = ["lr", "lasso", "gbdt", "xgb", "rf", "lgb"]
    best_estimators = {}
    summary_rows = []

    for model_name in model_names:
        log_msg(f"Tuning {model_name.upper()}")
        estimator, best_params = fit_estimator(model_name, X_fit, y_fit, sample_weight)
        best_estimators[model_name] = estimator
        joblib.dump(estimator, output_dir / f"Model_{model_name}.pkl")

        train_metrics = evaluate_model(estimator, X_train, y_train)
        summary_rows.append(
            {
                "Model": model_name.upper(),
                "Cohort": "Training",
                "Site": "Overall",
                **train_metrics,
                "Hyperparams": str(best_params),
            }
        )

        valid_all = []
        for valid_df in valid_dfs:
            site = valid_df["site_id"].iloc[0]
            X_site, y_site = transform_features(valid_df, feature_map, imputer, scaler)
            site_metrics = evaluate_model(estimator, X_site, y_site)
            summary_rows.append(
                {
                    "Model": model_name.upper(),
                    "Cohort": "Validation",
                    "Site": site,
                    **site_metrics,
                    "Hyperparams": str(best_params),
                }
            )
            valid_all.append(valid_df)

        combined_valid = pd.concat(valid_all, ignore_index=True)
        X_valid, y_valid = transform_features(combined_valid, feature_map, imputer, scaler)
        combined_metrics = evaluate_model(estimator, X_valid, y_valid)
        summary_rows.append(
            {
                "Model": model_name.upper(),
                "Cohort": "Validation",
                "Site": "Overall",
                **combined_metrics,
                "Hyperparams": str(best_params),
            }
        )

    ensemble = VotingClassifier(estimators=[(name, est) for name, est in best_estimators.items()], voting="soft", n_jobs=-1)
    ensemble.fit(X_fit, y_fit, sample_weight=sample_weight)
    joblib.dump(ensemble, output_dir / "Model_ensemble.pkl")

    ensemble_train = evaluate_model(ensemble, X_train, y_train)
    summary_rows.append(
        {
            "Model": "ENSEMBLE",
            "Cohort": "Training",
            "Site": "Overall",
            **ensemble_train,
            "Hyperparams": "Soft Voting",
        }
    )

    for valid_df in valid_dfs:
        site = valid_df["site_id"].iloc[0]
        X_site, y_site = transform_features(valid_df, feature_map, imputer, scaler)
        metrics = evaluate_model(ensemble, X_site, y_site)
        summary_rows.append(
            {
                "Model": "ENSEMBLE",
                "Cohort": "Validation",
                "Site": site,
                **metrics,
                "Hyperparams": "Soft Voting",
            }
        )

    combined_valid = pd.concat(valid_dfs, ignore_index=True)
    X_valid, y_valid = transform_features(combined_valid, feature_map, imputer, scaler)
    ensemble_valid = evaluate_model(ensemble, X_valid, y_valid)
    summary_rows.append(
        {
            "Model": "ENSEMBLE",
            "Cohort": "Validation",
            "Site": "Overall",
            **ensemble_valid,
            "Hyperparams": "Soft Voting",
        }
    )

    pd.DataFrame(summary_rows).to_csv(output_dir / "Final_Clinical_Report.csv", index=False)
    with open(output_dir / "Feature_Manifest.txt", "w", encoding="utf-8") as handle:
        handle.write("\n".join(PAPER_FEATURES))

    log_msg(f"Done. Output: {output_dir}")


if __name__ == "__main__":
    main()

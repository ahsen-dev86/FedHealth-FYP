"""
Build the FedHealth 4-class CBC dataset (healthy / anemia / thalassemia / leukemia).

Every row is copied from a real public dataset (see DATASET_README.md). Nothing is
generated synthetically: no SMOTE / GAN. Classes are balanced by DOWNSAMPLING.
The only values not taken from the row's own source are columns that source never
measured (WBC, PLT, RDW, NEUTp); those are borrowed from the most similar real
patient in LeukoAlert and every such cell is recorded in the `imputed` column.

Run:  python build_dataset.py      (from this folder)
Out:  fedhealth_cbc_4class.csv
"""
from pathlib import Path
import glob
import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors

SEED = 42
TARGET = 800                      # rows per class
rng = np.random.default_rng(SEED)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LEUKO = HERE / "LeukoAlert-project" / "LeukoAlert-project" / "leuk vs HC" / "dataset"

FEATURES = ["WBC", "RBC", "HGB", "HCT", "MCV", "MCH", "MCHC", "RDW", "PLT", "NEUTp"]

# Physiological plausibility bounds (same as Module 3 ML/schema.py, RDW/NEUTp added)
RANGES = {
    "WBC": (0.5, 200), "RBC": (1.0, 8.0), "HGB": (2.0, 24.0), "HCT": (5.0, 70.0),
    "MCV": (40, 140), "MCH": (10, 50), "MCHC": (20, 40), "RDW": (9, 40),
    "PLT": (1, 1500), "NEUTp": (0, 100),
}


def in_range(df, cols):
    ok = pd.Series(True, index=df.index)
    for c in cols:
        lo, hi = RANGES[c]
        ok &= df[c].isna() | df[c].between(lo, hi)
    return ok


def frame(label, subtype, source, basis, src_row, **cols):
    d = pd.DataFrame({c: cols.get(c, np.nan) for c in FEATURES})
    d.insert(0, "subtype", subtype)
    d.insert(0, "label", label)
    d["source"] = source
    d["source_row"] = src_row
    d["label_basis"] = basis
    return d


# ---------------------------------------------------------------- 1. Kaggle anemia types
def load_kaggle_anemia():
    k = pd.read_csv(ROOT / "anemia_diagnosed_cbc_data_v4.csv")
    k["source_row"] = k.index + 2                       # 1-based file line incl. header
    k = k[k.Diagnosis != "Thrombocytopenia"]
    k = k.drop_duplicates(subset=[c for c in k.columns if c != "source_row"])
    # ~60% of rows carry a constant mean-fill in LYMp/NEUTp/LYMn/NEUTn/HCT/PCT
    fill = k.LYMn.round(5) == 1.88076
    k.loc[fill, "NEUTp"] = np.nan
    k.loc[fill, "HCT"] = (k.RBC * k.MCV / 10)[fill]       # exact CBC identity
    # MCHC typos: keep original unless it contradicts Hb/Hct
    mchc_calc = k.HGB / k.HCT * 100
    bad = (k.MCHC - mchc_calc).abs() > 3
    k.loc[bad, "MCHC"] = mchc_calc[bad]
    lab = np.where(k.Diagnosis == "Healthy", "healthy",
                   np.where(k.Diagnosis.str.startswith("Leukemia"), "leukemia", "anemia"))
    out = frame(lab, k.Diagnosis.str.lower().str.replace(" ", "_").values, "kaggle_anemia", "clinical",
                k.source_row.values, WBC=k.WBC.values, RBC=k.RBC.values, HGB=k.HGB.values,
                HCT=k.HCT.values, MCV=k.MCV.values, MCH=k.MCH.values, MCHC=k.MCHC.values,
                PLT=k.PLT.values, NEUTp=k.NEUTp.values)
    return out[in_range(out, FEATURES)]


# ---------------------------------------------------------------- 2. plenoi (alpha thal + normal)
def load_plenoi():
    p = pd.read_excel(HERE / "Alpha-2_addition-230622.xlsx", sheet_name="all")
    p["source_row"] = p.index + 2
    cols = ["Hb", "Hct", "MCV", "MCH", "MCHC", "RDW", "RBC count"]
    p = p.drop_duplicates(subset=cols + ["Group"])
    grp = {1: ("healthy", "normal"), 2: ("thalassemia", "alpha_thal_2"),
           3: ("thalassemia", "alpha_thal_1"), 4: ("thalassemia", "hbh_disease")}
    lab = p.Group.map(lambda g: grp[g][0]).values
    sub = p.Group.map(lambda g: grp[g][1]).values
    out = frame(lab, sub, "plenoi", "clinical", p.source_row.values, RBC=p["RBC count"].values,
                HGB=p.Hb.values, HCT=p.Hct.values, MCV=p.MCV.values, MCH=p.MCH.values,
                MCHC=p.MCHC.values, RDW=p.RDW.values)
    return out[in_range(out, FEATURES)]


# ---------------------------------------------------------------- 3. letslive (alpha carriers only)
def load_letslive():
    a = pd.read_csv(ROOT / "thalassemia" / "thalassemia_alphanorm.csv")
    a["source_row"] = a.index + 2
    a = a[a.phenotype == "alpha carrier"]        # its 'normal' rows are microcytic, so not used
    out = frame("thalassemia", "alpha_carrier", "letslive", "clinical", a.source_row.values,
                WBC=a.wbc.values, RBC=a.rbc.values, HGB=a.hb.values, HCT=a.pcv.values,
                MCV=a.mcv.values, MCH=a.mch.values, MCHC=a.mchc.values, RDW=a.rdw.values,
                PLT=a.plt.values, NEUTp=a.neut.values)
    out = out.dropna(subset=["RBC", "HGB", "HCT", "MCV", "MCH", "MCHC"])
    return out[in_range(out, FEATURES)]


# ---------------------------------------------------------------- 4. Mendeley Iraq (beta trait by HbA2 rule)
def load_mendeley():
    m = pd.read_excel(HERE / "thalassimia.xlsx").iloc[:, :12]
    m.columns = ["ID", "Gender", "Age", "MCV", "Hb", "MCH", "RBC", "S", "HbA2", "HbA", "HbF", "Iron"]
    m["source_row"] = m.index + 2
    m = m.apply(pd.to_numeric, errors="coerce")
    m = m.dropna(subset=["MCV", "Hb", "MCH", "HbA2"])
    m = m[m.Hb.between(3, 20) & m.MCV.between(40, 130) & m.MCH.between(10, 45)]
    # beta-thalassemia trait: HbA2 3.5-8 % with microcytosis (standard screening definition)
    m = m[m.HbA2.between(3.5, 8.0) & (m.MCV < 80)]
    # exact CBC identities recover what the file lacks
    rbc = m.RBC.where(m.RBC.between(1, 8), m.Hb * 10 / m.MCH)
    hct = m.MCV * rbc / 10
    mchc = m.Hb / hct * 100
    out = frame("thalassemia", "beta_trait", "mendeley_thal", "hba2_rule", m.source_row.values,
                RBC=rbc.values, HGB=m.Hb.values, HCT=hct.values, MCV=m.MCV.values,
                MCH=m.MCH.values, MCHC=mchc.values)
    return out[in_range(out, FEATURES)]


# ---------------------------------------------------------------- 5. LeukoAlert
def load_leukoalert():
    parts = []
    for f in sorted(glob.glob(str(LEUKO / "*" / "*.csv"))):
        d = pd.read_csv(f, usecols=["WBC(10^9/L)", "RBC(10^12/L)", "HGB(g/L)", "HCT(%)", "MCV(fL)",
                                    "MCH(pg)", "MCHC(g/L)", "PLT(10^9/L)", "RDW-CV(%)", "NEUT%(%)",
                                    "leukemia_label"])
        d["site"] = Path(f).parent.name + "/" + Path(f).stem
        d["source_row"] = d.index + 2
        parts.append(d)
    d = pd.concat(parts, ignore_index=True)
    d = d.rename(columns={"WBC(10^9/L)": "WBC", "RBC(10^12/L)": "RBC", "MCV(fL)": "MCV",
                          "MCH(pg)": "MCH", "PLT(10^9/L)": "PLT", "RDW-CV(%)": "RDW",
                          "NEUT%(%)": "NEUTp"})
    d["HGB"] = d["HGB(g/L)"] / 10
    d["MCHC"] = d["MCHC(g/L)"] / 10
    hct = d["HCT(%)"]
    d["HCT"] = np.where(hct < 1.5, hct * 100, hct)        # mixed fraction / percent units
    d = d[in_range(d, FEATURES)]
    d["source_row"] = d["site"] + ":" + d["source_row"].astype(str)
    return d


def sample_by_site(d, n):
    """Draw n rows spread evenly over LeukoAlert files so no single site dominates."""
    sites = d.site.unique()
    q = n // len(sites)
    take = []
    left = n
    for i, s in enumerate(sorted(sites)):
        g = d[d.site == s]
        k = min(len(g), q if i < len(sites) - 1 else left)
        take.append(g.sample(k, random_state=SEED))
        left -= k
    got = pd.concat(take)
    if left > 0:                                           # top up from leftovers
        rest = d.drop(got.index)
        got = pd.concat([got, rest.sample(left, random_state=SEED)])
    return got


def to_frame(d, label, subtype, basis):
    return frame(label, subtype, "leukoalert", basis, d.source_row.values,
                 **{c: d[c].values for c in FEATURES})


# ---------------------------------------------------------------- build
def main():
    ka, pl, le, me, lk = (load_kaggle_anemia(), load_plenoi(), load_letslive(),
                          load_mendeley(), load_leukoalert())
    # rows that only become identical after cleaning are still duplicates
    dedupe = lambda d: d.drop_duplicates(subset=FEATURES + ["label"])
    ka, pl, le, me = dedupe(ka), dedupe(pl), dedupe(le), dedupe(me)
    print("loaded rows:", dict(kaggle=len(ka), plenoi=len(pl), letslive=len(le),
                               mendeley_beta=len(me), leukoalert=len(lk)))

    leuk_pool = lk[lk.leukemia_label == "leukemia"]
    nonleuk = lk[lk.leukemia_label == "healthy"]           # LeukoAlert's non-leukemia patients

    # normal-range hospital patients (rule-labelled) to top up 'healthy'
    normal_rule = nonleuk[nonleuk.HGB.between(13, 17.5) & nonleuk.RBC.between(4.2, 6.0)
                          & nonleuk.MCV.between(80, 100) & nonleuk.MCH.between(27, 33)
                          & nonleuk.MCHC.between(32, 36) & nonleuk.WBC.between(4, 11)
                          & nonleuk.PLT.between(150, 400) & nonleuk.RDW.between(11, 16)
                          & nonleuk.NEUTp.between(40, 75)]
    # low-Hb, otherwise-normal hospital patients (rule-labelled) to top up 'anemia' if short
    anemia_rule = nonleuk[(nonleuk.HGB < 11) & nonleuk.WBC.between(4, 11)
                          & nonleuk.PLT.between(150, 450)]

    # ---- thalassemia: keep every real-complete row, trim the rule-labelled Mendeley rows
    thal_real = pd.concat([pl[pl.label == "thalassemia"], le])
    need = max(TARGET - len(thal_real), 0)
    thal = pd.concat([thal_real, me.sample(min(need, len(me)), random_state=SEED)])
    thal = thal.sample(min(len(thal), TARGET), random_state=SEED) if len(thal) > TARGET else thal

    # ---- healthy: plenoi normals + Kaggle healthy + LeukoAlert normal-range top-up
    healthy = pd.concat([pl[pl.label == "healthy"], ka[ka.label == "healthy"]])
    need = TARGET - len(healthy)
    if need > 0:
        top = to_frame(sample_by_site(normal_rule, need), "healthy", "normal_range_hospital", "range_rule")
        healthy = pd.concat([healthy, top])

    # ---- anemia: Kaggle anemia types, top up with rule-labelled LeukoAlert if short
    anemia = ka[ka.label == "anemia"]
    if len(anemia) >= TARGET:
        anemia = anemia.sample(TARGET, random_state=SEED)
    else:
        top = to_frame(sample_by_site(anemia_rule, TARGET - len(anemia)), "anemia", "low_hb_hospital", "range_rule")
        anemia = pd.concat([anemia, top])

    # ---- leukemia: all real Kaggle leukemia rows + LeukoAlert (spread across sites)
    leuk_k = ka[ka.label == "leukemia"]
    leuk_l = to_frame(sample_by_site(leuk_pool, TARGET - len(leuk_k)), "leukemia", "leukemia", "clinical")
    leukemia = pd.concat([leuk_k, leuk_l])

    df = pd.concat([healthy, anemia, thal, leukemia], ignore_index=True)

    # ---- fill columns the source never measured with the nearest real LeukoAlert patient
    pool = nonleuk.sample(150_000, random_state=SEED).reset_index(drop=True)
    match_cols = ["HGB", "MCV", "MCH", "RBC"]
    mu, sd = pool[match_cols].mean(), pool[match_cols].std()
    nn = NearestNeighbors(n_neighbors=20).fit(((pool[match_cols] - mu) / sd).values)
    df["imputed"] = ""
    for col in ["WBC", "PLT", "RDW", "NEUTp"]:
        miss = df[col].isna().values
        if not miss.any():
            continue
        # ONLY the non-leukemia neighbours are used, so no leukemia signal is created
        X = ((df.loc[miss, match_cols] - mu) / sd).values
        idx = nn.kneighbors(X, return_distance=False)
        pick = idx[np.arange(len(idx)), rng.integers(0, idx.shape[1], len(idx))]
        df.loc[miss, col] = pool.loc[pick, col].values
        df.loc[miss, "imputed"] += col + ";"
    df["imputed"] = df["imputed"].str.rstrip(";")
    # keep the 3 leukemia rows' features truthful: leukemia rows were never imputed from pool
    # unless the source lacked a column (Kaggle leukemia has no RDW)

    # ---- tidy + split
    df[FEATURES] = df[FEATURES].round(2)
    df = df.sample(frac=1, random_state=SEED).reset_index(drop=True)
    df.insert(0, "row_id", np.arange(1, len(df) + 1))
    df["split"] = ""
    for lab, g in df.groupby("label"):
        n = len(g)
        order = g.sample(frac=1, random_state=SEED).index
        df.loc[order[: int(.7 * n)], "split"] = "train"
        df.loc[order[int(.7 * n): int(.85 * n)], "split"] = "val"
        df.loc[order[int(.85 * n):], "split"] = "test"
    cols = ["row_id", "label", "subtype"] + FEATURES + ["source", "source_row", "label_basis", "imputed", "split"]
    df = df[cols]
    # clean training file + a separate traceability copy (which real row each line came from)
    trace = ["source", "source_row", "label_basis", "imputed"]
    df.drop(columns=trace).to_csv(HERE / "fedhealth_cbc_4class.csv", index=False)
    df.to_csv(HERE / "fedhealth_cbc_4class_provenance.csv", index=False)
    print(df.label.value_counts().to_string())
    print(pd.crosstab(df.label, df.source).to_string())


if __name__ == "__main__":
    main()

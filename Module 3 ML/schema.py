# ml/fedhealth_ml/schema.py
# ---------------------------------------------------------------------------
# The single source of truth for feature schemas, physiological cleaning
# ranges, and label maps. Imported by the Colab notebooks, the Flower FL
# clients (Module 4), and the inference service (Module 6) so that EVERY tier
# preprocesses CBC data identically — critical for federated learning, where
# all lab nodes must agree on the exact feature vector.
#
# Two independent model tracks (they have different source columns + labels):
#   * Model A "cbc_multiclass" — anemia subtypes + leukemia + thrombocytopenia
#                                + healthy, from the anemia CBC dataset.
#   * Model B "thal_carrier"   — thalassemia screening (see Module 3 notebook 04;
#                                dataset choice pending).
# ---------------------------------------------------------------------------

# --- Model A feature vector (order matters: this IS the ANN input layout) ----
MODEL_A_FEATURES = [
    "WBC", "LYMp", "NEUTp", "LYMn", "NEUTn", "RBC", "HGB",
    "HCT", "MCV", "MCH", "MCHC", "PLT", "PDW", "PCT",
]

# --- Model B candidate CBC feature vector (routine indices only) -------------
MODEL_B_FEATURES = [
    "hb", "pcv", "rbc", "mcv", "mch", "mchc", "rdw",
    "wbc", "neut", "lymph", "plt",
]

# --- Physiologically plausible ranges per CBC index --------------------------
# Values outside these bounds are treated as data-entry errors -> set to NaN
# -> median-imputed (impute stats fit on TRAIN only, to avoid leakage).
# Bounds are deliberately generous so genuine pathological values (e.g. very
# high WBC in leukemia) are kept. Keyed by UPPERCASE canonical name.
PLAUSIBLE_RANGES = {
    "WBC":  (0.5, 200.0),   # 10^3/uL  (leukemia can be very high)
    "LYMp": (0.0, 100.0),   # %
    "NEUTp":(0.0, 100.0),   # %
    "LYMn": (0.0, 100.0),   # 10^3/uL (absolute)
    "NEUTn":(0.0, 100.0),   # 10^3/uL (absolute)
    "RBC":  (1.0, 8.0),     # 10^6/uL
    "HGB":  (2.0, 24.0),    # g/dL
    "HCT":  (5.0, 70.0),    # %
    "MCV":  (40.0, 140.0),  # fL
    "MCH":  (10.0, 50.0),   # pg
    "MCHC": (20.0, 40.0),   # g/dL
    "PLT":  (1.0, 1500.0),  # 10^3/uL
    "PDW":  (5.0, 30.0),    # fL / %
    "PCT":  (0.0, 2.0),     # %
    "RDW":  (9.0, 40.0),    # %  (Model B)
}

# --- Model A: raw Diagnosis string -> snake_case class key -------------------
# Keys MUST match db/seed/seed.sql ml_models.classes for 'cbc_multiclass'.
ANEMIA_LABEL_MAP = {
    "Healthy":                         "healthy",
    "Iron deficiency anemia":          "iron_deficiency_anemia",
    "Normocytic hypochromic anemia":   "normocytic_hypochromic_anemia",
    "Normocytic normochromic anemia":  "normocytic_normochromic_anemia",
    "Other microcytic anemia":         "other_microcytic_anemia",
    "Macrocytic anemia":               "macrocytic_anemia",
    "Thrombocytopenia":                "thrombocytopenia",
    "Leukemia":                        "leukemia",
    "Leukemia with thrombocytopenia":  "leukemia_with_thrombocytopenia",
}

# Canonical, ordered class list for Model A (defines softmax output order).
MODEL_A_CLASSES = [
    "healthy",
    "iron_deficiency_anemia",
    "normocytic_hypochromic_anemia",
    "normocytic_normochromic_anemia",
    "other_microcytic_anemia",
    "macrocytic_anemia",
    "thrombocytopenia",
    "leukemia",
    "leukemia_with_thrombocytopenia",
]

# --- Model B: thalassemia-TRAIT screening ------------------------------------
# Pivoted from the original alpha-carrier file (which is not CBC-separable, AUC
# ~0.5 — see notebook 01) to beta-thalassemia TRAIT, the form that genuinely
# shows on a CBC (low MCV/MCH, high RBC, Mentzer < 13). This is the clinically
# honest, learnable target and matches the scope's "microcytic patterns for
# Thalassemia". The concrete dataset is user-sourced (notebook 04 lists options);
# the label column + map are set there, so these are sensible defaults only.
#
# Common public datasets frame this as a 3-way microcytic screen (normal vs iron
# deficiency vs beta-thal trait) or a 2-way BTT-vs-IDA. Default to the 3-class
# screen; drop 'iron_deficiency' if your dataset is binary.
MODEL_B_CLASSES = ["normal", "iron_deficiency", "beta_thal_trait"]

# Default label map — OVERRIDE in notebook 04 to match your dataset's strings.
THAL_LABEL_MAP = {
    "normal":                  "normal",
    "iron_deficiency_anemia":  "iron_deficiency",
    "iron deficiency anemia":  "iron_deficiency",
    "ida":                     "iron_deficiency",
    "beta_thalassemia_trait":  "beta_thal_trait",
    "beta thalassemia trait":  "beta_thal_trait",
    "btt":                     "beta_thal_trait",
    "beta_thalassemia_minor":  "beta_thal_trait",
}


def mentzer_index(mcv, rbc):
    """Mentzer index = MCV / RBC. <13 suggests thalassemia trait, >13 iron
    deficiency. Used as an interpretable rule-flag alongside the model."""
    try:
        return float(mcv) / float(rbc) if rbc else None
    except (TypeError, ZeroDivisionError):
        return None

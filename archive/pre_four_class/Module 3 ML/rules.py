# ml/fedhealth_ml/rules.py
# ---------------------------------------------------------------------------
# Archived (pre-four-class): part of the earlier Model A/Model B pipeline kept
# for history under archive/pre_four_class. Superseded by the later four-class
# CBC screening model, but the rule logic below is still explained normally.
#
# Interpretable CBC discriminant-index layer for thalassemia-TRAIT screening.
# This is the "B" half of the thalassemia strategy: a transparent, rule-based
# flag that runs on the SAME routine CBC indices Model A already uses, so we can
# surface "possible beta-thalassemia trait" today — no extra dataset needed —
# right next to the ML confidence scores.
#
# Clinical basis (well established in the literature): iron-deficiency anemia
# (IDA) and beta-thalassemia trait (BTT) are the two main causes of MICROCYTIC
# anemia and overlap heavily on a blood count. A family of formulas over MCV,
# RBC, MCH, HGB (and RDW where available) separate them. We compute several and
# take a consensus vote — no single index is reliable across populations.
#
# IMPORTANT clinical gate: these indices only discriminate WITHIN microcytic
# anemia. If MCV is not low, the flag is "not applicable" rather than negative.
# This layer SCREENS; it never diagnoses (confirmation needs Hb electrophoresis,
# per the scope). It complements — does not replace — Model A / Model B.
# ---------------------------------------------------------------------------

# Alias tables so this works for Model A (UPPER keys) and Model B (lower keys),
# and for HGB vs Hb naming.
_ALIASES = {
    "mcv":  ["MCV", "mcv"],
    "rbc":  ["RBC", "rbc"],
    "mch":  ["MCH", "mch"],
    "hgb":  ["HGB", "hgb", "hb", "Hb", "HB"],
    "rdw":  ["RDW", "rdw", "RDW_CV", "rdw_cv"],
}

# Microcytosis threshold (fL). Below this, the discriminant indices are meaningful.
MICROCYTIC_MCV = 80.0


def _get(cbc, key):
    """Fetch a CBC field by its canonical key, trying each known alias/casing; None if absent/unparseable."""
    for a in _ALIASES[key]:
        if a in cbc and cbc[a] is not None:
            try:
                return float(cbc[a])
            except (TypeError, ValueError):
                pass
    return None


# --- Individual discrimination indices --------------------------------------
# Each returns (value, is_thal_suggestive) or (None, None) if inputs missing.
# Cutoffs are the commonly cited ones; they vary by population, which is exactly
# why we vote across many rather than trusting one.

def mentzer(mcv, rbc):                      # < 13 -> thal trait
    if mcv is None or rbc in (None, 0):
        return None, None
    v = mcv / rbc
    return v, v < 13.0

def england_fraser(mcv, rbc, hgb):          # < 0 -> thal trait
    if None in (mcv, rbc, hgb):
        return None, None
    v = mcv - rbc - (5.0 * hgb) - 3.4
    return v, v < 0.0

def shine_lal(mcv, mch):                    # < 1530 -> thal trait
    if None in (mcv, mch):
        return None, None
    v = (mcv * mcv * mch) / 100.0
    return v, v < 1530.0

def srivastava(mch, rbc):                   # < 3.8 -> thal trait
    if mch is None or rbc in (None, 0):
        return None, None
    v = mch / rbc
    return v, v < 3.8

def ehsani(mcv, rbc):                       # < 15 -> thal trait
    if mcv is None or rbc is None:
        return None, None
    v = mcv - (10.0 * rbc)
    return v, v < 15.0

def sirdah(mcv, rbc, hgb):                  # < 27 -> thal trait
    if None in (mcv, rbc, hgb):
        return None, None
    v = mcv - rbc - (3.0 * hgb)
    return v, v < 27.0

def green_king(mcv, rdw, hgb):              # < 65 -> thal trait (needs RDW)
    if None in (mcv, rdw, hgb) or hgb == 0:
        return None, None
    v = (mcv * mcv * rdw) / (100.0 * hgb)
    return v, v < 65.0

def rdw_index(mcv, rdw, rbc):               # < 220 -> thal trait (needs RDW)
    if None in (mcv, rdw) or rbc in (None, 0):
        return None, None
    v = (mcv * rdw) / rbc
    return v, v < 220.0


# --- Consensus flag ---------------------------------------------------------
def thalassemia_trait_flag(cbc):
    """Run all applicable discriminant indices on one CBC record and return an
    interpretable screening result:

        {
          "applicable": bool,          # False if not microcytic / inputs missing
          "flag": bool,                # True = possible beta-thal trait
          "consensus": float,          # fraction of indices voting "thal" (0..1)
          "n_indices": int,            # how many indices could be computed
          "mentzer_index": float|None,
          "indices": { name: {"value": float, "thal_suggestive": bool}, ... },
          "rationale": str,
        }

    Designed to sit BESIDE the model confidence scores in the Doctor Portal.
    """
    mcv = _get(cbc, "mcv"); rbc = _get(cbc, "rbc")
    mch = _get(cbc, "mch"); hgb = _get(cbc, "hgb"); rdw = _get(cbc, "rdw")

    computed = {
        "mentzer":        mentzer(mcv, rbc),
        "england_fraser": england_fraser(mcv, rbc, hgb),
        "shine_lal":      shine_lal(mcv, mch),
        "srivastava":     srivastava(mch, rbc),
        "ehsani":         ehsani(mcv, rbc),
        "sirdah":         sirdah(mcv, rbc, hgb),
        "green_king":     green_king(mcv, rdw, hgb),   # only if RDW present
        "rdw_index":      rdw_index(mcv, rdw, rbc),     # only if RDW present
    }

    indices, votes = {}, []
    for name, (val, sugg) in computed.items():
        if val is None:
            continue
        indices[name] = {"value": round(float(val), 3), "thal_suggestive": bool(sugg)}
        votes.append(1 if sugg else 0)

    mi, _ = computed["mentzer"]
    n = len(votes)
    consensus = (sum(votes) / n) if n else 0.0

    # Clinical gate: indices are only meaningful in microcytic anemia.
    is_microcytic = (mcv is not None) and (mcv < MICROCYTIC_MCV)

    if not is_microcytic or n == 0:
        return {
            "applicable": False,
            "flag": False,
            "consensus": round(consensus, 3),
            "n_indices": n,
            "mentzer_index": round(mi, 2) if mi is not None else None,
            "indices": indices,
            "rationale": ("Not microcytic (MCV >= 80) — thal-trait indices not "
                          "applicable." if mcv is not None and not is_microcytic
                          else "Insufficient CBC inputs for discriminant indices."),
        }

    flag = consensus >= 0.5
    rationale = (
        f"Microcytic (MCV={mcv:.1f}); {sum(votes)}/{n} discriminant indices "
        f"favour beta-thalassemia trait over iron deficiency"
        + (f" (Mentzer={mi:.1f}<13)." if mi is not None and mi < 13 else ".")
    ) if flag else (
        f"Microcytic (MCV={mcv:.1f}); only {sum(votes)}/{n} indices favour "
        f"thal trait — pattern leans toward iron deficiency."
    )

    return {
        "applicable": True,
        "flag": bool(flag),
        "consensus": round(consensus, 3),
        "n_indices": n,
        "mentzer_index": round(mi, 2) if mi is not None else None,
        "indices": indices,
        "rationale": rationale,
    }

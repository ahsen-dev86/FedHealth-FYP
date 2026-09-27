"""Research-only thalassemia index audit; not an active inference rule.

Checks how well the classic Mentzer index (MCV/RBC < 13, a manual heuristic
for thalassemia screening) lines up with the dataset's labels. This is purely
descriptive research output — it is never consulted by the ANN/hybrid model."""
import numpy as np
from sklearn.metrics import confusion_matrix
from .schema import mentzer_index


def validation_audit(rows):
    """Compute the Mentzer-index confusion matrix against the 'thalassemia'
    label, restricted to validation rows only (never train/test, to avoid
    this research check leaking information about held-out performance)."""
    if set(rows.split) != {"val"}:
        raise ValueError("Rule research uses validation rows only")
    prediction = (rows.MCV / rows.RBC < 13).to_numpy()  # classic Mentzer index threshold
    target = (rows.label == "thalassemia").to_numpy()
    cm = confusion_matrix(target, prediction, labels=[False, True])
    return {"status": "research only; disabled in inference", "rule": "MCV/RBC < 13",
            "confusion_matrix": cm.tolist(), "screen_positive_fraction": float(np.mean(prediction)),
            "limitation": "CBC indices do not establish carrier status; rule validation does not confer clinical validity."}

"""Research-only thalassemia index audit; not an active inference rule."""
import numpy as np
from sklearn.metrics import confusion_matrix
from .schema import mentzer_index


def validation_audit(rows):
    if set(rows.split) != {"val"}:
        raise ValueError("Rule research uses validation rows only")
    prediction = (rows.MCV / rows.RBC < 13).to_numpy()
    target = (rows.label == "thalassemia").to_numpy()
    cm = confusion_matrix(target, prediction, labels=[False, True])
    return {"status": "research only; disabled in inference", "rule": "MCV/RBC < 13",
            "confusion_matrix": cm.tolist(), "screen_positive_fraction": float(np.mean(prediction)),
            "limitation": "CBC indices do not establish carrier status; rule validation does not confer clinical validity."}

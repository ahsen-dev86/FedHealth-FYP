# Trained model artifacts

Drop your Colab-trained artifacts here to activate the **real federated model**
in the inference service (otherwise it serves the labelled sklearn fallback):

```
models/
  cbc_multiclass/
    preprocessor.joblib
    ann.keras
    xgb.json
    meta.json
    metrics.json          # optional; register via POST /models/register
  thal_screen/            # once you have a beta-thal dataset (notebook 04)
    ...
```

This folder is mounted read-only into the `inference` container at `/models`.
To serve the real model you must also uncomment `tensorflow` + `xgboost` in
`ml/inference_service/requirements.txt` (and rebuild), since the hybrid model
needs them.

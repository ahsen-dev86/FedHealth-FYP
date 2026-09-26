# Paillier-encrypted federated run on the real seed-42 model

Run on this laptop (Windows, Python 3.12 venv, TensorFlow 2.20.0, phe 1.5.0 + gmpy2 2.3.1) on 2026-09-26,
started 2026-09-26T14:48:26+05:00, finished 2026-09-26T15:08:14+05:00 (about 20 minutes).

    python "Module 5 Encryption/encrypted_federation.py"       --model FYP_model_data_drive/FYP/four_class/four_class_v1/seed42/centralized/model       --out run-results/paillier/seed42_iid_r5 --rounds 5 --bits 2048 --compare-plaintext

(PYTHONPATH = repository root and `Module 4 FL`.) IID split, 3 labs (747/747/746 training rows), 5 rounds,
2048-bit Paillier keys, one local epoch per round. Only the JSON records and the filtered log are kept here;
the model files, public key and decrypted audit weights stay in the git-ignored `run-results/` folder.

- `equivalence_report.json`: decrypted encrypted aggregate vs plaintext FedAvg (Module 4 aggregation) per round:
  maximum absolute weight difference **0.0** in all 5 rounds; validation log loss and macro-F1 identical.
- `round_history.json`: global validation per round; round 0 (the centralized model) was selected again,
  as in the plaintext IID seed-42 run. The test split was not used.
- Limits (from Module 5): one shared keypair and a simulated key authority, in-process serialized transport
  (no network TLS on this path), no threshold Paillier, no privacy proof.

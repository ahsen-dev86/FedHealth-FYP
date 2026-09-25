# Four-class Modules 3 and 4

Branch: `feat/four-class-ml-federation`, based on `a2df2ed` from main.

## Work and verification plan

1. Establish the four-class schema, dataset/provenance checks and declared units.
2. Train-only preprocessing, ANN and local XGBoost, calibrated artifacts and baselines.
3. Port federation safeguards from `83e904f`; replace old split tools.
4. Generate four staged Colab notebooks and a frozen final-evaluation workflow.
5. Update inference, registry and documentation consumers; archive old teaching material.
6. Run unit, real training, three-lab/two-round and separate-process transport checks.
7. Record evidence, remaining Colab/deployment work and open a reviewable PR.

The supplied scope and technical explanation remain the architecture references.
The new handoff replaces their data/model counts with ten features and four outputs.
ANN weights are federated; XGBoost remains local (central reference head in Colab).
Module 4 is plaintext FedAvg with server-authenticated TLS, not Paillier or mTLS.
Module 5 encryption and full Module 9 deployment remain separate work.

No old branch is deleted before this replacement is verified and merged.
No clinical accuracy, privacy proof or improvement from federation is assumed.

## Current implementation checkpoint

The new schema, data flow, model bundles, four Colab notebooks, federation,
inference/registry consumers and documentation are implemented. The 33-test
suite and real separate-process TLS smoke pass. The remaining three-seed validation
matrix was stopped at the user's request; completed runs are recorded separately. See `docs/VERIFICATION.md` for measured results and remaining
manual Colab/Docker/encryption acceptance gates.

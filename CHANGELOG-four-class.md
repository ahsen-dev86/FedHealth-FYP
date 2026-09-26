# Four-class migration

- Replaced the nine-class and separate Model B contracts with ten fixed CBC
  features and healthy/anemia/thalassemia/leukemia outputs.
- Preserved the ANN–XGBoost hybrid; only ANN tensors participate in FedAvg.
- Archived old notebooks, notebook builder, random split tool, old rule module
  and the fake-package loading test. Original CSVs and old Git branches remain.
- Ported and adapted aggregation, validation selection and provenance safeguards
  from `fix/module4-federation-correctness` at `83e904f`.
- Replaced inferred units with declared conversions and strict report validation.
- Added immutable artifact bundles, schema/checksum checks and actual reload checks.
- Added train-only lab partitions, complete-round validation, explicit round-zero
  selection, pooled confusion counts and separate-process Flower transport.
- Added four manual Colab notebooks, a three-seed experiment matrix, a final-test
  lock and fresh source-exclusion training.
- Removed automatic inference fallback and unvalidated active carrier rules;
  updated registry seed, historical-model deactivation migration and API contract.
- Kept Paillier migration and full-stack Module 9 deployment explicitly separate.

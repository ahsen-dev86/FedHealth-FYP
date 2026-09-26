# Scope and technical explanation reconciliation

Reviewed against the supplied `FedHealth_Scope_Document.docx`,
`FedHealth_Technical_Explanation.docx`, the latest identical handoff pastes, and
the dataset release on main at `a2df2ed`.

| Requirement | Current four-class implementation | Evidence or boundary |
|---|---|---|
| Anemia, thalassemia and leukemia screening | One model with healthy plus the three disease groups | Fixed ordered schema; no subtype or metadata features |
| Hybrid ANN–XGBoost | ANN 10→64→32→4; local head sees 32 embedding values plus ten scaled features | Standalone ANN and hybrid evaluated separately |
| Consistent lab normalization | One train-fitted preprocessor, explicit declared unit conversions | HCT fraction conversion is ×100; no magnitude guessing |
| Decentralized ANN training | Lab clients train only supplied train rows; FedAvg uses actual counts | Public-data simulation; independent client processes exchange parameters and aggregate metrics |
| Privacy-preserving coordinator | Module 4 receives plaintext weights | Paillier and encrypted/plaintext equivalence are separate Module 5 work |
| mTLS in scope | Server-authenticated TLS available | This is not client-certificate authentication; lab IDs/hashes are consistency checks, not proof against malicious labs |
| Locally representative clinical model | Mixed public datasets | No Pakistani external clinical validation is established |
| Confidence scores and doctor confirmation | Calibrated four-class scores with screening wording | Mutually exclusive dataset labels do not model disease co-occurrence |
| Old Model B/carrier track | Removed from active inference and registry seed | Old notebooks/rules retained as historical evidence |
| Honest selection and reporting | Validation every global round; test used only after a frozen comparison plan | Round 0 can win; all seeds and all scenarios must be reported |
| Full-stack deployment | Inference contract and related consumer files updated | Module 9 assembly/deployment remains separate; no end-to-end clinical system claim |

## Dataset interpretation

The new training input is one combined CSV with 3,200 rows, ten features and
four labels. Its companion provenance CSV is metadata, not another model input.
The supplied split is preserved: 2,240 train, 480 validation, 480 test.
The original three unique CSV datasets remain evidence; none is an active input.

The donor-filled WBC/PLT/RDW/NEUTp values in 1,692 rows and 891 rule-derived
labels are part of the supplied release. Donor imputation happened before the
split. Train-only preprocessing in this branch cannot undo that upstream issue.
Source-exclusion runs refit both ANN and preprocessor from scratch, but remain
sensitivity checks until raw-source rebuilding establishes independence.
No duplicate feature group may cross splits; future releases failing that check
must be corrected upstream rather than silently reshuffled.

The reported old random-forest figures in the handoff are background, not results
from this implementation. LeukoAlert contains multiple cohorts; pooling them
into the supplied random split removes the original cohort holdout. Source bias,
mixed ages/populations, alpha-thal-2 ambiguity and milder leukemia remain concerns
to measure and report, not problems to hide by tuning the test set.

## Training protocol

Module 3 uses Adam 0.001, batch 32, dropout 0.30, L2 0.0001, up to 100 epochs,
validation-loss early stopping with patience 10 and min_delta 0.0001, restoring
the best weights. XGBoost uses at most 300 trees, depth 4, learning rate 0.05,
row/column sampling 0.9 and validation early stopping after 20 rounds.
Logistic regression and random forest are baselines on the identical split.

Module 4 first runs a three-lab, two-round smoke check. The experiment matrix is
20 rounds, one local epoch, batch 32 and fresh Adam 0.0001 per lab per round:
three-lab IID, Dirichlet alpha 0.5, Dirichlet alpha 0.1, and five source labs.
Seeds 42, 52 and 62 each receive their own independently trained Module 3 ANN.
All 20 rounds run. Lowest validation log loss selects among rounds with at most
0.05 absolute macro-F1 loss from round 0 and no extra nonhealthy-to-healthy errors.
These gates are experimental safeguards, not validated medical safety thresholds.

The starting ANN already saw all 2,240 training rows. This is federated fine-tuning
of a centralized reference, not private-data-only training from scratch. After
ANN selection the Colab reference XGBoost head is freshly trained centrally.
An actual deployment needs lab-local heads and adequate local class coverage;
the implementation rejects fitting a four-class head without all four classes.

## Acceptance evidence

See `IMPLEMENTATION_STATUS.md` and `docs/VERIFICATION.md` for checks actually run.
Local execution does not establish Colab or Docker execution. Validation quality
does not establish final test performance. No old branch should be deleted until
this branch is reviewed, the intended Colab results are verified, and it is merged.

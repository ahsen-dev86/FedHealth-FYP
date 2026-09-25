# FedHealth 4-class CBC dataset — how it was built

**File:** `fedhealth_cbc_4class.csv` · **Rows:** 3,200 (800 per class) · **Built by:** `build_dataset.py`

**Classes:** `healthy`, `anemia`, `thalassemia`, `leukemia`
**Features (10):** WBC, RBC, HGB, HCT, MCV, MCH, MCHC, RDW, PLT, NEUTp
(units: WBC/PLT ×10³/µL, RBC ×10⁶/µL, HGB and MCHC g/dL, HCT/RDW/NEUTp %, MCV fL, MCH pg)

## 1. The idea in one paragraph
No public dataset labels healthy / anemia / thalassemia / leukemia together, so we combined several
real public datasets, one or more per class. **Every row is copied from a real patient record in one of
those datasets.** We did not generate fake patients. Each row can be traced through the provenance file (`source`, `source_row`) back to the exact file and line it came from.

## 2. Where each class comes from

| Class | Rows | Foundational dataset(s) | Link |
|---|---|---|---|
| **Leukemia** | 800 | **LeukoAlert** (Shanghai Jiao Tong Univ., ~25k leukemia CBCs; 746 rows used, spread evenly over its sites A–G, training and real-world files) | https://data.mendeley.com/datasets/vc7kwnyppz/1 |
| | | Kaggle *Anemia Types Classification*, its "Leukemia" rows (54 used) | https://www.kaggle.com/datasets/ehababoelnaga/anemia-types-classification |
| **Anemia** | 800 | Kaggle *Anemia Types Classification*, all anemia subtypes merged (588 rows) | https://www.kaggle.com/datasets/ehababoelnaga/anemia-types-classification |
| | | LeukoAlert non-leukemia patients with Hb < 11 g/dL and normal WBC/PLT (212 rows, **rule-labelled**) | https://data.mendeley.com/datasets/vc7kwnyppz/1 |
| **Thalassemia** | 800 | Kaggle *Thalassemia* by plenoi: alpha-thal-1, alpha-thal-2, HbH (385 rows) | https://www.kaggle.com/datasets/plenoi/thalassemia |
| | | Kaggle *Alpha Thalassemia Dataset* by letslive: alpha carriers (143 rows) | https://www.kaggle.com/datasets/letslive/alpha-thalassemia-dataset |
| | | Mendeley *Thalassemia Dataset* (Iraq, DOI 10.17632/p8rv84hrbs.1): beta trait (272 rows, **rule-labelled**) | https://data.mendeley.com/datasets/p8rv84hrbs/1 |
| **Healthy** | 800 | Kaggle *Thalassemia* (plenoi), its "Normal" group (228 rows) | https://www.kaggle.com/datasets/plenoi/thalassemia |
| | | Kaggle *Anemia Types Classification*, "Healthy" rows (165 rows) | https://www.kaggle.com/datasets/ehababoelnaga/anemia-types-classification |
| | | LeukoAlert non-leukemia patients whose every value is in the normal range (407 rows, **rule-labelled**) | https://data.mendeley.com/datasets/vc7kwnyppz/1 |

Check each page for its license before redistributing. The two Mendeley sets are CC BY 4.0 (cite them).

## 3. How it was built (the steps in `build_dataset.py`)
1. **Load** each source and keep only routine CBC columns. We dropped HbA/HbA2/HbF, genotype columns,
   patient names/ages/sex, and analyzer-only fields, because a normal lab report doesn't have them.
2. **Fix units and known defects.** LeukoAlert Hb and MCHC were in g/L (÷10), and its HCT mixed
   fractions and percentages. In the Kaggle anemia file about 60% of rows carried a constant mean-fill in
   HCT and the differential; we recomputed HCT = RBC × MCV ÷ 10 and blanked the differential there.
3. **Label** each row with one of the 4 classes (e.g., every anemia subtype → `anemia`; alpha-thal-1/2, HbH and
   beta trait → `thalassemia`). The original detailed label is kept in `subtype` as information only.
4. **Clean.** Removed physiologically impossible values, duplicates (including ones that became identical
   after cleaning), and Kaggle's "Thrombocytopenia" rows (not one of our four conditions).
5. **Balance to 800 per class by downsampling** (see below).
6. **Fill the gaps** (see below) and record every filled cell.
7. **Split** into train / val / test (70/15/15, stratified by class) in the `split` column.

## 4. Oversampling: none
We used **no SMOTE, GAN, or any synthetic oversampling**. Every class could be filled to 800 with real patient
rows, so we balanced by **downsampling** (random sampling with a fixed seed, 42; LeukoAlert spread evenly over
its sites so no single hospital dominates). Anemia and healthy were short of clinically labelled rows, so they were
topped up with real LeukoAlert patients chosen by lab-value ranges (marked rule-labelled above).

What we *did* do is **fill missing columns** (this is imputation, not oversampling). Some sources never
measured every feature. For example, the thalassemia datasets have no WBC or PLT, and Kaggle anemia has
no RDW. Two kinds of fills:
- **Exact math (no guessing):** the CBC values are linked by formulas (MCH = Hb ÷ RBC × 10,
  MCV = Hct ÷ RBC × 10, MCHC = Hb ÷ Hct × 100). We used them to recover RBC, HCT and MCHC for the Mendeley
  rows. These checked out within 5% on ~99% of the plenoi rows.
- **Nearest real patient:** for WBC, PLT, RDW and NEUTp we copied the values from a real non-leukemia
  LeukoAlert patient with the most similar Hb, MCV, MCH and RBC (a random one of the 20 nearest). Leukemia
  patients are never used as donors, so this cannot plant a leukemia signal.

Every filled cell is listed in the `imputed` column of the provenance file. Filled cells per class: WBC/PLT for 657 thalassemia and 228
healthy rows; RDW for 588 anemia, 165 healthy, 272 thalassemia and 54 leukemia rows; NEUTp for 262 anemia,
344 healthy, 657 thalassemia and 30 leukemia rows.

## 5. Column guide
`fedhealth_cbc_4class.csv` has: `row_id`, `label`, `subtype` (original detailed label, information only), the 10
features, and `split` (train/val/test).

Traceability lives in a separate file, `fedhealth_cbc_4class_provenance.csv` (same rows, same `row_id`), which adds
**`source`** (which dataset), **`source_row`** (line in that file), **`label_basis`** (`clinical` = label given by the
dataset, `hba2_rule` = beta trait from HbA2 3.5–8% + MCV < 80, `range_rule` = we labelled by lab-value ranges) and
**`imputed`** (columns filled). Don't train on those four columns. Use the file for source-holdout tests and to trace rows.

## 6. Honest limitations (please read before training or reporting results)
- **Leukemia is mostly one source.** 746 of 800 rows come from one Chinese hospital's analyzers, where leukemia
  shows up as severe pancytopenia (median WBC ≈ 3, PLT ≈ 60). The 54 Kaggle leukemia rows are milder (WBC 10–27).
  In a test where the model never saw Kaggle's leukemia rows, it recognised only ~2% of them. So the model
  detects "LeukoAlert-style" leukemia far better than mild presentations. Report this and add source-based
  validation.
- **Some labels are rule-based, not clinical diagnoses:** 212 anemia rows and 407 healthy rows (LeukoAlert, by
  value ranges) and 272 thalassemia rows (Mendeley, by HbA2). "Healthy" here means normal-range CBC, and the
  LeukoAlert ones are hospital patients.
- **Thalassemia is mostly alpha** (528 of 800 rows are the two alpha sets, and beta is only the 272 rule-labelled
  Mendeley rows). Alpha-thal-2 carriers have near-normal CBCs (median MCV 81), so they are the hardest to detect (~61% found
  in a quick test).
- **Filled values** (WBC/PLT for all plenoi and Mendeley thalassemia rows) are realistic but not measured. The model
  cannot learn any real effect thalassemia has on WBC/PLT. Validate on the fully real rows where `imputed` is empty
  as well.
- **Different labs and populations.** The Mendeley set includes many children, and the sources come from
  different labs and countries (for example Iraq for Mendeley, Thailand for plenoi, China for LeukoAlert). A model can partly learn "which lab" instead of the disease, so use the provenance file's `source` column to test by holding a whole source out.
- A quick 5-fold check gives ~87% accuracy (all four classes between 0.85 and 0.90 F1), so the classes are
  learnable and not suspiciously perfect. This is a sanity check, not a performance claim.

## 7. Rebuild
```bash
cd Dataset
python build_dataset.py     # needs pandas, numpy, scikit-learn, openpyxl
```
The input files it expects in this folder: `Alpha-2_addition-230622.xlsx` (plenoi), `thalassimia.xlsx` (Mendeley),
`LeukoAlert-project/`, plus `../anemia_diagnosed_cbc_data_v4.csv` and `../thalassemia/thalassemia_alphanorm.csv`.

"""Cross-layer contract: schema.py -> normalize_units -> exported JSON -> Node -> SQL -> Flask API.

Each test is one row of the contract matrix in docs/INTEGRATION_HANDOFF.md; any
layer drifting from Module 3 ML/schema.py fails here. Node checks run the real
backend modules with `node`; the database literals are read from init/*.sql
(the live database is covered by the backend's `npm run test:db`).
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "Module 1-2 Merged Backend"
CONTRACT_JSON = BACKEND / "src/contract/cbcContract.json"
BUNDLE = ROOT / "FYP_model_data_drive/FYP/four_class/four_class_v1/seed42/centralized/model"
METRICS = ROOT / "FYP_model_data_drive/FYP/four_class/four_class_v1/final_test/seed42_centralized_metrics.json"
sys.path.insert(0, str(ROOT / "tools"))

from fedhealth_ml import schema  # noqa: E402
from fedhealth_ml.preprocess import normalize_units  # noqa: E402

EXAMPLE = {"WBC": 9010, "RBC": 4.47, "HGB": 12.4, "HCT": 38, "MCV": 85, "MCH": 28, "MCHC": 33, "RDW": 13,
           "PLT": 147000, "NEUTp": 69}
PRINTED = {"WBC": "/mm3", "RBC": "mil/mm3", "HGB": "g/dL", "HCT": "%", "MCV": "fl", "MCH": "pg", "MCHC": "g/dL",
           "RDW": "%", "PLT": "/mm3", "NEUTp": "%"}
EXPECTED_SCORES = {"healthy": 0.224, "anemia": 0.588, "thalassemia": 0.169, "leukemia": 0.019}
# Old nine-class labels (still in frontend/src/api/client.mock.js and lib/format.js). Several survive as
# dataset *subtypes* inside the registered metrics payload; they must not appear as model classes.
OLD_LABELS = ["iron_deficiency_anemia", "normocytic_hypochromic_anemia", "normocytic_normochromic_anemia",
              "macrocytic_anemia", "other_microcytic_anemia", "thrombocytopenia", "beta_thal_trait"]
node = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")


def contract():
    return json.loads(CONTRACT_JSON.read_text(encoding="utf-8"))


def run_node(script, payload):
    """Run a JS snippet in the backend directory; stdin/stdout are JSON."""
    result = subprocess.run(["node", "-e", script], cwd=BACKEND, input=json.dumps(payload),
                            capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


READ_STDIN = "const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));"


# --- schema.py -> exported JSON ----------------------------------------------------------------
def test_exported_contract_is_current():
    import export_contract
    assert CONTRACT_JSON.read_text(encoding="utf-8").replace("\r\n", "\n") == export_contract.render(), \
        "Run: python tools/export_contract.py"


def test_exported_contract_matches_schema():
    c = contract()
    assert c["features"] == schema.FEATURES and c["classes"] == schema.CLASSES
    assert c["canonical_units"] == schema.UNITS
    assert c["plausible_ranges"] == {f: list(schema.PLAUSIBLE_RANGES[f]) for f in schema.FEATURES}
    assert c["model_name"] == schema.MODEL_NAME and c["schema_version"] == schema.SCHEMA_VERSION
    assert list(c["class_labels"]) == schema.CLASSES and list(c["feature_labels"]) == schema.FEATURES
    assert not set(c["not_model_inputs"]) & set(schema.FEATURES)


# --- normalize_units <-> exported unit table ---------------------------------------------------
def test_every_exported_unit_alias_converts_like_normalize_units():
    for feature, aliases in contract()["accepted_units"].items():
        lo, hi = schema.PLAUSIBLE_RANGES[feature]
        target = (lo + hi) / 2
        for alias, factor in aliases.items():
            out = normalize_units({feature: target / factor}, units={feature: alias})
            assert out[feature] == pytest.approx(target), (feature, alias)
        for bogus in ["mmol/L", "/cmm", "mg/dL", "IU"]:
            with pytest.raises(ValueError, match="Unsupported unit"):
                normalize_units({feature: target}, units={feature: bogus})


@node
def test_node_conversion_and_rejections_match_python():
    cases = [
        ({"WBC": 9010, "PLT": 147000}, {"WBC": "/mm3", "PLT": "/mm3"}),
        ({"WBC": 9.01, "RBC": 4.47}, {"WBC": " x10³/µL ", "RBC": "mil/mm3"}),
        ({"HGB": 124, "MCHC": 330}, {"HGB": "g/L", "MCHC": "g/L"}),
        ({"HCT": 0.38, "RDW": 13, "NEUTp": 0.69}, {"HCT": "L/L", "RDW": "%", "NEUTp": "fraction"}),
        ({"RBC": 4470000}, {"RBC": "/uL"}),
        ({"HGB": 12.4}, {"HGB": "GM/DL"}),
        (EXAMPLE, PRINTED),
        ({"WBC": 9010}, {"WBC": "10^3/uL"}),            # raw count declared canonical -> out of range
        ({"WBC": 9010}, {"WBC": "mmol/L"}),             # unsupported unit
        ({"HGB": 40}, {"HGB": "g/dL"}),                 # out of range
        ({"HGB": 12.4, "PLT": 147}, {"HGB": "g/dL"}),   # missing unit
    ]
    js = READ_STDIN + """
      const { prepareCbc } = require('./src/services/cbc');
      const out = input.map(([cbc, units]) => {
        try { return { ok: prepareCbc({ cbc, units }).canonical }; }
        catch (e) { return { error: e.message, status: e.status }; }
      });
      process.stdout.write(JSON.stringify(out));"""
    node_out = run_node(js, cases)
    for (cbc, units), got in zip(cases, node_out):
        try:
            py = {k: v for k, v in normalize_units(cbc, units=units).items() if v == v}
        except ValueError as exc:
            assert got.get("status") == 400, (cbc, units, got, exc)
            first_word = str(exc).split()[0]
            assert got["error"].split()[0] == first_word, (got["error"], str(exc))
            continue
        assert "ok" in got, (cbc, units, got)
        assert got["ok"].keys() == py.keys()
        for k in py:
            assert got["ok"][k] == py[k], (k, got["ok"][k], py[k])  # identical IEEE-754 arithmetic


# --- database literals (init/*.sql) ------------------------------------------------------------
def test_database_contract_literals_match_schema():
    sql = (BACKEND / "init/009_four_class_contract_and_fl_runs.sql").read_text(encoding="utf-8")
    classes = re.search(r"ARRAY\[([^\]]+)\]::text\[\]", sql).group(1)
    assert [c.strip().strip("'") for c in classes.split(",")] == schema.CLASSES
    ranges = json.loads(re.search(r"SELECT '(\{\"WBC\".*?\})'::jsonb", sql, re.S).group(1))
    assert list(ranges) == schema.FEATURES
    assert ranges == {f: list(schema.PLAUSIBLE_RANGES[f]) for f in schema.FEATURES}
    four = json.dumps(schema.CLASSES, separators=(",", ":"))
    assert sql.count(f"'{four}'::jsonb") == 2  # model-contract deactivation + chk_ml_models_four_class


def test_seed_and_backend_sources_have_no_old_class_names():
    files = [*(BACKEND / "init").glob("*.sql"), *(BACKEND / "src").rglob("*.js"),
             ROOT / "Module 1 Database/seed.sql", ROOT / "Module 6 Domain API/predictors.py"]
    hits = [(f.relative_to(ROOT).as_posix(), label) for f in files
            for label in OLD_LABELS if label in f.read_text(encoding="utf-8")]
    assert hits == []


def test_seed_contains_no_fabricated_metrics():
    for f in (BACKEND / "init").glob("*.sql"):
        text = f.read_text(encoding="utf-8").lower()
        assert not re.search(r"insert into ml_models", text), f"{f.name} seeds a model row"


# --- OCR -> Python normalization ---------------------------------------------------------------
@node
def test_ocr_output_is_accepted_by_normalize_units():
    text = "\n".join([
        "Total Leucocyte Count (TLC)   9,010   /mm3   4,000 - 11,000",
        "Red Blood Cells   4.47   mil/mm3", "Haemoglobin   12.4  L  g/dL   13.0 - 17.0",
        "Haematocrit (HCT)   38   %", "MCV 85 fl    MCH 28 pg", "MCHC   33   g/dL",
        "RDW-CV   13   %", "Platelet Count   147,000  L  /mm3", "Neutrophils   69   %",
    ])
    js = READ_STDIN + """
      const { parseCbcFromText } = require('./src/services/ocr');
      process.stdout.write(JSON.stringify(parseCbcFromText(input)));"""
    parsed = run_node(js, text)
    assert list(parsed["cbc"]) == schema.FEATURES and parsed["missing"] == []
    assert parsed["cbc"] == EXAMPLE
    assert {f: u.lower() for f, u in parsed["units"].items()} == {f: u.lower() for f, u in PRINTED.items()}
    canonical = normalize_units(parsed["cbc"], units=parsed["units"])
    assert canonical["WBC"] == pytest.approx(9.01) and canonical["PLT"] == pytest.approx(147)
    assert parsed["canonical"] == pytest.approx(canonical)


# --- trained bundle and registry payload -------------------------------------------------------
def test_served_bundle_and_registry_payload_match_schema():
    meta = json.loads((BUNDLE / "meta.json").read_text())
    assert meta["classes"] == schema.CLASSES and meta["features"] == schema.FEATURES
    assert meta["units"] == schema.UNITS and meta["model_name"] == schema.MODEL_NAME
    payload = json.loads(METRICS.read_text())
    assert payload["version"] == meta["version"] == "v2-four-class-seed42-b24108b19482"
    assert payload["classes"] == schema.CLASSES and payload["split"] == "test"
    assert list(payload["metrics"]["per_class_recall"]) == schema.CLASSES
    assert payload["metrics"]["accuracy"] == pytest.approx(0.8875)


# --- Flask /infer on the real bundle -----------------------------------------------------------
@pytest.fixture(scope="module")
def api(tmp_path_factory):
    if not (BUNDLE / "ann.keras").exists():
        pytest.skip("seed-42 bundle not present")
    import os
    os.environ["FEDHEALTH_MODEL_DIR"] = str(BUNDLE)
    os.environ.pop("INFERENCE_API_KEY", None)
    try:
        spec = importlib.util.spec_from_file_location("fedhealth_api_contract", ROOT / "Module 6 Domain API/app.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        os.environ.pop("FEDHEALTH_MODEL_DIR", None)
    return module.app.test_client()


@pytest.mark.integration
def test_inference_api_contract_on_real_bundle(api):
    c = api.get("/contract").json
    assert c["features"] == schema.FEATURES and c["classes"] == schema.CLASSES
    assert c["plausible_ranges"] == {f: list(r) for f, r in schema.PLAUSIBLE_RANGES.items()}

    r = api.post("/infer", json={"cbc": EXAMPLE, "units": PRINTED})
    assert r.status_code == 200
    body = r.json
    assert body["classes"] == schema.CLASSES and set(body["scores"]) == set(schema.CLASSES)
    assert {k: round(v, 3) for k, v in body["scores"].items()} == EXPECTED_SCORES
    assert body["top_condition"] == "anemia" and body["risk_flag"] is False
    assert body["model_version"] == "v2-four-class-seed42-b24108b19482" and body["mode"] == "centralized_hybrid"
    assert body["canonical_cbc"]["WBC"] == pytest.approx(9.01) and body["canonical_cbc"]["PLT"] == pytest.approx(147)
    assert body["imputed_features"] == [] and body["rule_flags"] == {} and body["screening_only"] is True
    assert body["calibration"]["method"] == "temperature_scaling"

    partial = api.post("/infer", json={"cbc": {k: v for k, v in EXAMPLE.items() if k != "RDW"}, "units": PRINTED})
    assert partial.status_code == 200 and partial.json["imputed_features"] == ["RDW"]
    assert partial.json["canonical_cbc"]["RDW"] is None

    for bad in [{"cbc": {**EXAMPLE, "FOO": 1}, "units": PRINTED},
                {"cbc": EXAMPLE, "units": {**PRINTED, "BAR": "%"}},
                {"cbc": EXAMPLE},
                {"cbc": EXAMPLE, "units": {**PRINTED, "WBC": "mmol/L"}},
                {"cbc": {**EXAMPLE, "HGB": 40}, "units": PRINTED},
                {"cbc": EXAMPLE, "canonical_units": True}]:
        assert api.post("/infer", json=bad).status_code == 400, bad
        assert api.post("/normalize", json=bad).status_code == 400, bad

    n = api.post("/normalize", json={"cbc": EXAMPLE, "units": PRINTED}).json
    assert n["canonical_cbc"]["WBC"] == pytest.approx(9.01) and n["missing_features"] == []


# --- frontend rows: known mismatch 1, fixed in Phase B -----------------------------------------
PHASE_B = pytest.mark.xfail(strict=True, reason="Phase B: frontend still on the nine-class/6-field mock; "
                                               "remove this mark when the frontend is aligned")


@PHASE_B
def test_frontend_mock_uses_only_the_four_classes():
    text = (ROOT / "frontend/src/api/client.mock.js").read_text(encoding="utf-8")
    assert [label for label in OLD_LABELS if label in text] == []


@PHASE_B
def test_frontend_cbc_form_offers_exactly_the_ten_features():
    text = (ROOT / "frontend/src/doctor/CbcForm.jsx").read_text(encoding="utf-8")
    assert all(re.search(rf"['\"]{f}['\"]", text) for f in schema.FEATURES)

import numpy as np
import pandas as pd
import pytest
from fedhealth_ml import schema
from fedhealth_ml.data import validate_frame, Dataset, sha256
from fedhealth_ml.preprocess import CBCPreprocessor, normalize_units, encode_labels
from partition import partition_dataframe


def test_release_counts_and_metadata(dataset):
    assert dataset.frame.shape == (3200, 14)
    assert [len(dataset.rows(s)) for s in ["train", "val", "test"]] == [2240, 480, 480]
    assert dataset.audit()["imputed_rows"] == 1692
    assert "row_id" not in schema.FEATURES and "subtype" not in schema.FEATURES and "split" not in schema.FEATURES
    assert dataset.provenance.row_id.tolist() == dataset.frame.row_id.tolist()


def test_line_endings_do_not_change_release(dataset, tmp_path):
    path = tmp_path / "windows.csv"
    path.write_bytes(dataset.path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    assert sha256(path, canonical=True) == dataset.sha256
    assert Dataset(path).sha256 == dataset.sha256


def test_reject_duplicate_leakage_and_conflicting_labels(dataset):
    df = dataset.frame.copy()
    a = df.index[df.split == "train"][0]
    b = df.index[df.split == "val"][0]
    df.loc[b, schema.FEATURES] = df.loc[a, schema.FEATURES]
    df.loc[b, "label"] = df.loc[a, "label"]
    with pytest.raises(ValueError, match="cross"):
        validate_frame(df)
    df.loc[b, "split"] = "train"
    df.loc[b, "label"] = "healthy" if df.loc[a, "label"] != "healthy" else "anemia"
    with pytest.raises(ValueError, match="conflicting"):
        validate_frame(df)


def test_only_train_statistics_and_inference_missing_features(dataset, tmp_path):
    train = dataset.rows("train")
    prep = CBCPreprocessor().fit(train)
    np.testing.assert_allclose(prep.scaler.mean_, train[schema.FEATURES].mean())
    changed = dataset.rows("val").copy()
    changed.loc[:, "WBC"] = 190
    before = prep.scaler.mean_.copy()
    prep.transform(changed)
    np.testing.assert_array_equal(before, prep.scaler.mean_)
    row = train.iloc[0][schema.FEATURES].to_dict()
    row.pop("RDW"); row.pop("NEUTp")
    assert np.isfinite(prep.transform(row)).all()
    prep.save(tmp_path / "prep.joblib")
    np.testing.assert_array_equal(prep.transform(row), CBCPreprocessor.load(tmp_path / "prep.joblib").transform(row))
    with pytest.raises(RuntimeError, match="immutable"):
        prep.fit(changed)


def test_explicit_unit_conversion_and_no_guessing():
    result = normalize_units({"HCT": .38, "WBC": 9010, "HGB": 124, "RBC": 4470000},
        units={"HCT": "fraction", "WBC": "/mm³", "HGB": "g/L", "RBC": "/uL"})
    assert result["HCT"] == 38
    assert result["WBC"] == pytest.approx(9.01)
    assert result["HGB"] == pytest.approx(12.4)
    assert result["RBC"] == pytest.approx(4.47)
    with pytest.raises(ValueError, match="Declare"):
        normalize_units({"HCT": .38})
    with pytest.raises(ValueError, match="outside"):
        normalize_units({"HCT": .38}, units={"HCT": "%"})
    for v in [float("inf"), float("nan"), True, -9, 9999]:
        with pytest.raises(ValueError):
            normalize_units({"WBC": v}, units=schema.UNITS)


@pytest.mark.parametrize("mode,alpha,labs", [("iid", .5, 3), ("non_iid", .5, 3), ("non_iid", .1, 3), ("source", .5, 5)])
def test_partitions_exact_coverage_reproducible_train_only(dataset, mode, alpha, labs):
    kwargs = dict(num_labs=labs, mode=mode, alpha=alpha, provenance=dataset.provenance)
    parts = partition_dataframe(dataset.rows("train"), **kwargs)
    repeat = partition_dataframe(dataset.rows("train"), **kwargs)
    ids = [i for part in parts for i in part.row_id]
    assert len(ids) == len(set(ids)) == 2240
    assert set(ids) == set(dataset.rows("train").row_id)
    for a, b in zip(parts, repeat):
        pd.testing.assert_frame_equal(a, b)
        assert len(a) and set(a.split) == {"train"}
    with pytest.raises(ValueError, match="training rows only"):
        partition_dataframe(dataset.frame, **kwargs)


def test_duplicate_training_group_stays_in_one_lab(dataset):
    df = dataset.rows("train").copy()
    duplicate = df.iloc[[0]].copy()
    duplicate.row_id = 99999
    df = pd.concat([df, duplicate], ignore_index=True)
    parts = partition_dataframe(df)
    assert sum({int(df.iloc[0].row_id), 99999} <= set(p.row_id) for p in parts) == 1


def test_unknown_labels_and_feature_order_rejected():
    with pytest.raises(ValueError):
        encode_labels(["leukemia", "unknown"])
    with pytest.raises(ValueError, match="order"):
        CBCPreprocessor(list(reversed(schema.FEATURES)))

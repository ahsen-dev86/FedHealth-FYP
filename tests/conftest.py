# Shared pytest fixtures for the whole test suite (pytest auto-discovers this file;
# fixtures defined here are visible to every test module without an import).
# Wires the FL/encryption module folders onto sys.path (they live outside the normal
# package tree) and provides the two expensive, session-scoped fixtures every
# integration test builds on: the real dataset and a small centrally-trained model.
import os
from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "Module 4 FL"))
sys.path.insert(0, str(ROOT / "Module 5 Encryption"))
# Keep TensorFlow's console noise down and disable oneDNN's non-deterministic
# op ordering, which would make training results vary slightly between runs.
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")


# Loads the real, checked-in CBC dataset + its provenance file once per test session
# (session scope avoids re-reading/validating the CSVs for every test that needs it).
@pytest.fixture(scope="session")
def dataset():
    from fedhealth_ml.data import Dataset
    return Dataset(ROOT / "Dataset/fedhealth_cbc_4class.csv", ROOT / "Dataset/fedhealth_cbc_4class_provenance.csv")


# Trains one small, real (non-mocked) centralized model to act as a shared baseline for
# FL/encryption tests. Deliberately tiny (2 epochs, 8 trees) — it only needs to behave
# correctly, not to be accurate.
@pytest.fixture(scope="session")
def central_model(dataset, tmp_path_factory):
    from fedhealth_ml.training import train
    return train(dataset, tmp_path_factory.mktemp("real_training") / "central", epochs=2, trees=8, verbose=0)

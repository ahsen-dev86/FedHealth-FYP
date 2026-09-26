import os
from pathlib import Path
import sys
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "Module 4 FL"))
sys.path.insert(0, str(ROOT / "Module 5 Encryption"))
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")


@pytest.fixture(scope="session")
def dataset():
    from fedhealth_ml.data import Dataset
    return Dataset(ROOT / "Dataset/fedhealth_cbc_4class.csv", ROOT / "Dataset/fedhealth_cbc_4class_provenance.csv")


@pytest.fixture(scope="session")
def central_model(dataset, tmp_path_factory):
    from fedhealth_ml.training import train
    return train(dataset, tmp_path_factory.mktemp("real_training") / "central", epochs=2, trees=8, verbose=0)

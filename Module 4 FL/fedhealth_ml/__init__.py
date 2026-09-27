"""Import shared ML code from the repository's Module 3 folder.

This package has no .py files of its own: it repoints its import path at
"Module 3 ML" so `from fedhealth_ml import schema, models, ...` inside
Module 4 FL resolves to the real Module 3 source, guaranteeing Module 4 always
trains/evaluates with the exact same preprocessing and model code as Module 3
instead of a duplicated copy.
"""
from pathlib import Path

_source = Path(__file__).resolve().parents[2] / "Module 3 ML"
_required = ("schema.py", "preprocess.py", "models.py", "rules.py")
if not all((_source / name).is_file() for name in _required):
    raise ImportError(f"Module 3 source files are missing from {_source}")

__path__ = [str(_source)]  # namespace-package trick: redirect submodule imports to Module 3 ML

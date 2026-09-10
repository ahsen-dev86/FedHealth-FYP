"""Import shared ML code from the repository's Module 3 folder."""
from pathlib import Path

_source = Path(__file__).resolve().parents[2] / "Module 3 ML"
_required = ("schema.py", "preprocess.py", "models.py", "rules.py")
if not all((_source / name).is_file() for name in _required):
    raise ImportError(f"Module 3 source files are missing from {_source}")

__path__ = [str(_source)]

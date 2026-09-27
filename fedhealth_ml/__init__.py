"""Single implementation shared by notebooks, lab clients and inference."""
from pathlib import Path

# This package has no code of its own: overriding __path__ makes Python resolve
# `fedhealth_ml.<module>` imports from "Module 3 ML" instead, so every consumer
# (tests, tools, FL clients/server) shares one real implementation on disk
# without needing that folder's awkward name in an import statement.
__path__ = [str(Path(__file__).resolve().parents[1] / "Module 3 ML")]

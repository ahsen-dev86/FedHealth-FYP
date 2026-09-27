"""Create a raw training-only CSV using Module 3's saved split rules."""
# Archived (pre-four-class): CLI tool for the earlier Model A pipeline (kept
# under archive/pre_four_class for history). Re-runs the exact stratified split
# from Module 3's preprocess.stratified_split (same seed/ratios) so the FL
# clients (Module 4) only ever see the training rows, never val/test.
import argparse
import sys
from pathlib import Path

import pandas as pd  # pandas: DataFrame-based CSV loading/writing

sys.path.insert(
    0,
    str(Path(__file__).resolve().parent),
)

from fedhealth_ml import preprocess as pp  # noqa: E402


def prepare_training_split(
    csv_path,
    output_path,
    seed=42,
):
    """Recompute Module 3's train/val/test split and write only the training rows to `output_path`."""
    csv_path = Path(csv_path).expanduser().resolve()
    output_path = Path(output_path).expanduser().resolve()

    if not csv_path.is_file():
        raise FileNotFoundError(
            f"Source CSV does not exist: {csv_path}"
        )

    if output_path.exists():
        raise FileExistsError(
            f"Refusing to overwrite: {output_path}"
        )

    X, y = pp.load_anemia(csv_path)

    splits = pp.stratified_split(
        X,
        y,
        test_size=0.2,
        val_size=0.1,
        seed=seed,
    )

    training_indices = splits["X_train"].index

    reserved_indices = (
        set(splits["X_val"].index)
        | set(splits["X_test"].index)
    )

    # Safety check: training rows must never overlap the held-out val/test rows,
    # otherwise the FL clients would be training on data used for evaluation.
    if not set(training_indices).isdisjoint(
        reserved_indices
    ):
        raise RuntimeError(
            "Training and reserved row indices overlap."
        )

    raw = pd.read_csv(csv_path)

    # Safety check: the split was computed on a possibly-cleaned copy, so make
    # sure its row indices still line up with the original raw CSV before slicing it.
    if not set(training_indices).issubset(
        set(raw.index)
    ):
        raise RuntimeError(
            "Split indices do not match the source CSV."
        )

    training_rows = raw.loc[
        training_indices
    ].copy()

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    training_rows.to_csv(
        output_path,
        index=False,
    )

    return {
        "training_rows": int(len(training_indices)),
        "validation_rows": int(
            len(splits["X_val"])
        ),
        "test_rows": int(
            len(splits["X_test"])
        ),
        "seed": int(seed),
        "output": str(output_path),
    }


def main():
    """CLI entry point: parse --csv/--out/--seed and write the training-only CSV."""
    parser = argparse.ArgumentParser(
        description=(
            "Create the Module 3 training-only "
            "CSV for federation"
        )
    )

    parser.add_argument(
        "--csv",
        required=True,
        help="source CBC dataset",
    )

    parser.add_argument(
        "--out",
        required=True,
        help="new training-only CSV",
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=42,
    )

    args = parser.parse_args()

    try:
        result = prepare_training_split(
            args.csv,
            args.out,
            args.seed,
        )
    except (
        FileNotFoundError,
        FileExistsError,
        RuntimeError,
        ValueError,
    ) as error:
        parser.error(str(error))

    print(
        "Prepared "
        f"{result['training_rows']} training rows; "
        f"reserved {result['validation_rows']} "
        "validation and "
        f"{result['test_rows']} test rows."
    )

    print(
        "Saved:",
        result["output"],
    )


if __name__ == "__main__":
    main()

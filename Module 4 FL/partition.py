"""Exhaustive, disjoint train-only IID, Dirichlet or source lab partitions."""
import numpy as np
import pandas as pd
from fedhealth_ml import schema
from fedhealth_ml.data import validate_frame


def partition_dataframe(frame, num_labs=3, mode="iid", seed=42, alpha=.5, provenance=None):
    validate_frame(frame, require_all_splits=False)
    if set(frame.split) != {"train"}:
        raise ValueError("Labs may receive training rows only")
    if mode not in {"iid", "non_iid", "source"} or num_labs < 3 or not np.isfinite(alpha) or alpha <= 0:
        raise ValueError("Invalid partition configuration; require at least three labs")
    df = frame.reset_index(drop=True)
    rng = np.random.default_rng(seed)
    group_ids = df.groupby(schema.FEATURES, sort=True).ngroup()
    groups = [np.flatnonzero(group_ids == g) for g in sorted(group_ids.unique())]
    labels = [df.iloc[g[0]].label for g in groups]
    if mode == "source":
        if provenance is None:
            raise ValueError("Source partition requires matching provenance")
        p = provenance.set_index("row_id").loc[df.row_id]
        sources = sorted(p.source.unique())
        if len(sources) != num_labs:
            raise ValueError(f"Source partition requires {len(sources)} labs")
        owner = dict(zip(sources, range(num_labs)))
        bins = [[] for _ in sources]
        for g in groups:
            source = p.iloc[g].source.unique()
            if len(source) != 1:
                raise ValueError("Duplicate feature group crosses sources; rebuild partition policy")
            bins[owner[source[0]]].extend(g)
    else:
        for attempt in range(1000):
            bins = [[] for _ in range(num_labs)]
            for cls in schema.CLASSES:
                candidates = np.array([i for i, label in enumerate(labels) if label == cls])
                rng.shuffle(candidates)
                probabilities = np.full(num_labs, 1 / num_labs) if mode == "iid" else rng.dirichlet(np.full(num_labs, alpha))
                chunks = np.array_split(candidates, num_labs) if mode == "iid" else np.split(candidates, np.cumsum(rng.multinomial(len(candidates), probabilities))[:-1])
                # Rotate IID remainders across labs for balanced row counts.
                offset = schema.CLASSES.index(cls) if mode == "iid" else 0
                for i, chunk in enumerate(chunks):
                    for gid in chunk:
                        bins[(i + offset) % num_labs].extend(groups[gid])
            if min(map(len, bins)) >= 1:
                break
        else:
            raise ValueError("Could not generate non-empty partitions in 1000 attempts")
    shards = [df.iloc[rng.permutation(b)].reset_index(drop=True) for b in bins]
    joined = pd.concat(shards)
    if joined.row_id.duplicated().any() or set(joined.row_id) != set(df.row_id):
        raise ValueError("Partition lost or duplicated rows")
    for group in groups:
        ids = set(df.iloc[group].row_id)
        if sum(bool(ids & set(shard.row_id)) for shard in shards) != 1:
            raise ValueError("Duplicate group split between labs")
    return shards

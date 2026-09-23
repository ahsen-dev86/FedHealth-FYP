"""Set the Python, NumPy and TensorFlow experiment seed together."""
import random

import numpy as np


def seed_all(seed):
    import tensorflow as tf

    seed = int(seed)
    random.seed(seed)
    np.random.seed(seed)
    tf.keras.utils.set_random_seed(seed)
    tf.config.experimental.enable_op_determinism()

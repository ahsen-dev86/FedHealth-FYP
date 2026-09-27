# fl/common/crypto.py
# ---------------------------------------------------------------------------
# Archived (pre-four-class): part of the earlier Model A federated-learning
# pipeline, kept under archive/pre_four_class for history.
#
# Bridge between an "encrypted model" (fedhealth_ml.paillier_utils) and Flower's
# Parameters transport object. Flower Parameters carry a list of byte tensors; we
# pack the whole serialized ciphertext model into one tensor tagged 'paillier'.
# ---------------------------------------------------------------------------
import os
import sys

from flwr.common import Parameters  # flwr (Flower): federated-learning framework; Parameters is its weight-transport container

_ML = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "ml"))
if _ML not in sys.path:
    sys.path.insert(0, _ML)
from fedhealth_ml import paillier_utils as pu  # noqa: E402


def encrypted_to_parameters(model):
    """Encrypted model -> Flower Parameters (single ciphertext blob)."""
    return Parameters(tensors=[pu.serialize_encrypted(model)], tensor_type="paillier")


def parameters_to_encrypted(pub, parameters):
    """Flower Parameters -> encrypted model, rebuilt under the public key."""
    return pu.deserialize_encrypted(pub, parameters.tensors[0])


def build_initial_encrypted_parameters(pub, weights):
    """Encrypt the initial global weights (public-key op) for the strategy's
    initial_parameters. Round 1 clients decrypt these with total_examples=1."""
    return encrypted_to_parameters(pu.encrypt_weights(pub, weights))

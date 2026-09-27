# Module 5 Encryption/paillier_utils.py
# ---------------------------------------------------------------------------
# Module 5 — Paillier homomorphic encryption for the federated weight exchange.
#
# WHY PAILLIER FITS FEDAVG EXACTLY:
# Paillier is ADDITIVELY homomorphic:
#     D(E(a) * E(b))     = a + b        (add two ciphertexts)
#     D(E(a) ** k)       = a * k        (multiply a ciphertext by a plaintext int)
# FedAvg is a weighted sum then a scale:  w_global = (Σ nᵢ·wᵢ) / N.
# So the server can compute the ENCRYPTED weighted sum  E(Σ nᵢ·wᵢ)  using only
# ciphertext + the PUBLIC key — it never divides and never decrypts. The labs,
# who hold the PRIVATE key, decrypt and do the final /N. Hence the server is
# "blind": it only ever holds ciphertext.
#
# KEY CUSTODY (the privacy-critical point): the private key lives with the labs,
# NEVER on the aggregation server. The server loads the public key only (enough
# to add/scale ciphertext, not to decrypt). A production system would use
# THRESHOLD Paillier so no single lab holds the whole key either — that's the
# documented next step; for this FYP the labs share one keypair issued by a key
# authority.
#
# phe handles floating-point transparently (fixed-point EncodedNumber internally),
# so we encrypt weights directly without hand-rolling quantization.
# ---------------------------------------------------------------------------
import json

import numpy as np
from phe import paillier


# --- Key generation ---------------------------------------------------------
def generate_keypair(n_length=2048):
    """Generate a Paillier keypair. n_length 2048+ for real security; 1024 is
    acceptable for a fast demo (flagged in keygen.py)."""
    pub, priv = paillier.generate_paillier_keypair(n_length=n_length)
    return pub, priv


# --- Key (de)serialization (JSON-friendly) ----------------------------------
def public_key_to_dict(pub):
    # The modulus n fully specifies a Paillier public key.
    return {"n": str(pub.n)}


def public_key_from_dict(d):
    return paillier.PaillierPublicKey(n=int(d["n"]))


def private_key_to_dict(priv):
    # p, q are the secret primes; keep this file OFF the server.
    return {"n": str(priv.public_key.n), "p": str(priv.p), "q": str(priv.q)}


def private_key_from_dict(d):
    pub = paillier.PaillierPublicKey(n=int(d["n"]))
    return paillier.PaillierPrivateKey(pub, int(d["p"]), int(d["q"]))


def save_public_key(pub, path):
    with open(path, "w") as f:
        json.dump(public_key_to_dict(pub), f)


def load_public_key(path):
    with open(path) as f:
        return public_key_from_dict(json.load(f))


def save_private_key(priv, path):
    with open(path, "w") as f:
        json.dump(private_key_to_dict(priv), f)


def load_private_key(path):
    with open(path) as f:
        return private_key_from_dict(json.load(f))


# --- Flatten / unflatten a list-of-layers weight vector ---------------------
# Paillier only encrypts scalars, so a model (a list of numpy arrays, one per
# layer) has to be flattened to a single 1-D vector of numbers before
# encrypting, and reshaped back afterwards using the recorded per-layer shapes.

def _flatten(weights):
    """List of per-layer numpy arrays -> (flat 1-D float64 vector, list of original shapes)."""
    shapes = [list(w.shape) for w in weights]
    flat = np.concatenate([np.asarray(w, dtype=np.float64).ravel() for w in weights])
    return flat, shapes


def _unflatten(flat, shapes):
    """Inverse of _flatten: slice the flat vector back into per-layer arrays of `shapes`."""
    out, i = [], 0
    for shape in shapes:
        size = int(np.prod(shape)) if shape else 1
        out.append(np.asarray(flat[i:i + size], dtype=np.float32).reshape(shape))
        i += size
    return out


# --- Encrypted-model container ----------------------------------------------
# An "encrypted model" is just {shapes, enc} where enc is a flat list of phe
# EncryptedNumber objects (one per weight), in the same order as _flatten.

def encrypt_weights(pub, weights):
    """Encrypt a list-of-layer weight arrays element-wise with the PUBLIC key."""
    flat, shapes = _flatten(weights)
    enc = [pub.encrypt(float(x)) for x in flat]
    return {"shapes": shapes, "enc": enc}


def decrypt_weights(priv, model, divisor=1):
    """Decrypt an encrypted model back to a list-of-layer arrays (key holders only).

    `divisor` is applied in float64 before the float32 cast, so E(sum n_i*w_i)
    decrypted with divisor=N reproduces plaintext FedAvg without extra rounding."""
    if int(divisor) < 1:
        raise ValueError("divisor must be a positive integer")
    flat = np.array([priv.decrypt(e) for e in model["enc"]], dtype=np.float64) / int(divisor)
    return _unflatten(flat, model["shapes"])


def homomorphic_weighted_sum(models_and_weights):
    """Server-side aggregation with NO decryption. Computes, element-wise,
    E(Σ nᵢ·wᵢ) from each lab's E(wᵢ) and plaintext example count nᵢ. Only uses
    ciphertext addition and ciphertext*plaintext-int — both public-key ops."""
    first_model = models_and_weights[0][0]
    n_weights = len(first_model["enc"])
    acc = [None] * n_weights
    for model, weight in models_and_weights:
        w = int(weight)
        for j, enc in enumerate(model["enc"]):
            term = enc * w                       # D(term) = wⱼ * nᵢ
            acc[j] = term if acc[j] is None else acc[j] + term  # homomorphic add
    return {"shapes": first_model["shapes"], "enc": acc}


# --- Serialization for transport (Flower Parameters carry these bytes) -------
def serialize_encrypted(model):
    """Encrypted model -> bytes. Each ciphertext is (ciphertext_int, exponent);
    the public key (n) is needed to deserialize, and both server and labs have
    it, so we don't embed it here."""
    payload = {
        "shapes": model["shapes"],
        "data": [[str(e.ciphertext()), int(e.exponent)] for e in model["enc"]],
    }
    return json.dumps(payload).encode("utf-8")


def deserialize_encrypted(pub, blob):
    """bytes -> encrypted model, rebuilding EncryptedNumber objects under `pub`."""
    payload = json.loads(blob.decode("utf-8"))
    enc = [paillier.EncryptedNumber(pub, int(c), int(exp)) for c, exp in payload["data"]]
    return {"shapes": payload["shapes"], "enc": enc}


def ciphertext_sha256(model):
    """Fingerprint of an encrypted model (does not re-randomize the ciphertexts)."""
    import hashlib
    digest = hashlib.sha256(json.dumps(model["shapes"]).encode("utf-8"))
    for e in model["enc"]:
        digest.update(f"{e.ciphertext(be_secure=False)}:{e.exponent};".encode("ascii"))
    return digest.hexdigest()


def count_weights(weights):
    """Number of scalar weights (i.e. Paillier ops per client per round) — handy
    for reporting the encryption cost at defense."""
    return int(sum(int(np.prod(w.shape)) for w in weights))

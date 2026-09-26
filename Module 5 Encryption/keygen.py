# Module 5 Encryption/keygen.py
# ---------------------------------------------------------------------------
# Generate the Paillier keypair for the federation and write two files:
#   * public.json  -> given to the SERVER and all labs (aggregate + encrypt)
#   * private.json -> given ONLY to the labs (decrypt). NEVER deploy this to the
#                     aggregation server — that is what keeps the server blind.
#
#   python Module 5 Encryption/keygen.py --out fl/keys --bits 1024
#
# Key size: 2048+ bits is recommended for real security. 1024 is offered for a
# fast demo (keygen + per-weight encryption get much slower at 2048). Flagged so
# you can explain the security/speed trade-off at defense.
# ---------------------------------------------------------------------------
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paillier_utils as pu  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="Generate FedHealth Paillier keys")
    ap.add_argument("--out", default="keys")
    ap.add_argument("--bits", type=int, default=2048,
                    help="Paillier modulus bits (1024 = fast demo, 2048+ = secure)")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    print(f"Generating {args.bits}-bit Paillier keypair (this can take a while)...")
    pub, priv = pu.generate_keypair(n_length=args.bits)

    pub_path = os.path.join(args.out, "public.json")
    priv_path = os.path.join(args.out, "private.json")
    pu.save_public_key(pub, pub_path)
    pu.save_private_key(priv, priv_path)

    print(f"  public key  -> {pub_path}   (server + labs)")
    print(f"  private key -> {priv_path}  (LABS ONLY — keep off the server!)")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# fl/scripts/gen_certs.sh
# ---------------------------------------------------------------------------
# Generate a self-signed CA + server certificate for the FedHealth FL uplink
# (Module 6.4.1 — secure uplink). Flower terminates server-authenticated TLS
# with these; clients verify the server against the CA.
#
# The SAN list covers 'localhost' and the docker-compose service name
# 'fl-server' so the same cert works locally and inside Compose (Module 9).
#
#   bash fl/scripts/gen_certs.sh        # writes into fl/certs/
# ---------------------------------------------------------------------------
set -euo pipefail
CERT_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "Generating CA..."
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 825 \
  -subj "/O=FedHealth/CN=FedHealth-CA" -out ca.crt

echo "Generating server key + CSR..."
openssl genrsa -out server.key 4096
openssl req -new -key server.key -subj "/O=FedHealth/CN=fl-server" -out server.csr

cat > san.cnf <<'EOF'
subjectAltName=DNS:localhost,DNS:fl-server,IP:127.0.0.1
EOF

echo "Signing server cert with CA..."
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 -extfile san.cnf

rm -f server.csr san.cnf
echo "Done. Wrote ca.crt, server.crt, server.key into $CERT_DIR"
echo "Enable TLS by passing FL_CA_CERT / FL_SERVER_CERT / FL_SERVER_KEY."

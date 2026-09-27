"""Launch real server and three clients; verify separate-process TLS FedAvg."""
import argparse
from datetime import datetime, timedelta, timezone
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "Module 4 FL"))
from fedhealth_ml.data import Dataset
from fedhealth_ml.training import DEFAULT_CSV, DEFAULT_PROVENANCE
from prepare_labs import prepare


# Generates a throwaway CA + a server certificate for "localhost", so the FL server/client
# processes can be smoke-tested talking real TLS instead of the --insecure-dev fallback.
# Uses the `cryptography` library directly (self-signed, 2-day validity, test-only).
def certificates(folder):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    folder.mkdir()
    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "FedHealth test CA")])
    ca = x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True).sign(ca_key, hashes.SHA256())
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    cert = x509.CertificateBuilder().subject_name(server_name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=2)).add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False).sign(ca_key, hashes.SHA256())
    (folder / "ca.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (folder / "server.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (folder / "server.key").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))


# Launches the real server.py and 3 real client.py processes (separate OS processes, not
# in-process calls) over an actual TCP socket, optionally with the TLS certs from
# certificates(), and waits for a complete 2-round FedAvg run to finish. This is the only
# test that proves the FL transport itself (not just the aggregation logic) works.
def run(model, output, *, tls=True):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    model = Path(model).resolve()
    labs = prepare(Dataset(DEFAULT_CSV, DEFAULT_PROVENANCE), model, output / "labs")
    # Bind port 0 to let the OS pick a free ephemeral port, then release the socket
    # immediately so the server process can bind to that same port itself.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    address = f"127.0.0.1:{port}"
    secure_server, secure_client = ["--insecure-dev"], ["--insecure-dev"]
    if tls:
        certificates(output / "certs")
        secure_server = ["--ca-cert", str(output / "certs/ca.pem"), "--server-cert", str(output / "certs/server.pem"), "--server-key", str(output / "certs/server.key")]
        secure_client = ["--ca-cert", str(output / "certs/ca.pem")]
    env = dict(os.environ, PYTHONPATH=str(ROOT), TF_NUM_INTRAOP_THREADS="1", TF_NUM_INTEROP_THREADS="1", TF_CPP_MIN_LOG_LEVEL="2", TF_ENABLE_ONEDNN_OPTS="0")
    processes, logs = [], []
    # Starts one subprocess (server or a lab client), redirecting its output to a per-
    # process log file so a failure can be diagnosed after the fact.
    def launch(name, args):
        log = (output / f"{name}.log").open("w", encoding="utf-8")
        logs.append(log)
        p = subprocess.Popen([sys.executable, *args], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        processes.append((name, p))
        return p
    try:
        server = launch("server", ["Module 4 FL/server.py", "--bind", address, "--model", str(model), "--plan", str(labs / "plan.json"), "--validation", str(labs / "validation.csv"), "--out", str(output / "server_result"), "--rounds", "2", *secure_server])
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            if server.poll() is not None:
                raise RuntimeError("Server stopped during startup; inspect server.log")
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.25):
                    break
            except OSError:
                time.sleep(.25)
        else:
            raise TimeoutError("Server startup timeout")
        for i in range(3):
            lab = f"lab-{i:02d}"
            launch(lab, ["Module 4 FL/client.py", "--server", address, "--lab-id", lab, "--shard", str(labs / f"{lab}.csv"), "--model", str(model), "--canonical-units", *secure_client])
        deadline = time.monotonic() + 360
        while any(p.poll() is None for _, p in processes):
            if time.monotonic() > deadline:
                raise TimeoutError("Transport smoke timeout")
            for name, p in processes:
                if p.poll() not in (None, 0):
                    raise RuntimeError(f"{name} exited {p.returncode}; inspect {name}.log")
            time.sleep(.5)
        for name, p in processes:
            if p.returncode != 0:
                raise RuntimeError(f"{name} exited {p.returncode}")
        history = json.loads((output / "server_result/round_history.json").read_text())
        if len(history["aggregation"]) != 2 or len(history["validation"]) != 3:
            raise AssertionError("Incomplete transport run")
        from fedhealth_ml.artifacts import load_bundle
        load_bundle(output / "server_result/model")
        (output / "result.json").write_text(json.dumps({"passed": True, "rounds": 2, "labs": 3, "tls": tls,
            "selected_round": history["selected_round"], "raw_training_rows_sent": False}, indent=2))
        print(f"Separate-process {'TLS' if tls else 'insecure'} smoke passed: {output}")
    finally:
        for _, p in processes:
            if p.poll() is None:
                p.terminate()
        for _, p in processes:
            try: p.wait(timeout=10)
            except subprocess.TimeoutExpired: p.kill(); p.wait()
        for log in logs:
            log.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--model", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--insecure-dev", action="store_true")
    args = ap.parse_args()
    run(args.model, args.out, tls=not args.insecure_dev)

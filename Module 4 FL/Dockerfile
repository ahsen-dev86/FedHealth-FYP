# Build: docker build -f "Module 4 FL/Dockerfile" -t fedhealth-fl-server .
FROM python:3.13-slim
WORKDIR /app
COPY ["Module 4 FL/requirements.txt", "/tmp/requirements.txt"]
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt
COPY ["Module 3 ML/schema.py", "Module 3 ML/preprocess.py", "Module 3 ML/models.py", "Module 3 ML/rules.py", "/app/Module 3 ML/"]
COPY ["Module 4 FL/", "/app/module4/"]
WORKDIR /app/module4
ENV PYTHONPATH=/app/module4
ENV FL_BIND=0.0.0.0:8080 FL_ROUNDS=20 FL_LABS=3 LOCAL_EPOCHS=1
ENV FL_CA_CERT=/certs/ca.crt FL_SERVER_CERT=/certs/server.crt FL_SERVER_KEY=/certs/server.key
VOLUME ["/artifacts", "/certs", "/output"]
EXPOSE 8080
CMD ["python", "server.py", "--reference-dir", "/artifacts/reference", "--split-manifest", "/artifacts/split_manifest.json", "--validation-csv", "/artifacts/validation.csv", "--output-dir", "/output/federated_ann"]

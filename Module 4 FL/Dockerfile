# fl/server/Dockerfile
# Build context is the repo root (so we can COPY both fl/ and ml/).
#   docker build -f fl/server/Dockerfile -t fedhealth-fl-server .
FROM python:3.11-slim

WORKDIR /app

# System deps kept minimal; TF wheels are manylinux so no build toolchain needed.
COPY fl/requirements.txt /app/fl/requirements.txt
RUN pip install --no-cache-dir -r /app/fl/requirements.txt

# Shared ML package + FL code.
COPY ml /app/ml
COPY fl /app/fl
# The reference dataset (used to init the preprocessor + global model).
COPY anemia_diagnosed_cbc_data_v4.csv /app/anemia_diagnosed_cbc_data_v4.csv

ENV PYTHONPATH=/app/fl:/app/ml
ENV FL_BIND=0.0.0.0:8080 FL_ROUNDS=5 FL_LABS=4
ENV REFERENCE_CSV=/app/anemia_diagnosed_cbc_data_v4.csv
ENV PREPROCESSOR=/app/fl/preprocessor.joblib

EXPOSE 8080
CMD ["python", "/app/fl/server/server.py"]

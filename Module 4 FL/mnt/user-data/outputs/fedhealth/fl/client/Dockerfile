# fl/client/Dockerfile
# Build context is the repo root.
#   docker build -f fl/client/Dockerfile -t fedhealth-fl-client .
FROM python:3.11-slim

WORKDIR /app

COPY fl/requirements.txt /app/fl/requirements.txt
RUN pip install --no-cache-dir -r /app/fl/requirements.txt

COPY ml /app/ml
COPY fl /app/fl
COPY anemia_diagnosed_cbc_data_v4.csv /app/anemia_diagnosed_cbc_data_v4.csv

ENV PYTHONPATH=/app/fl:/app/ml
# Each lab container overrides LAB_ID + SHARD_CSV via docker-compose (Module 9).
ENV FL_SERVER=fl-server:8080 LAB_ID=lab-00 LOCAL_EPOCHS=2
ENV SHARD_CSV=/app/fl/client/data/lab_00.csv
ENV REFERENCE_CSV=/app/anemia_diagnosed_cbc_data_v4.csv
ENV PREPROCESSOR=/app/fl/preprocessor.joblib

CMD ["python", "/app/fl/client/client.py"]

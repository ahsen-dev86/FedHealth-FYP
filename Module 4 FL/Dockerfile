# Build: docker build -f "Module 4 FL/Dockerfile" -t fedhealth-fl-server .
FROM python:3.13-slim
WORKDIR /app
COPY ["Module 4 FL/requirements.txt", "/tmp/requirements.txt"]
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt
COPY ["Module 3 ML/schema.py", "Module 3 ML/preprocess.py", "Module 3 ML/models.py", "Module 3 ML/rules.py", "/app/Module 3 ML/"]
COPY ["Module 4 FL/", "/app/module4/"]
WORKDIR /app/module4
ENV PYTHONPATH=/app/module4
ENV FL_BIND=0.0.0.0:8080 FL_ROUNDS=5 FL_LABS=3 LOCAL_EPOCHS=2
ENV PREPROCESSOR=/artifacts/preprocessor.joblib
VOLUME ["/artifacts", "/output"]
EXPOSE 8080
CMD ["python", "server.py", "--output-dir", "/output/federated_ann"]

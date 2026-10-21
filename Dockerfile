FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY frontend /app/frontend
COPY assets /app/assets

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health')"

CMD ["python3", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]

FROM python:3.12-alpine
RUN adduser -D -u 10001 canary
COPY --chown=root:root server.py /app/server.py
USER 10001
ENV PYTHONUNBUFFERED=1
CMD ["python", "/app/server.py"]

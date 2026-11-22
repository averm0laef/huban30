# АН-30 parts finder / VIN decoder: internal sidecar for the NestJS API.
# Not published to the internet: the API calls it as http://parts-finder:8011.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PARTS_FINDER_STATE_DIR=/data/state \
    VIN_VPIC_MODE=offline

WORKDIR /app

COPY requirements.lock.txt ./
RUN pip install --only-binary=:all: -r requirements.lock.txt \
    && groupadd --system --gid 10011 partsfinder \
    && useradd --system --uid 10011 --gid partsfinder --no-create-home --shell /usr/sbin/nologin partsfinder \
    && install -d -o partsfinder -g partsfinder -m 0700 /data/state

COPY --chown=root:root *.py index.html ./

USER partsfinder
VOLUME ["/data/state"]
EXPOSE 8011

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8011/health', timeout=4).status == 200 else 1)"]

CMD ["python", "proxy.py", "--host", "0.0.0.0", "--port", "8011"]

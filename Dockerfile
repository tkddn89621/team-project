# 시연용 배포 (Railway): 프론트를 빌드해서 FastAPI 서버 하나가 화면과 API를 함께 내보냄
# 키는 Railway Variables에 넣음 (.env는 이미지에 안 들어감 — .dockerignore)

# 1) 화면 빌드
FROM node:22-slim AS web
WORKDIR /web
COPY cardcoach/frontend/package.json cardcoach/frontend/package-lock.json ./
RUN npm ci
COPY cardcoach/frontend/ ./
RUN npm run build

# 2) 서버
FROM python:3.12-slim
WORKDIR /app/cardcoach/backend
COPY cardcoach/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY cardcoach/backend/ ./
COPY cardcoach/data/ /app/cardcoach/data/
COPY --from=web /web/dist /app/cardcoach/frontend/dist
# DB는 /data 에 둠. Railway에서 Volume을 /data 에 붙이면 재배포해도 기록이 남음
RUN mkdir -p /data
ENV DB_FILE=/data/cardcoach.db
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

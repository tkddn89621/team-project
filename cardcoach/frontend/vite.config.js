import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 폰에서 앱 안 카메라·실제 GPS를 쓰려면 https가 필요하다(브라우저 규칙).
// certs/ 에 자체 서명 인증서가 있으면 https로, 없으면 지금처럼 http로 뜬다.
const keyFile = new URL('./certs/dev-key.pem', import.meta.url)
const certFile = new URL('./certs/dev-cert.pem', import.meta.url)
const https = fs.existsSync(keyFile) && fs.existsSync(certFile)
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : undefined

// https 페이지에서 http 백엔드(8000)를 직접 부르면 브라우저가 막는다.
// 그래서 프론트는 /api/... 로 요청하고, 이 개발 서버가 백엔드로 대신 전달한다. (로고 /api/logos/... 도 같음)
// localhost 대신 127.0.0.1: Node가 localhost를 IPv6(::1)로 풀어 uvicorn에 못 붙는 문제 방지
const backend = { target: 'http://127.0.0.1:8000', changeOrigin: true }

// 관리자 화면(admin.html)은 PC 개발 서버에서만: localhost:5173/admin 으로 열림.
// 배포 빌드(npm run build)는 index.html만 묶으므로 배포 주소에는 관리자 화면이 없다
const adminPage = {
  name: 'admin-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/admin' || req.url === '/admin/') req.url = '/admin.html'
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), adminPage],
  server: {
    host: true, // 같은 와이파이의 폰에서 접속 가능 (npm run dev -- --host 와 같음)
    // Cloudflare 임시 터널(https://○○.trycloudflare.com)로 폰 데이터에서도 접속 허용
    allowedHosts: ['.trycloudflare.com'],
    https,
    proxy: {
      '/api': { ...backend, rewrite: (p) => p.replace(/^\/api/, '') },
    },
  },
})

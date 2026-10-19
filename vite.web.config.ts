import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 在普通浏览器中运行界面（使用模拟的桌面接口），用于开发和测试交互
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5199, strictPort: true },
  build: { outDir: '../../dist-web', emptyOutDir: true }
})

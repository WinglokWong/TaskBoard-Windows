import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// 打包后的界面只允许加载自身的脚本；图片可以来自附件协议（tbfile:）、data: 和 blob:
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' tbfile: data: blob:",
  "font-src 'self'",
  "connect-src 'self' tbfile:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'"
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'taskboard-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
}

// 入口使用 electron-vite 的默认约定：
//   src/main/index.ts、src/preload/index.ts、src/renderer/index.html
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), contentSecurityPolicy()]
  }
})

import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    // JSX 변환은 esbuild에 맡긴다. babel(@vitejs/plugin-react)을 쓰지 않으므로
    // 의존성이 줄고 CI에서 빌드가 깨질 여지도 줄어든다.
    esbuild: { jsx: 'automatic' },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') }
      }
    }
  }
})

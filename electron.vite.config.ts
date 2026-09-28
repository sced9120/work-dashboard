import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
        // 한글 문서 도구(kordoc)는 devDependencies 에 두고 이 번들에 묶는다. 그래야 쓰지 않는
        // 의존성(MCP 서버 등)이 설치파일에 들어가지 않는다. 스캔 PDF 글자 인식·PDF 출력에 쓰는
        // 무거운 선택 모듈은 쓰지 않으므로 묶지 않는다(부르면 없다고 나올 뿐 앱은 멀쩡하다).
        external: [
          'sharp',
          'onnxruntime-node',
          '@huggingface/transformers',
          '@hyzyla/pdfium',
          'puppeteer-core'
        ]
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

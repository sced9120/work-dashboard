// src/components/Markdown.tsx — AI 답의 Markdown 을 화면에 (빌드 없이: esbuild 로 t_markdown.tsx 를 묶어 돌린다)
const path = require('path')
const esbuild = require(path.join(__dirname, '../node_modules/esbuild'))

const out = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 't_markdown.tsx')],
  bundle: true,
  platform: 'node',
  jsx: 'automatic',
  write: false,
  logLevel: 'warning'
})
new Function('module', 'exports', 'require', out.outputFiles[0].text)({ exports: {} }, {}, require)

// shared/*.ts 를 빌드 없이 읽는다(typescript 로 옮겨 적기만). shared 안의 ./파일 도 같은 방법으로
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '../node_modules/typescript'))

const cache = new Map()
function loadShared(file) {
  const f = file.endsWith('.ts') ? file : `${file}.ts`
  if (cache.has(f)) return cache.get(f)
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../shared', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  cache.set(f, m.exports)
  const req = (r) => (r.startsWith('./') ? loadShared(r.slice(2)) : require(r))
  new Function('module', 'exports', 'require', code)(m, m.exports, req)
  return m.exports
}

module.exports = { loadShared }

// 'electron' 을 가짜로 바꿔 끼운다. 실제 빌드 결과(out/main/index.js)를 Electron 의 Node 로 돌리되,
// 창·트레이는 만들지 않고 IPC 처리기만 모아 직접 부른다. 자료 폴더는 임시 폴더라 실제 DB 를 건드리지 않는다.
const Module = require('module')
const path = require('path')
const os = require('os')
const fs = require('fs')

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-it-'))
const handlers = new Map()
/** 화면으로 보낸 소식 (webContents.send) — 받는 중 글 · 진행 표시 시험에 쓴다 */
const calls = { opened: [], revealed: [], sent: [] }
const next = { open: [], save: [] }

function stub(name) {
  const fn = function () {}
  return new Proxy(fn, {
    get(_t, p) {
      if (p === 'then') return undefined
      if (p === Symbol.toPrimitive) return () => ''
      if (p === 'toString') return () => name
      return stub(`${name}.${String(p)}`)
    },
    apply() {
      return stub(`${name}()`)
    },
    construct() {
      return stub(`new ${name}`)
    }
  })
}

const app = new Proxy(
  {
    whenReady: () => Promise.resolve(),
    isReady: () => true,
    getPath: (k) => (k === 'userData' || k === 'appData' ? USER_DATA : path.join(USER_DATA, k)),
    getVersion: () => '2.9.0',
    getName: () => 'work-dashboard',
    isPackaged: false,
    requestSingleInstanceLock: () => true,
    on: () => app,
    once: () => app,
    quit: () => {},
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ openAtLogin: false })
  },
  { get: (t, p) => (p in t ? t[p] : stub(`app.${String(p)}`)) }
)

/** 창 — 화면으로 보내는 소식만 모으고 나머지는 아무 일도 하지 않는다 */
function windowStub() {
  const wc = new Proxy({ send: (ch, payload) => void calls.sent.push({ ch, payload }) }, { get: (t, p) => (p in t ? t[p] : stub(`webContents.${String(p)}`)) })
  return new Proxy({ webContents: wc }, { get: (t, p) => (p in t ? t[p] : stub(`win.${String(p)}`)) })
}
const BrowserWindow = new Proxy(function () {}, {
  construct: () => windowStub(),
  get: (_t, p) => stub(`BrowserWindow.${String(p)}`)
})

const electron = new Proxy(
  {
    app,
    BrowserWindow,
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: () => {} },
    // 앱은 net.fetch(윈도우 인증서)로 밖에 나간다. 시험에서는 global.fetch 로 돌려 가로챌 수 있게 한다.
    net: { fetch: (...a) => global.fetch(...a) },
    dialog: {
      showOpenDialog: async () => ({ canceled: !next.open.length, filePaths: next.open.shift() ?? [] }),
      showSaveDialog: async () => {
        const p = next.save.shift()
        return { canceled: !p, filePath: p }
      },
      showMessageBox: async () => ({ response: 0 })
    },
    shell: {
      openExternal: async (u) => void calls.opened.push(u),
      openPath: async (p) => {
        calls.opened.push(p)
        return ''
      },
      showItemInFolder: (p) => void calls.revealed.push(p)
    },
    // 시험에서는 암호화하지 않고 적는다(실제 PC 의 키 저장소를 쓰지 않는다)
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s) => Buffer.from(String(s)),
      decryptString: (b) => Buffer.from(b).toString()
    },
    clipboard: { writeText: () => {}, readText: () => '' }
  },
  { get: (t, p) => (p in t ? t[p] : stub(`electron.${String(p)}`)) }
)

const load = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron
  return load.call(this, request, ...rest)
}

global.__it = { handlers, calls, next, USER_DATA }
process.on('exit', () => {
  try {
    fs.rmSync(USER_DATA, { recursive: true, force: true })
  } catch {
    // 임시 폴더라 남아도 괜찮다
  }
})

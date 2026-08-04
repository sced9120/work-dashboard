import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type { Notice, NoticeInput, Task, TaskInput } from '../../shared/types'

/**
 * 예전 Streamlit 버전(school_admin_v25_final.db)과 같은 스키마를 유지한다.
 * 그래야 그 때 쓰던 .db 파일을 그대로 불러올 수 있고,
 * 여기서 내보낸 파일도 필요하면 예전 도구에서 열린다.
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tasks (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT, task_date_display TEXT, task_date_raw TEXT,
     task_type TEXT, workflow TEXT, draft_full TEXT,
     key_points TEXT, filename TEXT, is_completed INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS notices (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT, content TEXT, date TEXT, link TEXT)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`
]

let SQL: SqlJsStatic | null = null
let db: Database | null = null

function dbPath(): string {
  return path.join(app.getPath('userData'), 'work-dashboard.db')
}

function backupDir(): string {
  const dir = path.join(app.getPath('userData'), 'backups')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function loadWasm(): ArrayBuffer {
  // asar 안에서도 fs로 읽을 수 있다. 패키징 후 경로가 바뀌어도 require.resolve가 찾아 준다.
  const buf = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** 스키마를 최신 상태로 맞춘다. 예전 DB를 불러왔을 때 빠진 컬럼을 채우는 용도. */
function migrate(target: Database): void {
  for (const stmt of SCHEMA) target.run(stmt)

  const cols = (table: string): string[] => {
    const res = target.exec(`PRAGMA table_info(${table})`)
    if (!res.length) return []
    return res[0].values.map((row) => String(row[1]))
  }

  if (!cols('notices').includes('link')) target.run('ALTER TABLE notices ADD COLUMN link TEXT')
  if (!cols('tasks').includes('is_completed')) {
    target.run('ALTER TABLE tasks ADD COLUMN is_completed INTEGER DEFAULT 0')
  }

  // 예전 버전은 API 키를 DB에 넣어두었다. 인수인계 파일에 남의 키가 섞여
  // 들어가지 않도록, 불러온 시점에 지운다. 키는 이 PC의 안전 저장소에만 둔다.
  target.run("DELETE FROM settings WHERE key IN ('openai_key','gemini_key','model_choice')")
}

function seedIfEmpty(target: Database): void {
  const res = target.exec('SELECT COUNT(*) FROM notices')
  const count = res.length ? Number(res[0].values[0][0]) : 0
  if (count > 0) return

  const guide = `이 프로그램은 담당 업무를 다음 담당자에게 넘겨주기 위한 도구입니다.

1. 문서 학습
   업무 길라잡이·매뉴얼이나 그동안 받은 공문을 올리면, AI가 업무 목록으로 정리해 줍니다.
   PDF가 가장 정확하게 읽힙니다. 한글 파일(hwp, hwpx)과 엑셀도 지원합니다.

2. 검토는 사람이
   AI가 정리한 내용은 등록 전에 화면에서 직접 확인하고 고칠 수 있습니다.
   빠진 업무가 있을 수 있으니 큰 틀을 잡는 용도로 보시면 됩니다.

3. 인수인계
   [데이터 관리]에서 인수인계 파일을 내보내 다음 담당자에게 전달하세요.
   받는 분은 같은 화면에서 그 파일을 불러오면 바로 이어서 쓸 수 있습니다.
   API 키는 파일에 담기지 않으니 안심하고 보내셔도 됩니다.`

  target.run('INSERT INTO notices (title, content, date, link) VALUES (?, ?, ?, ?)', [
    '[필독] 이 프로그램 사용 안내',
    guide,
    today(),
    ''
  ])
}

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function persist(): void {
  if (!db) return
  const data = Buffer.from(db.export())
  const target = dbPath()
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, target)
}

export async function openDb(): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ wasmBinary: loadWasm() })

  const file = dbPath()
  db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database()

  migrate(db)
  seedIfEmpty(db)
  persist()
}

function need(): Database {
  if (!db) throw new Error('데이터베이스가 아직 열리지 않았습니다.')
  return db
}

/** exec 결과를 객체 배열로 바꾼다. */
function rows<T>(sql: string, params: unknown[] = []): T[] {
  const stmt = need().prepare(sql)
  stmt.bind(params as never)
  const out: T[] = []
  while (stmt.step()) out.push(stmt.getAsObject() as T)
  stmt.free()
  return out
}

function run(sql: string, params: unknown[] = []): void {
  need().run(sql, params as never)
  persist()
}

function lastId(): number {
  const res = need().exec('SELECT last_insert_rowid()')
  return res.length ? Number(res[0].values[0][0]) : 0
}

/* ---------- 업무 ---------- */

export function listTasks(): Task[] {
  return rows<Task>('SELECT * FROM tasks ORDER BY id DESC')
}

export function addTask(t: TaskInput): number {
  run(
    `INSERT INTO tasks
       (title, task_date_display, task_date_raw, task_type, workflow, draft_full, key_points, filename, is_completed)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      t.title,
      t.task_date_display,
      t.task_date_raw,
      t.task_type,
      t.workflow,
      t.draft_full,
      t.key_points,
      t.filename,
      t.is_completed ?? 0
    ]
  )
  return lastId()
}

export function updateTask(id: number, patch: Partial<TaskInput>): void {
  const fields = Object.keys(patch) as (keyof TaskInput)[]
  if (!fields.length) return
  const set = fields.map((f) => `${f}=?`).join(', ')
  run(`UPDATE tasks SET ${set} WHERE id=?`, [...fields.map((f) => patch[f] ?? ''), id])
}

export function deleteTask(id: number): void {
  run('DELETE FROM tasks WHERE id=?', [id])
}

/* ---------- 공지 ---------- */

export function listNotices(): Notice[] {
  return rows<Notice>('SELECT * FROM notices ORDER BY id DESC')
}

export function addNotice(n: NoticeInput): number {
  run('INSERT INTO notices (title, content, date, link) VALUES (?,?,?,?)', [
    n.title,
    n.content,
    n.date || today(),
    n.link
  ])
  return lastId()
}

export function updateNotice(id: number, n: NoticeInput): void {
  run('UPDATE notices SET title=?, content=?, link=?, date=? WHERE id=?', [
    n.title,
    n.content,
    n.link,
    n.date || today(),
    id
  ])
}

export function deleteNotice(id: number): void {
  run('DELETE FROM notices WHERE id=?', [id])
}

/* ---------- DB에 저장되는 설정 ---------- */

export function getSetting(key: string, fallback = ''): string {
  const res = rows<{ value: string }>('SELECT value FROM settings WHERE key=?', [key])
  return res.length ? res[0].value : fallback
}

export function setSetting(key: string, value: string): void {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value])
}

/* ---------- 백업 / 복구 ---------- */

export function exportTo(targetPath: string): void {
  fs.writeFileSync(targetPath, Buffer.from(need().export()))
}

/**
 * 인수인계 파일을 현재 데이터로 불러온다.
 * 덮어쓰기 전에 현재 상태를 backups 폴더에 자동 보관한다.
 */
export async function importFrom(sourcePath: string): Promise<{ tasks: number; notices: number }> {
  const buf = fs.readFileSync(sourcePath)
  if (!SQL) SQL = await initSqlJs({ wasmBinary: loadWasm() })

  // 먼저 열어 보고 정상적인 DB인지 확인한다. 깨진 파일이면 여기서 throw.
  const incoming = new SQL.Database(buf)
  incoming.exec('SELECT COUNT(*) FROM sqlite_master')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir(), `자동백업_${stamp}.db`), Buffer.from(need().export()))

  db?.close()
  db = incoming
  migrate(db)
  seedIfEmpty(db)
  persist()

  const t = db.exec('SELECT COUNT(*) FROM tasks')
  const n = db.exec('SELECT COUNT(*) FROM notices')
  return {
    tasks: t.length ? Number(t[0].values[0][0]) : 0,
    notices: n.length ? Number(n[0].values[0][0]) : 0
  }
}

export function clearAll(): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir(), `초기화전_${stamp}.db`), Buffer.from(need().export()))
  need().run('DELETE FROM tasks')
  need().run('DELETE FROM notices')
  persist()
  seedIfEmpty(need())
  persist()
}

export function dbInfo(): { path: string; backups: string; sizeKb: number } {
  const file = dbPath()
  return {
    path: file,
    backups: backupDir(),
    sizeKb: fs.existsSync(file) ? Math.round(fs.statSync(file).size / 1024) : 0
  }
}

import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import type {
  CalEvent,
  CalEventInput,
  Deadline,
  DeadlineInput,
  Doc,
  DocFull,
  DocInput,
  JournalEntry,
  JournalInput,
  Notice,
  NoticeInput,
  SearchHit,
  Task,
  TaskInput,
  Template,
  TemplateInput
} from '../../shared/types'

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
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  // 올린 공문·매뉴얼의 원문을 그대로 보관한다. 예전에는 AI가 뽑아낸 업무만 남기고
  // 원문을 버려서, 나중에 "그 공문 어디 갔지" 를 찾을 방법이 없었다.
  `CREATE TABLE IF NOT EXISTS documents (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     filename TEXT, doc_kind TEXT, doc_date TEXT,
     added_at TEXT, content TEXT)`,
  // 문서를 만들 때 본보기로 삼는 예시. 내용이 아니라 '형식'을 담아 두는 곳이다.
  // kind 에는 문서 서식의 id 가 들어간다 (shared/docforms.ts).
  `CREATE TABLE IF NOT EXISTS templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT, kind TEXT, content TEXT, added_at TEXT)`,
  // 절차 기한. 사안명에 개인정보가 섞일 수 있어 인수인계 파일에서는 기본으로 뺀다.
  `CREATE TABLE IF NOT EXISTS deadlines (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT, case_ref TEXT, due_date TEXT, note TEXT,
     done INTEGER DEFAULT 0)`,
  // 그날 무슨 일을 했는지 남기는 기록. "작년 이맘때 뭐 했더라" 에 답하기 위한 것이라
  // 인수인계 파일에 함께 넘어간다.
  `CREATE TABLE IF NOT EXISTS journal (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entry_date TEXT, content TEXT)`,
  // 달력에 직접 넣는 일정. 업무(tasks)의 "3월 1주" 와 달리 실제 날짜를 가진다.
  // remind 를 켜면 기한처럼 D-day 가 붙고 윈도우 알림 대상이 된다.
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_date TEXT, end_date TEXT, start_time TEXT,
     title TEXT, content TEXT, color TEXT,
     remind INTEGER DEFAULT 0, done INTEGER DEFAULT 0)`
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

/**
 * 스키마를 최신 상태로 맞춘다. 예전 DB를 불러왔을 때 빠진 컬럼을 채우는 용도.
 * 실제로 무언가 바꿨으면 true 를 돌려준다 (바뀐 게 없으면 저장을 건너뛰기 위해).
 */
function migrate(target: Database): boolean {
  for (const stmt of SCHEMA) target.run(stmt)
  let changed = false

  const cols = (table: string): string[] => {
    const res = target.exec(`PRAGMA table_info(${table})`)
    if (!res.length) return []
    return res[0].values.map((row) => String(row[1]))
  }

  if (!cols('notices').includes('link')) {
    target.run('ALTER TABLE notices ADD COLUMN link TEXT')
    changed = true
  }
  if (!cols('tasks').includes('is_completed')) {
    target.run('ALTER TABLE tasks ADD COLUMN is_completed INTEGER DEFAULT 0')
    changed = true
  }
  if (!cols('tasks').includes('document_id')) {
    target.run('ALTER TABLE tasks ADD COLUMN document_id INTEGER DEFAULT 0')
    changed = true
  }

  // 예전 버전은 API 키를 DB에 넣어두었다. 인수인계 파일에 남의 키가 섞여
  // 들어가지 않도록, 불러온 시점에 지운다. 키는 이 PC의 안전 저장소에만 둔다.
  target.run("DELETE FROM settings WHERE key IN ('openai_key','gemini_key','model_choice')")
  if (target.getRowsModified() > 0) changed = true

  return changed
}

/** 처음 켰을 때 안내 공지를 하나 넣는다. 넣었으면 true. */
function seedIfEmpty(target: Database): boolean {
  const res = target.exec('SELECT COUNT(*) FROM notices')
  const count = res.length ? Number(res[0].values[0][0]) : 0
  if (count > 0) return false

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
  return true
}

function today(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 여러 건을 잇달아 넣는 동안에는 저장을 미룬다.
 * sql.js 는 파일 일부만 고치지 못하고 DB 전체를 내보내 다시 쓰므로,
 * 공문 300건을 한 번에 보관하면 "전체 다시 쓰기" 가 300번 일어난다.
 */
let deferDepth = 0
let dirtyWhileDeferred = false

function persist(): void {
  if (!db) return
  if (deferDepth > 0) {
    dirtyWhileDeferred = true
    return
  }
  const data = Buffer.from(db.export())
  const target = dbPath()
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, target)
}

/** fn 이 도는 동안 저장을 미루고, 끝날 때 한 번만 저장한다. */
export function batched<T>(fn: () => T): T {
  deferDepth++
  try {
    return fn()
  } finally {
    deferDepth--
    if (deferDepth === 0 && dirtyWhileDeferred) {
      dirtyWhileDeferred = false
      persist()
    }
  }
}

export async function openDb(): Promise<void> {
  if (!SQL) SQL = await initSqlJs({ wasmBinary: loadWasm() })

  const file = dbPath()
  const isNew = !fs.existsSync(file)
  db = isNew ? new SQL.Database() : new SQL.Database(fs.readFileSync(file))

  const migrated = migrate(db)
  const seeded = seedIfEmpty(db)

  // 바뀐 것이 없으면 다시 쓰지 않는다. 공문 원문이 쌓이면 이 한 번이
  // 수십 MB 를 통째로 다시 쓰는 일이 되어, 켤 때마다 그대로 느려진다.
  if (isNew || migrated || seeded) persist()
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
       (title, task_date_display, task_date_raw, task_type, workflow, draft_full, key_points, filename, is_completed, document_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      t.title,
      t.task_date_display,
      t.task_date_raw,
      t.task_type,
      t.workflow,
      t.draft_full,
      t.key_points,
      t.filename,
      t.is_completed ?? 0,
      t.document_id ?? 0
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

/**
 * 같은 앞머리를 가진 설정을 한꺼번에 읽는다.
 * 주제별로 흩어 저장한 흐름도(`wf:○○`)를 한자리에 모아 보여 주는 데 쓴다.
 */
export function settingsByPrefix(prefix: string): { key: string; value: string }[] {
  return rows<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key LIKE ? AND value <> '' ORDER BY key",
    [`${prefix}%`]
  )
}

/* ---------- 보관 문서 (공문 원문) ---------- */

/** 목록에서는 본문을 빼고 읽는다. 본문까지 다 읽으면 수십 MB가 오간다. */
export function listDocs(): Doc[] {
  return rows<Doc>(
    `SELECT id, filename, doc_kind, doc_date, added_at, LENGTH(content) AS chars
       FROM documents ORDER BY id DESC`
  )
}

export function getDoc(id: number): DocFull | null {
  const res = rows<DocFull>(
    `SELECT id, filename, doc_kind, doc_date, added_at, content,
            LENGTH(content) AS chars
       FROM documents WHERE id=?`,
    [id]
  )
  return res.length ? res[0] : null
}

/**
 * 같은 파일을 두 번 올려도 중복 보관하지 않는다.
 * 이미 있으면 그 id를 그대로 돌려준다.
 */
export function addDoc(d: DocInput): number {
  const dup = rows<{ id: number }>(
    'SELECT id FROM documents WHERE filename=? AND LENGTH(content)=?',
    [d.filename, d.content.length]
  )
  if (dup.length) return dup[0].id

  run('INSERT INTO documents (filename, doc_kind, doc_date, added_at, content) VALUES (?,?,?,?,?)', [
    d.filename,
    d.doc_kind,
    d.doc_date,
    d.added_at || today(),
    d.content
  ])
  return lastId()
}

export function deleteDoc(id: number): void {
  run('DELETE FROM documents WHERE id=?', [id])
  run('UPDATE tasks SET document_id=0 WHERE document_id=?', [id])
}

export function docCount(): number {
  const res = need().exec('SELECT COUNT(*) FROM documents')
  return res.length ? Number(res[0].values[0][0]) : 0
}

/**
 * 공문에서 접수일자·시행일자를 찾아 YYYY-MM-DD 로 돌려준다.
 * 공문 서식마다 표기가 달라 완벽하지 않다. 못 찾으면 빈 문자열.
 */
function asDate(y: string, mo: string, d: string): string {
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  if (year < 1990 || year > 2100) return ''
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${year}-${p(month)}-${p(day)}`
}

/**
 * 공문에서 그 문서의 날짜를 찾아낸다.
 *
 * 예전에는 앞부분에서 날짜처럼 보이는 것을 처음 하나 집었는데, 공문에는
 * 근거 법령("학교폭력예방법 2016. 12. 20. 개정")이나 지난 공문 인용이 함께
 * 실려 있어 엉뚱하게 2016년으로 잡히는 일이 있었다.
 *
 * 그래서 두 단계로 본다.
 * 1) "시행 / 접수 / 기안" 처럼 **이름표가 붙은 날짜**가 있으면 그것이 답이다.
 * 2) 없으면 앞부분의 날짜를 모두 모아, 아직 오지 않은 날짜를 뺀 뒤
 *    **가장 최근 것**을 고른다. 인용된 법령·지난 공문은 대개 더 옛날이기 때문이다.
 */
export function guessDocDate(text: string): string {
  const head = text.slice(0, 6000)

  // 1) 이름표가 붙은 날짜
  const labeled =
    /(?:접수|시행|기안|생산|발신|작성)\s*(?:일자|일)?\s*[:：]?\s*(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/
  const m = head.match(labeled)
  if (m) {
    const got = asDate(m[1], m[2], m[3])
    if (got) return got
  }

  // 2) 앞부분의 모든 날짜 중에서 고른다
  const loose = /(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/g
  const now = new Date()
  // 며칠 뒤 날짜까지는 봐준다(발송 예정일 등). 그보다 먼 미래는 기한이지 문서 날짜가 아니다.
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30)
    .toISOString()
    .slice(0, 10)

  const found: string[] = []
  for (const hit of head.matchAll(loose)) {
    const got = asDate(hit[1], hit[2], hit[3])
    if (got && got <= limit) found.push(got)
  }
  if (!found.length) return ''

  // 가장 최근 것
  return found.sort()[found.length - 1]
}

/** 잘못 잡힌 날짜를 사람이 고칠 수 있게 한다. */
export function setDocDate(id: number, date: string): void {
  run('UPDATE documents SET doc_date = ? WHERE id = ?', [date, id])
}

/* ---------- 대본 · 회의록 본보기 ---------- */

export function listTemplates(): Template[] {
  return rows<Template>('SELECT * FROM templates ORDER BY id DESC')
}

export function addTemplate(t: TemplateInput): number {
  run('INSERT INTO templates (name, kind, content, added_at) VALUES (?,?,?,?)', [
    t.name,
    t.kind,
    t.content,
    t.added_at || today()
  ])
  return lastId()
}

export function updateTemplate(id: number, t: TemplateInput): void {
  run('UPDATE templates SET name=?, kind=?, content=? WHERE id=?', [t.name, t.kind, t.content, id])
}

export function deleteTemplate(id: number): void {
  run('DELETE FROM templates WHERE id=?', [id])
}

/* ---------- 절차 기한 ---------- */

/** 기한이 빠른 것부터. 날짜가 비어 있는 것은 맨 뒤로 보낸다. */
export function listDeadlines(): Deadline[] {
  return rows<Deadline>(
    `SELECT * FROM deadlines
      ORDER BY done ASC,
               CASE WHEN due_date IS NULL OR due_date='' THEN 1 ELSE 0 END,
               due_date ASC`
  )
}

export function addDeadline(d: DeadlineInput): number {
  run('INSERT INTO deadlines (title, case_ref, due_date, note, done) VALUES (?,?,?,?,?)', [
    d.title,
    d.case_ref,
    d.due_date,
    d.note,
    d.done ?? 0
  ])
  return lastId()
}

export function updateDeadline(id: number, patch: Partial<DeadlineInput>): void {
  const fields = Object.keys(patch) as (keyof DeadlineInput)[]
  if (!fields.length) return
  const set = fields.map((f) => `${f}=?`).join(', ')
  run(`UPDATE deadlines SET ${set} WHERE id=?`, [...fields.map((f) => patch[f] ?? ''), id])
}

export function deleteDeadline(id: number): void {
  run('DELETE FROM deadlines WHERE id=?', [id])
}

/* ---------- 업무 일지 ---------- */

export function listJournal(): JournalEntry[] {
  return rows<JournalEntry>('SELECT * FROM journal ORDER BY entry_date DESC, id DESC')
}

export function addJournal(j: JournalInput): number {
  run('INSERT INTO journal (entry_date, content) VALUES (?,?)', [j.entry_date || today(), j.content])
  return lastId()
}

export function updateJournal(id: number, j: JournalInput): void {
  run('UPDATE journal SET entry_date=?, content=? WHERE id=?', [j.entry_date, j.content, id])
}

export function deleteJournal(id: number): void {
  run('DELETE FROM journal WHERE id=?', [id])
}

/** 기한이 다가온 것만 골라 낸다. 알림에 쓴다. */
/* ---------- 달력 일정 ---------- */

export function listEvents(): CalEvent[] {
  return rows<CalEvent>(
    `SELECT id, event_date, end_date, start_time, title, content, color, remind, done
     FROM events ORDER BY event_date, start_time, id`
  )
}

/** 달력 한 화면에 필요한 만큼만. from·to 는 YYYY-MM-DD (양 끝 포함). */
export function listEventsBetween(from: string, to: string): CalEvent[] {
  return rows<CalEvent>(
    `SELECT id, event_date, end_date, start_time, title, content, color, remind, done
     FROM events
     WHERE event_date <= ? AND (CASE WHEN end_date = '' THEN event_date ELSE end_date END) >= ?
     ORDER BY event_date, start_time, id`,
    [to, from]
  )
}

export function addEvent(e: CalEventInput): number {
  run(
    `INSERT INTO events (event_date, end_date, start_time, title, content, color, remind, done)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.event_date,
      e.end_date || e.event_date,
      e.start_time ?? '',
      e.title,
      e.content ?? '',
      e.color || 'blue',
      e.remind ? 1 : 0,
      e.done ? 1 : 0
    ]
  )
  return lastId()
}

export function updateEvent(id: number, patch: Partial<CalEventInput>): void {
  const keys = Object.keys(patch) as (keyof CalEventInput)[]
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  run(`UPDATE events SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k] ?? ''), id])
}

export function deleteEvent(id: number): void {
  run('DELETE FROM events WHERE id = ?', [id])
}

/**
 * 기한으로 챙기라고 해 둔 일정 중 곧 닥치는 것.
 * 절차 기한과 같은 규칙으로 본다. 끝난 것과 알림을 끈 것은 뺀다.
 */
export function dueEvents(withinDays: number): CalEvent[] {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return listEvents().filter((e) => {
    if (e.done === 1 || e.remind !== 1 || !e.event_date) return false
    // 여러 날짜에 걸친 일정은 끝나는 날을 기한으로 본다.
    const target = new Date(`${e.end_date || e.event_date}T00:00:00`)
    if (Number.isNaN(target.getTime())) return false
    const left = Math.round((target.getTime() - midnight.getTime()) / 86400000)
    return left <= withinDays
  })
}

export function dueDeadlines(withinDays: number): Deadline[] {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return listDeadlines().filter((d) => {
    if (d.done === 1 || !d.due_date) return false
    const target = new Date(`${d.due_date}T00:00:00`)
    if (Number.isNaN(target.getTime())) return false
    const left = Math.round((target.getTime() - midnight.getTime()) / 86400000)
    return left <= withinDays
  })
}

/* ---------- 통합 검색 ---------- */

/** 검색어 주변을 잘라 미리보기를 만든다. */
function makeSnippets(text: string, terms: string[], max = 2): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []
  for (const term of terms) {
    let from = 0
    while (out.length < max) {
      const at = lower.indexOf(term, from)
      if (at < 0) break
      const start = Math.max(0, at - 50)
      const end = Math.min(text.length, at + term.length + 70)
      const piece = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
      if (!out.includes(piece)) out.push(piece)
      from = at + term.length
    }
    if (out.length >= max) break
  }
  return out
}

function countOf(haystack: string, term: string): number {
  let n = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(term, from)
    if (at < 0) return n
    n++
    from = at + term.length
  }
}

/**
 * 등록된 업무와 보관된 공문 원문을 한꺼번에 찾는다.
 * 띄어쓰기로 나눈 낱말을 모두 포함하는 것만 결과에 넣는다.
 */
export function searchAll(query: string, limit = 60): SearchHit[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (!terms.length) return []

  const hits: SearchHit[] = []

  for (const t of listTasks()) {
    const title = t.title ?? ''
    const body = `${t.draft_full ?? ''}\n${t.key_points ?? ''}\n${t.workflow ?? ''}`
    const hay = `${title}\n${body}`.toLowerCase()
    if (!terms.every((term) => hay.includes(term))) continue

    // 제목에 걸린 것을 위로 올린다.
    const score = terms.reduce(
      (sum, term) => sum + countOf(hay, term) + countOf(title.toLowerCase(), term) * 5,
      0
    )
    hits.push({
      kind: 'task',
      id: t.id,
      title: title || '(제목 없음)',
      subtitle: t.task_date_display || '수시',
      filename: t.filename ?? '',
      date: '',
      score,
      snippets: makeSnippets(body, terms)
    })
  }

  const docs = rows<{ id: number; filename: string; doc_kind: string; doc_date: string; content: string }>(
    'SELECT id, filename, doc_kind, doc_date, content FROM documents'
  )
  for (const d of docs) {
    const content = d.content ?? ''
    const name = d.filename ?? ''
    const hay = `${name}\n${content}`.toLowerCase()
    if (!terms.every((term) => hay.includes(term))) continue

    const score = terms.reduce(
      (sum, term) => sum + countOf(hay, term) + countOf(name.toLowerCase(), term) * 5,
      0
    )
    hits.push({
      kind: 'document',
      id: d.id,
      title: name,
      subtitle: d.doc_date ? `${d.doc_date} 접수` : d.doc_kind || '문서',
      filename: name,
      date: d.doc_date ?? '',
      score,
      snippets: makeSnippets(content, terms)
    })
  }

  for (const j of listJournal()) {
    const content = j.content ?? ''
    const hay = content.toLowerCase()
    if (!terms.every((term) => hay.includes(term))) continue

    const score = terms.reduce((sum, term) => sum + countOf(hay, term), 0)
    hits.push({
      kind: 'journal',
      id: j.id,
      // 일지는 제목이 없으니 첫 줄을 제목처럼 쓴다.
      title: content.split('\n')[0].slice(0, 60) || '(내용 없음)',
      subtitle: `${j.entry_date} 업무 일지`,
      filename: '',
      date: j.entry_date ?? '',
      score,
      snippets: makeSnippets(content, terms)
    })
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** 도우미가 질문과 관련 있는 자료를 고를 때 걸러 낼 흔한 낱말·조사 */
const CHAT_STOPWORDS = new Set([
  '그리고',
  '그런데',
  '하지만',
  '어떻게',
  '무엇',
  '뭐야',
  '뭔가',
  '알려줘',
  '알려',
  '해줘',
  '있나',
  '있어',
  '관련',
  '대해',
  '대한',
  '경우',
  '어떤',
  '이거',
  '저거',
  '그거'
])

/**
 * 업무 도우미용 근거 찾기.
 * 통합 검색과 달리 낱말을 "모두" 포함할 필요는 없다(OR). 자연스러운 질문에서
 * 관련 있어 보이는 공문·업무·일지를 점수 순으로 골라, 본문째로 돌려준다.
 */
export function retrieveForChat(query: string, limit = 6): { label: string; text: string }[] {
  const terms = query
    .toLowerCase()
    .replace(/[?!.,·…"'`()[\]{}<>]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !CHAT_STOPWORDS.has(t))
  if (!terms.length) return []

  type Scored = { label: string; text: string; score: number }
  const scored: Scored[] = []

  for (const t of listTasks()) {
    const title = t.title ?? ''
    const text = `${title}\n시기: ${t.task_date_display ?? ''}\n${t.draft_full ?? ''}\n${t.key_points ?? ''}\n${t.workflow ?? ''}`
    const hay = text.toLowerCase()
    const score = terms.reduce(
      (s, term) => s + countOf(hay, term) + countOf(title.toLowerCase(), term) * 4,
      0
    )
    if (score > 0) {
      scored.push({ label: `업무: ${title || '(제목 없음)'} (${t.task_date_display || '수시'})`, text, score })
    }
  }

  const docs = rows<{ filename: string; doc_kind: string; doc_date: string; content: string }>(
    'SELECT filename, doc_kind, doc_date, content FROM documents'
  )
  for (const d of docs) {
    const name = d.filename ?? ''
    const content = d.content ?? ''
    const hay = `${name}\n${content}`.toLowerCase()
    const score = terms.reduce(
      (s, term) => s + countOf(hay, term) + countOf(name.toLowerCase(), term) * 4,
      0
    )
    if (score > 0) {
      const when = d.doc_date ? ` (${d.doc_date} 접수)` : ''
      scored.push({ label: `공문: ${name}${when}`, text: `${name}\n${content}`, score })
    }
  }

  for (const j of listJournal()) {
    const content = j.content ?? ''
    const hay = content.toLowerCase()
    const score = terms.reduce((s, term) => s + countOf(hay, term), 0)
    if (score > 0) {
      scored.push({ label: `업무 일지 (${j.entry_date})`, text: content, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ label, text }) => ({ label, text }))
}

/* ---------- 백업 / 복구 ---------- */

/**
 * 인수인계 파일로 내보낸다.
 * 기한 목록에는 학생 이름이 섞여 있을 수 있어, 기본으로는 빼고 내보낸다.
 * API 키를 DB에서 분리한 것과 같은 이유다.
 */
export async function exportTo(targetPath: string, includePersonal = false): Promise<void> {
  if (includePersonal) {
    fs.writeFileSync(targetPath, Buffer.from(need().export()))
    return
  }

  if (!SQL) SQL = await initSqlJs({ wasmBinary: loadWasm() })
  const copy = new SQL.Database(need().export())
  copy.run('DELETE FROM deadlines')
  fs.writeFileSync(targetPath, Buffer.from(copy.export()))
  copy.close()
}

/**
 * 인수인계 파일을 현재 데이터로 불러온다.
 * 덮어쓰기 전에 현재 상태를 backups 폴더에 자동 보관한다.
 */
export async function importFrom(
  sourcePath: string
): Promise<{ tasks: number; notices: number; documents: number }> {
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
  const d = db.exec('SELECT COUNT(*) FROM documents')
  return {
    tasks: t.length ? Number(t[0].values[0][0]) : 0,
    notices: n.length ? Number(n[0].values[0][0]) : 0,
    documents: d.length ? Number(d[0].values[0][0]) : 0
  }
}

export function clearAll(): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.writeFileSync(path.join(backupDir(), `초기화전_${stamp}.db`), Buffer.from(need().export()))
  need().run('DELETE FROM tasks')
  need().run('DELETE FROM notices')
  need().run('DELETE FROM documents')
  need().run('DELETE FROM journal')
  need().run('DELETE FROM events')
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

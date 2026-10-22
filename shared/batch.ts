/**
 * 폴더 일괄 분석 — 학생 결과물이 담긴 폴더를 통째로 읽어 학생별로 항목을 정리하고(엑셀 · CSV), 원하면 세특 · 채점까지.
 * 화면(src/components/FolderBatch.tsx)과 메인(electron/main/batch.ts)이 함께 쓰는 약속.
 *
 * 파일 이름으로 학생을 묶는다: '10107(김선우)_사진1.jpg' · '10107(김선우)_사진2.jpg' 는 한 학생.
 * 학번 · 이름을 찾지 못한 파일은 하위 폴더 이름으로, 그것도 없으면 파일 하나를 한 사람으로 본다.
 */

import type { ModelChoice } from './types'

/** 읽는 파일 형식 */
export const BATCH_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'hwp', 'hwpx', 'docx', 'txt', 'md', 'xlsx', 'xls', 'csv'] as const

/** 폴더 하나에서 읽는 파일 수 · 하위 폴더 깊이 */
export const BATCH_MAX_FILES = 400
export const BATCH_MAX_DEPTH = 3

export type BatchFileKind = 'pdf' | 'image' | 'doc'

export interface BatchFile {
  /** 이번 실행에서만 쓰는 번호 (경로는 화면에 넘기지 않는다) */
  id: string
  name: string
  size: number
  kind: BatchFileKind
}

export interface BatchStudent {
  /** 묶음 열쇠 — 학번+이름, 없으면 파일 · 폴더 이름 */
  key: string
  sid: string
  name: string
  files: BatchFile[]
}

export interface BatchFolder {
  ok: boolean
  /** 고른 폴더 이름 (경로는 넘기지 않는다) */
  folder: string
  students: BatchStudent[]
  /** 읽지 않는 형식이라 뺀 파일 */
  skipped: string[]
  error?: string
}

export interface BatchOptions {
  /** 학생마다 정리할 항목 (엑셀의 열) */
  items: string[]
  /** 항목을 요약해서 쓸지, 학생이 쓴 글을 그대로 옮길지 */
  style: 'summary' | 'verbatim'
  seteuk: boolean
  /** 세특 글자 수 (공백 포함) */
  seteukLength: number
  /** 세특을 쓸 때 따를 지침 (말투 · 과목 · 강조점) */
  seteukGuide: string
  grade: boolean
  /** 채점 기준 */
  rubric: string
  /** 그 밖에 바라는 것 */
  note: string
}

export interface BatchRequest {
  job: string
  /** 이번에 읽을 학생 (다시 하기 · 고른 학생만) */
  students: { key: string; sid: string; name: string; ids: string[] }[]
  options: BatchOptions
  model: ModelChoice | null
}

export interface BatchResult {
  items: Record<string, string>
  score: string
  scoreReason: string
  seteuk: string
  /** AI 가 남긴 말 (읽지 못한 파일 · 불확실한 곳) */
  note: string
  usage?: { input: number; output: number }
}

export interface BatchProgress {
  job: string
  key: string
  status: 'reading' | 'done' | 'error'
  result?: BatchResult
  error?: string
}

export const BATCH_DEFAULT_ITEMS = ['탐구 제목', '탐구 동기', '탐구 내용', '결론 · 느낀 점', '활용한 수학 개념', '희망 진로']

export const BATCH_DEFAULT_GUIDE = `- 학생 이름 · 학번은 쓰지 않는다
- 문장은 '~함.', '~임.', '~보임.' 같은 명사형으로 끝낸다
- 결과물에 실제로 있는 주제 · 개념 · 과정만 쓰고, 없는 활동은 지어내지 않는다
- 탐구 주제와 활용한 개념, 탐구 과정에서 드러난 역량(문제 해결 · 추론 · 의사소통 등)이 보이게 쓴다`

export const BATCH_DEFAULT_OPTIONS: BatchOptions = {
  items: BATCH_DEFAULT_ITEMS,
  style: 'summary',
  seteuk: true,
  seteukLength: 200,
  seteukGuide: BATCH_DEFAULT_GUIDE,
  grade: false,
  rubric: '',
  note: ''
}

const kindOf = (ext: string): BatchFileKind => (ext === 'pdf' ? 'pdf' : /^(png|jpe?g|webp|heic|heif)$/.test(ext) ? 'image' : 'doc')
export const batchKindOf = (fileName: string): BatchFileKind | null => {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return (BATCH_EXTS as readonly string[]).includes(ext) ? kindOf(ext) : null
}

/** 한글 이름 (2~5글자) */
const NAME = '[가-힣]{2,5}'

/**
 * 파일 · 폴더 이름에서 학번 · 이름을 찾는다.
 *  - '10107(김선우)_…' (학교 제출함이 붙이는 꼴)
 *  - '10121 이재욱.pdf' · '10121_이재욱_수학.pdf' · '10121이재욱.hwp'
 *  - '이재욱_10121.pdf' · '이재욱(10121).pdf'
 * 학번은 4~6자리(반이 한 자리면 4자리 — 1101).
 */
export function parseStudent(raw: string): { sid: string; name: string } | null {
  const s = raw.replace(/\.[^.]+$/, '').trim()
  let m = s.match(new RegExp(`^(\\d{4,6})\\s*[(\\[]\\s*(${NAME})\\s*[)\\]]`))
  if (m) return { sid: m[1], name: m[2] }
  m = s.match(new RegExp(`^(\\d{4,6})[\\s_.\\-]*(${NAME})(?![가-힣])`))
  if (m) return { sid: m[1], name: m[2] }
  m = s.match(new RegExp(`^(${NAME})[\\s_.\\-]*[(\\[]?(\\d{4,6})(?!\\d)`))
  if (m) return { sid: m[2], name: m[1] }
  // 학번만 (이름은 문서 안에 있다)
  m = s.match(/^(\d{4,6})(?!\d)/)
  if (m) return { sid: m[1], name: '' }
  return null
}

export interface RawEntry {
  id: string
  name: string
  size: number
  /** 고른 폴더 안의 하위 폴더 이름들 (바깥부터) */
  dirs: string[]
}

/** 파일들을 학생별로 묶는다 — 파일 이름 → 가장 가까운 하위 폴더 이름 → 파일 하나가 한 사람 */
export function groupStudents(entries: RawEntry[]): BatchStudent[] {
  const map = new Map<string, BatchStudent>()
  for (const e of entries) {
    const kind = batchKindOf(e.name)
    if (!kind) continue
    let who = parseStudent(e.name)
    let fallback = ''
    if (!who) {
      for (let i = e.dirs.length - 1; i >= 0 && !who; i--) who = parseStudent(e.dirs[i])
      if (!who && e.dirs.length) fallback = e.dirs[e.dirs.length - 1]
    }
    const key = who ? `${who.sid}|${who.name}` : fallback ? `dir|${fallback}` : `file|${e.dirs.join('/')}/${e.name}`
    let st = map.get(key)
    if (!st) {
      st = { key, sid: who?.sid ?? '', name: who?.name ?? (fallback || e.name.replace(/\.[^.]+$/, '')), files: [] }
      map.set(key, st)
    }
    st.files.push({ id: e.id, name: e.name, size: e.size, kind })
  }
  // 학번만 있는 묶음에 같은 학번의 이름 있는 묶음이 있으면 합친다 ('10121.pdf' + '10121 이재욱.jpg')
  for (const [key, st] of map) {
    if (st.name || !st.sid) continue
    const named = [...map.values()].find((o) => o !== st && o.sid === st.sid && o.name)
    if (named) {
      named.files.push(...st.files)
      map.delete(key)
    }
  }
  const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, 'ko', { numeric: true })
  return [...map.values()]
    .map((s) => ({ ...s, files: s.files.sort(byName) }))
    .sort((a, b) => (a.sid && b.sid ? a.sid.localeCompare(b.sid, 'en', { numeric: true }) : a.sid ? -1 : b.sid ? 1 : byName(a, b)))
}

/** 세특 글자 수 — 나이스처럼 공백 · 줄바꿈도 센다(줄바꿈은 빼고) */
export const seteukLength = (s: string): number => [...s.replace(/\r?\n/g, '')].length

/** 글자 수가 목표에서 이만큼 벗어나면 한 번 고쳐 받는다 */
export const lengthOk = (n: number, target: number): boolean => n >= Math.floor(target * 0.85) && n <= Math.ceil(target * 1.08)

/** AI 에게 주는 지침 */
export function batchSystem(o: BatchOptions): string {
  const items = o.items.map((x) => x.trim()).filter(Boolean)
  return [
    '당신은 고등학교 교사가 학생 한 명이 낸 수행평가 결과물을 정리하도록 돕는 조수입니다.',
    '첨부된 파일(문서 · PDF · 사진)은 모두 한 학생이 낸 것입니다. 사진이 여러 장이면 차례로 이어지는 한 결과물입니다. 같은 내용을 다른 형식으로 두 번 낸 파일이 있을 수도 있습니다.',
    '',
    '## 지킬 것',
    '- 결과물에 실제로 있는 내용만 근거로 씁니다. 없는 활동 · 내용은 지어내지 않습니다.',
    '- 해당 내용이 결과물에 없으면 그 칸은 "(없음)" 으로 씁니다.',
    '- 사진 · 손글씨에서 읽기 어려운 글자는 [불확실: …] 로 남깁니다.',
    '- 양식에 원래 인쇄된 안내 문구 · 예시 문장(예: "회색 안내 문구와 예시는 지우고 작성합니다")은 학생이 쓴 내용이 아니므로 쓰지 않습니다.',
    '',
    '## 정리할 항목',
    ...items.map((x) => `- ${x}`),
    o.style === 'verbatim'
      ? '각 항목은 학생이 쓴 글을 요약하지 말고 그대로 옮겨 씁니다(줄바꿈은 공백으로).'
      : '각 항목은 학생이 쓴 내용을 바탕으로 1~3문장으로 짧게 정리합니다. 학생이 쓴 핵심 용어 · 수식 · 고유명사는 살립니다.',
    ...(o.grade
      ? ['', '## 채점', '아래 기준으로 채점하고, 점수와 근거(어느 부분이 기준의 어디에 해당하는지)를 짧게 씁니다.', o.rubric.trim() || '(기준이 없으면 결과물의 완성도를 상 · 중 · 하 로 매깁니다)']
      : []),
    ...(o.seteuk
      ? [
          '',
          '## 세특 (교과 세부능력 및 특기사항)',
          `- 공백을 포함해 ${o.seteukLength}자 안팎(${Math.floor(o.seteukLength * 0.9)}~${o.seteukLength}자)으로 한 문단으로 씁니다.`,
          ...o.seteukGuide
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => (l.startsWith('-') ? l : `- ${l}`))
        ]
      : []),
    ...(o.note.trim() ? ['', '## 그 밖에', o.note.trim()] : []),
    '',
    '## 답 형식',
    '설명 없이 아래 모양의 JSON 하나만 답합니다. items 의 열쇠는 위 항목 이름을 글자 그대로 씁니다.',
    JSON.stringify(
      {
        items: Object.fromEntries(items.map((x) => [x, '…'])),
        ...(o.grade ? { score: '…', score_reason: '…' } : {}),
        ...(o.seteuk ? { seteuk: '…' } : {}),
        note: '읽지 못한 파일 · 불확실한 곳이 있으면 짧게, 없으면 빈 문자열'
      },
      null,
      2
    )
  ].join('\n')
}

/** 세특 글자 수를 맞춰 달라고 다시 부탁하는 말 */
export function seteukFixText(text: string, target: number): string {
  const n = seteukLength(text)
  const ask = [
    `아래 세특은 공백 포함 ${n}자입니다. 내용과 말투는 그대로 두고 공백 포함 ${Math.floor(target * 0.9)}~${target}자로 ${n > target ? '줄여' : '늘려'} 주세요.`,
    n < target ? '늘릴 때도 결과물에 없는 내용은 더하지 말고, 이미 있는 탐구 과정 · 개념을 조금 더 구체적으로 씁니다.' : '',
    '설명 없이 고친 세특 글만 답합니다.'
  ].filter(Boolean)
  return `${ask.join('\n')}\n\n${text}`
}

/** 모델 답에서 JSON 을 꺼낸다 (```json 울타리 · 앞뒤 말 허용) */
export function parseBatchAnswer(text: string, items: string[]): BatchResult {
  const t = text.trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 답에서 결과(JSON)를 찾지 못했습니다.')
  let d: Record<string, unknown>
  try {
    d = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('AI 답의 결과(JSON)가 깨져 있습니다.')
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  const raw = (d.items && typeof d.items === 'object' ? d.items : {}) as Record<string, unknown>
  // 열쇠를 조금 다르게 써 왔으면(띄어쓰기 · 가운뎃점) 맞춰 준다
  const norm = (s: string): string => s.replace(/[\s·・,./()]/g, '')
  const out: Record<string, string> = {}
  for (const it of items) {
    const k = it in raw ? it : Object.keys(raw).find((x) => norm(x) === norm(it))
    out[it] = k ? str(raw[k]) : ''
  }
  return { items: out, score: str(d.score), scoreReason: str(d.score_reason), seteuk: str(d.seteuk).replace(/\s*\n+\s*/g, ' '), note: str(d.note) }
}

export interface BatchRow {
  sid: string
  name: string
  files: string[]
  result?: BatchResult
  error?: string
}

/** 결과 표의 머리글과 행 — 엑셀 · CSV · 화면이 함께 쓴다 */
export function batchTable(rows: BatchRow[], o: BatchOptions): { header: string[]; rows: string[][] } {
  const items = o.items.map((x) => x.trim()).filter(Boolean)
  const header = ['학번', '이름', ...items, ...(o.grade ? ['점수', '채점 근거'] : []), ...(o.seteuk ? ['세특', '세특 글자 수'] : []), '파일', '비고']
  const body = rows.map((r) => [
    r.sid,
    r.name,
    ...items.map((x) => r.result?.items[x] ?? ''),
    ...(o.grade ? [r.result?.score ?? '', r.result?.scoreReason ?? ''] : []),
    ...(o.seteuk ? [r.result?.seteuk ?? '', r.result?.seteuk ? String(seteukLength(r.result.seteuk)) : ''] : []),
    r.files.join(', '),
    r.error ? `오류: ${r.error}` : (r.result?.note ?? '')
  ])
  return { header, rows: body }
}

/** CSV (엑셀이 한글을 바로 알아보게 BOM 을 붙인다) */
export function toCsv(header: string[], rows: string[][]): string {
  const cell = (v: string): string => {
    // 수식으로 읽히지 않게 (=, +, -, @ 로 시작하는 칸)
    const s = /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`
}

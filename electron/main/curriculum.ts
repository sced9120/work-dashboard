/**
 * 2022 개정 교육과정 성취기준 찾기 (3.8.0~).
 *
 * 자료(약 2MB)는 처음 찾을 때 한 번만 읽는다 — 앱을 켤 때 느려지지 않게 따로 떨어진 묶음으로 둔다.
 * 인터넷을 쓰지 않는다.
 */
import type { CurriculumCheck, CurriculumQuery, CurriculumResult, CurriculumSubject, Standard, StandardRow } from '../../shared/curriculum'
import { checkCodes, normCode, rowToStandard, searchStandards, subjectsOf } from '../../shared/curriculum'

interface Loaded {
  list: Standard[]
  known: Set<string>
  subjects: CurriculumSubject[]
  meta: { version: string; commit: string }
}

let loading: Promise<Loaded> | null = null

function load(): Promise<Loaded> {
  if (!loading) {
    loading = import('./data/curriculum2022.json')
      .then((m) => {
        const data = (m.default ?? m) as unknown as { meta: { version: string; commit: string }; rows: StandardRow[] }
        const list = data.rows.map(rowToStandard)
        return { list, known: new Set(list.map((s) => normCode(s.code))), subjects: subjectsOf(list), meta: data.meta }
      })
      .catch((e) => {
        loading = null
        throw e
      })
  }
  return loading
}

export async function curriculumSubjects(): Promise<{ subjects: CurriculumSubject[]; total: number; version: string }> {
  const d = await load()
  return { subjects: d.subjects, total: d.list.length, version: d.meta.version }
}

export async function curriculumSearch(q: CurriculumQuery): Promise<CurriculumResult> {
  const d = await load()
  return searchStandards(d.list, {
    level: q?.level === '초' || q?.level === '중' || q?.level === '고' ? q.level : '',
    group: typeof q?.group === 'string' ? q.group.slice(0, 40) : '',
    subject: typeof q?.subject === 'string' ? q.subject.slice(0, 80) : '',
    q: typeof q?.q === 'string' ? q.q.slice(0, 200) : '',
    limit: Number(q?.limit) || 200
  })
}

export async function curriculumGet(keys: string[]): Promise<Standard[]> {
  const d = await load()
  const want = new Set((Array.isArray(keys) ? keys : []).slice(0, 500).map((k) => normCode(String(k))))
  return d.list.filter((s) => want.has(normCode(s.key)) || want.has(normCode(s.code)))
}

export async function curriculumCheck(text: string): Promise<CurriculumCheck> {
  const d = await load()
  return checkCodes(String(text ?? '').slice(0, 200000), d.known)
}

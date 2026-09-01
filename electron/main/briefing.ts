/**
 * 인수인계 브리핑.
 *
 * 프로그램에 쌓인 것을 모아 **사람이 읽는 한 편의 글**로 엮는다.
 *
 * 지금까지는 다음 담당자에게 .db 파일 하나를 건네주고 "열어 보세요" 하는 것이
 * 전부였다. 받은 사람은 업무 400건과 공문 346건 앞에서 어디부터 봐야 할지
 * 알 수 없다. 이 글이 그 첫 장이 된다.
 *
 * AI를 쓰지 않는다. 이미 적어 둔 것을 차례대로 엮을 뿐이라 공짜이고 즉시 나오며,
 * 인터넷이 막힌 학교 컴퓨터에서도 된다.
 */

import type { Task, Workflow } from '../../shared/types'
import { schoolYearLabel } from '../../shared/types'
import * as db from './db'
import { monthOrder, monthOf, weekOf } from '../../shared/schedule'

export interface BriefingInput {
  /** 이 학년도의 자료만 담는다. 0 이면 전부 */
  year: number
  /** 넘겨주는 사람 이름 (선택) */
  from: string
  /** 받는 사람 이름 (선택) */
  to: string
}

function line(n = 60): string {
  return '─'.repeat(n)
}

function heading(no: number, title: string): string {
  return `\n${no}. ${title}\n${line()}`
}

/** "3월 1주" 를 앞에 세워 시기 순으로 늘어놓는다 */
function byTime(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const om = monthOrder(monthOf(a.task_date_display)) - monthOrder(monthOf(b.task_date_display))
    if (om !== 0) return om
    const ow = weekOf(a.task_date_display) - weekOf(b.task_date_display)
    if (ow !== 0) return ow
    return a.title.localeCompare(b.title, 'ko')
  })
}

/** 그림으로 그린 워크플로우를 글로 편다 */
function flowToText(wf: Workflow): string {
  if (!wf.nodes.length) return ''
  const name = new Map(wf.nodes.map((n) => [n.id, n.text.replace(/\s+/g, ' ').trim()]))
  const out: string[] = []

  // 들어오는 화살표가 없는 상자를 시작으로 본다
  const hasIncoming = new Set(wf.edges.map((e) => e.to))
  const starts = wf.nodes.filter((n) => !hasIncoming.has(n.id))
  const seen = new Set<string>()

  const walk = (id: string, depth: number): void => {
    if (seen.has(id) || depth > 40) return
    seen.add(id)
    out.push(`${'   '.repeat(Math.min(depth, 6))}${depth === 0 ? '▶' : '└'} ${name.get(id) ?? ''}`)
    for (const e of wf.edges.filter((x) => x.from === id)) {
      if (e.label.trim()) out.push(`${'   '.repeat(Math.min(depth + 1, 6))}  (${e.label.trim()})`)
      walk(e.to, depth + 1)
    }
  }

  for (const s of starts) walk(s.id, 0)
  // 화살표로 이어지지 않은 외톨이 상자도 빠뜨리지 않는다
  for (const n of wf.nodes) if (!seen.has(n.id)) out.push(`▶ ${name.get(n.id) ?? ''}`)
  return out.join('\n')
}

/**
 * 인수인계서 초안을 짠다.
 *
 * 자료가 없는 자리는 지어내지 않고 "(적어 주세요)" 로 남긴다.
 * 넘겨주는 사람이 마지막에 손으로 채워야 할 곳이 어디인지 보이게 하려는 것이다.
 */
export function buildBriefing(input: BriefingInput): string {
  const job = db.getSetting('job_title', '') || '담당 업무'
  const school = db.getSetting('school_name', '')
  const roster = db.getSetting('duty_roster', '')
  const today = new Date()
  const stamp = `${today.getFullYear()}. ${today.getMonth() + 1}. ${today.getDate()}.`

  const all = db.listTasks()
  const tasks = input.year ? all.filter((t) => t.school_year === input.year) : all
  const docs = db.listDocs()
  const yearDocs = input.year ? docs.filter((d) => d.school_year === input.year) : docs

  const out: string[] = []

  /* ── 표지 ── */
  out.push(line(70))
  out.push(`  ${job} 업무 인수인계서`)
  if (school) out.push(`  ${school}`)
  out.push(`  ${input.year ? schoolYearLabel(input.year) + ' · ' : ''}${stamp}`)
  out.push(line(70))
  out.push('')
  out.push(`  인계자 : ${input.from || '(   )'}`)
  out.push(`  인수자 : ${input.to || '(   )'}`)
  out.push('')

  /* ── 1. 이 업무는 ── */
  out.push(heading(1, '이 업무는 어떤 일인가'))
  out.push('')
  out.push('(이 업무를 처음 맡는 사람에게 한 문단으로 설명해 주세요.)')
  out.push('')
  if (roster.trim()) {
    out.push('업무분장표에 적힌 내용:')
    out.push(
      roster
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((s) => `  · ${s}`)
        .join('\n')
    )
    out.push('')
  }
  out.push(`한 해 동안 처리한 일 : ${tasks.length}건`)
  out.push(`보관된 공문 원문     : ${yearDocs.length}건`)

  /* ── 2. 연간 흐름 ── */
  out.push(heading(2, '한 해가 이렇게 돌아갑니다'))
  const months = new Map<number, Task[]>()
  for (const t of tasks) {
    const m = monthOf(t.task_date_display)
    if (!months.has(m)) months.set(m, [])
    months.get(m)!.push(t)
  }
  const ordered = [...months.keys()].sort((a, b) => monthOrder(a) - monthOrder(b))
  if (!ordered.length) {
    out.push('\n(등록된 업무가 없습니다.)')
  } else {
    for (const m of ordered) {
      const label = m === 99 ? '수시 · 시기 미정' : `${m}월`
      out.push(`\n[${label}]`)
      for (const t of byTime(months.get(m)!)) {
        out.push(`  · ${t.task_date_display} ${t.title}`)
      }
    }
  }

  /* ── 3. 업무별 워크플로우 ── */
  out.push(heading(3, '업무별 진행 순서'))
  const flows = db.settingsByPrefix('wf:')
  const notes = db.settingsByPrefix('flow:')
  if (!flows.length && !notes.length) {
    out.push('\n(정리해 둔 흐름도가 없습니다. [업무 워크플로우]에서 그려 두면 여기 실립니다.)')
  }
  for (const row of flows) {
    const topic = row.key.slice(3)
    let text = ''
    try {
      text = flowToText(JSON.parse(row.value) as Workflow)
    } catch {
      text = ''
    }
    if (!text) continue
    out.push(`\n▣ ${topic}`)
    out.push(text)
  }
  for (const row of notes) {
    const topic = row.key.slice(5)
    if (!row.value.trim()) continue
    out.push(`\n▣ ${topic} — 적어 둔 흐름`)
    out.push(
      row.value
        .split('\n')
        .map((s) => `  ${s}`)
        .join('\n')
    )
  }

  /* ── 4. 겪어 보고 아는 요령 ── */
  out.push(heading(4, '겪어 보고 아는 것 · 주의할 점'))
  const points = tasks.filter((t) => t.key_points.trim())
  if (!points.length) {
    out.push('\n(적어 둔 유의사항이 없습니다.)')
  } else {
    for (const t of points.slice(0, 60)) {
      out.push(`\n· ${t.title}`)
      out.push(
        t.key_points
          .split('\n')
          .map((s) => `    ${s.trim()}`)
          .filter((s) => s.trim())
          .join('\n')
      )
    }
    if (points.length > 60) out.push(`\n… 그 밖에 ${points.length - 60}건이 더 있습니다.`)
  }

  /* ── 5. 절차와 기한 ── */
  out.push(heading(5, '놓치면 안 되는 기한'))
  const withFlow = tasks.filter((t) => t.workflow.trim())
  if (!withFlow.length) {
    out.push('\n(적어 둔 절차가 없습니다.)')
  } else {
    for (const t of byTime(withFlow).slice(0, 40)) {
      out.push(`\n· [${t.task_date_display}] ${t.title}`)
      out.push(
        t.workflow
          .split('\n')
          .map((s) => `    ${s.trim()}`)
          .filter((s) => s.trim())
          .join('\n')
      )
    }
  }

  /* ── 6. 공문 목록 ── */
  out.push(heading(6, '보관된 공문'))
  if (!yearDocs.length) {
    out.push('\n(보관된 공문이 없습니다.)')
  } else {
    out.push('\n프로그램의 [통합 검색]에서 원문을 그대로 찾아볼 수 있습니다.\n')
    const sorted = [...yearDocs].sort((a, b) => (a.doc_date || '9999').localeCompare(b.doc_date || '9999'))
    for (const d of sorted.slice(0, 200)) {
      out.push(`  ${(d.doc_date || '날짜미상').padEnd(12)} ${d.filename}`)
    }
    if (sorted.length > 200) out.push(`\n  … 그 밖에 ${sorted.length - 200}건`)
  }

  /* ── 7. 손으로 채울 곳 ── */
  out.push(heading(7, '자료가 있는 곳 · 협조 부서'))
  out.push('')
  out.push('  문서함 / 공유 폴더 : (   )')
  out.push('  나이스 메뉴        : (   )')
  out.push('  협조 부서와 담당자 : (   )')
  out.push('  외부 기관 연락처   : (   )')
  out.push('')

  out.push(heading(8, '넘겨주는 사람이 꼭 하고 싶은 말'))
  out.push('')
  out.push('  (   )')
  out.push('')
  out.push(line(70))
  out.push('  이 문서는 업무 인수인계 대시보드가 자동으로 엮은 초안입니다.')
  out.push('  빈칸을 채우고 손봐서 넘겨주세요.')
  out.push(line(70))

  return out.join('\n')
}

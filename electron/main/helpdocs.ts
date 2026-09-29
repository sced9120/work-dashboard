/**
 * 학교업무 도움자료 목록을 들고 있다가 화면·검색·도우미에 내준다.
 * 목록 자체는 helpdocs.json (shared/helpdocs.ts 설명 참고). 사용자 자료가 아니라서 DB 에 넣지 않는다 —
 * 프로그램이 새 버전으로 바뀌면 목록도 함께 바뀌고, 인수인계 파일에는 "내 업무"로 고른 id 만 넘어간다.
 */

import raw from './helpdocs.json'
import type { HelpCatalog, HelpHit, HelpIndex, HelpMatch } from '../../shared/helpdocs'
import {
  LEVEL_KEY,
  MY_HELP_KEY,
  buildIndex,
  findItem,
  helpSourceText,
  matchDuties,
  parseMine,
  retrieveHelp,
  searchHelp
} from '../../shared/helpdocs'
import * as db from './db'

const catalog = raw as HelpCatalog
let index: HelpIndex | null = null

function ix(): HelpIndex {
  if (!index) index = buildIndex(catalog)
  return index
}

export function helpCatalog(): HelpCatalog {
  return catalog
}

function profile(): { level: string; mine: string[] } {
  return { level: db.getSetting(LEVEL_KEY, ''), mine: parseMine(db.getSetting(MY_HELP_KEY, '[]')) }
}

/** 적은 내 업무(여러 줄)에 맞는 도움자료. 학교급은 화면에서 막 고른 것을 쓴다(아직 저장 전일 수 있다). */
export function helpMatch(text: string, level: string): HelpMatch[] {
  return matchDuties(ix(), text, level)
}

export function helpSearch(query: string, limit = 15): HelpHit[] {
  const { level, mine } = profile()
  return searchHelp(ix(), query, level, mine, Math.max(1, Math.min(200, limit)))
}

/** 도우미에 실을 도움자료. label 은 근거 목록에 그대로 보인다. */
export function helpForChat(question: string, limit = 3): { label: string; text: string; url: string; title: string }[] {
  const { level, mine } = profile()
  return retrieveHelp(ix(), question, level, mine, limit).flatMap((h) => {
    const found = findItem(catalog, h.id)
    if (!found) return []
    return [
      {
        label: `도움자료: ${h.group} › ${h.title}`,
        text: helpSourceText(found.item, h),
        url: h.url,
        title: h.title
      }
    ]
  })
}

/** 도우미가 담당자의 일을 알 수 있게 "내 업무"로 고른 것의 이름을 한 줄로 */
export function myHelpLine(): string {
  const { mine } = profile()
  const names = mine.flatMap((id) => {
    const f = findItem(catalog, id)
    return f ? [f.item.title.replace(/^[\d-]+\.\s*/, '')] : []
  })
  return names.join(', ')
}

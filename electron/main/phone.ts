/**
 * 폰 연결 — 폰에서 온 수업 관찰 · 출결을 제자리에 넣고, 폰에 보일 판(활동 · 반 · 번호 범위)을 만든다.
 * 우편함과 주고받는 것은 messenger.ts(relayPull) 가 하고, 여기서는 넣기만 한다.
 */

import { ATT_RECORDS_KEY, ATT_REASONS, ATT_ROSTER_KEY, ATT_TYPES, defaultProof, readRecords, readRoster, upsertRecords } from '../../shared/attendance'
import type { AttReason, AttRecord, AttType } from '../../shared/attendance'
import { createCipheriv, randomBytes } from 'node:crypto'
import { b64u, buildBoard, buildNames } from '../../shared/relay'
import type { PhoneBoard, PhoneNames, RelayAtt, RelayItem, RelayObs, RelayText } from '../../shared/relay'
import { SETEUK_MODES, groupOf, modeOfRec, studentLabel } from '../../shared/seteuk'
import * as db from './db'
import { seteukActs, seteukAddObs, seteukRosterOf } from './seteuk'

/** 폰에 보일 판(이름 없음)과 이름표(잠가서 따로 올림) */
export function phoneBoard(): { board: PhoneBoard; names: PhoneNames } {
  const rosters: Record<string, { id: string; cls: string; no: string; group: string }[]> = {}
  const people: { id: string; label: string; name: string }[] = []
  for (const m of SETEUK_MODES) {
    const list = seteukRosterOf(m.key)
    rosters[m.key] = list.map((s) => ({ id: s.id, cls: s.cls, no: s.no, group: groupOf(s) }))
    for (const s of list) people.push({ id: s.id, label: studentLabel(s), name: s.name })
  }
  const acts = seteukActs().map((a) => ({ id: a.id, name: a.name, mode: modeOfRec(a.rec) }))
  const hr = readRoster(db.getSetting(ATT_ROSTER_KEY, ''))
  const board = buildBoard(rosters, acts, hr.students.length ? { cls: hr.cls, nos: hr.students.map((s) => s.no) } : null)
  return { board, names: buildNames(board, people, hr.students) }
}

/**
 * 이름표 잠그기 — AES-256-GCM, 12바이트 IV. 나오는 것은 base64url(iv | 잠근 글 | tag 16바이트).
 * 폰의 crypto.subtle.decrypt 는 '잠근 글 뒤에 tag' 를 그대로 받는다. 열쇠(base64url 32바이트)는 폰 주소의 # 뒤에만 있다.
 */
export function sealNames(plain: string, nkey: string, iv: Uint8Array = new Uint8Array(randomBytes(12))): string {
  const key = Buffer.from(nkey, 'base64url')
  if (key.length !== 32) throw new Error('이름표 열쇠 모양이 맞지 않습니다.')
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return b64u(new Uint8Array(Buffer.concat([Buffer.from(iv), ct, c.getAuthTag()])))
}

/** 폰 출결 기록의 id — 손으로 넣은 기록과 가른다 */
const phoneId = (r: { day: string; no: number; type: string }): string => `ph-${r.day}-${r.no}-${r.type}`

/**
 * 폰에서 온 출결을 출결 기록에 넣는다.
 * 같은 날 · 같은 학생의 폰 기록은 새것으로 바꾼다(결석을 지각으로 고쳐 보낸 경우). 손으로 넣은 기록은 건드리지 않는다.
 * '지움' 은 그 날 그 학생의 폰 기록을 지운다. 명단에 없는 번호는 missed.
 */
export function attAddFromPhone(list: RelayAtt[]): { added: number; removed: number; missed: RelayAtt[] } {
  const roster = readRoster(db.getSetting(ATT_ROSTER_KEY, ''))
  let records = readRecords(db.getSetting(ATT_RECORDS_KEY, '[]'))
  const missed: RelayAtt[] = []
  let added = 0
  let removed = 0
  for (const a of list) {
    if (!roster.students.some((s) => s.no === a.no)) {
      missed.push(a)
      continue
    }
    const before = records.length
    records = records.filter((r) => !(r.id.startsWith('ph-') && r.date === a.day && r.no === a.no))
    if (a.type === '지움') {
      removed += before - records.length
      continue
    }
    if (!(ATT_TYPES as readonly string[]).includes(a.type)) {
      missed.push(a)
      continue
    }
    const reason: AttReason = (ATT_REASONS as readonly string[]).includes(a.reason) ? (a.reason as AttReason) : '기타'
    const rec: AttRecord = { id: phoneId(a), date: a.day, no: a.no, type: a.type as AttType, reason, note: a.text.slice(0, 200), proof: defaultProof(reason), neis: false }
    records = upsertRecords(records, [rec])
    added++
  }
  if (added || removed) db.setSetting(ATT_RECORDS_KEY, JSON.stringify(records))
  return { added, removed, missed }
}

export interface RouteResult {
  /** 받은 글함으로 갈 것 (글 · 넣지 못한 관찰 · 출결) */
  inbox: RelayText[]
  obs: number
  att: number
  /** 관찰이 붙은 활동 id */
  acts: string[]
}

/** 가져온 것을 나눠 넣는다 */
export function routeRelay(items: RelayItem[]): RouteResult {
  const text = items.filter((x): x is RelayText => x.kind === 'text')
  const obs = items.filter((x): x is RelayObs => x.kind === 'obs')
  const att = items.filter((x): x is RelayAtt => x.kind === 'att')
  const o = obs.length ? seteukAddObs(obs) : { added: 0, acts: [] as string[], missed: [] as RelayObs[] }
  const a = att.length ? attAddFromPhone(att) : { added: 0, removed: 0, missed: [] as RelayAtt[] }
  const acts = seteukActs()
  const inbox: RelayText[] = [
    ...text,
    ...(o.missed as RelayObs[]).map((x) => ({
      kind: 'text' as const,
      id: x.id,
      t: x.t,
      text: `[폰 수업 관찰 · 넣을 곳을 찾지 못함] ${acts.find((y) => y.id === x.act)?.name ?? '지운 활동'} ${x.no ? `${x.cls}반 ${x.no}번` : `학생 ${x.sid ?? ''}`}${x.group ? ` · ${x.group}` : ''} (${x.day})\n${x.text}`
    })),
    ...a.missed.map((x) => ({
      kind: 'text' as const,
      id: x.id,
      t: x.t,
      text: `[폰 출결 · 명단에 없는 번호] ${x.day} ${x.no}번 ${x.type} (${x.reason})${x.text ? ` — ${x.text}` : ''}`
    }))
  ]
  return { inbox, obs: o.added, att: a.added + a.removed, acts: o.acts }
}

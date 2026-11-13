/**
 * 폰에서 적으면 PC 로 — 선생님 구글 계정의 Apps Script 웹 앱 하나를 우편함으로 쓴다.
 *
 *  폰: 웹 앱 주소(?k=열쇠)를 홈 화면에 두고 쓴다 (화면은 relayPage.ts).
 *      · 수업 관찰 — 번호를 눌러 본 것을 적는다 → 세특 작성실 관찰 기록
 *      · 출결      — 담임 반 번호를 눌러 결석 · 지각 · 조퇴 · 결과 → 출결 기록
 *      · 글 보내기 — 메신저 · 카톡 글 → [메신저 정리] 의 '폰에서 온 글'
 *  PC: 몇 분마다 같은 주소에 op=pull 로 가져오고 op=ack 로 지운다. op=board 로 폰에 보일 활동 · 반 · 번호 범위를 올린다.
 *
 * 구글 로그인 연동 · 앱 심사가 없다(스크립트는 선생님 계정에서 '나로 실행'). 열쇠를 모르면 읽지도 쓰지도 못한다.
 * 글은 PC 가 가져가면 바로 지운다. 안 가져간 글은 14일 뒤 스스로 지운다.
 *
 * 학생 이름 · 학번: PC 가 AES-256-GCM 으로 잠근 '이름표' 만 우편함에 간다. 여는 열쇠는 폰 주소의 '#n=…' 에만 있다
 * (# 뒤는 브라우저가 서버로 보내지 않는다). 그래서 구글에는 못 읽는 글만 있고, 폰 화면이 crypto.subtle 로 푼다.
 * 판(board)에는 활동 이름 · 수업반 이름 · 학생 id('반-번호')만 있다.
 */
import { PHONE_PAGE } from './relayPage'

/** 2 — 수업 관찰 · 출결 · 폰 판(board). 1 은 글 보내기만 */
export const RELAY_VERSION = 2

/** 열쇠 — 주소에 붙여 쓰므로 영문 · 숫자만 */
export function newRelayKey(rand: (n: number) => Uint8Array): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return [...rand(24)].map((b) => abc[b % abc.length]).join('')
}

/** base64url (= 없음) */
export function b64u(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 이름표 열쇠 — AES-256 (32바이트) 를 base64url 43자로 */
export function newNameKey(rand: (n: number) => Uint8Array): string {
  return b64u(rand(32))
}

export const isNameKey = (v: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(v)

/** 우편함 속성 하나는 9KB 까지 — 주소에 실어 보내므로 '주소에 쓴 길이' 로 이만큼씩 나눈다 */
export const PART_MAX = 6000

/** 글을 주소에 실을 조각들로 — 한 조각의 encodeURIComponent 길이가 max 를 넘지 않게 (글자 중간을 자르지 않음) */
export function splitParts(text: string, max = PART_MAX): string[] {
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of text) {
    const n = encodeURIComponent(ch).length
    if (len + n > max && cur) {
      out.push(cur)
      cur = ''
      len = 0
    }
    cur += ch
    len += n
  }
  out.push(cur)
  return out
}

/** Apps Script 쪽 코드 — String.raw 라 역슬래시가 그대로 간다. 열쇠 · 화면은 아래에서 끼운다 */
const SCRIPT = String.raw`/**
 * 오르빗 — 폰에서 보내기 · 수업 관찰 · 출결 (v__VER__)
 * 선생님 구글 계정에만 있는 우편함입니다. 폰에서 보낸 것을 PC 의 오르빗이 가져가면 바로 지웁니다.
 * 아래 KEY 는 오르빗이 만든 열쇠입니다. 남에게 주소를 알려 주지 마세요.
 * 학생 이름 · 학번은 오르빗이 잠근 글(names)로만 옵니다. 여는 열쇠는 폰 주소의 # 뒤에만 있어 여기서는 읽을 수 없습니다.
 */
var KEY = '__RELAYKEY__';
var VER = __VER__;
var KEEP_DAYS = 14;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.k !== KEY) return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">주소가 맞지 않습니다.</p>');
  if (p.op === 'pull') return out_({ ok: true, v: VER, items: list_() });
  if (p.op === 'ack') { ack_(String(p.ids || '').split(',')); return out_({ ok: true, v: VER }); }
  if (p.op === 'ping') return out_({ ok: true, v: VER, n: list_().length });
  if (p.op === 'put') return out_(putPart_(p.name, p.i, p.n, p.b));
  var boot = JSON.stringify({ k: KEY, tab: String(p.tab || ''), board: board_(), names: joined_('names') }).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(PAGE.replace('__BOOT__', function () { return boot; }))
    .setTitle('오르빗')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 폰 화면에서 부른다 (google.script.run) — 메신저 · 카톡 글 */
function send(k, text) {
  if (k !== KEY) throw new Error('주소가 맞지 않습니다.');
  text = String(text || '').trim().slice(0, 8000);
  if (!text) throw new Error('보낼 글이 없습니다.');
  return put_({ text: text });
}

/** 폰 화면에서 부른다 — 수업 관찰 · 출결 한 건 */
function sendItem(k, it) {
  if (k !== KEY) throw new Error('주소가 맞지 않습니다.');
  it = it || {};
  var day = /^\d{4}-\d{2}-\d{2}$/.test(String(it.d)) ? String(it.d) : '';
  var n = Math.floor(Number(it.n));
  var s = it.kind === 'obs' ? String(it.s || '').slice(0, 80) : '';
  if (!day || !((n >= 1 && n <= 99) || s)) throw new Error('날짜나 번호가 맞지 않습니다.');
  var x = String(it.x || '').trim();
  if (it.kind === 'obs') {
    if (!x) throw new Error('적은 내용이 없습니다.');
    return put_({ kind: 'obs', a: String(it.a || '').slice(0, 60), s: s, g: String(it.g || '').slice(0, 30), c: String(it.c || '').slice(0, 12), n: n >= 1 && n <= 99 ? n : 0, d: day, x: x.slice(0, 2000) });
  }
  if (it.kind === 'att') return put_({ kind: 'att', ty: String(it.ty || '').slice(0, 4), r: String(it.r || '').slice(0, 6), n: n, d: day, x: x.slice(0, 200) });
  throw new Error('알 수 없는 종류입니다.');
}

function put_(m) {
  var id = new Date().getTime() + '-' + Math.floor(Math.random() * 1e6);
  m.id = id;
  m.t = new Date().getTime();
  PropertiesService.getScriptProperties().setProperty('m_' + id, JSON.stringify(m));
  return list_().length;
}

function list_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var items = [];
  var old = new Date().getTime() - KEEP_DAYS * 86400000;
  for (var k in all) {
    if (k.indexOf('m_') !== 0) continue;
    try {
      var it = JSON.parse(all[k]);
      if (it.t < old) { props.deleteProperty(k); continue; }
      items.push(it);
    } catch (err) { props.deleteProperty(k); }
  }
  items.sort(function (a, b) { return a.t - b.t; });
  return items;
}

function ack_(ids) {
  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < ids.length; i++) if (/^[0-9]+-[0-9]+$/.test(ids[i])) props.deleteProperty('m_' + ids[i]);
}

/**
 * PC 가 올리는 것 — 판(board: 활동 · 수업반 · 학생 id, 이름 없음) 과 이름표(names: 잠근 글).
 * 속성 하나에 9KB 까지라 조각(i / n)으로 받는다. 마지막 조각을 받으면 몇 조각인지 적고 남은 옛 조각을 지운다.
 */
function putPart_(name, i, n, b) {
  if (name !== 'board' && name !== 'names') return { ok: false, v: VER, error: '알 수 없는 이름입니다.' };
  i = Math.floor(Number(i)); n = Math.floor(Number(n)); b = String(b || '');
  if (!(n >= 1 && n <= 20 && i >= 0 && i < n) || b.length > 8500) return { ok: false, v: VER, error: '조각이 맞지 않습니다.' };
  if (name === 'names' && b && !/^[A-Za-z0-9_-]+$/.test(b)) return { ok: false, v: VER, error: '이름표 모양이 아닙니다.' };
  var props = PropertiesService.getScriptProperties();
  props.setProperty('y_' + name + '_' + i, b);
  if (i < n - 1) return { ok: true, v: VER };
  var all = '', got = [];
  for (var j = 0; j < n; j++) { got.push(props.getProperty('y_' + name + '_' + j) || ''); all += got[j]; }
  for (var q = 0; q < 20; q++) props.deleteProperty('y_' + name + '_' + q);
  if (name === 'board') { try { JSON.parse(all); } catch (err) { return { ok: false, v: VER, error: '판을 읽지 못했습니다.' }; } }
  // 다 받은 뒤에만 바꿔 끼운다 — 망가진 판이 와도 폰에는 앞 판이 남는다
  for (var w = 0; w < n; w++) props.setProperty('x_' + name + '_' + w, got[w]);
  props.setProperty('x_' + name + '_n', String(n));
  for (var k = n; k < 20; k++) props.deleteProperty('x_' + name + '_' + k);
  return { ok: true, v: VER };
}

function joined_(name) {
  var props = PropertiesService.getScriptProperties();
  var n = Math.floor(Number(props.getProperty('x_' + name + '_n') || 0));
  var all = '';
  for (var j = 0; j < n && j < 20; j++) all += props.getProperty('x_' + name + '_' + j) || '';
  return all;
}

function board_() {
  try { return JSON.parse(joined_('board') || 'null'); } catch (err) { return null; }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

var PAGE = __PAGE__;
`

/** Apps Script 에 붙여 넣을 코드 (Code.gs 하나) */
export function relayScript(key: string): string {
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) throw new Error('열쇠 모양이 맞지 않습니다.')
  return SCRIPT.replace(/__VER__/g, String(RELAY_VERSION))
    .replace('__RELAYKEY__', key)
    .replace('__PAGE__', () => JSON.stringify(PHONE_PAGE))
}

/** 웹 앱 주소인지 (배포 → 웹 앱 URL) */
export function normalizeRelayUrl(v: string): string {
  const s = v.trim().replace(/[?#].*$/, '')
  return /^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(s) ? s : ''
}

/**
 * 폰에서 열 주소 — tab 을 주면 그 탭으로 연다(수업 관찰 obs · 출결 att · 글 보내기 text).
 * nkey(이름표 열쇠)는 # 뒤에 — 브라우저가 서버(구글)로 보내지 않는 자리라 tab 보다 뒤에 온다.
 */
export function phoneUrl(url: string, key: string, tab = '', nkey = ''): string {
  return `${url}?k=${encodeURIComponent(key)}${tab ? `&tab=${tab}` : ''}${nkey ? `#n=${nkey}` : ''}`
}

/* ---------- 받은 것 ---------- */

export interface RelayText {
  kind: 'text'
  id: string
  t: number
  text: string
}
export interface RelayObs {
  kind: 'obs'
  id: string
  t: number
  /** 활동 id · 반 · 번호 · 날짜 · 적은 것 */
  act: string
  /** 세특 학생 id — 있으면 이것으로 찾는다 (없으면 반 · 번호) */
  sid?: string
  /** 폰에서 고른 수업반 */
  group?: string
  cls: string
  /** 모르면 0 (sid 로 찾는다) */
  no: number
  day: string
  text: string
}
export interface RelayAtt {
  kind: 'att'
  id: string
  t: number
  no: number
  day: string
  /** 결석 · 지각 · 조퇴 · 결과, 또는 '지움'(그 날 그 학생의 폰 출결을 지운다) */
  type: string
  reason: string
  text: string
}
export type RelayItem = RelayText | RelayObs | RelayAtt

const DAY = /^\d{4}-\d{2}-\d{2}$/
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** op=pull 답 → 받은 것. 모양이 틀린 것은 버린다 */
export function parsePull(v: unknown): RelayItem[] | null {
  if (!v || typeof v !== 'object' || (v as { ok?: unknown }).ok !== true) return null
  const items = (v as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  const out: RelayItem[] = []
  for (const x of items as Record<string, unknown>[]) {
    if (!x || typeof x.id !== 'string' || !/^\d+-\d+$/.test(x.id)) continue
    const base = { id: x.id, t: Number(x.t) || 0 }
    const no = Math.floor(Number(x.n))
    if (x.kind === 'obs') {
      const text = str(x.x, 2000).trim()
      const sid = str(x.s, 80)
      const okNo = no >= 1 && no <= 99
      if (!DAY.test(String(x.d)) || !(okNo || sid) || !text) continue
      out.push({ ...base, kind: 'obs', act: str(x.a, 60), ...(sid ? { sid } : {}), ...(str(x.g, 30) ? { group: str(x.g, 30) } : {}), cls: str(x.c, 12), no: okNo ? no : 0, day: String(x.d), text })
    } else if (x.kind === 'att') {
      if (!DAY.test(String(x.d)) || !(no >= 1 && no <= 99)) continue
      out.push({ ...base, kind: 'att', no, day: String(x.d), type: str(x.ty, 4), reason: str(x.r, 6), text: str(x.x, 200).trim() })
    } else if (typeof x.text === 'string') {
      out.push({ ...base, kind: 'text', text: x.text.slice(0, 8000) })
    }
  }
  return out
}

/** 답에 실린 스크립트 판 (v1 도 ping/pull 에 v 를 싣는다) */
export function versionOf(v: unknown): number {
  const n = Number((v as { v?: unknown } | null)?.v)
  return Number.isInteger(n) && n > 0 ? n : 0
}

/* ---------- 폰 판 ---------- */

/** [1,2,3,5,6] → '1-3,5-6' */
export function rangeOf(nums: number[]): string {
  const list = [...new Set(nums.filter((n) => Number.isInteger(n) && n > 0 && n < 100))].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < list.length; ) {
    let j = i
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++
    out.push(list[i] === list[j] ? String(list[i]) : `${list[i]}-${list[j]}`)
    i = j + 1
  }
  return out.join(',')
}

export interface PhoneBoard {
  /** 명단 묶음(mode) → [수업반, 학생 id(반-번호)들][] — 이름 · 학번 없음 */
  m: Record<string, [string, string[]][]>
  /** 활동 — id · 이름 · 명단 묶음 */
  a: { i: string; n: string; m: string }[]
  /** 담임 반 (출결) — 반 이름 · 번호 범위. 담임 명단이 없으면 null */
  h: { c: string; r: string } | null
}

/** 판의 크기 한도 — 조각으로 나눠 올리지만 너무 크면 뒤 활동부터 뺀다 */
export const BOARD_MAX = 24000

export interface BoardStudent {
  id: string
  cls: string
  no: string
  /** 수업반 (없으면 담임 반 '3반') */
  group: string
}

const numCmp = (a: string, b: string): number => a.localeCompare(b, 'ko', { numeric: true })

/**
 * PC 의 명단 · 활동 → 폰 판. 이름 · 학번은 넣지 않는다(이름표는 buildNames 로 따로 잠근다).
 * rosters: 명단 묶음 → 학생(id · 반 · 번호 · 수업반), acts: 활동(명단 묶음 포함), homeroom: 담임 반 이름 · 번호들
 */
export function buildBoard(
  rosters: Record<string, BoardStudent[]>,
  acts: { id: string; name: string; mode: string }[],
  homeroom: { cls: string; nos: number[] } | null
): PhoneBoard {
  const m: PhoneBoard['m'] = {}
  for (const [mode, list] of Object.entries(rosters)) {
    const byGroup = new Map<string, BoardStudent[]>()
    for (const st of list) {
      if (!st.id) continue
      const g = (st.group || (st.cls ? `${st.cls}반` : '') || '명단').slice(0, 30)
      byGroup.set(g, [...(byGroup.get(g) ?? []), st])
    }
    const rows = [...byGroup.entries()]
      .sort((a, b) => numCmp(a[0], b[0]))
      .map(([g, sts]) => [g, [...sts].sort((a, b) => numCmp(a.cls, b.cls) || Number(a.no) - Number(b.no)).map((s) => s.id.slice(0, 80))] as [string, string[]])
    if (rows.length) m[mode] = rows
  }
  const a = acts.filter((x) => m[x.mode]).map((x) => ({ i: x.id.slice(0, 60), n: x.name.slice(0, 40), m: x.mode }))
  const h = homeroom && homeroom.nos.length ? { c: homeroom.cls.slice(0, 20) || '우리 반', r: rangeOf(homeroom.nos) } : null
  const board: PhoneBoard = { m, a, h }
  while (board.a.length && JSON.stringify(board).length > BOARD_MAX) board.a.pop()
  for (const k of Object.keys(board.m)) if (!board.a.some((x) => x.m === k)) delete board.m[k]
  return board
}

/** 이름표 — 잠가서 올린다. s: 세특 학생 id → [학번 또는 '3반 5번', 이름], h: 담임 반 번호 → 이름 */
export interface PhoneNames {
  s: Record<string, [string, string]>
  h: Record<string, string>
}

/** 판에 나온 학생만 이름표에 넣는다 */
export function buildNames(
  board: PhoneBoard,
  students: { id: string; label: string; name: string }[],
  homeroom: { no: number; name: string }[]
): PhoneNames {
  const ids = new Set<string>()
  for (const rows of Object.values(board.m)) for (const [, sids] of rows) for (const id of sids) ids.add(id)
  const s: PhoneNames['s'] = {}
  for (const st of students) if (ids.has(st.id) && !s[st.id]) s[st.id] = [st.label.slice(0, 20), st.name.slice(0, 20)]
  const h: PhoneNames['h'] = {}
  if (board.h) for (const st of homeroom) if (st.no >= 1 && st.no <= 99) h[String(st.no)] = st.name.slice(0, 20)
  return { s, h }
}

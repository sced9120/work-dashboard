/**
 * 학생 명단 → 상담 기록 으로 건너갈 때 쓰는 작은 전달 통로.
 * 명단에서 [상담 기록] 을 누르면 번호를 여기 쌓고 'wd-homeroom-tab' 소식(detail: '상담 기록')을 보낸다.
 * 담임 화면이 그 소식을 받아 칸을 바꾸면 상담 기록 판이 새로 열리며 쌓인 번호를 꺼내 간다.
 * 이미 열려 있으면 'wd-counsel-student' 소식으로 바로 받는다.
 */
export const HOMEROOM_TAB_EVENT = 'wd-homeroom-tab'
export const COUNSEL_STUDENT_EVENT = 'wd-counsel-student'

let queued = 0

export function queueCounselStudent(no: number): void {
  queued = no
  window.dispatchEvent(new CustomEvent(COUNSEL_STUDENT_EVENT, { detail: no }))
  window.dispatchEvent(new CustomEvent(HOMEROOM_TAB_EVENT, { detail: '상담 기록' }))
}

/** 쌓인 번호를 한 번만 꺼낸다 (없으면 0) */
export function takeCounselStudent(): number {
  const n = queued
  queued = 0
  return n
}

export function gotoHomeroomTab(tab: '학생 명단' | '상담 기록'): void {
  window.dispatchEvent(new CustomEvent(HOMEROOM_TAB_EVENT, { detail: tab }))
}

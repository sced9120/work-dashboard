/**
 * 세특 작성실에게 '이 활동을 열어 달라'고 한 번 부탁한다 (3.7.5~).
 * 문서 스캔 · 정리에서 결과를 활동으로 보낸 뒤 [그 활동 열기] 를 누르면, 화면을 옮기며 여기 맡겨 두었다가
 * 세특 작성실이 열릴 때(useSeteuk) 꺼내 간다. 이미 세특 작성실 안(스캔 탭)이면 'wd-seteuk-act' 소식으로 알린다.
 */

let wanted = ''

export const SETEUK_ACT_EVENT = 'wd-seteuk-act'

export function queueSeteukAct(actId: string): void {
  wanted = actId
  try {
    window.dispatchEvent(new CustomEvent(SETEUK_ACT_EVENT))
  } catch {
    // 소식을 못 보내도 새로 열릴 때 꺼내 간다
  }
}

/** 맡겨 둔 활동 id 를 한 번만 꺼낸다(없으면 빈 글) */
export function takeSeteukAct(): string {
  const t = wanted
  wanted = ''
  return t
}

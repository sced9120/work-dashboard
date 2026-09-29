/**
 * 화면 사이에 한 번만 넘기는 부탁.
 *
 * 학교 문서 만들기에서 [💬 도우미와 대화로] 를 누르면 도우미 입력칸에 글을 미리 적어 두고,
 * 도우미에서 [양식 넣으러 가기] 를 누르면 학교 문서 만들기를 양식 보관함 탭으로 연다.
 * 화면을 옮기면 앞 화면이 사라지므로, 넘길 것을 여기 잠깐 맡겨 두었다가 새 화면이 꺼내 간다.
 */

let chatDraft = ''
let committeeTab = ''

export function queueChat(text: string): void {
  chatDraft = text
}

export function takeChat(): string {
  const t = chatDraft
  chatDraft = ''
  return t
}

export function queueCommitteeTab(tab: string): void {
  committeeTab = tab
}

export function takeCommitteeTab(): string {
  const t = committeeTab
  committeeTab = ''
  return t
}

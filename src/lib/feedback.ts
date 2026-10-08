import { fillFeedback } from '../../shared/catalog'

/**
 * 의견 · 오류 보내기 — 만든이의 구글 설문지를 브라우저로 연다.
 * 프로그램 버전 · 윈도우 버전만 미리 채운다(이름 · 학교 · 자료는 보내지 않는다).
 */
export async function openFeedback(url: string): Promise<void> {
  const [version, os] = await Promise.all([window.api.appVersion(), window.api.appOs()])
  await window.api.shell.open(fillFeedback(url, version, os))
}

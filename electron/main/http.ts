import { app, net } from 'electron'

/**
 * 바깥으로 나가는 요청(AI · 나이스 · 업데이트 확인)은 Electron 의 net.fetch 로 보낸다.
 *
 * net.fetch 는 크롬과 같은 네트워크를 써서 윈도우 인증서 저장소와 프록시 설정을 따른다.
 * 학교망(예: 경남교육청)은 보안 검사를 하려고 연결 중간에 자체 인증서(GNE_CERT)를 끼워 넣는데,
 * 윈도우는 이 인증서를 믿지만 Node 내장 fetch 는 믿지 않아 "self signed certificate in certificate chain"
 * 으로 끊겼다(open.neis.go.kr · api.anthropic.com 에서 확인). 앱이 아직 준비되기 전에만 Node fetch 를 쓴다.
 */
export function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (app.isReady() && typeof net?.fetch === 'function') return net.fetch(input, init)
  return fetch(input, init)
}

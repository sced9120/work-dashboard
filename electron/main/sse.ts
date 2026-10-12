/**
 * 받는 대로 오는 답(Server-Sent Events)을 읽는다 — Gemini · OpenAI · Claude 가 모두 이 모양이다.
 * 빈 줄로 나뉜 덩어리마다 data: 줄을 모아 한 번씩 넘긴다(event: 줄은 보지 않는다 — 내용 JSON 에 type 이 있다).
 */
export async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const flush = (chunk: string): void => {
    const data = chunk
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('')
    if (data) onData(data)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    // 줄바꿈이 \r\n 이어도 한 가지로 (조각 경계에서 갈라져도 버퍼 전체를 다시 맞춘다)
    buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      flush(buf.slice(0, cut))
      buf = buf.slice(cut + 2)
    }
  }
  if (buf.trim()) flush(buf.trim())
}

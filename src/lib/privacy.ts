import type { AliasPair } from '../../shared/types'

/**
 * 글에서 이름·학번을 찾아 가명을 붙인다. 이미 정해 둔 가명(base)은 그대로 쓴다.
 * 새로 찾은 이름은 역할을 모르므로 '관련인A' 처럼 붙인다 — 문서 만들기의 역할 이름과 겹치지 않게.
 */
export async function aliasesFor(text: string, base: AliasPair[] = []): Promise<AliasPair[]> {
  const [names, ids] = await Promise.all([window.api.privacy.candidates(text), window.api.privacy.ids(text)])
  const known = new Set(base.map((a) => a.real))
  const extra = [
    ...names.filter((n) => !known.has(n)).map((n) => ({ name: n, role: '관련인' })),
    ...ids.filter((n) => !known.has(n)).map((n) => ({ name: n, role: '학번' }))
  ]
  return [...base, ...(extra.length ? await window.api.privacy.aliases(extra) : [])]
}

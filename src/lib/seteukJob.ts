/**
 * 세특 작성실에서 받는 일(초안 받기 · 압축)의 줄 — 화면을 옮겨 다녀도 이어지고, 여러 개를 쌓아 둘 수 있다 (3.7.6~).
 *
 * 받는 일은 메인 프로세스에서 돌고 글도 거기서 저장된다. 화면은 다른 곳으로 가면 지워지므로
 * '무슨 일이 몇 개 · 어디까지 왔는지'는 화면 바깥(여기)에 둔다.
 *
 * 줄 세우는 규칙: 같은 서비스(같은 API 키)로 가는 일은 한 번에 하나만 돌고 나머지는 '대기'한다.
 * 다른 서비스로 가는 일은 서로 상관없이 함께 돈다.
 */
export interface SeteukJob {
  kind: 'write' | 'compress'
  id: string
  /** 초안은 활동 번호, 압축은 기록 영역 */
  ref: string
  /** 줄에 보일 이름 (예: 통계 포스터 발표) */
  label: string
  /** 같은 서비스끼리 줄을 세우는 기준 */
  provider: string
  /** 이 일이 맡은 학생 번호들 */
  ids: string[]
  status: 'wait' | 'run'
  done: number
  total: number
  errors: Record<string, string>
  /** 돌기 시작한 때(대기 중이면 0) */
  startedAt: number
}

interface Entry extends SeteukJob {
  run: (id: string) => Promise<void>
}

let jobs: Entry[] = []
let snapshot: SeteukJob[] = []
const subs = new Set<() => void>()
let wired = false
let seq = 0

function emit(): void {
  snapshot = jobs.map(({ run: _run, ...j }) => j)
  subs.forEach((f) => f())
}

function update(kind: SeteukJob['kind'], p: { job: string; done: number; total: number; id?: string; error?: string }): void {
  const j = jobs.find((x) => x.id === p.job && x.kind === kind)
  if (!j) return
  j.done = p.done
  j.total = p.total
  if (p.error && p.id) j.errors = { ...j.errors, [p.id]: p.error }
  emit()
}

function wire(): void {
  if (wired) return
  wired = true
  window.api.seteuk.onProgress((p) => update('write', p))
  window.api.seteuk.onSumProgress((p) => update('compress', p))
}

/** 이 서비스로 도는 일이 없으면 줄 맨 앞의 대기 일을 시작한다 */
function pump(provider: string): void {
  if (jobs.some((j) => j.provider === provider && j.status === 'run')) return
  const next = jobs.find((j) => j.provider === provider && j.status === 'wait')
  if (!next) return
  next.status = 'run'
  next.startedAt = Date.now()
  emit()
  void next
    .run(next.id)
    .catch(() => undefined)
    .finally(() => {
      jobs = jobs.filter((j) => j.id !== next.id)
      emit()
      pump(provider)
    })
}

export const seteukJob = {
  /** 지금 줄에 있는 일들(도는 것 · 대기) */
  list: (): SeteukJob[] => snapshot,
  get: (id: string): SeteukJob | undefined => snapshot.find((j) => j.id === id),
  /** 이 활동(또는 기록 영역)에서 이미 받는 중이거나 대기 중인 학생 번호 */
  busyIds(kind: SeteukJob['kind'], ref: string): Set<string> {
    return new Set(snapshot.filter((j) => j.kind === kind && j.ref === ref).flatMap((j) => j.ids))
  },
  /** 일을 줄에 세운다. 같은 서비스로 도는 일이 없으면 바로 시작한다. run 이 끝나면 줄에서 빠진다 */
  enqueue(spec: { kind: SeteukJob['kind']; ref: string; label: string; provider: string; ids: string[]; run: (id: string) => Promise<void> }): string {
    wire()
    const id = `${spec.kind[0]}${Date.now().toString(36)}${(seq++).toString(36)}`
    jobs.push({ ...spec, id, status: 'wait', done: 0, total: spec.ids.length, errors: {}, startedAt: 0 })
    emit()
    pump(spec.provider)
    return id
  },
  /** 대기 중이면 줄에서 빼고, 도는 중이면 멈추라고 한다 */
  cancel(id: string): void {
    const j = jobs.find((x) => x.id === id)
    if (!j) return
    if (j.status === 'wait') {
      jobs = jobs.filter((x) => x.id !== id)
      emit()
      return
    }
    void (j.kind === 'write' ? window.api.seteuk.cancel(id) : window.api.seteuk.compressCancel(id))
  },
  subscribe(fn: () => void): () => void {
    subs.add(fn)
    return () => subs.delete(fn)
  }
}

/** 명당 걸린 시간 안내 — 받은 학생이 있어야 보인다 */
export function jobPace(j: Pick<SeteukJob, 'done' | 'startedAt'>): string {
  if (!j.done || !j.startedAt) return ''
  const sec = Math.max(1, Math.round((Date.now() - j.startedAt) / 1000 / j.done))
  return ` · 명당 약 ${sec}초`
}

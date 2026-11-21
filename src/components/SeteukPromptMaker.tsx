import { useMemo } from 'react'
import { CUSTOM_PLACEHOLDERS, STRUCTURE_TEMPLATES, buildSeteukPrompt, limitOf, usesCustomPrompt } from '../../shared/seteuk'
import type { SeteukActivity, SeteukConfig, SeteukStyle } from '../../shared/seteuk'
import SeteukFill from './SeteukFill'
import { useToast } from '../lib/toast'

/**
 * 세특 작성실 — 프롬프트 만들기.
 * 왼쪽에 선생님이 쓰는 칸(활동 개요 · 세특 구성 · 요청사항 · 분량)을 두고, 오른쪽에 실제로 AI 에게 가는 프롬프트를 그대로 보인다.
 * 프롬프트의 칸은 둘로 나뉜다.
 *   · 기재요령 틀 — 역할 · 서술 규칙 · 기재 금지사항 · 입력 자료 형식 · 출력. 2026 기재요령을 지키는 몫이라 여기서는 고치지 않는다
 *   · 선생님 칸 — 과제(활동 개요) · 세특 구성 · 선생님 요청사항 · 분량. 왼쪽에서 고치면 바로 바뀐다
 * 세특 구성은 "어떤 차례로 쓸지"를 한 줄에 한 칸씩 적는다. 견본을 눌러 시작하고 고쳐 쓰면 된다.
 */
interface Props {
  act: SeteukActivity
  style: SeteukStyle
  config: SeteukConfig
  onPatch: (patch: Partial<SeteukActivity>) => void
  onClose: () => void
}

/** 선생님이 고치는 칸 */
const MINE = ['# 과제', '# 세특 구성', '# 선생님 요청사항', '# 분량', '# 예시', '# 문체 예시', '# 내 문체', '# 활동 이름']

export default function SeteukPromptMaker({ act, style, config, onPatch, onClose }: Props): JSX.Element {
  const toast = useToast()
  const prompt = useMemo(() => buildSeteukPrompt(act, { style, config }), [act, style, config])
  const parts = useMemo(
    () =>
      prompt.split(/\n\n(?=# )/).map((body) => {
        const head = body.split('\n')[0]
        return { head, body, mine: MINE.some((m) => head.startsWith(m)) }
      }),
    [prompt]
  )
  const limit = limitOf(act)
  const custom = usesCustomPrompt(act)

  /** 스위치를 켠다 — 쓴 글이 없으면 지금의 기본 프롬프트를 채워 시작한다 */
  const toggleCustom = (on: boolean): void => {
    if (!on) return onPatch({ customOn: false })
    const seed = act.customPrompt?.trim() ? act.customPrompt : buildSeteukPrompt(act, { style, config, ignoreCustom: true })
    onPatch({ customOn: true, customPrompt: seed })
  }

  const copyGem = async (): Promise<void> => {
    const r = await window.api.seteuk.gemText(act.id)
    if (!r.ok || !r.text) return toast(r.error ?? '지침을 만들지 못했습니다.', 'err')
    await window.api.clipboard.write(r.text)
    toast('지침을 복사했습니다. Gem · GPT · 프로젝트의 「지침」 칸에 붙여 넣으세요.', 'ok')
  }

  const saveSkill = async (): Promise<void> => {
    const r = await window.api.seteuk.skillSave(act.id)
    if (r.message !== '취소했습니다.') toast(r.message, r.ok ? 'ok' : 'err')
  }

  return (
    <div className="stk-panel stk-maker">
      <div className="stk-import-head">
        <b>프롬프트 만들기 — 「{act.name}」</b>
        <span className="small muted">왼쪽에 쓰면 오른쪽 프롬프트에 바로 들어갑니다</span>
        <span className="spacer" />
        <button
          className="btn btn-sm"
          onClick={() =>
            void (async () => {
              await window.api.clipboard.write(prompt)
              toast('프롬프트를 복사했습니다.', 'ok')
            })()
          }
        >
          프롬프트 복사
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          닫기
        </button>
      </div>

      <div className="stk-maker-cols">
        <div className="stk-maker-edit">
          <div className="stk-custom">
            <label className="stk-check" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <input type="checkbox" style={{ marginTop: 3, flex: 'none' }} checked={custom} onChange={(e) => toggleCustom(e.target.checked)} />
              <span>프롬프트 전체를 직접 쓰기 <span className="muted">기본 구조(역할 · 서술 규칙 · 금지사항 …) 대신 아래 글을 그대로 AI 에게 보냅니다</span></span>
            </label>
            {custom && (
              <>
                <div className="stk-templates">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      if (window.confirm('직접 쓴 글을 지우고 기본 프롬프트로 바꿉니다. 계속할까요?')) onPatch({ customPrompt: buildSeteukPrompt(act, { style, config, ignoreCustom: true }) })
                    }}
                  >
                    기본 프롬프트로 다시 채우기
                  </button>
                </div>
                <textarea
                  className="stk-maker-custom"
                  style={{ minHeight: 320 }}
                  value={act.customPrompt ?? ''}
                  onChange={(e) => onPatch({ customPrompt: e.target.value })}
                  aria-label="직접 쓴 전체 프롬프트"
                />
                <p className="small muted">
                  쓸 수 있는 자리표시자: {CUSTOM_PLACEHOLDERS.join(' ')} — 보낼 때 이 활동의 값으로 바뀝니다. 학생 자료는 프롬프트와 따로 붙으니 넣지 않습니다.
                  글을 지워도 스위치를 끄면 기본 구조로 돌아가고, 쓴 글은 남아 있습니다. 생성 뒤의 기재 금지 · 분량 검사와 자동 고쳐쓰기는 그대로 돕니다.
                </p>
              </>
            )}
          </div>

          <fieldset disabled={custom} style={{ border: 0, padding: 0, margin: 0, opacity: custom ? 0.45 : 1 }}>
          <label>
            <span>활동 개요 — 무엇을 한 수업 · 활동인지</span>
            <textarea value={act.desc} onChange={(e) => onPatch({ desc: e.target.value })} placeholder="예: 실생활 자료로 함수의 그래프를 그리고 변화율을 설명하는 모둠 탐구 3차시" />
          </label>

          <div>
            <span className="stk-style-label">
              세특 구성 — 어떤 차례로 쓸지 <span className="muted">한 줄에 한 칸. 메모에 없는 칸은 AI 가 건너뜁니다</span>
            </span>
            <div className="stk-templates">
              {STRUCTURE_TEMPLATES.map((t) => (
                <button key={t.name} type="button" className="btn btn-sm" onClick={() => onPatch({ structure: t.text })} title={`${t.for}에 맞는 짜임 — 누르면 아래 칸에 채워집니다`}>
                  {t.name}
                </button>
              ))}
              {act.structure.trim() && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onPatch({ structure: '' })}>
                  비우기
                </button>
              )}
            </div>
            <textarea
              className="stk-maker-structure"
              value={act.structure}
              onChange={(e) => onPatch({ structure: e.target.value })}
              placeholder={'예)\n수업에서 다룬 개념과 탐구 주제를 정한 계기\n스스로 자료를 찾고 조사한 과정\n막힌 곳과 고친 방법\n이어간 탐구와 결론'}
              aria-label="세특 구성"
            />
            {!act.structure.trim() && <p className="small muted">비워 두면 기본 서술 흐름(계기 → 직접 한 과정 → 이어간 탐구 → 결론)을 따릅니다.</p>}
          </div>

          <label>
            <span>요청사항 — 이 활동에서 더 바라는 것 (한 줄에 하나)</span>
            <textarea
              value={act.request}
              onChange={(e) => onPatch({ request: e.target.value })}
              placeholder={'예) 모둠 활동에서 맡은 몫을 꼭 밝힌다\n예) 사용한 공학 도구 이름을 쓴다'}
              aria-label="요청사항"
            />
          </label>

          <SeteukFill fill={act.fill} limit={limit} short={act.amount === '메모만큼'} onFill={(v) => onPatch({ fill: v })} onShort={(v) => onPatch({ amount: v ? '메모만큼' : '보통' })} />

          </fieldset>

          <div className="stk-export">
            <span className="stk-style-label">
              다른 AI 앱에 저장해 두기 <span className="muted">이 규칙을 한 번 저장해 두면 그 앱에서는 학생 자료만 붙여 넣으면 됩니다</span>
            </span>
            <div className="stk-export-btns">
              <button type="button" className="btn btn-sm" onClick={() => void copyGem()} title="Gemini 의 Gem, ChatGPT 의 GPT, Claude 의 프로젝트 지침 칸에 붙여 넣습니다">
                Gem · GPT · 프로젝트 지침 복사
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void saveSkill()} title="claude.ai 설정 › 기능 › 스킬에 올리는 zip 파일로 저장합니다">
                Claude 스킬 파일로 저장
              </button>
            </div>
            <p className="small muted">학생 이름이나 관찰 기록은 들어가지 않습니다. 예시 · 문체에 든 이름도 가려서 내보냅니다.</p>
            <details className="stk-howto">
              <summary>처음이면 — Gem · GPT 만드는 순서</summary>
              <div className="stk-howto-body">
                <b>공통</b>
                <ol>
                  <li>위의 [Gem · GPT · 프로젝트 지침 복사]를 누릅니다. 활동마다 규칙이 달라, 쓸 활동마다 따로 만듭니다.</li>
                  <li>아래 순서로 만들 때 지침 칸에 붙여 넣습니다(Ctrl+V). 이름과 설명은 아무렇게나 적어도 됩니다.</li>
                </ol>
                <b>Gemini — Gem</b>
                <ol>
                  <li>gemini.google.com 왼쪽의 [Gems] → [새 Gem].</li>
                  <li>[이름]에 활동 이름(예: 통계 포스터 발표 세특). [설명]은 비워도 됩니다.</li>
                  <li>[요청 사항] 칸에 복사한 글을 붙여 넣습니다. [기본 도구]는 '기본 도구 없음' 그대로, [지식]에 파일은 넣지 않아도 됩니다.</li>
                  <li>오른쪽 [미리보기]에서 학생 자료 한 명분을 붙여 시험해 보고, 맞으면 [저장].</li>
                </ol>
                <b>ChatGPT — GPT</b>
                <ol>
                  <li>chatgpt.com 왼쪽의 [GPT 탐색] → 오른쪽 위 [만들기] (유료 요금제에서 만들 수 있습니다).</li>
                  <li>[구성] 탭에서 [이름]을 적고, [지침] 칸에 복사한 글을 붙여 넣습니다.</li>
                  <li>[기능]은 웹 검색 · 이미지 · 코드 실행을 모두 끕니다. 파일(지식)은 넣지 않습니다.</li>
                  <li>[만들기]를 눌러 저장하고, 공유는 '나만 보기'로 둡니다.</li>
                </ol>
                <b>쓸 때</b>
                <ol>
                  <li>[키 없이 — 요청 글 복사]로 복사한 글에서 아래쪽 [학생 자료] 부분(이름은 가려져 있습니다)만 Gem · GPT 대화창에 붙여 넣습니다. 여러 명이면 [S1] [S2] 처럼 표시를 붙입니다.</li>
                  <li>받은 본문을 읽고 관찰한 사실과 맞춰 본 뒤 [AI 초안] 칸에 붙여 넣습니다.</li>
                </ol>
                <p className="small muted">앱 화면 이름은 업데이트로 조금 달라질 수 있습니다. 학교 · 교육청의 생성형 AI 지침을 먼저 확인하세요. Claude 는 [Claude 스킬 파일로 저장] 또는 프로젝트의 지침 칸에 같은 글을 붙여 넣으면 됩니다.</p>
              </div>
            </details>
          </div>
        </div>

        <div className="stk-maker-view" aria-label="AI 에게 가는 프롬프트">
          {custom ? (
            <section className="stk-maker-part mine">
              <span className="stk-maker-tag">직접 쓴 프롬프트 · 기본 구조 사용 안 함</span>
              <pre>{prompt}</pre>
            </section>
          ) : (
            parts.map((p, i) => (
              <section key={i} className={`stk-maker-part ${p.mine ? 'mine' : 'locked'}`}>
                <span className="stk-maker-tag">{p.mine ? '선생님 칸' : '기재요령 틀 · 고정'}</span>
                <pre>{p.body}</pre>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

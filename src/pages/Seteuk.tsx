/* 세특 작성실 — 화면 틀. 상태 · 동작은 seteuk/core.tsx 의 useSeteuk, 화면 조각은 seteuk/*.tsx */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../shared/types'
import {
  COLUMN_SETS,
  cleanGroup,
  groupOf,
  groupsOf,
  mergeGroup,
  GRADES,
  SETEUK_SUBJECTS,
  joinFields,
  readColumns,
  subjectOf,
  SETEUK_AMOUNTS,
  SETEUK_EXAMPLE_MAX,
  SETEUK_MODES,
  SETEUK_RECORDS,
  buildSeteukPrompt,
  byteLen,
  checkBadge,
  emptyRosters,
  emptyRow,
  defaultConfig,
  defaultOptions,
  emptyStyle,
  groundLeft,
  limitOf,
  minRatioOf,
  mergeNote,
  modeInfo,
  modeOfRec,
  newActivity,
  parseRoster,
  recordOf,
  setSeteukConfig,
  studentLabel,
  validateSeteuk
} from '../../shared/seteuk'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../shared/seteuk'
import Icon from '../components/Icon'
import ModelPicker from '../components/ModelPicker'
import SeteukImport from '../components/SeteukImport'
import SeteukReview from '../components/SeteukReview'
import SeteukRules from '../components/SeteukRules'
import SeteukFill from '../components/SeteukFill'
import SeteukPromptMaker from '../components/SeteukPromptMaker'
import RelayCard from '../components/RelayCard'
import SeteukStylePanel from '../components/SeteukStyle'
import SeteukSumView from '../components/SeteukSum'
import SeteukXlsx from '../components/SeteukXlsx'
import { useConfirm } from '../lib/confirm'
import type { PageId } from '../App'
import Ocr from './Ocr'
import { useToast } from '../lib/toast'
import { useSeteuk } from './seteuk/core'
import SeteukRosterPanel from './seteuk/SeteukRosterPanel'
import SeteukActsView from './seteuk/SeteukActsView'
import { SAVE_DELAY, MODE_KEY, INTRO_KEY, newId, stored, remember } from './seteuk/core'

type Props = Parameters<typeof useSeteuk>[0]

export default function Seteuk(props: Props): JSX.Element {
  const c = useSeteuk(props)
  const { onGo, toast, ask, loaded, setLoaded, rosters, setRosters, acts, setActs, rows, setRows, demo, setDemo, style, setStyle, options, setOptions, config, setConfig, grounding, setGrounding, mode, setMode, actIds, setActIds, cls, setCls, sel, setSel, focus, setFocus, save, setSave, model, setModel, panel, setPanel, rosterText, setRosterText, rosterGroup, setRosterGroup, cfgOpen, setCfgOpen, makerOpen, setMakerOpen, importOpen, setImportOpen, view, setView, finalOnly, setFinalOnly, rev, setRev, intro, setIntro, job, setJob, prog, setProg, errors, setErrors, pending, timer, actsTimer, actsRef, jobRef, info, students, modeActs, act, limit, cur, reload, flush, setCell, changeActs, patchAct, resetView, switchMode, switchView, togglePanel, parsed, applyRoster, removeGroup, removeStudent, clearRoster, classes, shown, prevRosterText, closeIntro, fillDemo, clearDemo, switchAct, addAct, removeAct, addExample, importNotes, targets, ready, write, saveOptions, checkGround, copyRequest, adoptEmpty, copyFinals, actKey, checks, allOn, toggleAll, toggle, filled, rec, rules } = c

  if (!loaded) return <></>

  const rosterPanel = <SeteukRosterPanel c={c} />

  return (
    <>
      <div className="page-head">
        <h1>세특 작성실</h1>
        <p>관찰한 것을 적으면 AI 가 초안을 쓰고, 선생님이 다듬어 최종본으로 둡니다. 학생 이름은 AI 에 보내지 않습니다.</p>
      </div>

      {intro && (
        <section className="card stk-intro">
          <div className="card-title">처음이시면</div>
          <ol>
            <li>
              <b>교과 · 동아리 · 담임</b> 가운데 쓸 것을 고릅니다. 학생이 서로 달라 명단을 따로 둡니다.
            </li>
            <li>
              <b>명단</b>을 엑셀에서 복사해 붙여 넣습니다. 활동은 미리 만들어 두었습니다.
            </li>
            <li>
              학생마다 <b>관찰한 것</b>을 적고 [초안 받기]. 쓰는 규칙과 분량은 이미 맞춰져 있습니다.
            </li>
            <li>
              초안을 읽고 고쳐 <b>최종본</b>으로 두면, [취합 · 나이스]에서 모아 나이스 파일로 받습니다.
            </li>
          </ol>
          <div className="row">
            {demo.canFill && (
              <button className="btn btn-primary btn-sm" onClick={() => void fillDemo()}>
                체험 자료로 먼저 보기
              </button>
            )}
            <button className="btn btn-sm" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1' }))}>
              화면 따라 배우기 (F1)
            </button>
            <button className="btn btn-sm btn-ghost" onClick={closeIntro}>
              닫기
            </button>
            {demo.canFill && <span className="small muted">지어낸 학생 16명과 채워진 활동이 들어갑니다. 한 번에 지울 수 있습니다.</span>}
          </div>
        </section>
      )}

      {demo.filled && (
        <div className="note note-info small stk-demo">
          <span>
            <b>체험 자료</b>가 들어 있습니다. 학생과 글은 모두 지어낸 것입니다. 교과의 윤바다 초안에는 일부러 고칠 곳을 넣었고, 강하늘은
            [취합]에서 한도를 넘습니다.
          </span>
          <button className="btn btn-sm" onClick={() => void clearDemo()} disabled={!!job}>
            체험 자료 지우기
          </button>
        </div>
      )}

      <div className="ocr-modes stk-modes" role="tablist" aria-label="모드">
        {SETEUK_MODES.map((m) => (
          <button key={m.key} role="tab" aria-selected={m.key === mode} className={`ocr-mode ${m.key === mode ? 'active' : ''}`} onClick={() => void switchMode(m.key)} disabled={!!job}>
            {m.name}
            <small>
              {m.desc} · {rosters[m.key].length ? `${m.who} ${rosters[m.key].length}명` : '명단 없음'}
            </small>
          </button>
        ))}
      </div>

      <div className="stk-bar">
        <div className="memo-filter stk-view" role="radiogroup" aria-label="보기">
          <button role="radio" aria-checked={view === 'acts'} className={view === 'acts' ? 'on' : ''} onClick={() => void switchView('acts')}>
            활동별 작성
          </button>
          <button role="radio" aria-checked={view === 'sum'} className={view === 'sum' ? 'on' : ''} onClick={() => void switchView('sum')} disabled={!!job}>
            취합 · 나이스
          </button>
          <button role="radio" aria-checked={view === 'scan'} className={view === 'scan' ? 'on' : ''} onClick={() => void switchView('scan')} disabled={!!job} title="스캔 · 사진 속 표를 글자 그대로 읽어 엑셀로 · 폴더째 학생별 정리">
            문서 스캔
          </button>
        </div>
        <span className="spacer" />
        <span className="small muted stk-save" aria-live="polite">
          {save === 'saved' ? '저장됨' : save === 'saving' ? '저장 중…' : '적는 중…'}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('phone')} aria-expanded={panel === 'phone'} title="수업 중에 폰으로 번호를 누르고 본 것을 적으면 관찰 기록에 붙습니다">
          폰으로 관찰
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('review')} aria-expanded={panel === 'review'} title="한 학생의 학생부를 읽고 1 · 2학년은 이어 갈 탐구, 3학년은 짜임과 보완할 곳을 짚습니다">
          학생부 살펴보기
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('style')} aria-expanded={panel === 'style'}>
          내 문체{style.on ? ' · 켬' : ''}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('rules')} aria-expanded={panel === 'rules'} title="금지어 · 검사 · 쓰는 규칙을 켜고 끄거나 내 것을 더합니다">
          내 규칙
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => void togglePanel('xlsx')} aria-expanded={panel === 'xlsx'} disabled={!!job}>
          엑셀로 주고받기
        </button>
        <button className="btn btn-sm" onClick={() => void togglePanel('roster')} aria-expanded={panel === 'roster'} disabled={!!job}>
          {students.length ? `명단 ${students.length}명` : '명단 넣기'}
        </button>
      </div>

      {panel === 'roster' && <section className="card stk-side">{rosterPanel}</section>}
      {panel === 'phone' && (
        <RelayCard
          tab="obs"
          title="폰으로 수업 관찰"
          desc="수업 중에 학생을 누르고 본 것을 적으면, 그 활동의 관찰 기록 뒤에 날짜와 함께 붙습니다"
          startOpen
          className="stk-phone"
          howTo={
            <ol className="small relay-how">
              <li>폰 화면의 <b>[수업 관찰]</b> 탭에서 활동과 수업반을 고릅니다. 이 PC 의 활동 · 명단이 몇 분 안에 폰에 올라갑니다. 폰에는 학번 · 이름이 보이지만 구글에는 이 PC 에서 잠근 글만 갑니다.</li>
              <li>학생을 누르고 [발표] · [질문] 같은 단어를 눌러 시작하거나, 키보드의 마이크로 말해서 적고 [보내기].</li>
              <li>3분 안에 이 표의 관찰 기록에 <b>[11/13] 발표: …</b> 처럼 붙습니다. 오늘 적은 학생은 폰에서 색이 칠해져 아직 못 본 학생이 보입니다.</li>
            </ol>
          }
        />
      )}
      {panel === 'xlsx' && <SeteukXlsx onImported={() => void reload()} onClose={() => setPanel('')} />}
      {panel === 'review' && <SeteukReview students={students} rosters={rosters} acts={acts} rows={rows} model={model} onClose={() => setPanel('')} />}
      {panel === 'style' && <SeteukStylePanel style={style} model={model} onChange={setStyle} onClose={() => setPanel('')} />}
      {panel === 'rules' && (
        <SeteukRules
          config={config}
          preview={rules}
          actName={act?.name ?? '활동'}
          onChange={(c) => {
            setSeteukConfig(c)
            setConfig(c)
          }}
          onClose={() => {
            setPanel('')
            // 취합 보기도 새 규칙으로 다시 검사하게
            setRev((n) => n + 1)
          }}
        />
      )}

      {panel !== 'review' && view === 'sum' && <SeteukSumView key={`${rev}-${mode}`} students={students} acts={modeActs} rows={rows} />}
      {panel !== 'review' && view === 'scan' && (
        <div className="stk-scan">
          <Ocr onGo={onGo} />
        </div>
      )}

      <SeteukActsView c={c} rosterPanel={rosterPanel} />
    </>
  )
}

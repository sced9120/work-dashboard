/* 세특 작성실 — 명단 넣기 · 수업반 (Seteuk.tsx 에서 나눔, 3.8.0) */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ModelChoice } from '../../../shared/types'
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
} from '../../../shared/seteuk'
import type { SeteukActivity, SeteukAmount, SeteukCheck, SeteukConfig, SeteukImportHit, SeteukMode, SeteukOptions, SeteukRosters, SeteukRow, SeteukRows, SeteukStyle } from '../../../shared/seteuk'
import Icon from '../../components/Icon'
import ModelPicker from '../../components/ModelPicker'
import SeteukImport from '../../components/SeteukImport'
import SeteukReview from '../../components/SeteukReview'
import SeteukRules from '../../components/SeteukRules'
import SeteukFill from '../../components/SeteukFill'
import SeteukPromptMaker from '../../components/SeteukPromptMaker'
import RelayCard from '../../components/RelayCard'
import SeteukStylePanel from '../../components/SeteukStyle'
import SeteukSumView from '../../components/SeteukSum'
import SeteukXlsx from '../../components/SeteukXlsx'
import { useConfirm } from '../../lib/confirm'
import type { PageId } from '../../App'
import Ocr from '../Ocr'
import { useToast } from '../../lib/toast'
import type { SeteukState } from './core'
import { SAVE_DELAY, MODE_KEY, INTRO_KEY, newId, stored, remember } from './core'

export default function SeteukRosterPanel({ c }: { c: SeteukState }): JSX.Element {
  const { onGo, toast, ask, loaded, setLoaded, rosters, setRosters, acts, setActs, rows, setRows, demo, setDemo, style, setStyle, options, setOptions, config, setConfig, grounding, setGrounding, mode, setMode, actIds, setActIds, cls, setCls, sel, setSel, focus, setFocus, save, setSave, model, setModel, panel, setPanel, rosterText, setRosterText, rosterGroup, setRosterGroup, cfgOpen, setCfgOpen, makerOpen, setMakerOpen, importOpen, setImportOpen, view, setView, finalOnly, setFinalOnly, rev, setRev, intro, setIntro, job, setJob, prog, setProg, errors, setErrors, pending, timer, actsTimer, actsRef, jobRef, info, students, modeActs, act, limit, cur, reload, flush, setCell, changeActs, patchAct, resetView, switchMode, switchView, togglePanel, parsed, applyRoster, removeGroup, removeStudent, clearRoster, classes, shown, prevRosterText, closeIntro, fillDemo, clearDemo, switchAct, addAct, removeAct, addExample, importNotes, targets, ready, write, saveOptions, checkGround, copyRequest, adoptEmpty, copyFinals, actKey, checks, allOn, toggleAll, toggle, filled, rec, rules } = c
  return (
    <div className="stk-panel">
      <p className="small">
        엑셀 · 나이스 명렬표에서 <b>학번(또는 반 · 번호) · 이름</b> 칸을 끌어 복사해 붙여 넣으세요. 이 명단은 <b>{info.name}</b>({info.who})에만 씁니다.
        <br />
        <b>반마다 따로</b> 넣으면 표를 반별로 보고 나이스에도 반별로 올립니다. 선택과목처럼 여러 반 학생이 모인 수업은 <b>미적분A반</b> 처럼 이름을 지어 넣으세요.
      </p>
      {classes.length > 0 && (
        <div className="stk-groups-now">
          {classes.map((c) => (
            <span key={c.name} className="stk-chip">
              <b>{c.name}</b> {c.count}명
              <button onClick={() => void removeGroup(c.name)} aria-label={`${c.name} 명단에서 빼기`} title="이 반을 명단에서 빼기">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {students.length > 0 && (
        <div className="stk-roster-now">
          <div className="stk-import-head">
            <span className="stk-style-label">
              지금 {info.name} 명단 {students.length}명 <span className="muted">× 를 누르면 그 학생을 뺍니다</span>
            </span>
            <span className="spacer" />
            <button className="btn btn-sm btn-ghost stk-danger-text" onClick={() => void clearRoster()}>
              명단 모두 지우기
            </button>
          </div>
          <div className="stk-chips">
            {students.map((s) => (
              <span key={s.id} className="stk-chip">
                {studentLabel(s)} {s.name}
                <button onClick={() => void removeStudent(s.id)} aria-label={`${s.name} 빼기`} title="명단에서 빼기">
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <label className="stk-group-name">
        <span>반 이름</span>
        <input
          type="text"
          value={rosterGroup}
          onChange={(e) => setRosterGroup(e.target.value)}
          placeholder="예: 3반 · 미적분A반 · 과학탐구실험 2반"
          list="stk-group-list"
          aria-describedby="stk-group-hint"
        />
        <datalist id="stk-group-list">
          {classes.map((c) => (
            <option key={c.name} value={c.name} />
          ))}
        </datalist>
        <span id="stk-group-hint" className="small muted">
          {cleanGroup(rosterGroup)
            ? classes.some((c) => c.name === cleanGroup(rosterGroup))
              ? `${cleanGroup(rosterGroup)} 명단만 새로 바꿉니다. 다른 반은 그대로입니다.`
              : `${cleanGroup(rosterGroup)}을(를) 새로 더합니다. 다른 반은 그대로입니다.`
            : '비워 두면 명단 전체를 바꿉니다.'}
        </span>
      </label>
      <textarea className="stk-roster" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'학번\t이름\n20301\t이름\n20415\t이름\n…'} aria-label={`${info.name} 명단 붙여넣기`} />
      <div className="row">
        <button className="btn btn-primary btn-sm" onClick={() => void applyRoster()} disabled={!parsed.students.length}>
          {parsed.students.length ? `${cleanGroup(rosterGroup) ? `${cleanGroup(rosterGroup)}에 ` : ''}${parsed.students.length}명 넣기` : '명단 넣기'}
        </button>
        {rosterText.trim() && (
          <span className="small muted">
            {parsed.students.length
              ? `읽은 학생 ${parsed.students.length}명 · 담임 반 ${new Set(parsed.students.map((s) => s.cls || '없음')).size}개에서` + (parsed.skipped ? ` · 건너뛴 줄 ${parsed.skipped}` : '')
              : '이름을 찾지 못했습니다. 이름이 든 칸을 함께 복사해 주세요.'}
          </span>
        )}
      </div>
    </div>
  )
}

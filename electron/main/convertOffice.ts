/**
 * 한글 · 워드 · 엑셀 · 파워포인트로 PDF 만들기 — 이 PC 에 깔린 프로그램을 윈도우 PowerShell 로 부린다(COM).
 *
 *  - 파일 길은 명령줄에 넣지 않고 JSON 파일로 넘긴다. 임시 폴더의 번호 이름(f001.hwp) 사본만 연다.
 *  - 문서의 매크로는 끈다. 암호가 걸린 오피스 파일은 가짜 암호로 열어 묻는 창 없이 실패하게 한다.
 *  - 한 파일에서 3분 동안 소식이 없으면(묻는 창 · 멈춤) 그 파일만 실패로 두고 다음 파일부터 다시 한다.
 *  - 억지로 끝낼 때는 이번에 새로 켠 프로그램만 끈다. 선생님이 열어 둔 한글 · 오피스는 건드리지 않는다.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ConvKind } from '../../shared/convert'

export type OfficeKind = Exclude<ConvKind, 'image' | 'pdf'>

export interface OfficeItem {
  id: string
  input: string
  output: string
}

const IDLE_LIMIT = 3 * 60 * 1000

const APP_NAME: Record<OfficeKind, string> = { hwp: '한컴오피스 한글', word: 'Microsoft Word', excel: 'Microsoft Excel', ppt: 'Microsoft PowerPoint' }

/** PowerShell 5.1 이 BOM 없는 파일을 읽으므로 아스키 글자만 쓴다 */
export const SCRIPT = `param([string]$Job)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$j = Get-Content -LiteralPath $Job -Encoding UTF8 -Raw | ConvertFrom-Json
function Say($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
$procName = @{ hwp = 'Hwp'; word = 'WINWORD'; excel = 'EXCEL'; ppt = 'POWERPNT' }[$j.engine]
$progId = @{ hwp = 'HWPFrame.HwpObject'; word = 'Word.Application'; excel = 'Excel.Application'; ppt = 'PowerPoint.Application' }[$j.engine]
$before = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
$app = $null
try { $app = New-Object -ComObject $progId } catch { Say 'NOAPP'; exit 0 }
Start-Sleep -Milliseconds 300
$own = @(Get-Process -Name $procName -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | ForEach-Object { $_.Id })
# Attached to a window the user already has open: never close or clear it. (PowerPoint is single-instance and handled below.)
if ($j.engine -ne 'ppt' -and $own.Count -eq 0 -and $before.Count -gt 0) { Say 'BUSY'; exit 0 }
foreach ($p in $own) { Say "PID $p" }
$oldSecurity = $null
try {
  if ($j.engine -eq 'hwp') {
    try { [void]$app.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') } catch {}
    try { $app.XHwpWindows.Item(0).Visible = $true } catch {}
  } elseif ($j.engine -eq 'word') {
    $app.Visible = $false; $app.DisplayAlerts = 0; $app.AutomationSecurity = 3
  } elseif ($j.engine -eq 'excel') {
    $app.Visible = $false; $app.DisplayAlerts = $false; $app.AutomationSecurity = 3; $app.AskToUpdateLinks = $false
  } else {
    $oldSecurity = $app.AutomationSecurity; $app.AutomationSecurity = 3
  }
  foreach ($it in $j.items) {
    Say "START $($it.id)"
    $doc = $null
    try {
      if ($j.engine -eq 'hwp') {
        if (-not $app.Open($it.input, '', 'forceopen:true')) { throw 'open failed' }
        if (-not $app.SaveAs($it.output, 'PDF', '')) { throw 'save failed' }
      } elseif ($j.engine -eq 'word') {
        $doc = $app.Documents.Open($it.input, $false, $true, $false, 'no-password')
        $doc.ExportAsFixedFormat($it.output, 17)
      } elseif ($j.engine -eq 'excel') {
        $doc = $app.Workbooks.Open($it.input, 0, $true, [Type]::Missing, 'no-password')
        if ($j.excelFit) {
          foreach ($sheet in $doc.Worksheets) {
            try { $sheet.PageSetup.Zoom = $false; $sheet.PageSetup.FitToPagesWide = 1; $sheet.PageSetup.FitToPagesTall = $false } catch {}
          }
        }
        $doc.ExportAsFixedFormat(0, $it.output)
      } else {
        $doc = $app.Presentations.Open($it.input, -1, 0, 0)
        $doc.SaveAs($it.output, 32)
      }
      if (-not (Test-Path -LiteralPath $it.output)) { throw 'no output' }
      Say "OK $($it.id)"
    } catch {
      Say ("FAIL $($it.id) " + ($_.Exception.Message -replace '[\\r\\n]+', ' '))
    } finally {
      try {
        if ($j.engine -eq 'hwp') { [void]$app.Clear(1) }
        elseif ($doc -and $j.engine -eq 'ppt') { $doc.Close() }
        elseif ($doc) { $doc.Close($false) }
      } catch {}
    }
  }
} finally {
  try { if ($null -ne $oldSecurity -and $before.Count -gt 0) { $app.AutomationSecurity = $oldSecurity } } catch {}
  try { if ($j.engine -ne 'ppt' -or $before.Count -eq 0) { $app.Quit() } } catch {}
  try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) } catch {}
  Say 'END'
}
`

const powershell = (): string => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

interface Round {
  /** 끝난 까닭 */
  end: 'done' | 'noapp' | 'busy' | 'stuck' | 'died' | 'aborted'
  /** 하던 파일 */
  current: string
}

/** 프로그램이 돌려준 오류 글은 알아듣기 어렵고 임시 파일 길이 섞이기도 해서 쉬운 말로 */
export function officeError(kind: OfficeKind, raw: string): string {
  if (/암호|password/i.test(raw)) return '암호가 걸린 파일입니다. 암호를 푼 뒤 다시 해 주세요.'
  return `${APP_NAME[kind]} 이(가) 열거나 저장하지 못했습니다. 암호가 걸렸거나 손상된 파일인지 확인해 주세요.`
}

export interface OfficeEvents {
  start: (id: string) => void
  ok: (id: string) => void
  fail: (id: string, message: string) => void
}

function killPids(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid)
    } catch {
      // 이미 끝났다
    }
  }
}

function runRound(kind: OfficeKind, script: string, jobFile: string, signal: AbortSignal, on: OfficeEvents, finished: Set<string>): Promise<Round> {
  return new Promise((resolve) => {
    const child = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Job', jobFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const own: number[] = []
    let current = ''
    let buffer = ''
    let end: Round['end'] | null = null
    let timer: NodeJS.Timeout | null = null
    let settled = false
    let started = false
    let aborting: NodeJS.Timeout | null = null

    const stop = (why: Round['end']): void => {
      end = why
      child.kill()
      killPids(own)
    }
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => stop('stuck'), IDLE_LIMIT)
    }
    // 프로그램이 켜지는 중(첫 파일을 시작하기 전)이면 켠 프로그램의 번호를 아직 모를 수 있다.
    // 바로 끊으면 숨은 창이 남으므로 첫 START 까지(길어야 8초) 기다렸다 끝낸다
    const onAbort = (): void => {
      if (started) return stop('aborted')
      end = 'aborted'
      aborting = setTimeout(() => stop('aborted'), 8000)
    }
    const finish = (r: Round): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (aborting) clearTimeout(aborting)
      signal.removeEventListener('abort', onAbort)
      resolve(r)
    }

    const line = (s: string): void => {
      const [word, id = ''] = s.split(' ', 2)
      if (word === 'PID') own.push(Number(id))
      else if (word === 'NOAPP') end = 'noapp'
      else if (word === 'BUSY') end = 'busy'
      else if (word === 'END') end = end ?? 'done'
      else if (word === 'START') {
        started = true
        if (aborting) return stop('aborted')
        current = id
        on.start(id)
      } else if (word === 'OK') {
        finished.add(id)
        current = ''
        on.ok(id)
      } else if (word === 'FAIL') {
        finished.add(id)
        current = ''
        on.fail(id, officeError(kind, s.slice(word.length + id.length + 2)))
      }
    }

    child.stdout.on('data', (d: Buffer) => {
      arm()
      buffer += d.toString('utf8')
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const s = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (s) line(s)
      }
    })
    child.stderr.on('data', () => undefined)
    child.on('error', () => finish({ end: 'died', current }))
    child.on('close', () => finish({ end: end ?? 'died', current }))
    signal.addEventListener('abort', onAbort)
    arm()
    if (signal.aborted) onAbort()
  })
}

/** 한 프로그램으로 바꿀 파일들을 차례로. 결과는 파일마다 on.ok · on.fail 로 */
export async function convertWithOffice(kind: OfficeKind, items: OfficeItem[], workDir: string, excelFit: boolean, signal: AbortSignal, on: OfficeEvents): Promise<void> {
  const name = APP_NAME[kind]
  const failAll = (list: OfficeItem[], message: string): void => list.forEach((x) => on.fail(x.id, message))
  if (process.platform !== 'win32') return failAll(items, `${name} 변환은 윈도우에서만 됩니다.`)

  const script = path.join(workDir, 'office.ps1')
  fs.writeFileSync(script, SCRIPT, 'ascii')
  const finished = new Set<string>()
  let left = items
  for (let round = 0; left.length && !signal.aborted; round++) {
    const jobFile = path.join(workDir, `job-${kind}-${round}.json`)
    fs.writeFileSync(jobFile, JSON.stringify({ engine: kind, excelFit, items: left }), 'utf8')
    const r = await runRound(kind, script, jobFile, signal, on, finished)
    left = left.filter((x) => !finished.has(x.id))
    if (r.end === 'aborted') return
    if (r.end === 'noapp') return failAll(left, `이 PC 에서 ${name} 을(를) 부를 수 없습니다. 설치되어 있는지 확인해 주세요.`)
    if (r.end === 'busy') return failAll(left, `열려 있는 ${name} 을(를) 모두 닫고 다시 해 주세요.`)
    const stuck = left.find((x) => x.id === r.current)
    // 어느 파일에서도 멈춘 것이 아니면 다시 해도 같다
    if (!stuck) return failAll(left, `${name} 을(를) 부리지 못했습니다. 보안 프로그램이 PowerShell 을 막았는지 확인해 주세요.`)
    on.fail(
      stuck.id,
      r.end === 'stuck'
        ? kind === 'hwp'
          ? '3분 동안 끝나지 않았습니다. 한글의 [접근 허용] 창이나 암호를 묻는 창이 떠 있었을 수 있습니다.'
          : '3분 동안 끝나지 않았습니다. 암호나 확인을 묻는 파일일 수 있습니다.'
        : `${name} 이(가) 이 파일에서 갑자기 끝났습니다.`
    )
    finished.add(stuck.id)
    left = left.filter((x) => x.id !== stuck.id)
  }
}

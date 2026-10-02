import type { MySlot, MyTimetable, TtPeriod } from '../../shared/timetable'
import { endOf, lunchOf, periodNow } from '../../shared/timetable'

interface Props {
  my: MyTimetable
  /** 수업 길이(분) */
  length: number
  /** 홈에 얹을 때 조금 작게 */
  compact?: boolean
  /** 오늘 요일 칸(0=월)과 지금 교시를 표시한다. -1 이면 표시하지 않음 */
  today?: number
  now?: string
  /** 칸을 눌렀을 때 (칸 고치기) */
  onCell?: (day: number, period: number) => void
}

/** "08:40" → "8:40" */
const hm = (t: string): string => t.replace(/^0/, '')

/** 칸 모양 — 수업은 청록, 창체는 분홍, 동아리는 회색, 그 밖에 손으로 적은 것은 연보라 */
export function slotKind(s: MySlot): 'class' | 'cr' | 'club' | 'etc' {
  if (/창체|자율|진로활동|봉사/.test(s.subject)) return 'cr'
  if (/동아리/.test(s.subject)) return 'club'
  if (s.manual && !s.cls) return 'etc'
  return 'class'
}

function timeLabel(p: TtPeriod, length: number): string {
  return p.start ? `${hm(p.start)} - ${hm(endOf(p, length))}` : ''
}

/**
 * 내 시간표를 그림처럼 그린다(학교에서 흔히 쓰는 시간표 그림 모양).
 * 홈 위젯 · 시간표 화면이 함께 쓰고, drawTimetable 로 같은 모양을 PNG 로도 만든다.
 */
export default function TimetableBoard({ my, length, compact, today = -1, now = '', onCell }: Props): JSX.Element {
  const lunch = lunchOf(my.periods, length)
  const cur = today >= 0 && now ? periodNow(my.periods, now, length) : { index: -1, during: false }
  const rows: JSX.Element[] = []
  my.periods.forEach((p, i) => {
    rows.push(
      <div className="ttb-row" key={`r${i}`}>
        <div className="ttb-period">
          <b>{p.label}</b>
          {p.start && <span>{timeLabel(p, length)}</span>}
        </div>
        {my.days.map((_, d) => {
          const s = my.grid[d]?.[i] ?? null
          const isNow = d === today && cur.index === i
          const off = i + 1 > (my.dayPeriods[d] ?? 99) && !s
          const cls = `ttb-cell ${s ? `k-${slotKind(s)}` : ''} ${isNow ? (cur.during ? 'now' : 'next') : ''} ${d === today ? 'today' : ''} ${off ? 'off' : ''} ${onCell ? 'editable' : ''}`
          const inner = s && (
            <>
              <span className="ttb-subj">{s.subject}</span>
              {s.cls && <span className="ttb-cls">{s.cls}</span>}
            </>
          )
          const title = isNow ? (cur.during ? '지금 수업' : '다음 수업') : undefined
          return onCell ? (
            <button key={d} type="button" className={cls} onClick={() => onCell(d, i)} title={title}>
              {inner}
            </button>
          ) : (
            <div key={d} className={cls} title={title}>
              {inner}
            </div>
          )
        })}
      </div>
    )
    if (lunch && lunch.after === i) {
      rows.push(
        <div className="ttb-lunch" key="lunch">
          점심 {hm(lunch.from)} ~ {hm(lunch.to)} ({lunch.minutes}′)
        </div>
      )
    }
  })
  return (
    <div className={`ttb ${compact ? 'ttb-compact' : ''}`} style={{ ['--ttb-days' as string]: my.days.length }}>
      <div className="ttb-row ttb-head">
        <div />
        {my.days.map((dn, d) => (
          <div key={dn} className={`ttb-day ${d === today ? 'today' : ''}`}>
            {dn}
          </div>
        ))}
      </div>
      {rows}
    </div>
  )
}

/* ---------- PNG ---------- */

const COLORS = {
  bg: '#fde9e1',
  frame: '#20324f',
  pillFill: '#ffffff',
  class: '#11899e',
  classText: '#ffffff',
  cr: '#fbd3d0',
  club: '#d9dadc',
  etc: '#e6dcf5',
  dark: '#1e2a3c',
  lunch: '#f7a6b8'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 화면의 시간표와 같은 모양으로 그림을 만든다 (2배 크기, PNG) */
export function drawTimetable(my: MyTimetable, length: number, title: string): string {
  const scale = 2
  const pad = 18
  const colW = 92
  const headH = 34
  const rowH = 58
  const lunch = lunchOf(my.periods, length)
  const lunchH = lunch ? 34 : 0
  const titleH = title ? 34 : 0
  const W = pad * 2 + colW * (my.days.length + 1) + 6 * my.days.length
  const H = pad * 2 + titleH + headH + 8 + my.periods.length * (rowH + 6) + (lunch ? lunchH + 6 : 0)
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  const font = (size: number, bold = false): string => `${bold ? '700 ' : ''}${size}px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif`

  ctx.fillStyle = COLORS.bg
  roundRect(ctx, 1, 1, W - 2, H - 2, 22)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = COLORS.frame
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  let y = pad
  if (title) {
    ctx.fillStyle = COLORS.dark
    ctx.font = font(17, true)
    ctx.fillText(title, W / 2, y + titleH / 2 - 4)
    y += titleH
  }
  const colX = (k: number): number => pad + (colW + 6) * k
  // 요일 머리
  my.days.forEach((dn, d) => {
    const x = colX(d + 1)
    roundRect(ctx, x, y, colW, headH - 6, 13)
    ctx.fillStyle = COLORS.pillFill
    ctx.fill()
    ctx.strokeStyle = COLORS.frame
    ctx.lineWidth = 1.6
    ctx.stroke()
    ctx.fillStyle = COLORS.dark
    ctx.font = font(15, true)
    ctx.fillText(dn, x + colW / 2, y + (headH - 6) / 2)
  })
  y += headH + 8
  my.periods.forEach((p, i) => {
    // 교시 칸
    roundRect(ctx, colX(0), y, colW, rowH, 22)
    ctx.fillStyle = COLORS.pillFill
    ctx.fill()
    ctx.strokeStyle = COLORS.frame
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.fillStyle = COLORS.dark
    ctx.font = font(12.5, true)
    ctx.fillText(p.label, colX(0) + colW / 2, y + (p.start ? rowH / 2 - 9 : rowH / 2))
    if (p.start) {
      ctx.font = font(11)
      ctx.fillText(timeLabel(p, length), colX(0) + colW / 2, y + rowH / 2 + 9)
    }
    my.days.forEach((_, d) => {
      const s = my.grid[d]?.[i]
      if (!s) return
      const x = colX(d + 1) + 3
      const kind = slotKind(s)
      roundRect(ctx, x, y + 4, colW - 6, rowH - 8, 9)
      ctx.fillStyle = kind === 'class' ? COLORS.class : COLORS[kind]
      ctx.fill()
      ctx.strokeStyle = COLORS.frame
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.fillStyle = kind === 'class' ? COLORS.classText : COLORS.dark
      const twoLine = !!s.cls
      ctx.font = font(s.subject.length > 5 ? 12 : 14, true)
      ctx.fillText(s.subject, x + (colW - 6) / 2, y + rowH / 2 + (twoLine ? -9 : 0), colW - 12)
      if (twoLine) {
        ctx.font = font(15, true)
        ctx.fillText(s.cls, x + (colW - 6) / 2, y + rowH / 2 + 11, colW - 12)
      }
    })
    y += rowH + 6
    if (lunch && lunch.after === i) {
      roundRect(ctx, pad, y, W - pad * 2, lunchH - 6, 14)
      ctx.fillStyle = COLORS.lunch
      ctx.fill()
      ctx.strokeStyle = COLORS.frame
      ctx.lineWidth = 1.4
      ctx.stroke()
      ctx.fillStyle = COLORS.dark
      ctx.font = font(14, true)
      ctx.fillText(`점심  ${hm(lunch.from)} ~ ${hm(lunch.to)} (${lunch.minutes}′)`, W / 2, y + (lunchH - 6) / 2)
      y += lunchH + 6
    }
  })
  return canvas.toDataURL('image/png')
}

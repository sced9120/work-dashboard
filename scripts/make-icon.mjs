/**
 * 앱 아이콘을 만든다. 외부 이미지 도구 없이 픽셀을 직접 그려
 * build/icon.png (512x512) 와 build/icon.ico (여러 크기) 를 생성한다.
 *
 *   node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build')

/* ---------- 그리기 ---------- */

/** 둥근 사각형 내부까지의 거리. 0보다 크면 바깥. */
function roundRectDist(x, y, left, top, right, bottom, r) {
  const cx = Math.max(left + r, Math.min(x, right - r))
  const cy = Math.max(top + r, Math.min(y, bottom - r))
  const dx = x - cx
  const dy = y - cy
  const d = Math.hypot(dx, dy)
  if (x >= left + r && x <= right - r) return Math.max(top - y, y - bottom)
  if (y >= top + r && y <= bottom - r) return Math.max(left - x, x - right)
  return d - r
}

/** 경계를 부드럽게 만들기 위한 알파값 (0~1) */
const cover = (dist, feather = 1.2) => Math.min(1, Math.max(0, 0.5 - dist / feather))

function blend(dst, i, r, g, b, a) {
  if (a <= 0) return
  const inv = 1 - a
  dst[i] = Math.round(dst[i] * inv + r * a)
  dst[i + 1] = Math.round(dst[i + 1] * inv + g * a)
  dst[i + 2] = Math.round(dst[i + 2] * inv + b * a)
  dst[i + 3] = Math.round(dst[i + 3] * inv + 255 * a)
}

/**
 * HSOrbit 마크 — 종이색 둥근 판 위에 궤도(꼬리) · 가운데 점 · 새벽 4시 자리의 주황 점.
 * 원본은 hsorbit.uk 로고 svg/hsorbit-mark.svg (viewBox 64): 호 M12.95 25 A22 22 0 1 1 24.48 56.67,
 * 가운데 (32,36) r9, 주황 (51.05,47) r4.5. 여기서는 512 판 가운데에 6.4배로 놓는다.
 */
const PAPER = [244, 243, 238]
const LINE = [226, 224, 216]
const INK = [53, 53, 50]
const HAND = [224, 122, 63]

function renderRGBA(size) {
  const s = size / 512 // 512 기준으로 좌표를 잡고 배율만 바꾼다
  const px = new Uint8Array(size * size * 4)
  const k = 6.4
  const at = (vx, vy) => [256 + (vx - 32) * k, 256 + (vy - 36) * k]
  const [cx, cy] = at(32, 36)
  const R = 22 * k
  // 작은 아이콘(16 · 24px)에서도 선이 끊기지 않게 최소 1.6px
  const stroke = Math.max(4 * k, (512 / size) * 1.6)
  const A0 = (-150 * Math.PI) / 180
  const A1 = (110 * Math.PI) / 180
  const e0 = [cx + R * Math.cos(A0), cy + R * Math.sin(A0)]
  const e1 = [cx + R * Math.cos(A1), cy + R * Math.sin(A1)]
  const [hx, hy] = at(51.05, 47)
  const feather = Math.max(1.2, 512 / size) // 512 좌표에서 1px 만큼 부드럽게

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const X = (x + 0.5) / s
      const Y = (y + 0.5) / s

      // 바탕: 종이색 둥근 사각형 + 얇은 테두리(흰 작업 표시줄에서도 보이게)
      const outer = roundRectDist(X, Y, 16, 16, 496, 496, 112)
      const bgA = cover(outer, feather)
      if (bgA > 0) blend(px, i, ...LINE, bgA)
      const inA = cover(roundRectDist(X, Y, 22, 22, 490, 490, 106), feather)
      if (inA > 0) blend(px, i, ...PAPER, inA)
      if (bgA <= 0) continue

      // 궤도: 호(둥근 끝)
      const ang = Math.atan2(Y - cy, X - cx)
      const onArc = ang >= A0 && ang <= A1
      const d = onArc ? Math.abs(Math.hypot(X - cx, Y - cy) - R) : Math.min(Math.hypot(X - e0[0], Y - e0[1]), Math.hypot(X - e1[0], Y - e1[1]))
      const arcA = cover(d - stroke / 2, feather)
      if (arcA > 0) blend(px, i, ...INK, arcA)

      // 가운데 점
      const coreA = cover(Math.hypot(X - cx, Y - cy) - 9 * k, feather)
      if (coreA > 0) blend(px, i, ...INK, coreA)

      // 새벽 4시 주황 점 (로고처럼 궤도 위에 그대로 얹는다)
      const handA = cover(Math.hypot(X - hx, Y - hy) - 5.2 * k, feather)
      if (handA > 0) blend(px, i, ...HAND, handA)
    }
  }
  return px
}

/* ---------- PNG 인코딩 ---------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // 필터 없음
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/* ---------- ICO 인코딩 ---------- */

function encodeIco(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 아이콘 타입
  header.writeUInt16LE(pngs.length, 4)

  const entries = []
  let offset = 6 + pngs.length * 16

  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size
    e[1] = size >= 256 ? 0 : size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(buf.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += buf.length
  }

  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)])
}

/* ---------- 실행 ---------- */

fs.mkdirSync(OUT_DIR, { recursive: true })

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, buf: encodePng(renderRGBA(size), size) }))

// electron-builder는 mac/linux 아이콘 원본으로 1024x1024를 권장한다.
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), encodePng(renderRGBA(1024), 1024))
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeIco(pngs))

console.log('아이콘을 만들었습니다: build/icon.png (1024x1024), build/icon.ico')

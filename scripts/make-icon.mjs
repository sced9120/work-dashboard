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

const lerp = (a, b, t) => a + (b - a) * t

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

/** 선분과 점 사이 거리 (체크 표시를 그리는 데 쓴다) */
function segDist(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1
  const vy = y2 - y1
  const wx = px - x1
  const wy = py - y1
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (x1 + t * vx), py - (y1 + t * vy))
}

function renderRGBA(size) {
  const s = size / 512 // 512 기준으로 좌표를 잡고 배율만 바꾼다
  const px = new Uint8Array(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const X = x / s
      const Y = y / s

      // 바탕: 파란 라운드 사각형에 위아래 그라데이션
      const bgA = cover(roundRectDist(X, Y, 16, 16, 496, 496, 104), 2)
      if (bgA > 0) {
        const t = Y / 512
        blend(px, i, lerp(59, 29, t), lerp(130, 78, t), lerp(246, 216, t), bgA)
      }

      // 뒤쪽 종이 한 장 (살짝 비껴 있음)
      const backA = cover(roundRectDist(X, Y, 150, 118, 388, 386, 22), 2)
      if (backA > 0) blend(px, i, 219, 232, 254, backA * 0.95)

      // 앞쪽 종이
      const paperA = cover(roundRectDist(X, Y, 128, 148, 366, 416, 22), 2)
      if (paperA > 0) blend(px, i, 255, 255, 255, paperA)

      // 목록 줄 세 개
      if (paperA > 0.9) {
        for (let k = 0; k < 3; k++) {
          const top = 206 + k * 56
          const right = k === 2 ? 268 : 322
          const lineA = cover(roundRectDist(X, Y, 226, top, right, top + 16, 8), 1.6)
          if (lineA > 0) blend(px, i, 148, 163, 184, lineA)

          // 줄 앞의 점
          const dotA = cover(Math.hypot(X - 186, Y - (top + 8)) - 10, 1.6)
          if (dotA > 0) blend(px, i, 191, 202, 216, dotA)
        }
      }

      // 완료 표시 (초록 원 + 흰 체크)
      const badgeA = cover(Math.hypot(X - 372, Y - 388) - 76, 2)
      if (badgeA > 0) blend(px, i, 255, 255, 255, badgeA)
      const badgeInner = cover(Math.hypot(X - 372, Y - 388) - 64, 2)
      if (badgeInner > 0) blend(px, i, 22, 163, 74, badgeInner)

      if (badgeInner > 0.5) {
        const d = Math.min(
          segDist(X, Y, 340, 388, 362, 412),
          segDist(X, Y, 362, 412, 406, 362)
        )
        const checkA = cover(d - 9, 1.8)
        if (checkA > 0) blend(px, i, 255, 255, 255, checkA)
      }
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

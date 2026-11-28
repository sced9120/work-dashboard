#!/usr/bin/env node
/**
 * 2022 개정 교육과정 성취기준을 프로그램이 읽는 모양으로 만든다.
 *
 *   node scripts/build-curriculum.mjs <k-curriculum-2022 폴더>
 *
 * 원본: https://github.com/greatsong/k-curriculum-2022 (data/standards.json)
 *   - 성취기준 원문은 교육부 고시 제2022-33호, 구조화 · 식별자는 greatsong 의 CC BY 4.0
 * 초 · 중 · 고 성취기준만 담는다(산업수요 전문교과는 학교급이 비어 있어 뺀다).
 * 결과: electron/main/data/curriculum2022.json — 메인 프로세스가 처음 찾을 때 한 번 읽는다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('사용법: node scripts/build-curriculum.mjs <k-curriculum-2022 폴더>')
  process.exit(1)
}
const root = resolve(src)
const rows = JSON.parse(readFileSync(join(root, 'data/standards.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(root, 'data/manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let commit = ''
try {
  commit = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // git 폴더가 아니면 비워 둔다
}

const LEVEL = { 초등학교: '초', 중학교: '중', 고등학교: '고' }
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

const out = []
for (const r of rows) {
  const level = LEVEL[r.school_level]
  if (!level) continue
  out.push([
    clean(r.key),
    clean(r.code),
    level,
    clean(r.grade_group),
    clean(r.subject_group),
    clean(r.subject),
    clean(r.curriculum_category),
    clean(r.area),
    clean(r.content),
    clean(r.explanation)
  ])
}
// 학교급 → 교과군 → 과목 → 원래 차례(코드 차례)
const ord = { 초: 0, 중: 1, 고: 2 }
out.sort((a, b) => ord[a[2]] - ord[b[2]] || a[4].localeCompare(b[4], 'ko') || a[5].localeCompare(b[5], 'ko') || 0)

const data = {
  meta: {
    name: '2022 개정 교육과정 성취기준',
    source: 'greatsong/k-curriculum-2022',
    url: 'https://github.com/greatsong/k-curriculum-2022',
    license: 'CC BY 4.0',
    version: String(pkg.version ?? ''),
    commit,
    schema: manifest.schema_version,
    origin: '교육부 고시 제2022-33호 「초·중등학교 교육과정」 및 별책',
    fields: ['key', 'code', 'level', 'gradeGroup', 'group', 'subject', 'category', 'area', 'content', 'note']
  },
  rows: out
}
const here = dirname(fileURLToPath(import.meta.url))
const target = join(here, '../electron/main/data/curriculum2022.json')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(data))
const byLevel = out.reduce((m, r) => ((m[r[2]] = (m[r[2]] ?? 0) + 1), m), {})
console.log(`성취기준 ${out.length}개 (초 ${byLevel.초} · 중 ${byLevel.중} · 고 ${byLevel.고}) → ${target}`)

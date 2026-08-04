import fs from 'node:fs/promises'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import ExcelJS from 'exceljs'
import type { ExtractedDoc } from '../../../shared/types'
import { extractHwp, decodeXmlEntities } from './hwp'

async function fromPdf(buf: Buffer): Promise<string> {
  // legacy 빌드가 Node 환경을 전제로 만들어져 있어 메인 프로세스에서 안전하다.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true
  }).promise

  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) {
        text += `${line}\n`
        line = ''
      }
    }
    if (line) text += `${line}\n`
    text += '\n'
    page.cleanup()
  }
  await doc.destroy()
  return text
}

async function fromXlsx(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)

  let text = ''
  wb.eachSheet((sheet) => {
    text += `\n[시트: ${sheet.name}]\n`
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = cell.value
        if (v === null || v === undefined) cells.push('')
        else if (typeof v === 'object' && 'text' in v) cells.push(String(v.text))
        else if (typeof v === 'object' && 'result' in v) cells.push(String(v.result ?? ''))
        else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10))
        else cells.push(String(v))
      })
      const line = cells.join('\t').trim()
      if (line) text += `${line}\n`
    })
  })
  return text
}

function fromDocx(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf))
  const entry = files['word/document.xml']
  if (!entry) return ''
  const xml = strFromU8(entry)
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
  let text = ''
  for (const m of xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>|\n/g)) {
    text += m[0] === '\n' ? '\n' : decodeXmlEntities(m[1] ?? '')
  }
  return text
}

function fromPlainText(buf: Buffer): string {
  const utf8 = buf.toString('utf-8')
  // 한글 윈도우에서 만든 txt/csv는 CP949인 경우가 많다.
  if (utf8.includes('�')) {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return utf8
    }
  }
  return utf8
}

/** 공백만 잔뜩 있는 문서를 AI에 그대로 넘기지 않도록 정리한다. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractFile(filePath: string): Promise<ExtractedDoc> {
  const name = path.basename(filePath)
  const ext = path.extname(filePath).slice(1).toLowerCase()

  try {
    const buf = await fs.readFile(filePath)
    let raw = ''

    switch (ext) {
      case 'hwp':
      case 'hwpx':
        raw = extractHwp(buf, ext)
        break
      case 'pdf':
        raw = await fromPdf(buf)
        break
      case 'xlsx':
      case 'xlsm':
        raw = await fromXlsx(buf)
        break
      case 'xls':
        return {
          filename: name,
          text: '',
          chars: 0,
          error: '옛날 엑셀(.xls)은 읽을 수 없습니다. 엑셀에서 .xlsx로 저장한 뒤 올려 주세요.'
        }
      case 'docx':
        raw = fromDocx(buf)
        break
      case 'txt':
      case 'md':
      case 'csv':
        raw = fromPlainText(buf)
        break
      default:
        return {
          filename: name,
          text: '',
          chars: 0,
          error: `지원하지 않는 형식입니다 (.${ext}). PDF, 한글(hwp/hwpx), 엑셀(xlsx), 워드(docx), 텍스트를 지원합니다.`
        }
    }

    const text = tidy(raw)
    if (text.length < 10) {
      return {
        filename: name,
        text,
        chars: text.length,
        error:
          '글자를 거의 읽지 못했습니다. 스캔한 이미지 문서일 수 있습니다. 한글이나 워드에서 PDF로 다시 저장한 뒤 올려 보세요.'
      }
    }
    return { filename: name, text, chars: text.length }
  } catch (e) {
    return {
      filename: name,
      text: '',
      chars: 0,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

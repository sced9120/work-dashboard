// vite 가 pdf.js 일꾼 파일을 앱 안의 자산으로 내보내고 그 주소를 준다
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const src: string
  export default src
}

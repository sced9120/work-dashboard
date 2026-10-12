# 시험 (tests/)

창을 띄우지 않고, 빌드한 메인(`out/main/index.js`)의 IPC 처리기를 바로 불러 시험합니다.
`hook.cjs` 가 `electron` 을 가짜로 바꿔 끼우고, 자료 폴더는 임시 폴더를 씁니다(실제 DB · 키를 건드리지 않음).
바깥 요청(Gemini · GitHub)은 시험마다 `global.fetch` 를 가로채 가짜로 답합니다 — **진짜 API 키를 쓰지 않습니다.**
`tsload.cjs` 는 `shared/*.ts` 를 빌드 없이 읽는 도우미입니다.

```bash
npm run build
node -r ./tests/hook.cjs ./tests/run_ocr.cjs       # 스캔 문서 → 엑셀 (OCR)
node -r ./tests/hook.cjs ./tests/run_catalog.cjs   # 도구 모음 목록 받기
node -r ./tests/hook.cjs ./tests/run_memo.cjs      # 자유 메모장
node tests/t_mdtable.cjs                           # 답에서 표 뽑기 · 이어 붙이기 · 수식 (빌드 없이)
node tests/t_catalog.cjs                           # remote/catalog.json 규칙 (빌드 없이)
```

Electron 의 Node 로 돌리려면 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -r ./tests/hook.cjs ./tests/run_ocr.cjs`
(윈도우는 `electron.exe`). 둘 다 같은 결과가 나와야 합니다.

| 파일 | 보는 것 |
|---|---|
| `run_ocr.cjs` | 파일 고르기(경로는 화면에 안 넘김) · 보내는 요청 모양(지침 · 그림 해상도 high · 생각 low · temperature 없음) · PDF 원본 inline · 끊긴 답 이어 받기 · 큰 파일 Gemini 파일 저장소(이름 안 보냄 · 끝나면 지움) · 오류 안내 · 엑셀(글자 그대로 · 수식 아님 · LaTeX 는 읽기 쉬운 글자로 · 아주 긴 칸은 열을 넓혀 줄 높이 409 안에) · 만든이 지침 바꾸기 · 기존 Gemini 대화 temperature |
| `run_catalog.cjs` | GitHub → jsDelivr · 3시간 두기 · 깨진 파일이면 마지막 것 · 인수인계 파일에 안 들어감 |
| `run_memo.cjs` | 메모 · 자유 워크플로우 · 검색 · '넘기기' 켠 것만 인수인계 |
| `t_mdtable.cjs` | `\|` · 코드 안의 \| · 코드 울타리 · ```markdown 으로 감싼 표 · 덜 나온 행 빼기 · 머리글 같은 표 잇기 · 수식(LaTeX) 안의 `\\` 지키기와 글자로 바꾸기(행렬 · 분수 · 첨자 · 기호, `$5` 같은 돈은 그대로) · `<br>` |
| `t_catalog.cjs` | https 만 · 테마 토큰만 · 의견 설문지 · OCR 지침/모델 · 실제 `remote/catalog.json` |

# 시험 (tests/)

창을 띄우지 않고, 빌드한 메인(`out/main/index.js`)의 IPC 처리기를 바로 불러 시험합니다.
`hook.cjs` 가 `electron` 을 가짜로 바꿔 끼우고, 자료 폴더는 임시 폴더를 씁니다(실제 DB · 키를 건드리지 않음).
화면으로 보낸 소식(webContents.send — 받는 중 글 · 진행 표시)은 `global.__it.calls.sent` 에 모입니다.
바깥 요청(Gemini · GitHub)은 시험마다 `global.fetch` 를 가로채 가짜로 답합니다 — **진짜 API 키를 쓰지 않습니다.**
`tsload.cjs` 는 `shared/*.ts` 를 빌드 없이 읽는 도우미입니다.

```bash
npm run build
node -r ./tests/hook.cjs ./tests/run_ocr.cjs       # 스캔 문서 → 엑셀 (OCR)
node -r ./tests/hook.cjs ./tests/run_chat.cjs      # 업무 도우미 · 일반 대화 · 대화 보관
node -r ./tests/hook.cjs ./tests/run_catalog.cjs   # 도구 모음 목록 받기
node -r ./tests/hook.cjs ./tests/run_memo.cjs      # 자유 메모장
node tests/t_mdtable.cjs                           # 답에서 표 뽑기 · 이어 붙이기 · 수식 (빌드 없이)
node tests/t_markdown.cjs                          # AI 답의 Markdown 그리기 (빌드 없이)
node tests/t_catalog.cjs                           # remote/catalog.json 규칙 (빌드 없이)
```

Electron 의 Node 로 돌리려면 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -r ./tests/hook.cjs ./tests/run_ocr.cjs`
(윈도우는 `electron.exe`). 둘 다 같은 결과가 나와야 합니다.

| 파일 | 보는 것 |
|---|---|
| `run_ocr.cjs` | 파일 고르기(경로는 화면에 안 넘김) · 보내는 요청 모양(지침 · 그림 해상도 high · 생각 low · temperature 없음) · PDF 원본 inline · 끊긴 답 이어 받기 · 큰 파일 Gemini 파일 저장소(이름 안 보냄 · 끝나면 지움) · 오류 안내 · 엑셀(글자 그대로 · 수식 아님 · LaTeX 는 읽기 쉬운 글자로 · 아주 긴 칸은 열을 넓혀 줄 높이 409 안에) · 탭(끌어 놓은 파일 · 함께 읽기 · 진행 표시에 탭 번호 · 그 탭만 멈추기 · 5개까지 · 닫으면 그 탭이 올린 파일만 지움) · OpenAI 키만 있을 때(gpt-6-luna · 같은 지침 + OpenAI 규칙 · 생각 medium · detail high · PDF 그대로 · 이어 받기 · 생각 설정 빼고 다시 · HEIC 막기 · 큰 PDF 파일 저장소 · 4쪽 넘는 PDF 는 4쪽씩 나눠 읽고 한 표로(같은 머리글 · 이어지는 쪽 붙이기 · 묶음 안 이어 받기 · 실패한 묶음만 빠짐) · 만든이 모델 · 키 없음) · 만든이 지침 바꾸기 · 기존 Gemini 대화 temperature |
| `run_chat.cjs` | 파일 올리기(글 · 사진 · 스캔 PDF · 막는 것) · 일반 대화(지침 · 보관 자료 없음 · temperature 없음) · 다음 질문에도 앞 파일 · 고르지 않은 경로는 안 읽음 · 업무 도우미 지침 · OpenAI(image_url · file) · Claude(image · document) · HEIC · 받는 대로 · 멈추기 · 오류 · 대화 보관(목록 · 이름 · 지우기 · 이상한 번호) · 지침 모음 · 키 없는 서비스를 골랐으면 키 있는 서비스로 · 인수인계 파일에 안 들어감 |
| `run_catalog.cjs` | GitHub → jsDelivr · 3시간 두기 · 깨진 파일이면 마지막 것 · 인수인계 파일에 안 들어감 |
| `run_memo.cjs` | 메모 · 자유 워크플로우 · 검색 · '넘기기' 켠 것만 인수인계 |
| `t_mdtable.cjs` | `\|` · 코드 안의 \| · 코드 울타리 · ```markdown 으로 감싼 표 · 덜 나온 행 빼기 · 머리글 같은 표 잇기 · 수식(LaTeX) 안의 `\\` 지키기와 글자로 바꾸기(행렬 · 분수 · 첨자 · 기호, `$5` 같은 돈은 그대로) · `<br>` |
| `t_markdown.cjs` | 굵게 · 기울임 · 코드 · 지움 · 스크립트는 글자로 · 링크는 http(s) 만 · 겹친 목록 · 칸 수가 다른 표 · 닫히지 않은 코드 · 수식 · 오래 걸리지 않음 |
| `t_catalog.cjs` | https 만 · 테마 토큰만 · 의견 설문지 · OCR 지침/모델(Gemini · OpenAI) · 실제 `remote/catalog.json` |

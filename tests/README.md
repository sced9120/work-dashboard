# 시험 (tests/)

창을 띄우지 않고, 빌드한 메인(`out/main/index.js`)의 IPC 처리기를 바로 불러 시험합니다.
`hook.cjs` 가 `electron` 을 가짜로 바꿔 끼우고, 자료 폴더는 임시 폴더를 씁니다(실제 DB · 키를 건드리지 않음).
화면으로 보낸 소식(webContents.send — 받는 중 글 · 진행 표시)은 `global.__it.calls.sent` 에 모입니다.
바깥 요청(Gemini · GitHub)은 시험마다 `global.fetch` 를 가로채 가짜로 답합니다 — **진짜 API 키를 쓰지 않습니다.**
`tsload.cjs` 는 `shared/*.ts` 를 빌드 없이 읽는 도우미입니다.

```bash
npm run build
node -r ./tests/hook.cjs ./tests/run_ocr.cjs       # 스캔 문서 → 엑셀 (OCR)
node -r ./tests/hook.cjs ./tests/run_batch.cjs     # 폴더 일괄 분석 (학생별 정리 · 세특 · 채점)
node -r ./tests/hook.cjs ./tests/run_chat.cjs      # 업무 도우미 · 일반 대화 · 대화 보관
node -r ./tests/hook.cjs ./tests/run_catalog.cjs   # 도구 모음 목록 받기
node -r ./tests/hook.cjs ./tests/run_memo.cjs      # 자유 메모장
node -r ./tests/hook.cjs ./tests/run_messenger.cjs # 메신저 정리 · 폰에서 보내기
node -r ./tests/hook.cjs ./tests/run_exaone.cjs    # K-EXAONE (LG) 연결
node tests/t_mdtable.cjs                           # 답에서 표 뽑기 · 이어 붙이기 · 수식 (빌드 없이)
node tests/t_markdown.cjs                          # AI 답의 Markdown 그리기 (빌드 없이)
node tests/t_catalog.cjs                           # remote/catalog.json 규칙 (빌드 없이)
node tests/t_ttdated.cjs                           # 시간표 — 그 날만 바꾼 수업 (빌드 없이)
node tests/t_widgetgrid.cjs                        # 새 화면 오늘 판 — 위젯 칸 놓기 · 밀기 · 크기 (빌드 없이)
node tests/t_hwpfit.cjs                            # 한글 양식 — 양식과 새 문서 맞춰 보기 · 칸 맞춤 · 『 』 굵게 · 검사관 답 (빌드 없이)
node tests/t_chatdoc.cjs                           # 도우미 한글 파일 묶음 여러 개 · 모양 표시 걷어 내기 · 말하는 사람 대조 (빌드 없이)
node tests/t_messenger.cjs                         # 출결 명단 · 기록, 메신저 답 읽기, 폰 우편함 스크립트 (빌드 없이)
node tests/t_weather.cjs                           # 날씨 · D-Day 위젯 — 학교 주소 → 지역 · 미세먼지 등급 · 날씨 답 읽기 · D-Day 셈 (빌드 없이)
```

Electron 의 Node 로 돌리려면 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron -r ./tests/hook.cjs ./tests/run_ocr.cjs`
(윈도우는 `electron.exe`). 둘 다 같은 결과가 나와야 합니다.

| 파일 | 보는 것 |
|---|---|
| `run_ocr.cjs` | 파일 고르기(경로는 화면에 안 넘김) · 보내는 요청 모양(지침 · 그림 해상도 high · 생각 low · temperature 없음) · PDF 원본 inline · 끊긴 답 이어 받기 · 큰 파일 Gemini 파일 저장소(이름 안 보냄 · 끝나면 지움) · 오류 안내 · 엑셀(글자 그대로 · 수식 아님 · LaTeX 는 읽기 쉬운 글자로 · 아주 긴 칸은 열을 넓혀 줄 높이 409 안에) · 탭(끌어 놓은 파일 · 함께 읽기 · 진행 표시에 탭 번호 · 그 탭만 멈추기 · 5개까지 · 닫으면 그 탭이 올린 파일만 지움) · OpenAI 키만 있을 때(gpt-6-luna · 같은 지침 + OpenAI 규칙 · 생각 medium · detail high · PDF 그대로 · 이어 받기 · 생각 설정 빼고 다시 · HEIC 막기 · 큰 PDF 파일 저장소 · 4쪽 넘는 PDF 는 4쪽씩 나눠 읽고 한 표로(같은 머리글 · 이어지는 쪽 붙이기 · 묶음 안 이어 받기 · 실패한 묶음만 빠짐) · 만든이 모델 · 키 없음) · 만든이 지침 바꾸기 · 기존 Gemini 대화 temperature |
| `run_batch.cjs` | 폴더 고르기 · 끌어 놓기(경로는 화면에 안 넘김) · 학번(이름)으로 묶기(사진 두 장 = 한 학생 · 하위 폴더 이름 · 임시 파일 빼기) · 학생마다 요청 한 번 · 워드 글 + 안의 그림 · 파일 이름 · 학생 이름 안 보냄 · JSON 으로 받기 · 지침(항목 · 글자 수 · 채점 기준) · 세특 글자 수 고쳐 받기 · 항목 이름 맞추기 · 엑셀 · CSV(BOM) · OpenAI(detail high · PDF 이름 없이) · Claude(document) · 키 오류면 멈춤 |
| `run_chat.cjs` | 파일 올리기(글 · 사진 · 스캔 PDF · 막는 것) · 일반 대화(지침 · 보관 자료 없음 · temperature 없음) · 다음 질문에도 앞 파일 · 고르지 않은 경로는 안 읽음 · 업무 도우미 지침 · OpenAI(image_url · file) · Claude(image · document) · HEIC · 받는 대로 · 멈추기 · 오류 · 대화 보관(목록 · 이름 · 지우기 · 이상한 번호) · 지침 모음 · 키 없는 서비스를 골랐으면 키 있는 서비스로 · 인수인계 파일에 안 들어감 |
| `run_catalog.cjs` | GitHub → jsDelivr · 3시간 두기 · 깨진 파일이면 마지막 것 · 인수인계 파일에 안 들어감 |
| `run_memo.cjs` | 메모 · 자유 워크플로우 · 검색 · '넘기기' 켠 것만 인수인계 |
| `run_exaone.cjs` | 처음 값 · 주소 · Bearer 키 · 모델 · reasoning_effort high · response_format 안 보냄 · 답 앞 줄바꿈 없앰 · 받는 대로 받을 때 생각(reasoning_content)은 버리고 답만 · 사진은 안 보내고 글로 알림 · 429 면 쉬었다 한 번 더 · 401 안내 · 키 저장 칸 |
| `run_messenger.cjs` | 가리기(명단 학생 → 학생N · 성 없는 이름 · 다른 사람 → 사람A · 전화번호, 겹치는 이름은 그대로) · AI 에는 가린 글만 · 답의 가명 되돌리기 · 학생N → 명단 번호 · 키 없음 · 폰 우편함(코드 만들기 · 주소 모양 · 잇기 ping · 가져오기 + ack · 같은 글 두 번 안 넣기 · 받은 글 지우기 · HTML 답이면 배포 안내) · 인수인계 파일에 명단 · 출결 · 받은 글 없음 · 열쇠는 AI 키와 같은 칸 |
| `t_mdtable.cjs` | `\|` · 코드 안의 \| · 코드 울타리 · ```markdown 으로 감싼 표 · 덜 나온 행 빼기 · 머리글 같은 표 잇기 · 수식(LaTeX) 안의 `\\` 지키기와 글자로 바꾸기(행렬 · 분수 · 첨자 · 기호, `$5` 같은 돈은 그대로) · `<br>` |
| `t_markdown.cjs` | 굵게 · 기울임 · 코드 · 지움 · 스크립트는 글자로 · 링크는 http(s) 만 · 겹친 목록 · 칸 수가 다른 표 · 닫히지 않은 코드 · 수식 · 오래 걸리지 않음 |
| `t_ttdated.cjs` | 주 고르기(일요일은 다음 주) · 그 날만 바꾸기 · 되돌리기 · 원래 글이면 안 바꿈 · 60일 지난 것 지우기 · 그 주에만 얹기 · 바뀐 칸에 원래 글 · 깨진 값 |
| `t_widgetgrid.cjs` | 놓으면 겹친 위젯을 아래로(연쇄) · 끄는 동안 처음 자리에서 다시 계산 · 빈칸 메우기 · 첫 빈자리 · 깨진 판 풀기 · 판 · 크기 한도 · 손잡이별 크기 · 좁은 창 차례 |
| `t_hwpfit.cjs` | 칸 맞춤 빈칸 되살리기(":" 없는 빈칸 · 쉼표 뒤는 그대로) · 『 』 안 굵게(바탕 모양이면 그대로) · 빠진 문단 · 빠진 문장 · 빠진 항목 줄 · 번호 건너뜀 · 지어 붙인 문단 · 제목 · 받는 사람 빈칸 · 학생 두 벌 · 둘째 벌에서만 빠진 줄 · 검사관 답(고친 것 · 물을 것 · 고친 문서 · 없음 · 그대로 · 모양 틀림) |
| `t_chatdoc.cjs` | 한 답의 문서 묶음 여러 개 · "내용:" 없는 묶음 · "본문:" · 지침 문구 · "(가운데 · 24pt · 굵게)" · "11pt · 굵게 — " 걷어 내기(본문 괄호는 그대로) · 화자 읽기 · 양식에 없는 화자 찾기 |
| `t_messenger.cjs` | 명단 읽기(번호 · 학번 · 탭 · 번호 없음 · 겹친 번호) · 출결 합치기(같은 날 · 학생 · 종류) · 합계 · 표 복사 · 서류 기본값 · 프롬프트 날짜 · AI 답 읽기(틀린 날짜 · 시각 · 종류, 학생N → 번호) · 우편함 열쇠 · 웹 앱 주소 · 생성한 Apps Script 를 가짜 구글로 돌리기(열쇠 확인 · 쌓기 · 가져오기 · 지우기 · 폰 화면 스크립트 문법) |
| `t_weather.cjs` | 학교 주소에서 시 · 군 · 구만(도 · 광역시 · 특별자치시) · 짧은 이름 · 날씨 코드 말(밤엔 달) · 미세먼지 등급(환경부 기준, 나쁜 쪽) · Open-Meteo 답(지금 · 오늘 · 내일 · 지금 시부터 12시간 · 미세먼지 못 받아도) · 우산 · 지금 비 · 미세먼지 알림 · D-Day(D-Day · D+ · 해 넘김) · 틀린 D-Day 빼기 · 다가오는 것 먼저 |
| `t_catalog.cjs` | https 만 · 테마 토큰만 · 의견 설문지 · OCR 지침/모델(Gemini · OpenAI) · 실제 `remote/catalog.json` |

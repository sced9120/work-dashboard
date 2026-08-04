# 업무 인수인계 대시보드

학교 담당 업무를 정리해 두고, 다음 담당자에게 **파일 하나로** 넘겨주기 위한 데스크톱 프로그램입니다.

기존 Streamlit 버전(`my_dashboard/app.py`)을 Electron 데스크톱 앱으로 새로 만든 것으로,
받는 사람이 Python이나 PyCharm을 설치할 필요 없이 **설치파일 하나로 끝납니다.**

---

## 무엇이 달라졌나

| | 예전 (Streamlit) | 지금 (Electron) |
|---|---|---|
| 설치 | Python + PyCharm + `pip install` 7개 | 설치파일 실행 한 번 |
| 실행 | 명령 프롬프트에 명령어 입력 | 바탕화면 아이콘 더블클릭 |
| 한글(.hwp) 읽기 | 압축을 풀지 않아 대부분 깨짐 (한글 프로그램 설치 시에만 정상) | 압축 해제 후 직접 해석, 한글 미설치 PC에서도 동작 |
| 상세 가이드 편집 | 화면에서 고쳐도 저장 안 됨 | 저장됨 |
| AI 모델 | 존재하지 않는 이름(`GPT 5.2`, `gemini-3.0-pro`) → 호출 실패 | 실제 모델명, 설정에서 직접 입력 가능 |
| API 키 | 인수인계 DB 안에 평문 저장 → 남에게 그대로 전달됨 | OS 보안 저장소에 이 PC에만 저장, 인수인계 파일에서 자동 제거 |
| AI 분석 결과 | 확인 없이 바로 DB에 등록 | 목록으로 보여주고 고른 것만 등록 |
| 긴 문서 | 앞 35,000자만 분석 | 여러 조각으로 나눠 전부 분석 |

---

## 배포용 설치파일 만들기 (GitHub Actions)

맥에서는 윈도우 설치파일을 만들 수 없어서, GitHub의 윈도우 서버에서 대신 빌드합니다.
**처음 한 번만** 아래를 설정해 두면, 이후에는 버튼 한 번으로 새 설치파일이 나옵니다.

### 1. GitHub에 비공개 저장소 만들기

[github.com/new](https://github.com/new) 에서 저장소를 하나 만듭니다. (Private 권장)

### 2. 코드 올리기

이 폴더에서:

```bash
git remote add origin https://github.com/<사용자명>/<저장소명>.git
```

```bash
git push -u origin main
```

### 3. 빌드 실행

GitHub 저장소 → **Actions** 탭 → 왼쪽에서 **윈도우 설치파일 빌드** →
오른쪽 **Run workflow** 버튼 클릭. 5분쯤 뒤 완료됩니다.

완료된 실행을 눌러 맨 아래 **Artifacts** 에서 `WorkDashboard-Windows` 를 내려받으면
그 안에 설치파일이 있습니다.

- `WorkDashboard-Setup-1.0.0.exe` — 설치 프로그램 (관리자 권한 없이 설치됨)
- `WorkDashboard-Portable-1.0.0.exe` — 설치 없이 실행만 하는 파일 (설치가 막힌 PC용)

### 4. 버전 올려 배포하기

`package.json`의 `version`을 올리고 태그를 붙여 올리면, 설치파일이 자동으로
**Releases** 에 첨부되어 링크로 바로 공유할 수 있습니다.

```bash
git tag v1.0.1 && git push origin v1.0.1
```

---

## 개발자용

### 실행

```bash
npm install
```

```bash
npm run dev
```

### 확인

```bash
npm run typecheck
```

### 로컬에서 빌드 (맥용 dmg)

```bash
npm run build:mac
```

> 윈도우 설치파일은 윈도우에서만 만들 수 있습니다. 맥에서는 GitHub Actions를 쓰세요.

---

## 구조

```
electron/
  main/
    index.ts      창 생성, IPC 핸들러 등록
    db.ts         SQLite(sql.js) 자료 저장 — 예전 .db 파일과 호환
    secrets.ts    API 키를 OS 보안 저장소에 보관 (인수인계 파일과 분리)
    ai.ts         OpenAI / Gemini 호출, 긴 문서 분할, 응답 검증
    extract/
      index.ts    PDF · 엑셀 · 워드 · 텍스트에서 글자 뽑기
      hwp.ts      한글 파일(.hwp 5.0 / .hwpx) 해석
  preload/
    index.ts      렌더러에 노출할 API 정의
src/
  App.tsx         화면 전환
  pages/          홈 · 로드맵 · 상세가이드 · 문서학습 · 데이터 · 설정
shared/types.ts   양쪽이 함께 쓰는 타입
scripts/make-icon.mjs  아이콘 생성 (외부 도구 없이 픽셀을 직접 그림)
```

### 자료가 저장되는 곳

| | 경로 |
|---|---|
| 업무·공지 자료 | `%APPDATA%\업무 인수인계 대시보드\work-dashboard.db` |
| 자동 백업 | `%APPDATA%\업무 인수인계 대시보드\backups\` |
| API 키 | `%APPDATA%\업무 인수인계 대시보드\settings.json` (Windows DPAPI로 암호화) |

자료 파일은 평범한 SQLite 파일이라 필요하면 DB 뷰어로도 열립니다.
예전 Streamlit 버전에서 쓰던 `school_admin_v25_final.db` 도 그대로 불러올 수 있습니다.

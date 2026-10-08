import type { PageId } from '../App'
import { navLabel } from './nav'

/**
 * 따라 배우기 — 메뉴마다 실제 화면 위에서 한 단계씩 짚어 주는 안내.
 *
 * 대상은 화면 글자로 찾는다(sel + text). 화면 파일마다 표시를 달지 않아도 되고,
 * 글자가 바뀌어 못 찾으면 그 단계는 가운데에 설명만 띄운다(optional 이면 건너뛴다).
 * 직접 눌러 보는 단계(click)는 자료가 바뀌지 않는 것만 고른다 — 탭 · 보기 바꾸기 · 칸 열고 닫기.
 */

export interface TourStep {
  /** CSS 선택자. 여러 개 맞으면 화면에 보이는 첫 번째 */
  sel?: string
  /** 이 글자가 들어 있는 것만 */
  text?: string
  /** 글자가 정확히 같은 것만 (앞뒤 빈칸 · 이모지 무시 안 함) */
  exact?: boolean
  /** 찾은 것에서 이 선택자로 올라간 상자를 비춘다 (예: 제목 → 카드 전체) */
  up?: string
  title: string
  body: string
  /** 표시된 곳을 직접 눌러야 다음으로 간다 */
  click?: boolean
  /** 화면에 없으면 조용히 건너뛴다 */
  optional?: boolean
}

export interface Tour {
  page: PageId
  /** 목록에 보이는 한 줄 설명 */
  intro: string
  steps: TourStep[]
}

const H1 = '.main .page-head h1'
const card = (title: string): Pick<TourStep, 'sel' | 'text' | 'up'> => ({ sel: '.main .card-title', text: title, up: '.card' })

export const TOURS: Record<PageId, Tour> = {
  홈: {
    page: '홈',
    intro: '오늘 패널 · 위젯 · 홈 꾸미기 · 메뉴 접기',
    steps: [
      { sel: H1, title: '홈은 하루를 여는 곳', body: '위젯을 모아 둔 판입니다. 위젯마다 오른쪽 위 단추로 그 화면으로 가거나(↗) 접고(▾) 넓히고(↔) 닫을(✕) 수 있습니다.' },
      { sel: '.td-hero', title: '오늘', body: '지금 몇 교시인지, 다음 수업이 무엇인지, 오늘 달력에 적힌 일정을 보여 줍니다. 시간표 파일을 불러오면 교시 띠가 채워집니다.', optional: true },
      { sel: '.td-ask', title: '도우미에게 바로 묻기', body: '여기 적고 Enter를 누르면 업무 도우미 화면 입력칸에 옮겨 적힙니다. 위의 예시 문장을 눌러도 됩니다.', optional: true },
      { sel: '.td-stack', title: '절차 기한 카드', body: '맨 앞 카드가 가장 급한 기한입니다. 뒤 카드를 누르면 앞으로 오고, 왼쪽 동그란 단추는 처리했다는 표시입니다.', optional: true },
      { sel: '.td-fan', title: '오늘 급식', body: '나이스에 학교를 연결하면 조식 · 중식 · 석식이 카드로 뜹니다. 시각에 맞는 끼니가 앞에 오고, 동그라미 단추로 넘깁니다.', optional: true },
      { sel: '.main button', text: '홈 꾸미기', click: true, title: '홈 꾸미기를 눌러 보세요', body: '위젯을 끌어 옮기고, 빠진 위젯을 더하고, 배치 방식을 고를 수 있습니다.' },
      { sel: '.hw-add', title: '배치와 위젯 더하기', body: '격자 배치는 두 칸에 맞춰 놓고, 자유 배치는 창처럼 아무 데나 놓습니다. 아래에서 빠진 위젯을 다시 더할 수 있습니다.', optional: true },
      { sel: '.main button', text: '꾸미기 끝', click: true, title: '꾸미기 끝을 눌러 마치세요', body: '바꾼 배치는 바로 저장됩니다. 아무것도 안 바꿨으면 그대로입니다.', optional: true },
      { sel: '.side-knob', title: '메뉴 접고 펼치기', body: '이 동그라미를 누르면 왼쪽 메뉴가 아이콘만 남기고 접힙니다. 접힌 메뉴는 마우스를 올리면 이름이 뜹니다.' },
      { sel: '.side-learn', title: '언제든 다시 배우기', body: '여기를 누르면 이 목록이 열립니다. 어느 화면에서든 F1을 누르면 그 화면을 바로 배웁니다.' }
    ]
  },
  달력: {
    page: '달력',
    intro: '일정 넣기 · 월/주 보기 · 학사일정 · 구글 캘린더',
    steps: [
      { sel: H1, title: '달력', body: '내 일정, 학교 학사일정, 업무 기한을 한 달 또는 한 주로 봅니다.' },
      { sel: '.main button', text: '＋ 일정', title: '일정 넣기', body: '날짜 · 시각 · 색을 골라 일정을 넣습니다. 기한으로 챙기기를 켜면 D-day가 붙고 윈도우 알림 대상이 됩니다.' },
      { sel: '.main .cal-cell.today', title: '날짜 칸', body: '날짜를 누르면 그날 일정이 옆에 뜨고 바로 더할 수 있습니다. 일정 막대는 끌어서 다른 날로 옮길 수 있습니다.', optional: true },
      { sel: '.main button', text: '주', exact: true, click: true, title: '한 주 보기', body: '‘주’를 눌러 보세요. 한 주를 시간 순서로 크게 봅니다.' },
      { sel: '.main button', text: '월', exact: true, click: true, title: '다시 한 달 보기', body: '‘월’을 눌러 돌아오세요.' },
      { sel: '.main button', text: '나이스 학사일정 가져오기', title: '학사일정 가져오기', body: '나이스에 학교를 연결해 두면 한 해 학사일정을 한 번에 달력에 넣습니다. 같은 날 같은 이름은 건너뜁니다.', optional: true },
      { sel: '.main button', text: '구글 캘린더', title: '구글 캘린더 겹쳐 보기', body: '구글 캘린더의 비공개 주소를 넣으면 개인 일정을 점선 막대로 함께 봅니다. 원할 때만 켜는 기능입니다.', optional: true }
    ]
  },
  시간표: {
    page: '시간표',
    intro: '내 시간표 · 학급별 · 수업 바꾸기 · 파일 불러오기',
    steps: [
      { sel: H1, title: '시간표', body: '학교 시간표 파일에서 내 시간표를 뽑아 보고, 맞교체 · 보강할 사람을 찾습니다.' },
      { sel: '.main button', text: '학급별', exact: true, click: true, title: '학급별 시간표', body: '눌러 보세요. 반을 골라 그 반의 한 주 시간표를 봅니다.', optional: true },
      { sel: '.main button', text: '수업 바꾸기', exact: true, click: true, title: '수업 바꾸기', body: '눌러 보세요. 비울 수업을 고르면 맞바꿀 수 있는 수업과 그 시간에 비어 있는 선생님을 찾아 줍니다.', optional: true },
      { sel: '.main button', text: '파일 · 설정', exact: true, click: true, title: '파일 · 설정', body: '눌러 보세요. 학교 시간표 엑셀을 불러오고 교시 시각 · 블록 · 창체를 정리하는 곳입니다.', optional: true },
      { sel: '.main button', text: '내 시간표', exact: true, click: true, title: '내 시간표로', body: '다시 ‘내 시간표’를 눌러 돌아오세요.', optional: true },
      { sel: '.main button', text: '칸 고치기', title: '칸 고치기 · 그림으로 저장', body: '파일에 없는 창체 · 동아리는 칸 고치기로 적어 넣고, 그림으로 저장하면 PNG 파일로 내보냅니다.', optional: true },
      { sel: '.main button', text: '시간표 엑셀 불러오기', title: '처음이라면 파일부터', body: '쿨메신저 등으로 받은 학교 시간표 엑셀을 불러오면 이름을 골라 내 시간표를 만듭니다.', optional: true }
    ]
  },
  기한: {
    page: '기한',
    intro: '통보 · 통지 기한을 D-day로 챙기기',
    steps: [
      { sel: H1, title: '절차 기한', body: '학교폭력 · 선도처럼 날짜가 정해진 통보 · 통지를 D-day로 챙깁니다. 다가오면 홈과 윈도우 알림에 뜹니다.' },
      { sel: '.main button', text: '기한 추가', click: true, title: '기한 추가를 눌러 보세요', body: '무엇을 언제까지 해야 하는지 적는 칸이 열립니다.' },
      { sel: '.main button', text: '등록', exact: true, up: '.card', title: '무엇을, 언제까지', body: '할 일과 기한 날짜, 관련 사안을 적고 등록하면 목록과 홈에 뜹니다. 지금은 연습이니 등록하지 않아도 됩니다.', optional: true },
      { sel: '.main button', text: '취소', exact: true, click: true, title: '취소로 닫기', body: '연습이 끝났으면 취소를 눌러 닫으세요.', optional: true },
      { sel: '.main label', text: '처리한 것도 보기', title: '처리한 것도 보기', body: '처리 표시한 기한은 숨겨집니다. 다시 보려면 이것을 켜세요.', optional: true }
    ]
  },
  일지: {
    page: '일지',
    intro: '오늘 한 일 한두 줄 남기기',
    steps: [
      { sel: H1, title: '업무 일지', body: '오늘 한 일을 짧게 남겨 두면 날짜별로 쌓이고, 인수인계 파일에 함께 넘어갑니다.' },
      { ...card('오늘 기록하기'), title: '오늘 기록하기', body: '날짜와 한 일을 적고 기록을 누릅니다. 한두 줄이면 충분합니다.' },
      { sel: '.main textarea', title: '한 일', body: '“선도위원회 출석 통지서 발송(3명)”처럼 나중에 찾을 낱말을 넣어 두면 통합 검색에서 찾기 쉽습니다.', optional: true },
      { sel: '.main button', text: '기록', exact: true, title: '기록', body: '누르면 아래 목록에 쌓입니다. 지금은 눌러 보지 않아도 됩니다.', optional: true }
    ]
  },
  로드맵: {
    page: '로드맵',
    intro: '한 해 업무를 인포그래픽 · 업무별 · 목록으로',
    steps: [
      { sel: H1, title: '연간 업무 로드맵', body: '한 해 업무를 달마다 펼쳐 봅니다. 공문 · 매뉴얼에서 뽑은 업무가 여기 모입니다.' },
      { sel: '.main .viewswitch-btn', up: 'div', title: '세 가지 보기', body: '인포그래픽은 한 해 흐름, 업무별은 주제로 묶은 업무, 목록은 달마다 줄로 봅니다.', optional: true },
      { sel: '.main .viewswitch-btn', text: '업무별', click: true, title: '업무별을 눌러 보세요', body: '주제(예: 학교폭력, 선도위원회)로 묶인 업무를 봅니다.', optional: true },
      { sel: '.main .topic-item', title: '주제', body: '주제를 누르면 그 업무들의 절차 · 유의사항 · 워크플로우가 오른쪽에 뜹니다. 워크플로우도 여기서 그립니다.', optional: true },
      { sel: '.main .viewswitch-btn', text: '목록', click: true, title: '목록을 눌러 보세요', body: '달마다 줄로 늘어놓고 완료를 체크합니다.', optional: true },
      { sel: '.main .viewswitch-btn', text: '인포그래픽', click: true, title: '처음 보기로', body: '인포그래픽을 눌러 돌아오세요.', optional: true },
      { sel: '.main .page-head', title: '업무가 비어 있다면', body: '[문서로 업무 만들기]에서 길라잡이나 공문을 올리면 이 로드맵이 채워집니다.' }
    ]
  },
  워크플로우: {
    page: '워크플로우',
    intro: '업무 처리 절차 순서도 모아 보기',
    steps: [
      { sel: H1, title: '업무 워크플로우', body: '업무 처리 절차를 순서도로 그려 둔 것을 모아 봅니다. 다음 담당자가 그대로 따라 할 수 있게 남겨 두세요.' },
      { sel: '.main .btn', text: '그리러 가기', title: '처음 그리기', body: '순서도는 [연간 업무 로드맵 → 업무별]에서 주제를 골라 그립니다. 시작 · 단계 · 갈림길 · 끝을 이어 붙입니다.', optional: true },
      { sel: '.main .card', title: '그려 둔 순서도', body: '순서도마다 단계와 갈림길이 보입니다. 눌러서 고칠 수 있습니다.', optional: true }
    ]
  },
  검색: {
    page: '검색',
    intro: '업무 · 공문 원문 · 도움자료를 한 번에 (Ctrl+K)',
    steps: [
      { sel: H1, title: '통합 검색', body: '업무 · 보관한 공문 원문 · 일지 · 학교업무 도움자료를 한 번에 찾습니다. 어디서든 Ctrl+K를 누르면 이 화면이 열립니다.' },
      { sel: '.main input[type="text"]', title: '찾을 낱말', body: '예: “방과후 강사 채용”. 띄어 쓴 낱말을 모두 담은 것부터 보여 줍니다.' },
      { sel: '.main button', text: '검색', exact: true, title: '검색', body: 'Enter나 검색을 누릅니다. AI 키를 넣어 두면 찾은 내용을 정리한 답도 함께 보여 줍니다.' }
    ]
  },
  도우미: {
    page: '도우미',
    intro: '묻고, 넣어 달라고 하고, 문서를 만들어 달라고 하기',
    steps: [
      { sel: H1, title: '업무 도우미', body: '맡은 업무에 대해 묻고, 일정 · 업무를 넣어 달라고 하거나 학교 양식으로 문서를 만들어 달라고 할 수 있습니다.' },
      { sel: '.main label', text: '이 대화에 쓸 모델', up: 'div', title: '모델 고르기', body: '이 대화에 쓸 AI를 고릅니다. 비워 두면 설정의 기본값을 씁니다.', optional: true },
      { sel: '.main button', text: '놓치면 안 되는 기한', title: '예시 질문', body: '눌러서 바로 물어볼 수 있는 예시입니다. 내 업무에 맞게 고쳐 쓰세요.', optional: true },
      { sel: '.main button', text: '📎 파일', exact: true, title: '파일 올리기', body: '공문 · 한글 파일을 올리고 “이걸로 일정 넣어 줘”처럼 부탁할 수 있습니다.', optional: true },
      { sel: '.main textarea', title: '묻기', body: 'Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 일정 · 업무를 넣을 때는 넣기 전에 먼저 보여 주고 묻습니다.' }
    ]
  },
  가이드: {
    page: '가이드',
    intro: '업무 하나하나의 절차 · 유의사항 · 나만의 요령',
    steps: [
      { sel: H1, title: '업무 상세 가이드', body: '업무 하나하나의 처리 절차, 유의사항, 원문을 자세히 봅니다.' },
      { ...card('업무 목록'), title: '업무 목록', body: '위 칸에 이름을 쳐서 찾고, 하나를 누르면 오른쪽에 자세히 뜹니다.', optional: true },
      { sel: '.main .nav-btn', click: true, title: '업무를 하나 골라 보세요', body: '누르면 그 업무의 절차와 본문이 오른쪽에 뜹니다.', optional: true },
      { ...card('유의사항'), title: '나만의 요령 남기기', body: '담당 장학사 연락처, 매년 반복되는 실수, 결재 라인처럼 다음 담당자에게 꼭 넘길 것을 적고 저장합니다.', optional: true },
      { sel: '.main .page-head', title: '업무가 비어 있다면', body: '[문서로 업무 만들기]에서 공문 · 매뉴얼을 올리면 업무가 여기 채워집니다.' }
    ]
  },
  도움자료: {
    page: '도움자료',
    intro: '교육청 학교업무 도움자료 247개 업무',
    steps: [
      { sel: H1, title: '학교업무 도움자료', body: '경남교육청 학교업무 도움자료의 업무별 자료 목록입니다. 내 업무를 골라 두면 맨 위에 모입니다.' },
      { sel: '.main button', text: '내 업무 고르기', title: '내 업무 고르기', body: '맡은 업무를 골라 두면 이 화면과 홈, 도우미 답에 그 자료가 먼저 나옵니다.', optional: true },
      { sel: '.main input[type="text"]', title: '찾기', body: '업무 이름이나 자료 이름으로 찾습니다. 예: 학교폭력, 생기부 정정, 체험학습 서식', optional: true },
      { sel: '.main button', text: '중고등학교', click: true, title: '학교급 고르기', body: '눌러 보세요. 학교급마다 업무 묶음이 다릅니다.', optional: true },
      { sel: '.main .help-item', title: '업무 한 줄', body: '누르면 자료 이름이 펼쳐지고, 자료 폴더 ↗로 교육청 누리집의 그 폴더를 엽니다. ☆을 누르면 내 업무에 들어갑니다.', optional: true }
    ]
  },
  학습: {
    page: '학습',
    intro: '공문 · 매뉴얼 파일로 업무 목록 만들기',
    steps: [
      { sel: H1, title: '문서로 업무 만들기', body: '공문 · 길라잡이 · 매뉴얼 파일을 올리면 AI가 업무 · 처리 절차 · 기한을 뽑아 로드맵에 넣습니다.' },
      { ...card('문서 종류 고르기'), title: '문서 종류 고르기', body: '한 해 업무가 담긴 길라잡이 · 매뉴얼인지, 공문 한 건인지 고릅니다. 뽑는 방식이 달라집니다.', optional: true },
      { ...card('파일 올리기'), title: '파일 올리기', body: 'PDF · 한글 · 워드 파일을 고릅니다. 몇 학년도 공문인지 정해 두면 새 학년도 정리 때 편합니다.', optional: true },
      { sel: '.main label', text: '개인정보를 가리고', title: '개인정보 가리기', body: '켜 두면 이름 · 연락처 · 주민등록번호 · 학번 · 주소를 ○○○으로 덮어서 AI에 보냅니다. 학생 사안 공문은 꼭 켜 두세요.', optional: true },
      { ...card('AI로 정리하기'), title: 'AI로 정리하기', body: '분석 시작을 누르면 업무 후보가 나옵니다. 확인하고 고른 것만 등록됩니다. AI 없이 원문만 보관할 수도 있습니다.', optional: true },
      { sel: '.main button', text: '저장된 문서 학습', title: '저장된 문서 학습', body: '전에 원문만 보관해 둔 공문을 나중에 한꺼번에 학습시킬 수 있습니다.', optional: true }
    ]
  },
  위원회: {
    page: '위원회',
    intro: '회의록 · 계획서 · 통지서를 학교 한글 양식으로',
    steps: [
      { sel: H1, title: '학교 문서 만들기', body: '회의록 · 계획서 · 통지서 같은 학교 문서를 우리 학교 한글 양식에 맞춰 만듭니다.' },
      { sel: '.main button', text: '양식 · 예시 보관함', title: '양식 · 예시 보관함', body: '우리 학교 한글 양식과 글 예시를 넣어 두는 곳입니다. 넣어 둔 양식대로 문서가 만들어집니다.', optional: true },
      { sel: '.main button', text: '빈칸 채우기', title: '두 가지 만드는 방식', body: '빈칸 채우기는 AI 없이 서식에 직접 적고, 도우미와 대화로 만들기는 묻고 답하며 채웁니다.', optional: true },
      { sel: '.main button', text: '선도위원회 회의록', title: '만들 문서 고르기', body: '문서 종류를 누르면 내용 칸이 열립니다. 학생 지도 · 사안 묶음에 선도위원회 · 사안조사 문서가 있습니다.', optional: true },
      { sel: '.main button', text: '한글 양식 넣기', title: '한글 양식 넣기', body: '.hwp · .hwpx 양식을 넣어 두면 그 틀(글꼴 · 문단 · 표)대로 새 문서를 짭니다.', optional: true },
      { sel: '.main button', text: '문서 종류 직접 만들기', title: '없는 문서는 직접', body: '목록에 없는 문서는 종류를 직접 만들어 씁니다.', optional: true }
    ]
  },
  발표: {
    page: '발표',
    intro: '주제와 자료로 슬라이드 짜고 PowerPoint로 저장',
    steps: [
      { sel: H1, title: '발표자료 만들기', body: '주제와 자료를 주면 AI가 슬라이드를 짜고, 고친 뒤 PowerPoint 파일로 저장합니다.' },
      { ...card('무엇을 발표하나요'), title: '무엇을 발표하나요', body: '주제 · 듣는 사람 · 장수 · 발표 시간을 적습니다.', optional: true },
      { sel: '.main textarea', title: '자료', body: 'AI는 여기 있는 사실만 씁니다. 공문 · 지침을 붙여 넣거나 파일에서 가져오세요. 이름 · 연락처는 가려서 보낼 수 있습니다.', optional: true },
      { ...card('디자인'), title: '디자인', body: '색 묶음을 고르거나, 학교에서 쓰던 PowerPoint 파일을 참고 파일로 고르면 그 모양을 그대로 씁니다.', optional: true },
      { sel: '.main button', text: '슬라이드 내용 만들기', title: '슬라이드 짜기', body: '누르면 슬라이드 내용이 나오고, 다음 단계에서 고친 뒤 저장합니다.', optional: true }
    ]
  },
  데이터: {
    page: '데이터',
    intro: '다음 담당자에게 넘기기 · 받은 파일 불러오기 · 백업',
    steps: [
      { sel: H1, title: '인수인계 · 백업', body: '다음 담당자에게 파일 하나로 넘기고, 전임자에게 받은 파일을 불러옵니다. 자동 백업도 여기서 봅니다.' },
      { ...card('현재 자료'), title: '현재 자료', body: '지금 들어 있는 업무 · 공문 · 일정 수를 봅니다.', optional: true },
      { ...card('인수인계 꾸러미'), title: '인수인계 꾸러미', body: '학년도와 인계자 · 인수자를 적으면 인수인계서 초안을 엮어 줍니다.', optional: true },
      { ...card('다음 담당자에게 넘겨주기'), title: '넘겨주기', body: '인수인계 파일 내보내기를 누르면 파일 하나가 만들어집니다. 시간표 · 키 같은 개인 설정은 빠집니다.', optional: true },
      { ...card('전임자에게 받은 파일'), title: '받은 파일 불러오기', body: '받은 파일을 불러오면 업무 · 공문 · 요령이 그대로 들어옵니다.', optional: true },
      { ...card('저장 위치'), title: '저장 위치', body: '자료 파일과 자동 백업 폴더 위치입니다. 문제가 생기면 백업 폴더에서 되살립니다.', optional: true },
      { ...card('초기화'), title: '초기화는 조심', body: '모든 자료를 지웁니다. 되돌릴 수 없으니 꼭 내보내기를 먼저 하세요.', optional: true }
    ]
  },
  도구: {
    page: '도구',
    intro: '만든이가 올려 두는 선생님용 도구 (세특 도우미 등)',
    steps: [
      { sel: H1, title: '도구 모음', body: '선생님 일을 덜어 줄 도구를 모아 둔 곳입니다. 새 도구가 올라오면 프로그램을 업데이트하지 않아도 여기 생기고, 왼쪽 메뉴에 ● 표시가 뜹니다.' },
      { sel: '.main .tool-card', title: '도구 한 장', body: '열기를 누르면 브라우저에서 열립니다. 이 프로그램의 업무 · 학생 자료는 도구로 보내지 않습니다.', optional: true },
      { sel: '.main .tool-card button', text: '메뉴에', title: '메뉴에 고정', body: '자주 쓰는 도구는 고정해 두면 왼쪽 메뉴 ‘바로가기’에서 한 번에 열립니다.', optional: true },
      { sel: '.main button', text: '새로 받기', title: '새로 받기', body: '목록은 3시간마다 저절로 새로 받습니다. 방금 올라온 도구를 바로 보려면 누르세요.' }
    ]
  },
  설정: {
    page: '설정',
    intro: '화면 테마 · 담당 업무 · 나이스 · AI · 알림',
    steps: [
      { sel: H1, title: '설정', body: '화면 테마, 담당 업무, 나이스 연결, AI 연결, 알림을 정합니다.' },
      { sel: '.main .theme-picks', click: true, title: '테마를 골라 보세요', body: '누르는 즉시 바뀝니다. 마음에 안 들면 다른 것을 다시 누르면 됩니다.' },
      { sel: '.main .theme-seg', title: '밝기', body: '윈도우 설정 따르기 · 밝게 · 어둡게 가운데 고릅니다. 이 PC에만 저장됩니다. 만든이가 올려 둔 받은 테마가 있으면 테마 아래에 함께 뜹니다.' },
      { sel: '.main #menu-settings', title: '왼쪽 메뉴 고르기', body: '안 쓰는 메뉴는 끄고 ↑ ↓ 로 차례를 바꿉니다. 자주 가는 누리집은 바로가기로 더하면 왼쪽 메뉴에서 바로 열립니다.', optional: true },
      { ...card('담당 업무'), title: '담당 업무', body: '담당 업무명과 학교 정보는 인수인계 파일에 함께 들어갑니다. 업무분장표를 붙여 두면 도우미가 참고합니다.', optional: true },
      { ...card('나이스 연결'), title: '나이스 연결', body: '학교를 연결하면 급식 · 학사일정 · 학급 시간표를 받아 옵니다. 인증키는 무료로 바로 발급됩니다.', optional: true },
      { ...card('AI 연결'), title: 'AI 연결', body: '쓸 AI 서비스를 고르고 키를 넣습니다. 키는 이 PC에만 암호화해 둡니다.', optional: true },
      { ...card('기한 알림'), title: '알림 · 자동 실행', body: '기한이 다가오면 윈도우 알림을 띄우고, 컴퓨터를 켤 때 자동으로 실행할 수 있습니다.', optional: true }
    ]
  }
}

/** 처음부터 차례로 배울 때의 순서 */
export const TOUR_ORDER: PageId[] = ['홈', '달력', '시간표', '기한', '일지', '로드맵', '워크플로우', '검색', '도우미', '가이드', '도움자료', '학습', '위원회', '발표', '도구', '데이터', '설정']

/** 왼쪽 메뉴에서 그 화면 단추 (도우미는 맨 위 ✦, 설정은 맨 아래 내 이름 칸) */
function navSel(page: PageId): string {
  if (page === '도우미') return '.sidebar .side-ai'
  if (page === '설정') return '.sidebar .side-me'
  return `.sidebar .nav-btn[data-page="${page}"]`
}

/**
 * 실제로 밟는 단계 — 맨 앞에 왼쪽 메뉴의 그 단추를 먼저 비춘다(어느 메뉴로 오는지 알게).
 * 메뉴를 꺼 두었으면 그 단계는 건너뛴다.
 */
export function tourSteps(page: PageId): TourStep[] {
  const t = TOURS[page]
  const label = navLabel(page)
  return [
    {
      sel: navSel(page),
      title: `왼쪽 메뉴 · ${label}`,
      body: `왼쪽 메뉴의 「${label}」을(를) 누르면 이 화면이 열립니다. ${t.intro}.`,
      optional: true
    },
    ...t.steps
  ]
}

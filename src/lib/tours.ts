import type { PageId } from '../App'
import { navLabel } from './nav'
import { getUiPrefs } from './theme'

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

/**
 * 폰 연결 — 처음 한 번 하는 설정과 폰에서 쓰는 법. 설정 순서 칸(.relay-steps)은 아직 잇지 않았을 때만,
 * QR(.relay-phone)은 이은 뒤에만 보이므로 그 단계들은 optional, 흐름 설명은 늘 보이게 대상 없이 둔다.
 */
const phoneSteps = (use: TourStep[]): TourStep[] => [
  { title: '폰 연결은 처음 한 번만', body: '선생님 구글 계정에 작은 우편함(Apps Script)을 만들어 폰과 이 PC 를 잇습니다. 순서는 ① 코드 만들기 → ② 구글에 붙여 넣기 → ③ 배포 → ④ 주소 붙여 넣고 잇기 → ⑤ 폰으로 QR 찍기. 10분쯤 걸리고, 한 번 이으면 [세특 작성실] · [출결] · [메신저 정리] 가 함께 씁니다.' },
  { sel: '.main .relay-steps li', text: '코드 만들기', title: '① 코드 만들기', body: '[코드 만들기] 를 누른 뒤 [코드 복사] 를 누릅니다. 이 PC 만 아는 열쇠가 든 코드입니다. 지금은 배우는 중이니 누르지 않아도 됩니다.', optional: true },
  { sel: '.main .relay-steps li', text: 'script.google.com', title: '② 구글에 붙여 넣기', body: 'script.google.com 에서 새 프로젝트를 만들고, 들어 있는 글을 모두 지운 뒤 붙여 넣고 저장(Ctrl+S)합니다. 학교 계정은 배포가 막혀 있을 수 있어 개인 구글 계정을 권합니다.', optional: true },
  { sel: '.main .relay-steps li', text: '새 배포', title: '③ 배포하기', body: '[배포 → 새 배포] → 유형 [웹 앱] → 실행: 나, 액세스 권한: 모든 사용자 → [배포]. 처음에는 구글이 권한을 묻습니다. 방금 만든 내 프로젝트인지 확인하고 허용합니다.', optional: true },
  { sel: '.main .relay-steps li', text: '웹 앱 URL', title: '④ 주소 붙여 넣고 잇기', body: '배포가 끝나면 나오는 웹 앱 URL(끝이 /exec)을 복사해 이 칸에 붙여 넣고 [잇기]. 이은 뒤 폰에 명단이 올라가기까지 몇 분 걸릴 수 있습니다.', optional: true },
  { sel: '.main .relay-phone img', title: '⑤ 폰으로 QR 찍기', body: '폰 카메라로 찍어 열고, 브라우저 메뉴의 [홈 화면에 추가] 로 두면 앱처럼 씁니다. 이 주소에는 열쇠가 들어 있으니 남에게 보내지 마세요.', optional: true },
  { sel: '.main .relay-trouble summary', title: '폰에서 안 열릴 때', body: '“현재 파일을 열 수 없습니다” 가 뜨면 여기를 펼쳐 보세요. 폰 브라우저의 구글 로그인 때문일 가능성이 큽니다. 개인정보 보호(시크릿) 탭에 주소를 붙여 넣어 열고 홈 화면에 추가합니다.', optional: true },
  ...use,
  { title: 'PC 에서 받기', body: 'PC 의 오르빗이 켜져 있으면 3분마다 가져옵니다. 바로 받으려면 연결 칸의 [지금 가져오기]. 가져간 것은 구글에서 지우고, 안 가져간 것은 14일 뒤 지워집니다. 폰 화면이 예전 판이라고 뜨면 안내대로 새 코드를 붙여 넣고 [배포 관리 → 새 버전] 으로 바꿉니다.' }
]

const PHONE_OBS: TourStep[] = [
  { title: '폰에서 수업 관찰 적기', body: '폰 화면의 [수업 관찰] 탭에서 활동과 수업반을 고르고 학생을 누릅니다. [발표] · [질문] 같은 낱말을 누르고 이어 적거나 키보드의 마이크로 말한 뒤 [보내기]. 오늘 적은 학생은 색이 칠해져 아직 못 본 학생이 보입니다.' },
  { title: '여기에 이렇게 붙습니다', body: '그 활동의 학생 관찰 기록 뒤에 [11/13] 발표: … 처럼 날짜와 함께 붙습니다. 입력 항목이 여럿인 활동은 첫 칸에 들어갑니다. 폰에 학생이 안 보이면 이 화면에 명단과 활동이 있는지 보고, 몇 분 뒤 폰 화면을 새로고침하세요.' }
]
const PHONE_ATT: TourStep[] = [
  { title: '폰에서 출결 보내기', body: '우리 반 명단을 넣어 두면 폰에 [출결] 탭이 생깁니다. 날짜를 확인하고 결석 · 지각 · 조퇴 · 결과인 학생만 눌러 구분 · 사유 · 메모를 고른 뒤 [보내기]. 잘못 보냈으면 다시 눌러 고치거나 [지우기]. 모두 출석이면 보낼 것이 없습니다.' }
]
const PHONE_TEXT: TourStep[] = [
  { title: '폰에서 글 보내기', body: '카톡 · 메신저에서 글을 길게 눌러 복사하고, 폰 화면의 [글 보내기] 탭에 붙여 넣어 [보내기]. 몇 분 안에 [메신저 정리] 의 ‘폰에서 온 글’ 로 옵니다. 다른 앱의 대화를 저절로 읽지는 않습니다.' }
]

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
      { sel: '.side-learn', title: '언제든 다시 배우기', body: '여기를 누르면 이 목록이 열립니다. 어느 화면에서든 F1을 누르면 그 화면을 바로 배웁니다.' },
      { sel: '.side-feedback', title: '의견 보내기', body: '불편한 점 · 오류 · 바라는 기능을 만든이에게 보냅니다. 설문지가 브라우저로 열리고, 프로그램 버전은 미리 채워집니다.', optional: true }
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
      { sel: '.main button', text: '구글 캘린더', title: '구글 캘린더 겹쳐 보기', body: '[구글 캘린더 설정 ↗] 에서 볼 캘린더를 고르고, ‘iCal 형식의 비공개 주소’(끝이 basic.ics)를 복사해 붙여 넣은 뒤 [저장] → [연결 확인]. 구글 일정이 점선 막대로 함께 보입니다. 원할 때만 켜는 기능이고, 이 주소는 남에게 알려 주지 마세요.', optional: true }
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
  메신저: {
    page: '메신저',
    intro: '메신저 · 카톡 글에서 할 일 · 출결 뽑기',
    steps: [
      { sel: H1, title: '메신저 정리', body: '쿨메신저 · 업무 메신저 · 카톡 글을 붙여 넣으면 AI 가 할 일과 출결 연락을 뽑아 줍니다. 넣기 전에 고치거나 뺄 수 있습니다.' },
      { sel: '.main .msg-text', title: '붙여 넣기', body: '여러 메시지를 한꺼번에 넣어도 됩니다. 학생 이름은 학생7 처럼 번호로, 다른 이름은 사람A 로 가려서 보냅니다.' },
      { sel: '.main .msg-privacy', title: 'AI 에 갈 글 보기', body: '무엇이 어떻게 가려져 나가는지 보내기 전에 확인할 수 있습니다.', optional: true },
      { sel: '.main .relay-card', title: '폰에서 보내기', body: '선생님 구글 계정에 작은 우편함을 만들어 두면 폰에서 보낸 글이 몇 분 안에 여기로 옵니다.', optional: true },
      { sel: '.main .relay-card button', text: '설정', click: true, title: '설정을 펼쳐 보세요', body: '눌러서 연결 칸을 엽니다. 이어 놓지 않았으면 설정 순서가, 이었으면 QR 이 보입니다.', optional: true },
      ...phoneSteps(PHONE_TEXT)
    ]
  },
  이번주: {
    page: '이번주',
    intro: '이번 주 달력 · 다가올 일 · 내 시간표',
    steps: [
      { sel: H1, title: '이번 주 한눈에', body: '이번 주 달력이 맨 위에, 그 아래에 앞으로 2주의 기한 · 일정 · 학사일정 · D-Day 와 작게 줄인 내 시간표가 있습니다.' },
      { sel: '.main .wk-up', title: '다가올 일', body: '날짜별로 모아 보여 줍니다. 누르면 그 일이 있는 화면으로 갑니다. 지난 기한은 오늘 칸에 \'지남\' 으로 남습니다.', optional: true },
      { sel: '.main .wk-tt', title: '내 시간표', body: '오늘 줄은 주황 바탕, 지금 교시는 먹색 칸입니다.', optional: true }
    ]
  },
  담임: {
    page: '담임',
    intro: '우리 반 학생 명단 · 상담 · 출결 · 학생부를 한곳에서',
    steps: [
      { sel: H1, title: '담임', body: '우리 반 학생 명단, 상담 기록, 출결, 학생부 분석을 한곳에 모았습니다. 위 탭의 [담임] 이나 오른쪽 위 [만들기] 에서 열고, 설정의 메뉴에서 탭을 숨길 수도 있습니다.' },
      { sel: '.main .memo-filter', title: '네 칸', body: '학생 명단 · 상담 기록 · 출결 · 학생부 분석을 작은 단추로 고릅니다. 마지막에 본 칸을 기억합니다. 학생부 살펴보기는 세특 작성실에서 이쪽으로 옮겼습니다.' },
      { sel: '.main .memo-filter button', text: '학생 명단', click: true, title: '학생 명단부터', body: '눌러 보세요. 번호 · 이름을 붙여 넣거나(엑셀의 두 칸도 됩니다) 한 명씩 더합니다. 학부모 연락과 메모도 적어 둡니다. 출결과 같은 명단이라 한 번만 넣으면 됩니다.' },
      { sel: '.main .memo-filter button', text: '상담 기록', click: true, title: '상담 기록', body: '눌러 보세요. 학생 × 달 표의 칸을 눌러 날짜 · 대상 · 방법 · 내용을 적습니다. 상담 예정을 넣으면 달력에도 이름 없이 번호만 적힙니다. [학부모 글] 은 AI 없이 보낼 글을 만들어 줍니다.' },
      { sel: '.main .memo-filter button', text: '출결', click: true, title: '출결', body: '눌러 보세요. 한 달 표의 칸을 눌러 결석 · 지각 · 조퇴 · 결과를 적습니다. 서류를 아직 안 받았거나 나이스에 넣지 않은 것은 [챙길 것] 에 모이고, 아래에서 결석계 한글 파일도 만듭니다.' },
      { sel: '.main .relay-card button', text: '설정', click: true, title: '폰으로 출결 체크', body: '조회 시간에 폰으로 번호만 눌러 보낼 수 있습니다. 눌러서 연결 칸을 열어 보세요. 이 칸은 우리 반 명단을 넣어야 보입니다.', optional: true },
      ...phoneSteps(PHONE_ATT),
      { sel: '.main .memo-filter button', text: '학생부 분석', click: true, title: '학생부 분석', body: '눌러 보세요. 상담 때 학생부를 읽고 이어 갈 탐구와 확인할 질문을 살펴보는 곳입니다. 이름은 가려서 보냅니다.' }
    ]
  },
  출결: {
    page: '출결',
    intro: '결석 · 지각 · 조퇴 · 결과 모아 두기',
    steps: [
      { sel: H1, title: '출결 기록', body: '우리 반 명단을 넣고 결석 · 지각 · 조퇴 · 결과를 모아 둡니다. 나이스에는 선생님이 직접 넣고, 여기서는 서류와 나이스 입력을 챙깁니다.' },
      { sel: '.main .att-table', title: '한 달 표', body: '칸을 누르면 그 날 그 학생의 기록을 넣거나 고칩니다. 미인정은 주황으로 보입니다.', optional: true },
      { sel: '.main .att-todo', title: '챙길 것', body: '서류를 아직 안 받았거나 나이스에 넣지 않은 기록이 모입니다. 서류가 필요한 출결은 평일 5일 뒤를 기한으로 잡고, 날수는 바꿀 수 있습니다.', optional: true },
      { sel: '.main button', text: '메신저 글에서 뽑기', title: '학부모 연락에서 뽑기', body: '메신저 · 카톡 글을 붙여 넣으면 AI 가 출결 연락을 뽑아 줍니다. 이름은 번호로 가려서 보내고, 확인한 것만 들어갑니다.', optional: true },
      { sel: '.main .relay-card button', text: '설정', click: true, title: '폰으로 출결 체크', body: '눌러서 연결 칸을 열어 보세요. 우리 반 명단을 넣어야 보입니다.', optional: true },
      ...phoneSteps(PHONE_ATT)
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
  메모장: {
    page: '메모장',
    intro: '아무 글이나 적는 메모 · 주제 없이 그리는 워크플로우',
    steps: [
      { sel: H1, title: '자유 메모장', body: '떠오른 것을 바로 적는 메모와, 업무 주제에 매이지 않은 자유 워크플로우를 한곳에 둡니다. 적는 대로 저절로 저장됩니다.' },
      { sel: '.main .memo-new button', text: '메모', title: '새 메모', body: '누르면 빈 메모가 생기고 바로 적을 수 있습니다. 제목을 비워 두면 첫 줄이 이름이 됩니다.' },
      { sel: '.main .memo-new button', text: '워크플로우', title: '자유 워크플로우', body: '시작 · 단계 · 판단 · 끝 상자를 이어 흐름도를 그립니다. [업무 워크플로우] 화면 아래에도 모여 보입니다.' },
      { sel: '.main .memo-list', title: '목록', body: '고정한 것이 맨 위, 나머지는 고친 차례입니다. 위 칸에서 찾고 메모 · 워크플로우로 골라 봅니다. 통합 검색(Ctrl+K)에도 걸립니다.' },
      { sel: '.main .memo-share', title: '다음 담당자에게도 넘기기', body: '자유 메모장은 나만 보는 것이 기본입니다. 이것을 켠 메모만 인수인계 파일에 들어갑니다.', optional: true }
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
      { sel: H1, title: '업무 도우미', body: '맡은 업무에 대해 묻고, 일정 · 업무를 넣어 달라고 하거나 학교 양식으로 문서를 만들어 달라고 할 수 있습니다. 지침을 주고 그냥 대화할 수도 있습니다.' },
      { sel: '.main .chat-side', title: '대화 목록', body: '보낸 대화는 여기에 남습니다. [＋ 새 채팅] 으로 새로 시작하고, 마우스를 올리면 이름 바꾸기 · 지우기가 나옵니다. 대화는 이 PC 에만 두고 인수인계 파일에는 넣지 않습니다.', optional: true },
      { sel: '.main .chat-modes', title: '두 가지 모드', body: '업무 도우미는 보관한 공문 · 업무 · 일지 · 시간표를 근거로 답합니다. 일반 대화는 보관 자료 없이, 위에 적은 지침(예: 세특 쓰기)을 따라 대화합니다.', optional: true },
      { sel: '.main .model-picker-label', text: '모델', exact: true, up: 'div', title: '모델 고르기', body: '이 대화에 쓸 AI를 고릅니다. 비워 두면 설정의 기본값을 씁니다.', optional: true },
      { sel: '.main button', text: '놓치면 안 되는 기한', title: '예시 질문', body: '눌러서 바로 물어볼 수 있는 예시입니다. 내 업무에 맞게 고쳐 쓰세요.', optional: true },
      { sel: '.main button', text: '파일', exact: true, title: '파일 올리기', body: '공문 · 한글 · 사진 · 스캔 PDF 를 올립니다. 창 위로 끌어 놓아도 됩니다. 사진 · 스캔본은 AI 가 그림으로 읽습니다.', optional: true },
      { sel: '.main textarea.chat-input', title: '묻기', body: 'Enter로 보내고 Shift+Enter로 줄을 바꿉니다. 답은 받는 대로 보이고, [멈추기] 로 멈출 수 있습니다. 다른 화면으로 가도 받던 답은 이 대화에 남습니다.' }
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
  세특: {
    page: '세특',
    intro: '명단 · 활동 · 설문지 · 폰으로 관찰 → AI 초안 → 최종본 → 나이스 파일',
    steps: [
      { sel: H1, title: '세특 작성실', body: '학생마다 관찰한 것을 적으면 AI 가 초안을 쓰고, 선생님이 다듬어 최종본으로 둡니다. 적는 대로 저절로 저장되고, 명단과 글은 이 PC 에만 있습니다(인수인계 파일에도 들어가지 않습니다).' },
      { sel: '.main .stk-modes', title: '교과 · 동아리 · 담임', body: '수업 반 학생, 동아리 부원, 우리 반 학생은 서로 달라서 명단을 따로 둡니다. 쓸 것을 고르면 그 명단과 활동만 보입니다.' },
      { sel: '.main .stk-bar', title: '명단 · 쓰는 규칙 · 엑셀', body: '처음이면 [체험 자료로 먼저 보기] 로 지어낸 학생 16명이 든 활동을 먼저 봅니다(명단이 비어 있을 때만 넣을 수 있습니다). [명단 넣기] 에 엑셀 명렬표의 반 · 번호 · 이름 칸을 붙여 넣습니다. [내 규칙] 에서 금지어를 쉼표로 더하고, 기본 검사와 쓰는 규칙의 칸을 켜고 끕니다(기재요령의 틀은 그대로). [엑셀로 주고받기] 는 세특 시트를 내려받은 파일을 읽거나 엑셀로 내보냅니다.' },
      { sel: '.main .stk-bar button', text: '명단', click: true, title: '명단 넣기를 눌러 보세요', body: '활동보다 명단이 먼저입니다. 눌러서 명단 칸을 엽니다.', optional: true },
      { sel: '.main .stk-side, .main .stk-first', title: '명단 붙여 넣기', body: '엑셀 명렬표에서 학번(또는 반 · 번호)과 이름 칸을 끌어 복사해 붙여 넣습니다. 반 이름을 적으면 그 반만 바꾸고 다른 반은 그대로 둡니다. 지금은 넣지 않아도 됩니다.', optional: true },
      { sel: '.main .stk-bar button', text: '명단', click: true, title: '다시 눌러 닫기', body: '같은 단추를 한 번 더 누르면 닫힙니다.', optional: true },
      { sel: '.main .stk-acts', title: '활동', body: '수행평가 · 탐구처럼 기록할 거리를 활동 하나로 만듭니다. [＋ 활동] 은 빈 활동, [＋ 설문지로 만들기] 는 구글 설문지 응답으로 활동과 학생별 답을 한 번에 만듭니다.' },
      { sel: '.main .stk-acts button', text: '설문지로 만들기', click: true, title: '설문지로 만들기를 눌러 보세요', body: '학생에게 구글 설문지로 받은 글이 있을 때 씁니다.', optional: true },
      { sel: '.main .stk-formact', title: '설문지 → 활동', body: '설문지에 학번 · 이름 문항을 넣고, [응답] 탭의 스프레드시트 아이콘으로 만든 응답 시트 주소를 붙여 넣습니다. [응답 읽기] → 가져올 문항 고르기 → [활동 만들고 N명 넣기]. 문항마다 입력 칸이 됩니다. 폰 연결이 있어야 읽을 수 있습니다.', optional: true },
      { sel: '.main .stk-formact button', text: '닫기', exact: true, click: true, title: '닫기', body: '[닫기] 를 눌러 닫으세요.', optional: true },
      { sel: '.main .stk-actbar', title: '활동 설정', body: '활동 탭 오른쪽의 [활동 설정] 을 누르면 창이 열립니다. [프롬프트 만들기] 탭에서 세특 구성 · 요청사항을 적고, [활동 규정] 탭에서 활동 이름, 과목, 분량(나이스 바이트), 활동 개요를 적어 둡니다. AI 가 이것을 맥락으로 읽습니다.', optional: true },
      { sel: '.main .stk-tools', title: '초안 받기', body: '모델을 고르고(K-EXAONE 도 됩니다) [초안 받기] 를 누르면 관찰 기록이 있는 학생을 한 명씩 받습니다. 학생을 체크하면 그 학생만 받습니다. 키가 없으면 [초안 받기] 는 잠기고, 학생 줄을 누른 뒤 [키 없이 — 요청 글 복사] 로 AI 앱에서 받아 [AI 초안] 칸에 붙여 넣습니다. [자동 고쳐쓰기] 는 검사에서 고칠 곳이 나온 학생만 한 번 더 받고, [근거 확인] 은 관찰 기록에 없는 내용이 들어갔는지 묻습니다.', optional: true },
      { sel: '.main .stk-tools button', text: '관찰 기록 가져오기', click: true, title: '관찰 기록 가져오기를 눌러 보세요', body: '이미 가진 자료에서 학생별 글을 한꺼번에 넣는 곳입니다.', optional: true },
      { sel: '.main .stk-import .memo-filter', title: '가져오는 길 세 가지', body: '[스캔 · 사진에서] 는 활동지를 내 Gemini · OpenAI 키로 읽습니다. [구글 설문지] 는 응답 시트에서 새 응답만 이어 받습니다. [엑셀 표 붙여넣기] 는 AI 없이 넣습니다. 맞춘 학생을 먼저 보여 주고, 눌러야 들어갑니다.', optional: true },
      { sel: '.main .stk-import button', text: '닫기', exact: true, click: true, title: '닫기', body: '[닫기] 를 눌러 닫으세요.', optional: true },
      { sel: '.main .stk-table', title: '관찰 기록 · AI 초안 · 최종본', body: '초안은 [최종본으로 →] 로 옮겨 다듬습니다. 칸을 누르면 분량 · 기재 금지 · 형식 · AI 말투 · 맞춤법 검사가 펼쳐지고, 결과는 “고칠 곳 / 살펴볼 곳”으로 나뉩니다. [최종본 열 복사] 로 엑셀 · 나이스에 한 번에 붙여 넣습니다.', optional: true },
      { sel: '.main .stk-view', title: '취합 · 나이스', body: '활동별 글을 기록 영역마다 하나로 모읍니다. 합본이 한도 안이면 그대로 최종본이 되고, 넘는 학생만 [압축] 으로 줄입니다. [학생 간 점검] 은 같은 문장 · 분량 차이 · 빈 학생을 견주고, [나이스 입력 파일] 은 나이스에서 내려받은 양식에 최종본을 채웁니다.' },
      { sel: '.main .stk-bar button', text: '폰으로 관찰', click: true, title: '폰으로 관찰을 눌러 보세요', body: '수업 중에 폰으로 본 것을 적으면 이 표의 관찰 기록에 붙습니다. 눌러서 연결 칸을 엽니다.', optional: true },
      ...phoneSteps(PHONE_OBS)
    ]
  },
  OCR: {
    page: 'OCR',
    intro: '스캔한 PDF · 사진을 글자 그대로 표로 읽어 엑셀로 (내 Gemini · OpenAI 키)',
    steps: [
      { sel: H1, title: '문서 스캔 · 정리', body: '[파일을 표로 옮기기] 는 스캔한 PDF · 사진을 AI 가 글자 그대로 읽어 표로 만들고 엑셀로 저장합니다. 요약하지 않고, 취소선으로 지운 글은 뺍니다. 설정에 넣은 내 Gemini 키를 쓰고, OpenAI 키만 있으면 OpenAI 의 싼 등급(gpt-6-luna)으로 읽습니다. [폴더째 학생별 정리] 는 학생 결과물 폴더를 골라 학생마다 항목 정리 · 세특 · 채점을 받습니다.' },
      { sel: '.main .ocr-tabs', title: '탭', body: '탭마다 따로 읽습니다(5개까지). 다른 화면으로 가도 읽던 것은 계속 읽고, 다 읽으면 알려 드립니다.', optional: true },
      { sel: '.main button', text: '파일 고르기', title: '파일 고르기', body: 'PDF · 사진을 여러 개 고를 수 있고, 끌어 놓아도 됩니다. 이름 차례로 한 표에 모아 읽습니다.' },
      { sel: '.main textarea', title: '추가 요청', body: '“학번 순으로”, “영어 본문만”처럼 더 바라는 것을 적습니다. 비워 두면 문서 전체를 원문 그대로 표로 옮깁니다.' },
      { sel: '.main .ocr-send .note', title: '보내는 것 확인', body: '파일 원본(학생 이름 · 학번 포함)이 그대로 Google 로 갑니다. 학생 자료는 결제를 켠 키를 쓰고, 학교 지침을 먼저 확인하세요. 확인란을 켜야 시작할 수 있습니다.' },
      { sel: '.main button', text: '읽어서 표로 만들기', title: '읽기', body: '쪽수가 많으면 몇 분 걸립니다. 받은 표는 화면에서 보고 [엑셀로 저장] 하거나 [표 복사] 로 붙여 넣습니다. 답이 길어 끊기면 [이어서 받기] 가 뜹니다. 표는 [세특 활동으로 보내기] 로 활동에 넣을 수도 있습니다.' },
      { sel: '.main .ocr-mode', text: '폴더째 학생별 정리', click: true, title: '폴더째 정리도 눌러 보세요', body: '학생 결과물이 든 폴더를 고르는 화면으로 바뀝니다.', optional: true },
      { title: '학생마다 한 줄로', body: '파일 이름의 학번 · 이름으로 학생을 나눠 항목 정리 · 세특 초안 · 채점을 받습니다. 학생 결과물 내용이 내 키의 AI 서비스로 가므로 학교 지침을 먼저 확인하고, 결과는 꼭 원본과 맞춰 보세요. 끝나면 [세특 활동으로 보내기] 를 쓸 수 있습니다.' }
    ]
  },
  변환: {
    page: '변환',
    intro: '한글 · 오피스 · 사진을 한꺼번에 PDF 로 (이 PC 안에서만)',
    steps: [
      { sel: H1, title: 'PDF 변환', body: '한글 · 워드 · 엑셀 · 파워포인트 · 사진을 PDF 로 한꺼번에 바꿉니다. 이 PC 에 깔린 한글 · 오피스로 바꾸며 인터넷 · AI 를 쓰지 않고, 원본은 그대로 둡니다.' },
      { sel: '.main button', text: '폴더 고르기', title: '바꿀 파일', body: '폴더나 파일을 고르거나 화면에 끌어 놓습니다. 폴더는 하위 폴더 3단계, 파일 500개까지 담습니다.' },
      { sel: '.main .conv-merge', title: '만드는 방식', body: '파일마다 하나씩, 파일 이름의 학번 · 이름이 같은 것끼리, 또는 모두 하나로 만들 수 있습니다.' },
      { sel: '.main button', text: '만들기', title: '만들기', body: '고른 폴더 옆에 새 폴더를 만들어 저장합니다. 한글에서 [접근 허용]을 묻는 창이 뜨면 [모두 허용]을 누르세요.' },
      { sel: '.main button', text: '나눌 PDF 고르기', title: 'PDF 나누기', body: '쪽 범위를 “1-3, 5” 처럼 적으면 묶음마다 PDF 하나로 나눕니다. 비워 두면 한 쪽씩 나눕니다.' }
    ]
  },
  PDF편집: {
    page: 'PDF편집',
    intro: 'PDF 합치기 · 쪽 정리 · 글 · 서명 · 가리기 (이 PC 안에서만)',
    steps: [
      { sel: H1, title: 'PDF 편집', body: '여러 PDF 를 합치고, 쪽을 정리하고, 글 · 서명 · 도장을 더합니다. 인터넷 · AI 를 쓰지 않고, 원본은 그대로 둔 채 늘 새 파일로 저장합니다.' },
      { sel: '.main button', text: 'PDF 열기', exact: true, title: 'PDF 열기', body: 'PDF 를 여러 개 고르거나 화면에 끌어 놓습니다. 연 차례대로 쪽이 이어 붙어 합치기가 됩니다.', optional: true },
      { sel: '.main .pe-pages', title: '쪽 정리', body: '끌어서 차례를 바꾸고, 돌리기 · 복제 · 빈 쪽 넣기 · 지우기를 합니다. 앞의 네모에 표시하면 여러 쪽을 한꺼번에 다룹니다.' },
      { sel: '.main .pe-tools', title: '그리는 도구', body: '글자 · 형광펜 · 네모 · 선 · 펜 · 그림을 더합니다. [덮고 새로 쓰기]는 안 보이게 덮기만 하므로, 개인정보는 반드시 [완전 가리기]를 쓰세요.' },
      { sel: '.main .pe-doc', title: '문서 전체', body: '모든 쪽에 쪽 번호와 워터마크를 넣습니다.', optional: true },
      { sel: '.main .pe-save', title: '저장', body: '전체 또는 고른 쪽만 새 PDF 로 저장합니다. 완전 가리기를 쓰면 모든 쪽이 그림으로 바뀌어 글자를 고를 수 없습니다.' }
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
      { ...card('나이스 연결'), title: '나이스 연결', body: '학교를 연결하면 급식 · 학사일정 · 학급 시간표를 받아 옵니다. 학교 이름을 적고 [찾기] → [이 학교로 연결] 만 하면 됩니다.', optional: true },
      { ...card('나이스 연결'), title: '나이스 인증키 받는 법 (선택)', body: '카드의 [인증키 받는 법] 을 펼치세요. 신청 화면에 구글 · 네이버 · 카카오로 로그인 → 활용 용도에 “학교 업무용” 처럼 적고 신청 → 마이페이지의 인증키를 복사 → 칸에 붙여 넣고 [저장] → [연결 확인]. 무료입니다.', optional: true },
      { ...card('AI 연결'), title: 'AI 연결', body: '쓸 AI 서비스를 고르고 키를 넣습니다. 어느 서비스든 하나만 있으면 되고, 키는 이 PC에만 암호화해 둡니다. 키가 없어도 검색 · 기한 · 서식 채우기는 됩니다.', optional: true },
      { ...card('AI 연결'), title: 'Gemini 키 받는 법', body: '[키 발급 페이지 열기] → 구글 로그인 → Create API Key → 나온 글자를 복사 → 칸에 붙여 넣고 [저장] → [연결 테스트]. 학생 자료를 보낼 때는 학교 · 교육청의 생성형 AI 지침을 먼저 확인하세요.', optional: true },
      { ...card('기한 알림'), title: '알림 · 자동 실행', body: '기한이 다가오면 윈도우 알림을 띄우고, 컴퓨터를 켤 때 자동으로 실행할 수 있습니다.', optional: true }
    ]
  }
}

/** 처음부터 차례로 배울 때의 순서 */
/** 새 화면의 '오늘' 판 */
const NEW_HOME: TourStep[] = [
  { sel: '.ns-tabs', title: '위 탭 셋', body: '오늘 · 이번 주(시간표 · 달력) · 내 업무(연간 업무 · 기한 · 가이드 · 인수인계)로 나눴습니다. 탭 안의 화면은 탭 아래 작은 단추로 고릅니다.' },
  { sel: '.ns-make', title: '＋ 만들기', body: '문서로 업무 만들기 · 학교 문서 · 발표자료 · 문서 스캔 · PDF 변환 · PDF 편집 · 도구 모음, 그리고 메모장 · 업무 일지가 여기 모여 있습니다.' },
  { sel: '.tb-board .tw', title: '위젯', body: '위젯을 길게 누르면 편집이 열립니다. 누른 채로 끌면 옮겨지고, 다른 위젯은 비켜 갑니다. 오른쪽 단추를 눌러도 됩니다.', optional: true },
  { sel: '.main button', text: '편집', exact: true, click: true, title: '편집을 눌러 보세요', body: '위젯을 누르면 테두리 손잡이가 생깁니다. 손잡이를 끌면 칸 단위로 크기가 바뀝니다.' },
  { sel: '.tb-editbar', title: '편집 막대', body: '[＋ 위젯]으로 위젯을 고르고 크기를 정해 넣습니다. 위젯을 고른 뒤 [위젯 설정]에서 배경 · 투명도 · 제목 줄을 바꿉니다.', optional: true },
  { sel: '.tb-editbar button', text: '완료', click: true, title: '완료를 눌러 마치세요', body: '바꾼 배치는 바로 저장됩니다.', optional: true },
  { sel: '.ns-ask', title: '물어보기 바', body: '적고 Enter를 누르면 업무 도우미, 돋보기를 누르면 통합 검색입니다. 어디서든 Ctrl+K로 커서가 옵니다.' }
]

export const TOUR_ORDER: PageId[] = ['홈', '달력', '시간표', '기한', '메신저', '일지', '메모장', '로드맵', '워크플로우', '검색', '도우미', '가이드', '도움자료', '학습', '위원회', '발표', '담임', '세특', 'OCR', '변환', 'PDF편집', '도구', '데이터', '설정']

/** 왼쪽 메뉴에서 그 화면 단추 (도우미는 맨 위 ✦, 설정은 맨 아래 내 이름 칸) */
function navSel(page: PageId): string {
  if (getUiPrefs().shell === 'new') return page === '도우미' ? '.ns-ask' : `.nshell [data-page="${page}"]`
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
  if (getUiPrefs().shell === 'new') {
    if (page === '홈') return NEW_HOME
    return [
      {
        sel: navSel(page),
        title: page === '도우미' ? '아래 물어보기 바' : `「${label}」`,
        body:
          page === '도우미'
            ? `화면 아래 물어보기 바에 적고 Enter를 누르면 업무 도우미가 열립니다. ${t.intro}.`
            : `위 탭이나 [＋ 만들기]에서 「${label}」을(를) 누르면 이 화면이 열립니다. ${t.intro}.`,
        optional: true
      },
      ...t.steps.filter((s) => !s.sel?.startsWith('.side'))
    ]
  }
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

import { useCatalog } from '../lib/catalog'
import { openFeedback } from '../lib/feedback'
import Icon from './Icon'

/** 설정 → 의견 · 오류 보내기. 설문지 주소가 없으면(remote/catalog.json 의 feedback) 보이지 않는다 */
export default function FeedbackCard(): JSX.Element | null {
  const url = useCatalog().catalog.feedback
  if (!url) return null
  return (
    <div className="card" id="feedback-card">
      <div className="card-title">
        <span>💬 의견 · 오류 보내기</span>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        불편한 점, 오류, 바라는 기능을 만든이에게 보냅니다. 설문지가 브라우저로 열리고, 어느 버전에서 생긴 일인지 알 수 있게 프로그램 버전과
        윈도우 버전만 미리 채워집니다. 학생 이름 같은 개인정보는 적지 마세요.
      </p>
      <button className="btn btn-primary btn-sm" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => void openFeedback(url)}>
        <Icon name="chat" size={14} /> 의견 보내기
      </button>
    </div>
  )
}

// shared/weather.ts — 학교 주소 → 지역, 날씨 말 · 미세먼지 등급, Open-Meteo 답 읽기, D-Day 셈
const { loadShared: load } = require('./tsload.cjs')
const W = load('weather.ts')

let fails = 0
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗', m); if (!c) fails++ }

// 지역 (주소는 지어낸 것)
ok(W.regionOf('경상남도 창원시 의창구 원이대로 1') === '경상남도 창원시 의창구', '도 · 시 · 구')
ok(W.regionOf('경상남도 함안군 가야읍 함안대로 1') === '경상남도 함안군', '도 · 군')
ok(W.regionOf('부산광역시 해운대구 해운대로 1') === '부산광역시 해운대구', '광역시 · 구')
ok(W.regionOf('세종특별자치시 조치원읍 1') === '세종특별자치시', '특별자치시')
ok(W.regionOf('(우)51000 경상남도 김해시 1') === '', '앞에 다른 말이 있으면 빈 값 (시도부터 와야 함)')
ok(W.regionOf('') === '', '빈 주소')
ok(W.shortPlace('경상남도 창원시 의창구') === '창원시 의창구', '짧은 이름')
ok(W.shortPlace('김해시') === '김해시', '시도 없는 이름은 그대로')

// 날씨 말
ok(W.weatherText(0).label === '맑음' && W.weatherText(0, false).emoji === '🌙', '맑음 · 밤')
ok(W.weatherText(63).label === '비' && W.weatherText(65).label === '강한 비', '비')
ok(W.weatherText(73).label === '눈' && W.weatherText(95).label === '뇌우', '눈 · 뇌우')

// 미세먼지 (환경부 기준, 나쁜 쪽)
ok(W.airGrade(20, 10) === '좋음', '좋음')
ok(W.airGrade(20, 30) === '보통', '초미세먼지가 보통이면 보통')
ok(W.airGrade(90, 10) === '나쁨', '미세먼지 나쁨')
ok(W.airGrade(10, 80) === '매우 나쁨', '초미세먼지 매우 나쁨')
ok(W.airGrade(null, null) === null && W.airGrade(null, 16) === '보통', '값이 없을 때')

// Open-Meteo 답
const fc = {
  current: { time: '2026-11-05T13:00', temperature_2m: 15.4, apparent_temperature: 14.4, weather_code: 2, relative_humidity_2m: 55, wind_speed_10m: 2.1, is_day: 1 },
  daily: { time: ['2026-11-05', '2026-11-06'], temperature_2m_max: [18.2, 16], temperature_2m_min: [7.1, 6], precipitation_probability_max: [10, 70], weather_code: [2, 61] },
  hourly: {
    time: Array.from({ length: 48 }, (_, i) => `2026-11-0${5 + Math.floor(i / 24)}T${String(i % 24).padStart(2, '0')}:00`),
    temperature_2m: Array.from({ length: 48 }, (_, i) => i),
    weather_code: Array.from({ length: 48 }, () => 3),
    precipitation_probability: Array.from({ length: 48 }, (_, i) => (i === 16 ? 70 : 0))
  }
}
const wx = W.parseWeather(fc, { current: { pm10: 6, pm2_5: 5.5 } })
ok(wx && wx.now.temp === 15.4 && wx.today.max === 18.2 && wx.tomorrow.pop === 70, '지금 · 오늘 · 내일')
ok(wx.hours.length === 12 && wx.hours[0].time === '13:00' && wx.hours[0].temp === 13, '시간별은 지금 시(時)부터 12시간')
ok(wx.air.pm10 === 6 && wx.air.pm25 === 5.5, '미세먼지')
ok(/우산/.test(W.weatherTip(wx)), '3시간 뒤 비 70% → 우산')
ok(W.parseWeather(fc, null).air.pm10 === null, '미세먼지 없어도 날씨는')
ok(W.parseWeather({}, null) === null && W.parseWeather(null, null) === null, '모양이 틀리면 null')
const bad = W.parseWeather({ ...fc, current: { ...fc.current, weather_code: 63 } }, { current: { pm10: 100, pm2_5: 10 } })
ok(/지금 비/.test(W.weatherTip(bad)) && /미세먼지 나쁨/.test(W.weatherTip(bad)), '지금 비 · 미세먼지 나쁨 알림')

// D-Day
ok(W.ddayLabel('2026-11-19', '2026-11-05') === 'D-14', 'D-14')
ok(W.ddayLabel('2026-11-05', '2026-11-05') === 'D-Day', 'D-Day')
ok(W.ddayLabel('2026-11-01', '2026-11-05') === 'D+4', '지난 날 D+4')
ok(W.daysUntil('2027-03-02', '2026-11-05') === 117, '해를 넘겨도 (2027-03-02 까지 117일)')
const list = W.parseDdays(JSON.stringify([{ id: 'a', title: '기말', date: '2026-12-10' }, { id: 'b', title: '수능', date: '2026-11-19' }, { id: 'c', title: '체육대회', date: '2026-10-20' }, { title: '', date: '2026-12-01' }, { title: 'x', date: '12/1' }]))
ok(list.length === 3, '틀린 것은 빼고 읽음')
ok(W.sortDdays(list, '2026-11-05').map((d) => d.id).join() === 'b,a,c', '다가오는 것 먼저, 지난 것은 뒤')
ok(W.parseDdays('망가짐').length === 0, '망가진 설정')

console.log(fails ? `\n${fails}개 실패` : '\n모두 통과')
process.exit(fails ? 1 : 0)

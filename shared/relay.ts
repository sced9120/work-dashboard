/**
 * 폰에서 적으면 PC 로 — 선생님 구글 계정의 Apps Script 웹 앱 하나를 우편함으로 쓴다.
 *
 *  폰: 웹 앱 주소(?k=열쇠)를 홈 화면에 두고 메신저 · 카톡 글을 붙여 넣어 보낸다 → 스크립트 속성에 쌓인다.
 *  PC: 몇 분마다 같은 주소에 op=pull 로 가져오고 op=ack 로 지운다 → [메신저 정리] 의 '폰에서 온 글'.
 *
 * 구글 로그인 연동 · 앱 심사가 없다(스크립트는 선생님 계정에서 '나로 실행'). 열쇠를 모르면 읽지도 쓰지도 못한다.
 * 글은 PC 가 가져가면 바로 지운다. 안 가져간 글은 14일 뒤 스스로 지운다.
 */

export const RELAY_VERSION = 1

/** 열쇠 — 주소에 붙여 쓰므로 영문 · 숫자만 */
export function newRelayKey(rand: (n: number) => Uint8Array): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return [...rand(24)].map((b) => abc[b % abc.length]).join('')
}

/** Apps Script 에 붙여 넣을 코드 (Code.gs 하나) */
export function relayScript(key: string): string {
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) throw new Error('열쇠 모양이 맞지 않습니다.')
  return `/**
 * 오르빗 — 폰에서 보내기 (v${RELAY_VERSION})
 * 선생님 구글 계정에만 있는 우편함입니다. 폰에서 보낸 글을 PC 의 오르빗이 가져가면 바로 지웁니다.
 * 아래 KEY 는 오르빗이 만든 열쇠입니다. 남에게 주소를 알려 주지 마세요.
 */
var KEY = '${key}';
var KEEP_DAYS = 14;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.k !== KEY) return HtmlService.createHtmlOutput('<p style="font:16px sans-serif;padding:24px">주소가 맞지 않습니다.</p>');
  if (p.op === 'pull') return out_({ ok: true, v: ${RELAY_VERSION}, items: list_() });
  if (p.op === 'ack') { ack_(String(p.ids || '').split(',')); return out_({ ok: true }); }
  if (p.op === 'ping') return out_({ ok: true, v: ${RELAY_VERSION}, n: list_().length });
  return HtmlService.createHtmlOutput(PAGE.replace('__KEY__', KEY))
    .setTitle('오르빗으로 보내기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 폰 화면에서 부른다 (google.script.run) */
function send(k, text) {
  if (k !== KEY) throw new Error('주소가 맞지 않습니다.');
  text = String(text || '').trim().slice(0, 8000);
  if (!text) throw new Error('보낼 글이 없습니다.');
  var id = new Date().getTime() + '-' + Math.floor(Math.random() * 1e6);
  PropertiesService.getScriptProperties().setProperty('m_' + id, JSON.stringify({ id: id, t: new Date().getTime(), text: text }));
  return list_().length;
}

function list_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var items = [];
  var old = new Date().getTime() - KEEP_DAYS * 86400000;
  for (var k in all) {
    if (k.indexOf('m_') !== 0) continue;
    try {
      var it = JSON.parse(all[k]);
      if (it.t < old) { props.deleteProperty(k); continue; }
      items.push(it);
    } catch (err) { props.deleteProperty(k); }
  }
  items.sort(function (a, b) { return a.t - b.t; });
  return items;
}

function ack_(ids) {
  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < ids.length; i++) if (/^[0-9]+-[0-9]+$/.test(ids[i])) props.deleteProperty('m_' + ids[i]);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

var PAGE = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'body{margin:0;background:#F4F3EE;color:#353532;font:16px/1.5 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}' +
  'main{max-width:560px;margin:0 auto;padding:20px 16px 32px}h1{font-size:20px;font-weight:600;margin:4px 0 2px}' +
  'p{margin:0 0 14px;color:#6B6A64;font-size:14px}textarea{box-sizing:border-box;width:100%;min-height:46vh;padding:14px;border:1px solid #E2E0D8;border-radius:16px;background:#fff;font:inherit;color:inherit}' +
  '.row{display:flex;gap:8px;margin-top:12px}button{flex:1;padding:14px;border-radius:999px;border:1px solid #E2E0D8;background:#fff;font:inherit;font-weight:600;color:#353532}' +
  'button.go{background:#353532;border-color:#353532;color:#F4F3EE}#msg{margin-top:12px;font-size:14px;color:#A9501F;min-height:20px}' +
  'i{display:inline-block;width:8px;height:8px;border-radius:50%;background:#E07A3F;margin-right:8px;vertical-align:1px}</style></head><body><main>' +
  '<h1><i></i>오르빗으로 보내기</h1><p>메신저 · 카톡 글을 길게 눌러 복사해 붙여 넣고 보내면, PC 의 [메신저 정리] 로 갑니다.</p>' +
  '<textarea id="t" placeholder="여기에 붙여 넣기"></textarea>' +
  '<div class="row"><button type="button" id="p">붙여 넣기</button><button type="button" class="go" id="s">보내기</button></div><div id="msg"></div>' +
  '<script>var K="__KEY__",t=document.getElementById("t"),m=document.getElementById("msg");' +
  'document.getElementById("p").onclick=function(){if(navigator.clipboard&&navigator.clipboard.readText){navigator.clipboard.readText().then(function(x){t.value=(t.value?t.value+"\\\\n":"")+x}).catch(function(){m.textContent="길게 눌러 붙여 넣어 주세요."})}else{m.textContent="길게 눌러 붙여 넣어 주세요."}};' +
  'document.getElementById("s").onclick=function(){var v=t.value.trim();if(!v){m.textContent="보낼 글이 없습니다.";return}m.textContent="보내는 중…";' +
  'google.script.run.withSuccessHandler(function(n){t.value="";m.textContent="보냈습니다. PC 에서 가져가기를 기다리는 글 "+n+"개."}).withFailureHandler(function(e){m.textContent="보내지 못했습니다: "+e.message}).send(K,v)};' +
  '</script></main></body></html>';
`
}

/** 웹 앱 주소인지 (배포 → 웹 앱 URL) */
export function normalizeRelayUrl(v: string): string {
  const s = v.trim().replace(/[?#].*$/, '')
  return /^https:\/\/script\.google\.com\/(?:a\/[^/]+\/)?macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(s) ? s : ''
}

/** 폰에서 열 주소 */
export function phoneUrl(url: string, key: string): string {
  return `${url}?k=${encodeURIComponent(key)}`
}

/** op=pull 답 → 받은 글 */
export function parsePull(v: unknown): { id: string; t: number; text: string }[] | null {
  if (!v || typeof v !== 'object' || (v as { ok?: unknown }).ok !== true) return null
  const items = (v as { items?: unknown }).items
  if (!Array.isArray(items)) return []
  return items
    .filter((x): x is { id: string; t: number; text: string } => !!x && typeof x.id === 'string' && /^\d+-\d+$/.test(x.id) && typeof x.text === 'string')
    .map((x) => ({ id: x.id, t: Number(x.t) || 0, text: x.text.slice(0, 8000) }))
}

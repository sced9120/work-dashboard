/**
 * 폰 화면 — Apps Script 웹 앱이 내보내는 한 장짜리 페이지 (relay.ts 가 스크립트 안에 넣는다).
 *
 *  수업 관찰 — 활동 · 반을 고르고 번호를 눌러 본 것을 적어 보낸다 → PC 의 세특 작성실 관찰 기록에 붙는다.
 *  출결      — 담임 반 번호를 눌러 결석 · 지각 · 조퇴 · 결과를 보낸다 → PC 의 출결 기록에 들어간다.
 *  글 보내기 — 예전처럼 메신저 · 카톡 글을 붙여 넣어 보낸다 → [메신저 정리] 의 '폰에서 온 글'.
 *
 * 판(board)에는 활동 이름 · 수업반 · 학생 id('반-번호')만 있다. 학번 · 이름은 PC 가 잠근 이름표(names)로 오고,
 * 여는 열쇠는 폰 주소의 '#n=…' 에만 있다 — google.script.url.getLocation 으로 받아 crypto.subtle(AES-GCM)로 푼다.
 * 열쇠가 없거나 못 풀면 예전처럼 번호만 보인다. 보내는 것에도 이름은 넣지 않는다(학생 id 만).
 * 보내지 못한 것은 폰(localStorage)에 모아 두었다가 다시 보낸다.
 *
 * String.raw 로 적는다 — 역슬래시를 그대로 두려고. 안의 스크립트는 백틱 · ${ 를 쓰지 않는다.
 * __BOOT__ 자리에 스크립트가 { k, tab, board, names } 를 JSON 으로 넣는다.
 * function unb · function unseal 은 한 줄로 둔다(시험이 그 줄을 꺼내 노드에서 돌려 본다).
 */
export const PHONE_PAGE = String.raw`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
:root{--bg:#F4F3EE;--card:#fff;--ink:#353532;--mute:#6B6A64;--line:#E2E0D8;--acc:#E07A3F;--acc2:#A9501F;--soft:#FBE9DD;--soft2:#F0C3A5}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;-webkit-tap-highlight-color:transparent}
header{position:sticky;top:0;z-index:5;background:var(--bg);padding:14px 16px 8px;max-width:560px;margin:0 auto}
h1{font-size:18px;margin:0 0 10px;font-weight:700}h1 i{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--acc);margin-right:8px;vertical-align:2px}
.tabs{display:flex;gap:4px;background:#E9E7E0;border-radius:999px;padding:4px}
.tabs button{flex:1;border:0;background:transparent;padding:9px 4px;border-radius:999px;font:inherit;font-size:15px;font-weight:600;color:var(--mute)}
.tabs button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
main{padding:6px 16px 96px;max-width:560px;margin:0 auto}
.pick{display:flex;gap:8px;margin-bottom:8px}
select,input,textarea{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px;width:100%;min-width:0}
.meta{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--mute);margin:2px 2px 8px}
.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.grid button{position:relative;aspect-ratio:1/1;border:1px solid var(--line);background:var(--card);border-radius:14px;font:inherit;font-size:19px;font-weight:700;color:var(--ink)}
.grid button.done{background:var(--soft);border-color:var(--soft2)}
.grid button .mk{position:absolute;right:6px;top:2px;font-size:12px;color:var(--acc2)}
.grid.nm{grid-template-columns:repeat(3,1fr)}
.grid.nm button{aspect-ratio:auto;min-height:60px;padding:6px 4px;font-size:15px;line-height:1.25;word-break:keep-all}
.grid.nm button small{display:block;font-size:12px;font-weight:600;color:var(--mute);letter-spacing:.02em}
.empty{padding:28px 8px;text-align:center;color:var(--mute);font-size:14px}
.dim{position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:9;display:none}.dim.on{display:block}
.sheet{position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--card);border-radius:20px 20px 0 0;box-shadow:0 -8px 30px rgba(0,0,0,.15);padding:16px 16px calc(16px + env(safe-area-inset-bottom));transform:translateY(105%);visibility:hidden;transition:transform .2s ease,visibility 0s .2s;max-width:560px;margin:0 auto}
.sheet.on{transform:none;visibility:visible;transition:transform .2s ease}
.sheet h2{font-size:17px;margin:0 0 10px}.sheet h2 small{font-weight:400;color:var(--mute);font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.chips button,.seg button{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:8px 12px;font:inherit;font-size:14px;color:var(--ink)}
.seg{display:flex;gap:6px;margin-bottom:8px}.seg button{flex:1;padding:9px 4px}
.seg button.on{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.sheet textarea{min-height:110px;display:block}
.row{display:flex;gap:8px;margin-top:10px}
.row button{flex:1;padding:13px;border-radius:999px;border:1px solid var(--line);background:var(--card);font:inherit;font-weight:700;color:var(--ink)}
.row button.go{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.row button.del{flex:0 0 auto;color:var(--acc2)}
.hint{font-size:13px;color:var(--mute);margin:8px 2px 0}
.q{display:none;margin-top:8px;padding:8px 8px 8px 12px;border-radius:12px;background:var(--soft);font-size:14px;gap:8px;align-items:center;justify-content:space-between}
.q.on{display:flex}
.q button{border:0;background:var(--ink);color:var(--bg);border-radius:999px;padding:6px 12px;font:inherit;font-size:13px;white-space:nowrap}
.list{margin-top:14px;font-size:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px 12px}
.list div{padding:8px 0;border-bottom:1px solid var(--line)}.list div:last-child{border:0}
#tv{min-height:42vh;display:block}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;opacity:0;transition:opacity .2s;z-index:20;pointer-events:none;max-width:90%;text-align:center}
#toast.on{opacity:1}
</style></head><body>
<header><h1><i></i>오르빗</h1><nav class="tabs" id="tabs"></nav><div class="q" id="q"><span id="qt"></span><button type="button" id="qb">다시 보내기</button></div></header>
<main id="main"></main>
<div class="dim" id="dim"></div><section class="sheet" id="sheet" aria-live="polite"></section><div id="toast" role="status"></div>
<script>
var B=__BOOT__,K=B.k,BD=B.board||{};
function $(id){return document.getElementById(id)}
function ls(k,v){try{if(v===undefined)return JSON.parse(localStorage.getItem('orbit_'+k)||'null');localStorage.setItem('orbit_'+k,JSON.stringify(v))}catch(e){return null}}
function p2(n){return(n<10?'0':'')+n}
function today(){var d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate())}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function nos(r){var out=[];String(r||'').split(',').forEach(function(p){var m=p.split('-'),a=+m[0],b=m.length>1?+m[1]:a;if(a>0&&b>=a&&b-a<100)for(var i=a;i<=b;i++)out.push(i)});return out}
function toast(t){var e=$('toast');e.textContent=t;e.className='on';clearTimeout(toast.h);toast.h=setTimeout(function(){e.className=''},2400)}
function md(d){return(+d.slice(5,7))+'/'+(+d.slice(8,10))}

/* 이름표 — 잠근 글을 주소의 #n= 열쇠로 푼다. 못 풀면 NM 은 null 이고 번호만 보인다 */
var NM=null,NMfail=false;
function unb(s){s=String(s).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function unseal(s,k,cb){try{var c=window.crypto&&window.crypto.subtle;if(!c||!s||!k){cb(null);return}var u=unb(s);c.importKey('raw',unb(k),{name:'AES-GCM'},false,['decrypt']).then(function(key){return c.decrypt({name:'AES-GCM',iv:u.slice(0,12)},key,u.slice(12))}).then(function(p){cb(JSON.parse(new TextDecoder().decode(p)))},function(){cb(null)})}catch(e){cb(null)}}
function nkeyOf(h){var m=/(?:^|[#&])n=([A-Za-z0-9_-]{43})(?:&|$)/.exec(String(h||''));return m?m[1]:''}
function loadNames(){
  if(!B.names)return;
  function tryKeys(ks){var k=ks.shift();if(!k){NMfail=true;redraw();return}unseal(B.names,k,function(o){if(o&&o.s){NM=o;ls('nk',k);redraw()}else tryKeys(ks)})}
  function go(h){var a=nkeyOf(h),b=ls('nk')||'',ks=[];if(a)ks.push(a);if(b&&b!==a)ks.push(b);tryKeys(ks)}
  if(window.google&&google.script&&google.script.url)google.script.url.getLocation(function(loc){go(loc&&loc.hash)});else go(location.hash);
}
/* 아래 칸이 열려 있으면 닫지 않는다 — 적는 중에 이름표가 풀려도 */
function redraw(){if($('sheet').className.indexOf('on')<0)draw();else drawTabs()}
function sidNo(s){var m=/^([^-]*)-(\d+)/.exec(String(s||''));return m?{c:m[1]==='0'?'':m[1],n:+m[2]}:{c:'',n:0}}
function who(sid){var x=NM&&NM.s&&NM.s[sid];return x?{l:x[0],nm:x[1]}:null}
function hname(n){return NM&&NM.h&&NM.h[n]?NM.h[n]:''}

/* 보내기 — 실패하면 폰에 모아 두었다가 다시 */
var Q=ls('q')||[];
function drawQ(){$('q').className='q'+(Q.length?' on':'');$('qt').textContent='보내지 못한 기록 '+Q.length+'건이 폰에 있습니다.'}
function push(it,cb){if(!(window.google&&google.script&&google.script.run)){cb(false);return}google.script.run.withSuccessHandler(function(){cb(true)}).withFailureHandler(function(err){cb(false,err)})[it.kind==='text'?'send':'sendItem'](K,it.kind==='text'?it.x:it)}
function send(it){push(it,function(ok,err){if(ok){toast('보냈습니다. PC 의 오르빗이 몇 분 안에 가져갑니다.');flush()}else if(err&&/맞지 않|없습니다/.test(err.message||'')){toast('보내지 못했습니다: '+err.message)}else{Q.push(it);ls('q',Q);drawQ();toast('연결이 약해 폰에 모아 두었습니다.')}})}
var flushing=false;
function flush(){if(flushing||!Q.length)return;flushing=true;push(Q[0],function(ok){flushing=false;if(!ok){drawQ();return}Q.shift();ls('q',Q);drawQ();flush()})}
$('qb').onclick=function(){flush();toast('다시 보내는 중…')};

/* 탭 */
var tabs=[['obs','수업 관찰']];if(BD.h&&BD.h.r)tabs.push(['att','출결']);tabs.push(['text','글 보내기']);
function has(t){return tabs.some(function(x){return x[0]===t})}
var tab=has(B.tab)?B.tab:has(ls('tab'))?ls('tab'):tabs[0][0];
function drawTabs(){$('tabs').innerHTML=tabs.map(function(t){return'<button type="button" data-t="'+t[0]+'" class="'+(t[0]===tab?'on':'')+'">'+t[1]+'</button>'}).join('')}
$('tabs').onclick=function(e){var t=e.target.getAttribute('data-t');if(!t)return;tab=t;ls('tab',t);draw()};

/* 아래에서 올라오는 칸 */
function open_(html){$('sheet').innerHTML=html;$('sheet').className='sheet on';$('dim').className='dim on'}
function close_(){$('sheet').className='sheet';$('dim').className='dim'}
$('dim').onclick=close_;

/* 수업 관찰 */
var CH=['발표','질문','모둠 역할','실험','토론','고친 점','도움 줌'];
var oa=ls('a')||'',oc=ls('c')||'';
function drawObs(){
  var acts=BD.a||[],A=acts.filter(function(x){return x.i===oa})[0]||acts[0];
  if(!A){$('main').innerHTML='<div class="empty">아직 활동이 없습니다.<br>PC 의 오르빗 [세특 작성실] 에 명단과 활동이 있으면,<br>오르빗이 켜져 있을 때 몇 분 안에 여기에 나옵니다.</div>';return}
  var cl=(BD.m||{})[A.m]||[],C=cl.filter(function(x){return x[0]===oc})[0]||cl[0];
  oa=A.i;ls('a',oa);
  var h='<div class="pick"><select id="sa" aria-label="활동">'+acts.map(function(x){return'<option value="'+esc(x.i)+'"'+(x.i===A.i?' selected':'')+'>'+esc(x.n)+'</option>'}).join('')+'</select>';
  if(cl.length>1)h+='<select id="sc" aria-label="수업반" style="max-width:40%">'+cl.map(function(x){return'<option value="'+esc(x[0])+'"'+(C&&x[0]===C[0]?' selected':'')+'>'+esc(x[0])+(/^\d+$/.test(x[0])?'반':'')+'</option>'}).join('')+'</select>';
  h+='</div>';
  if(!C||!C[1]||!C[1].length){$('main').innerHTML=h+'<div class="empty">이 활동의 명단이 비어 있습니다.</div>';bindObs();return}
  oc=C[0];ls('c',oc);
  var key='o_'+A.i+'_'+C[0]+'_'+today(),done=ls(key)||[],ss=C[1];
  var many=ss.map(function(s){return sidNo(s).c}).filter(function(c,i,a){return a.indexOf(c)===i}).length>1;
  h+='<div class="meta"><span>학생을 누르고 본 것을 적으세요</span><span>오늘 '+done.length+' / '+ss.length+'명</span></div>';
  h+='<div class="grid'+(NM?' nm':'')+'" id="g">'+ss.map(function(s,i){var d=done.indexOf(s)>=0,w=who(s),q=sidNo(s),t=w?w.l+' '+w.nm:(q.c&&many?q.c+'-':'')+q.n+'번';return'<button type="button" data-i="'+i+'" class="'+(d?'done':'')+'" aria-label="'+esc(t)+(d?' 오늘 적음':'')+'">'+(w?'<small>'+esc(w.l)+'</small>'+esc(w.nm):esc((q.c&&many?q.c+'-':'')+(q.n||'?')))+(d?'<span class="mk">✓</span>':'')+'</button>'}).join('')+'</div>';
  h+='<p class="hint">색이 칠해진 학생은 오늘 이 활동에서 이미 적은 학생입니다. 같은 학생에게 여러 번 보내도 됩니다.'+(NMfail?' 학번 · 이름을 보려면 PC 오르빗의 QR 을 다시 찍어 여세요.':'')+'</p>';
  $('main').innerHTML=h;bindObs();
  $('g').onclick=function(e){var b=e.target.closest('button');if(b)openObs(A,C[0],ss[+b.getAttribute('data-i')],key)};
}
function bindObs(){if($('sa'))$('sa').onchange=function(){oa=this.value;oc='';drawObs()};if($('sc'))$('sc').onchange=function(){oc=this.value;drawObs()}}
function openObs(A,g,sid,key){
  var w=who(sid),q=sidNo(sid),t=w?esc(w.l)+' '+esc(w.nm):esc(q.c?q.c+'반 ':'')+q.n+'번';
  open_('<h2>'+t+' <small>· '+esc(A.n)+'</small></h2><div class="chips" id="ch">'+CH.map(function(x){return'<button type="button">'+x+'</button>'}).join('')+'</div><textarea id="ox" placeholder="본 것을 짧게 적으세요. 키보드의 마이크(받아쓰기)로 말해도 됩니다."></textarea><div class="row"><button type="button" id="oc">닫기</button><button type="button" class="go" id="os">보내기</button></div>');
  $('ch').onclick=function(e){var b=e.target.closest('button');if(!b)return;var t=$('ox');t.value=(t.value.trim()?t.value.replace(/\s*$/,' '):'')+b.textContent+': ';t.focus()};
  $('oc').onclick=close_;
  $('os').onclick=function(){var x=$('ox').value.trim();if(!x){toast('적은 내용이 없습니다.');return}send({kind:'obs',a:A.i,s:sid,g:g,c:q.c,n:q.n,d:today(),x:x});var d=ls(key)||[];if(d.indexOf(sid)<0)d.push(sid);ls(key,d);close_();drawObs()};
  setTimeout(function(){$('ox').focus()},230);
}

/* 출결 */
var TY=['결석','지각','조퇴','결과'],RS=['질병','미인정','기타','출석인정'],MK={'결석':'●','지각':'◐','조퇴':'◑','결과':'○'};
var ad=today();
function drawAtt(){
  var H=BD.h,ns=nos(H.r),key='t_'+ad,got=ls(key)||{},ks=Object.keys(got).map(Number).sort(function(a,b){return a-b});
  var h='<div class="pick"><input type="date" id="ad" value="'+ad+'" aria-label="날짜"></div>';
  h+='<div class="meta"><span>'+esc(H.c)+' · 결석 · 지각 · 조퇴 · 결과만 누르세요</span><span>'+ks.length+'명</span></div>';
  h+='<div class="grid'+(NM?' nm':'')+'" id="g">'+ns.map(function(n){var g=got[n],nm=hname(n);return'<button type="button" data-n="'+n+'" class="'+(g?'done':'')+'" aria-label="'+n+'번'+(nm?' '+esc(nm):'')+(g?' '+g.ty:'')+'">'+(NM?'<small>'+n+'</small>'+esc(nm||(n+'번')):n)+(g?'<span class="mk">'+(MK[g.ty]||'')+'</span>':'')+'</button>'}).join('')+'</div>';
  h+=ks.length?'<div class="list">'+ks.map(function(n){var g=got[n];return'<div><b>'+n+'번'+(hname(n)?' '+esc(hname(n)):'')+'</b> '+esc(g.ty)+' ('+esc(g.r)+')'+(g.x?' — '+esc(g.x):'')+'</div>'}).join('')+'</div>':'<p class="hint">모두 출석이면 아무것도 보내지 않아도 됩니다. ● 결석 · ◐ 지각 · ◑ 조퇴 · ○ 결과</p>';
  $('main').innerHTML=h;
  $('ad').onchange=function(){ad=this.value||today();drawAtt()};
  $('g').onclick=function(e){var b=e.target.closest('button');if(b)openAtt(+b.getAttribute('data-n'),key)};
}
function seg(id,list,on){return'<div class="seg" id="'+id+'">'+list.map(function(x){return'<button type="button" class="'+(x===on?'on':'')+'">'+x+'</button>'}).join('')+'</div>'}
function segVal(id){var b=$(id).querySelector('.on');return b?b.textContent:''}
function segBind(id){$(id).onclick=function(e){var b=e.target.closest('button');if(!b)return;[].forEach.call(this.children,function(x){x.className=x===b?'on':''})}}
function openAtt(n,key){
  var got=ls(key)||{},cur=got[n]||{ty:'결석',r:'질병',x:''};
  open_('<h2>'+n+'번'+(hname(n)?' '+esc(hname(n)):'')+' <small>· '+md(ad)+' 출결</small></h2>'+seg('ty',TY,cur.ty)+seg('rs',RS,cur.r)+'<input type="text" id="ax" maxlength="100" placeholder="메모 (예: 병원 진료 후 3교시 등교)" value="'+esc(cur.x)+'"><div class="row">'+(got[n]?'<button type="button" class="del" id="ar">지우기</button>':'')+'<button type="button" id="ac">닫기</button><button type="button" class="go" id="as">보내기</button></div><p class="hint">서류(진단서 · 확인서)와 나이스 입력은 PC 의 [출결 기록] 에서 챙깁니다.</p>');
  segBind('ty');segBind('rs');
  $('ac').onclick=close_;
  $('as').onclick=function(){var it={kind:'att',n:n,d:ad,ty:segVal('ty'),r:segVal('rs'),x:$('ax').value.trim()};send(it);var g=ls(key)||{};g[n]={ty:it.ty,r:it.r,x:it.x};ls(key,g);close_();drawAtt()};
  if($('ar'))$('ar').onclick=function(){send({kind:'att',n:n,d:ad,ty:'지움',r:'',x:''});var g=ls(key)||{};delete g[n];ls(key,g);close_();drawAtt()};
}

/* 글 보내기 */
function drawText(){
  $('main').innerHTML='<p class="hint" style="margin:0 2px 8px">메신저 · 카톡 글을 길게 눌러 복사해 붙여 넣고 보내면, PC 의 [메신저 정리] 로 갑니다.</p><textarea id="tv" placeholder="여기에 붙여 넣기"></textarea><div class="row"><button type="button" id="tp">붙여 넣기</button><button type="button" class="go" id="ts">보내기</button></div>';
  $('tp').onclick=function(){var t=$('tv');if(navigator.clipboard&&navigator.clipboard.readText){navigator.clipboard.readText().then(function(x){t.value=(t.value?t.value+'\n':'')+x}).catch(function(){toast('길게 눌러 붙여 넣어 주세요.')})}else toast('길게 눌러 붙여 넣어 주세요.')};
  $('ts').onclick=function(){var v=$('tv').value.trim();if(!v){toast('보낼 글이 없습니다.');return}send({kind:'text',x:v});$('tv').value=''};
}

function draw(){drawTabs();close_();if(tab==='att')drawAtt();else if(tab==='text')drawText();else drawObs()}
drawQ();draw();flush();loadNames();
</script></body></html>`

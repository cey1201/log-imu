/***************** tiny helpers *****************/
const $ = id => document.getElementById(id);
const useTouch = 'ontouchstart' in document.documentElement;
const evDown = () => useTouch ? 'touchstart' : 'mousedown';
const evMove = () => useTouch ? 'touchmove'  : 'mousemove';
const evUp   = () => useTouch ? 'touchend'   : 'mouseup';
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const round = (v,d=4)=>typeof v==='number' ? +v.toFixed(d) : 0;

/***************** ws *****************/
function wsUrl(){ return (location.protocol==='https:'?'wss':'ws')+'://'+location.host; }
let WS=null; (function(){ try{ WS=new WebSocket(wsUrl()); }catch(e){ console.error(e); } })();

/***************** imu *****************/
let rot=null, accG=null, imuTimer=null, imuLog=[], logging=false, currentStage='';

function onMotion(e){ rot=e.rotationRate; accG=e.accelerationIncludingGravity; }
function startIMU(stage){
  currentStage = stage;
  if (!imuTimer){ window.addEventListener('devicemotion', onMotion, {passive:true}); }
  imuLog = []; logging = true;
  clearInterval(imuTimer);
  imuTimer = setInterval(()=>{
    if (!logging || !accG || !rot) return;
    imuLog.push({
      uid: userId, stage: currentStage,
      accX: round(accG.x), accY: round(accG.y), accZ: round(accG.z),
      gyroX: round(rot.beta), gyroY: round(rot.gamma), gyroZ: round(rot.alpha),
      timestamp: Date.now()
    });
  }, 1000/60);
}
function sendIMU(){
  logging=false; clearInterval(imuTimer); imuTimer=null;
  const payload = JSON.stringify({ type:'imu_log', subject:userId, stage:currentStage, data: imuLog });
  if (WS && WS.readyState===WebSocket.OPEN) WS.send(payload);
  else WS?.addEventListener('open', ()=>WS.send(payload), {once:true});
  imuLog=[];
}

/***************** permission + user id *****************/
let userId='';
$('btn-permission').addEventListener('click', ()=>{
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission==='function'){
    DeviceMotionEvent.requestPermission().then(s=>{
      $('btn-start').disabled = false;
      $('body').innerText = (s==='granted'?'Motion ok.':'Motion limited.');
    }).catch(()=>{$('body').innerText='Permission error';});
  } else { $('btn-start').disabled=false; $('body').innerText='Ready.'; }
});
$('subjectNo').addEventListener('input', ()=>{
  userId = $('subjectNo').value.trim();
  $('btn-start').disabled = userId.length===0;
});
$('btn-start').addEventListener('click', ()=> enterPIN() );

/***************** routing *****************/
function showOnly(id){
  ['stage-user','stage-pin','stage-pattern','stage-gesture','stage-done'].forEach(s=>{
    $(s).classList.toggle('hidden', s!==id);
  });
}

/***************** Stage 1: PIN (1-3-7-9) *****************/
const PIN_SEQ = ['1','3','7','9'];
const PIN_REPS=10;
let pinAttempt=1, pinBuf=[];

function enterPIN(){
  $('head').innerText='PIN';
  $('body').innerText='1-3-7-9 ×10';
  showOnly('stage-pin');
  pinAttempt=1; pinBuf=[];
  $('pin-progress').innerText=`${pinAttempt} / ${PIN_REPS}`;
  updatePinDisplay();
  $('pin-feedback').innerText='';
  startIMU(`PIN${pinAttempt}`);
}

function updatePinDisplay(){
  const shown = pinBuf.length? pinBuf.join(' ') : '· · · ·';
  $('PIN_display').innerText = `Entered: ${shown}`;
}

function pressPIN(d){
  pinBuf.push(d);
  if (pinBuf.length>4) pinBuf = pinBuf.slice(-4);
  updatePinDisplay();

  if (pinBuf.length===4){
    if (pinBuf.join('')===PIN_SEQ.join('')){
      $('pin-feedback').innerText='OK'; $('pin-feedback').className='feedback ok';
      sendIMU(); // end this attempt
      pinAttempt++;
      if (pinAttempt>PIN_REPS) return enterPattern();
      $('pin-progress').innerText=`${pinAttempt} / ${PIN_REPS}`;
      pinBuf=[]; updatePinDisplay();
      startIMU(`PIN${pinAttempt}`);
    } else {
      $('pin-feedback').innerText='Wrong (1 3 7 9)'; $('pin-feedback').className='feedback err';
      pinBuf=[]; updatePinDisplay(); // keep same attempt
    }
  }
}
document.querySelectorAll('.PIN_button').forEach(b=>{
  const h=(e)=>{ e.preventDefault(); pressPIN(b.innerText.trim()); };
  b.addEventListener('mousedown', h); b.addEventListener('touchstart', h, {passive:false});
});

/***************** Stage 2: Pattern (Z straight lines) *****************/
const PAT_EXPECT=[1,2,3,5,7,8,9];
const PAT_REPS=10;
let patAttempt=1, patPath=[], patCtx=null, patRect=null, patDownActive=false;

function enterPattern(){
  $('head').innerText='Pattern';
  $('body').innerText='Z ×10';
  showOnly('stage-pattern');
  patAttempt=1; patPath=[]; $('pat-feedback').innerText='';
  $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
  $('pat-path').innerText='Path: []';
  patCtx = $('pattern-canvas').getContext('2d');
  resizePat(); window.addEventListener('resize', resizePat);
  bindPatEvents();
  startIMU(`PAT${patAttempt}`);
}

function resizePat(){
  const grid=$('pattern-grid');
  const c=$('pattern-canvas');
  c.width = grid.clientWidth; c.height = grid.clientHeight;
  patRect = grid.getBoundingClientRect();
  clearPat();
}
function clearPat(){
  patCtx.clearRect(0,0,$('pattern-canvas').width,$('pattern-canvas').height);
  patCtx.lineWidth=6; patCtx.lineCap='round'; patCtx.strokeStyle='#1a73e8';
}

function nodeCenter(idx){
  const c=$('pattern-canvas');
  const col=(idx-1)%3, row=Math.floor((idx-1)/3);
  const cw=c.width/3, ch=c.height/3;
  return { x: col*cw + cw/2, y: row*ch + ch/2 };
}
function nearestIdx(x,y){
  const c=$('pattern-canvas'); const cw=c.width/3, ch=c.height/3;
  const col=clamp(Math.floor(x/cw),0,2), row=clamp(Math.floor(y/ch),0,2);
  return row*3+col+1;
}
function midpoint(a,b){
  const map={
    '1-3':2,'3-1':2,'4-6':5,'6-4':5,'7-9':8,'9-7':8,
    '1-7':4,'7-1':4,'2-8':5,'8-2':5,'3-9':6,'9-3':6,
    '1-9':5,'9-1':5,'3-7':5,'7-3':5
  };
  return map[`${a}-${b}`]||null;
}

function patDown(ev){
  ev.preventDefault(); patDownActive=true; patPath=[];
  clearPat();
  const t=ev.touches?ev.touches[0]:ev;
  const x=clamp(t.clientX-patRect.left,0,$('pattern-canvas').width);
  const y=clamp(t.clientY-patRect.top,0,$('pattern-canvas').height);
  const idx=nearestIdx(x,y);
  patPath.push(idx);
  $('pat-path').innerText=`Path: [${patPath.join(',')}]`;
}
function patMove(ev){
  if (!patDownActive) return;
  ev.preventDefault();
  const t=ev.touches?ev.touches[0]:ev;
  const x=clamp(t.clientX-patRect.left,0,$('pattern-canvas').width);
  const y=clamp(t.clientY-patRect.top,0,$('pattern-canvas').height);
  const idx=nearestIdx(x,y);
  const last=patPath[patPath.length-1];
  if (idx!==last && !patPath.includes(idx)){
    // auto include midpoint if needed
    const mid=midpoint(last,idx);
    const seq = mid && !patPath.includes(mid) ? [mid, idx] : [idx];

    // draw straight segments center-to-center
    let from = nodeCenter(last);
    seq.forEach(k=>{
      const to = nodeCenter(k);
      patCtx.beginPath(); patCtx.moveTo(from.x,from.y); patCtx.lineTo(to.x,to.y); patCtx.stroke();
      patPath.push(k); from = to;
    });
    $('pat-path').innerText=`Path: [${patPath.join(',')}]`;
  }
}
function patUp(){
  if (!patDownActive) return; patDownActive=false;
  const ok = JSON.stringify(patPath)===JSON.stringify(PAT_EXPECT);
  $('pat-feedback').innerText = ok ? 'OK' : 'Not Z';
  $('pat-feedback').className = 'feedback ' + (ok?'ok':'err');

  if (ok){
    sendIMU(); // end this attempt
    patAttempt++;
    if (patAttempt> PAT_REPS) return enterGesture();
    $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
    clearPat();
    startIMU(`PAT${patAttempt}`);
  }
}
function bindPatEvents(){
  const g=$('pattern-grid');
  g.addEventListener('mousedown', patDown);
  g.addEventListener('mousemove', patMove);
  window.addEventListener('mouseup', patUp);
  g.addEventListener('touchstart', patDown, {passive:false});
  g.addEventListener('touchmove', patMove, {passive:false});
  g.addEventListener('touchend', patUp);
  $('pat-reset').addEventListener('click', ()=>{ patPath=[]; $('pat-path').innerText='Path: []'; clearPat(); });
}

/***************** Stage 3: Gesture (free) *****************/
const GES_REPS=10;
let gesAttempt=1, gesCtx=null, gesRect=null, drawing=false, stroke=[];

function enterGesture(){
  $('head').innerText='Gesture';
  $('body').innerText='Free Z ×10';
  showOnly('stage-gesture');
  gesAttempt=1; $('ges-feedback').innerText='';
  $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;
  gesCtx = $('gesture-canvas').getContext('2d');
  resizeGes(); window.addEventListener('resize', resizeGes);
  bindGesEvents();
  startIMU(`GES${gesAttempt}`);
}
function resizeGes(){
  const c=$('gesture-canvas');
  const css = getComputedStyle(c);
  c.width = Math.round(parseFloat(css.width) || 560);
  c.height= Math.round(parseFloat(css.height) || 360);
  gesRect = c.getBoundingClientRect();
  clearGes();
}
function clearGes(){ const c=$('gesture-canvas'); gesCtx.clearRect(0,0,c.width,c.height);
  gesCtx.lineWidth=6; gesCtx.lineCap='round'; gesCtx.strokeStyle='#1a73e8'; }
function gpos(ev){
  const t=ev.touches?ev.touches[0]:ev;
  return { x: clamp(t.clientX-gesRect.left,0,$('gesture-canvas').width),
           y: clamp(t.clientY-gesRect.top ,0,$('gesture-canvas').height) };
}
function gesDown(ev){ ev.preventDefault(); drawing=true; const {x,y}=gpos(ev);
  gesCtx.beginPath(); gesCtx.moveTo(x,y); stroke=[{x,y,t:Date.now()}]; }
function gesMove(ev){ if(!drawing) return; ev.preventDefault(); const {x,y}=gpos(ev);
  gesCtx.lineTo(x,y); gesCtx.stroke(); stroke.push({x,y,t:Date.now()}); }
function gesUp(){ if(!drawing) return; drawing=false; }

function bindGesEvents(){
  const c=$('gesture-canvas');
  c.addEventListener('mousedown', gesDown); c.addEventListener('mousemove', gesMove);
  window.addEventListener('mouseup', gesUp);
  c.addEventListener('touchstart', gesDown, {passive:false});
  c.addEventListener('touchmove', gesMove, {passive:false});
  c.addEventListener('touchend', gesUp);
  $('ges-clear').addEventListener('click', ()=>{ clearGes(); stroke=[]; });
  $('ges-save').addEventListener('click', ()=>{
    if (stroke.length<5){ $('ges-feedback').innerText='Draw first'; $('ges-feedback').className='feedback warn'; return; }
    const payload = JSON.stringify({ type:'gesture_stroke', subject:userId, stage:`GES${gesAttempt}`, data:stroke });
    if (WS && WS.readyState===WebSocket.OPEN) WS.send(payload);
    else WS?.addEventListener('open', ()=>WS.send(payload), {once:true});
    sendIMU(); // end this attempt
    gesAttempt++;
    if (gesAttempt>GES_REPS){
      $('head').innerText='Done'; $('body').innerText=''; showOnly('stage-done');
      window.removeEventListener('devicemotion', onMotion);
      return;
    }
    $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;
    $('ges-feedback').innerText='Saved'; $('ges-feedback').className='feedback ok';
    clearGes(); stroke=[]; startIMU(`GES${gesAttempt}`);
  });
}

/***************** init header/body text *****************/
$('head').innerText='User';
$('body').innerText='Enter ID → Allow Motion → Start';
showOnly('stage-user');

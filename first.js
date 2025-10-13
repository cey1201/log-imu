/**************** helpers ****************/
const $ = (id) => document.getElementById(id);
const useTouch = 'ontouchstart' in document.documentElement;
const evDown = () => (useTouch ? 'touchstart' : 'mousedown');
const evMove = () => (useTouch ? 'touchmove'  : 'mousemove');
const evUp   = () => (useTouch ? 'touchend'   : 'mouseup');
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const round = (v,d=4)=>typeof v==='number' ? +v.toFixed(d) : 0;

/**************** WS ****************/
function wsUrl(){ return (location.protocol==='https:'?'wss':'ws')+'://'+location.host; }
let WS=null; try{ WS=new WebSocket(wsUrl()); }catch(e){ console.error(e); }

/**************** IMU ****************/
let rot=null, accG=null, imuTimer=null, imuLog=[], logging=false, stageLabel='';

function onMotion(e){ rot=e.rotationRate; accG=e.accelerationIncludingGravity; }
function startIMU(label){
  stageLabel = label;
  if (!imuTimer) window.addEventListener('devicemotion', onMotion, {passive:true});
  imuLog=[]; logging=true;
  clearInterval(imuTimer);
  imuTimer = setInterval(()=>{
    if (!logging || !accG || !rot) return;
    imuLog.push({
      uid: userId, stage: stageLabel,
      accX: round(accG.x), accY: round(accG.y), accZ: round(accG.z),
      gyroX: round(rot.beta), gyroY: round(rot.gamma), gyroZ: round(rot.alpha),
      timestamp: Date.now()
    });
  }, 1000/60);
}
function sendIMU(){
  logging=false; clearInterval(imuTimer); imuTimer=null;
  const payload = JSON.stringify({ type:'imu_log', subject:userId, stage:stageLabel, data:imuLog });
  if (WS && WS.readyState===WebSocket.OPEN) WS.send(payload);
  else WS?.addEventListener('open', ()=>WS.send(payload), {once:true});
  imuLog=[];
}

/**************** user + permission ****************/
let userId='';
$('btn-permission').addEventListener('click', ()=>{
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission==='function'){
    DeviceMotionEvent.requestPermission().then(()=>{ $('btn-start').disabled=false; });
  } else { $('btn-start').disabled=false; }
});
$('subjectNo').addEventListener('input', ()=>{
  userId = $('subjectNo').value.trim();
  $('btn-start').disabled = userId.length===0;
});
$('btn-start').addEventListener('click', ()=> enterPIN() );

function showOnly(id){
  ['stage-user','stage-pin','stage-pattern','stage-gesture','stage-done'].forEach(s=>{
    $(s).classList.toggle('hidden', s!==id);
  });
}
$('head').innerText='User'; $('body').innerText='ID → Allow Motion → Start'; showOnly('stage-user');

/**************** PIN (no correctness UI; consistent layout) ****************/
const PIN_SEQ = ['1','3','7','9'];
const PIN_REPS=10;
let pinAttempt=1, pinBuf=[];

function enterPIN(){
  $('head').innerText='PIN'; $('body').innerText='1-3-7-9 ×10';
  showOnly('stage-pin');
  pinAttempt=1; pinBuf=[];
  $('pin-progress').innerText=`${pinAttempt} / ${PIN_REPS}`;
  updatePinDisplay();
  startIMU(`PIN${pinAttempt}`);
}
function updatePinDisplay(){
  const shown = pinBuf.length ? pinBuf.join(' ') : '· · · ·';
  $('PIN_display').innerText = `Entered: ${shown}`;
}
function pressPIN(d){
  pinBuf.push(d);
  if (pinBuf.length>4) pinBuf = pinBuf.slice(-4);
  updatePinDisplay();

  if (pinBuf.length===4){
    if (pinBuf.join('')===PIN_SEQ.join('')){
      sendIMU();                    // silently complete attempt
      pinAttempt++;
      if (pinAttempt>PIN_REPS) return enterPattern();
      $('pin-progress').innerText=`${pinAttempt} / ${PIN_REPS}`;
      pinBuf=[]; updatePinDisplay();
      startIMU(`PIN${pinAttempt}`);
    } else {
      // wrong -> clear entry; no message
      pinBuf=[]; updatePinDisplay();
    }
  }
}
document.querySelectorAll('.PIN_button').forEach(b=>{
  const h=(e)=>{ e.preventDefault(); pressPIN(b.innerText.trim()); };
  b.addEventListener('mousedown', h);
  b.addEventListener('touchstart', h, {passive:false});
});

/**************** Pattern (straight segments + radius node hit + auto midpoints) ****************/
const PAT_EXPECT=[1,2,3,5,7,8,9];
const PAT_REPS=10;

let patAttempt=1, patPath=[], patCtx=null, patRect=null, patDownActive=false;
let nodeCenters=[], nodeRadius=24; // px; set on resize
const patCanvas = $('pattern-canvas'), patGrid = $('pattern-grid');

function enterPattern(){
  $('head').innerText='Pattern'; $('body').innerText='Z ×10';
  showOnly('stage-pattern');
  patAttempt=1; patPath=[]; $('pat-feedback').innerText='';
  $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
  $('pat-path').innerText='Path: []';
  patCtx = patCanvas.getContext('2d');
  resizePat(); window.addEventListener('resize', resizePat);
  bindPatEvents();
  startIMU(`PAT${patAttempt}`);
}

function resizePat(){
  patCanvas.width = patGrid.clientWidth;
  patCanvas.height = patGrid.clientHeight;
  patRect = patGrid.getBoundingClientRect();
  // centers of nodes 1..9
  nodeCenters = [];
  const cw = patCanvas.width/3, ch = patCanvas.height/3;
  for (let r=0;r<3;r++) for (let c=0;c<3;c++) nodeCenters.push({ x:c*cw+cw/2, y:r*ch+ch/2 });
  nodeRadius = Math.max(18, Math.min(cw, ch) * 0.28);
  redrawPattern(); // clear
}

function redrawPattern(previewPoint){ // render committed + optional preview
  patCtx.clearRect(0,0,patCanvas.width, patCanvas.height);
  patCtx.lineWidth=6; patCtx.lineCap='round'; patCtx.strokeStyle='#1a73e8';

  // committed segments
  for (let i=1;i<patPath.length;i++){
    const a=nodeCenters[patPath[i-1]-1], b=nodeCenters[patPath[i]-1];
    patCtx.beginPath(); patCtx.moveTo(a.x,a.y); patCtx.lineTo(b.x,b.y); patCtx.stroke();
  }

  // preview (dashed) from last node to finger
  if (previewPoint && patPath.length){
    const a = nodeCenters[patPath[patPath.length-1]-1];
    patCtx.save(); patCtx.setLineDash([10,8]); patCtx.globalAlpha=.7;
    patCtx.beginPath(); patCtx.moveTo(a.x,a.y); patCtx.lineTo(previewPoint.x, previewPoint.y); patCtx.stroke();
    patCtx.restore();
  }
}

function nearestNodeByRadius(px,py){
  let bestIdx=null, bestD=nodeRadius;
  for (let i=0;i<9;i++){
    const c=nodeCenters[i], d=Math.hypot(px-c.x, py-c.y);
    if (d<=bestD){ bestD=d; bestIdx=i+1; }
  }
  return bestIdx; // 1..9 or null
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
  ev.preventDefault();
  patDownActive=true; patPath=[];
  const t=ev.touches?ev.touches[0]:ev;
  const x=clamp(t.clientX-patRect.left,0,patCanvas.width);
  const y=clamp(t.clientY-patRect.top ,0,patCanvas.height);
  const idx = nearestNodeByRadius(x,y);
  if (idx){ patPath=[idx]; $('pat-path').innerText=`Path: [${patPath.join(',')}]`; }
  redrawPattern({x,y});
}
function patMove(ev){
  if (!patDownActive) return;
  ev.preventDefault();
  const t=ev.touches?ev.touches[0]:ev;
  const x=clamp(t.clientX-patRect.left,0,patCanvas.width);
  const y=clamp(t.clientY-patRect.top ,0,patCanvas.height);
  const hit = nearestNodeByRadius(x,y);

  // preview line from last node to finger
  redrawPattern({x,y});

  if (hit && (!patPath.length || patPath[patPath.length-1]!==hit) && !patPath.includes(hit)){
    // include midpoint if needed
    if (patPath.length){
      const mid = midpoint(patPath[patPath.length-1], hit);
      if (mid && !patPath.includes(mid)) patPath.push(mid);
    }
    patPath.push(hit);
    $('pat-path').innerText=`Path: [${patPath.join(',')}]`;
    redrawPattern({x,y});
  }
}
function patUp(){
  if (!patDownActive) return;
  patDownActive=false;
  redrawPattern(null); // remove preview

  const ok = JSON.stringify(patPath)===JSON.stringify(PAT_EXPECT);
  if (ok){
    sendIMU();                          // finish attempt
    patAttempt++;
    if (patAttempt> PAT_REPS) return enterGesture();
    $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
    startIMU(`PAT${patAttempt}`);
    patPath=[]; $('pat-path').innerText='Path: []';
    redrawPattern(null);
  } else {
    // not Z: stay on same attempt; no noisy UI
  }
}

function bindPatEvents(){
  patGrid.addEventListener('mousedown', patDown);
  patGrid.addEventListener('mousemove', patMove);
  window.addEventListener('mouseup', patUp);
  patGrid.addEventListener('touchstart', patDown, {passive:false});
  patGrid.addEventListener('touchmove', patMove, {passive:false});
  patGrid.addEventListener('touchend', patUp);
  $('pat-reset').addEventListener('click', ()=>{ patPath=[]; $('pat-path').innerText='Path: []'; redrawPattern(null); });
}

/**************** Gesture (raw strokes on canvas) ****************/
const GES_REPS=10;
let gesAttempt=1, gCtx=null, gRect=null, drawing=false, stroke=[];

function enterGesture(){
  $('head').innerText='Gesture'; $('body').innerText='Draw Z ×10';
  showOnly('stage-gesture');
  gesAttempt=1; $('ges-feedback').innerText='';
  $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;
  gCtx = $('gesture-canvas').getContext('2d');
  resizeGesture(); window.addEventListener('resize', resizeGesture);

  const c=$('gesture-canvas');
  c.addEventListener('mousedown', gDown);
  c.addEventListener('mousemove', gMove);
  window.addEventListener('mouseup', gUp);
  c.addEventListener('touchstart', gDown, {passive:false});
  c.addEventListener('touchmove', gMove, {passive:false});
  c.addEventListener('touchend', gUp);

  $('ges-clear').addEventListener('click', ()=>{ clearGesture(); stroke=[]; });
  $('ges-save').addEventListener('click', saveGesture);

  startIMU(`GES${gesAttempt}`);
}
function resizeGesture(){
  const c=$('gesture-canvas');
  const css = getComputedStyle(c);
  c.width = Math.round(parseFloat(css.width) || 560);
  c.height= Math.round(parseFloat(css.height) || 360);
  gRect = c.getBoundingClientRect();
  clearGesture();
}
function clearGesture(){
  const c=$('gesture-canvas');
  gCtx.clearRect(0,0,c.width,c.height);
  gCtx.lineWidth=6; gCtx.lineCap='round'; gCtx.strokeStyle='#1a73e8';
}
function gpos(ev){
  const t=ev.touches?ev.touches[0]:ev;
  return {
    x: clamp(t.clientX - gRect.left, 0, $('gesture-canvas').width),
    y: clamp(t.clientY - gRect.top , 0, $('gesture-canvas').height)
  };
}
function gDown(ev){ ev.preventDefault(); drawing=true; const {x,y}=gpos(ev);
  gCtx.beginPath(); gCtx.moveTo(x,y); stroke=[{x,y,t:Date.now()}]; }
function gMove(ev){ if(!drawing) return; ev.preventDefault(); const {x,y}=gpos(ev);
  gCtx.lineTo(x,y); gCtx.stroke(); stroke.push({x,y,t:Date.now()}); }
function gUp(){ if(!drawing) return; drawing=false; }

function saveGesture(){
  if (stroke.length<5){ $('ges-feedback').innerText='Draw first'; return; }
  const payload = JSON.stringify({ type:'gesture_stroke', subject:userId, stage:`GES${gesAttempt}`, data:stroke });
  if (WS && WS.readyState===WebSocket.OPEN) WS.send(payload);
  else WS?.addEventListener('open', ()=>WS.send(payload), {once:true});

  sendIMU(); // finish attempt
  gesAttempt++;
  if (gesAttempt>GES_REPS){
    $('head').innerText='Done'; $('body').innerText=''; showOnly('stage-done');
    window.removeEventListener('devicemotion', onMotion);
    return;
  }
  $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;
  $('ges-feedback').innerText='Saved';
  clearGesture(); stroke=[]; startIMU(`GES${gesAttempt}`);
}

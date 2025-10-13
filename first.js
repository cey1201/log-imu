/**************** helpers ****************/
const $ = (id) => document.getElementById(id);
const useTouch = 'ontouchstart' in document.documentElement;
const evDown = () => (useTouch ? 'touchstart' : 'mousedown');
const evMove = () => (useTouch ? 'touchmove'  : 'mousemove');
const evUp   = () => (useTouch ? 'touchend'   : 'mouseup');
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const round = (v,d=4)=>typeof v==='number' ? +v.toFixed(d) : 0;

/**************** WS ****************/
// function wsUrl(){ return (location.protocol==='https:'?'wss':'ws')+'://'+location.host; }
let WS=null; 
// try{ WS=new WebSocket(wsUrl()); }catch(e){ console.error(e); }

function startWebSocket() {
  WS = new WebSocket('wss://192.168.0.139:3000');

  WS.onopen = () => {
    console.log("WebSocket connection established.");
  };

  WS.onerror = (err) => {
    console.error("WebSocket error:", err);
  };

  WS.onclose = () => {
    console.log("WebSocket connection closed.");
  };
}

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

/**************** STATE MACHINE ****************/
const useTouchscreen = useTouch;
let mode = 'user';
let nextMode = null;

function genericNext () {
  if (!nextMode) return;
  mode = nextMode;
  nextMode = null;
  display();
}

function showSection(id) {
  ['stage-user','stage-pin','stage-pattern','stage-gesture','stage-done']
    .forEach(s => $(s).classList.toggle('hidden', s !== id));
}

function display() {
  const win_w = window.innerWidth;
  const win_h = window.innerHeight;

  // simple portrait/mobile guard
  if (!useTouchscreen || (win_w > win_h)) {
    showSection('stage-user');
    $('head').innerText = 'Rotate Device';
    $('body').innerText = 'Use portrait orientation on a mobile device.';
    return;
  }

  switch (mode) {
    case 'user':
      showSection('stage-user');
      $('head').innerText = 'User';
      $('body').innerText = 'ID → Allow Motion → Start';
      break;

    case 'pin':
      enterPIN();
      break;

    case 'pattern':
      enterPattern();
      break;

    case 'gesture':
      enterGesture();
      break;

    case 'done':
      showSection('stage-done');
      $('head').innerText = 'Done';
      $('body').innerText = '';
      break;
  }
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
$('btn-start').addEventListener('click', ()=>{
  nextMode = 'pin';
  genericNext();
});

/**************** PIN (no correctness UI; responsive layout handled by CSS) ****************/
const PIN_SEQ = ['1','3','7','9'];
const PIN_REPS=2;
let pinAttempt=1, pinBuf=[];

function enterPIN(){
  $('head').innerText='PIN'; $('body').innerText='1-3-7-9 ×10';
  showSection('stage-pin');
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
      sendIMU();
      pinAttempt++;
      if (pinAttempt>PIN_REPS) { nextMode = 'pattern'; return genericNext(); }
      $('pin-progress').innerText=`${pinAttempt} / ${PIN_REPS}`;
      pinBuf=[]; updatePinDisplay();
      startIMU(`PIN${pinAttempt}`);
    } else {
      pinBuf=[]; updatePinDisplay();
    }
  }
}
document.querySelectorAll('.PIN_button').forEach(b=>{
  const h=(e)=>{ e.preventDefault(); pressPIN(b.innerText.trim()); };
  b.addEventListener('mousedown', h);
  b.addEventListener('touchstart', h, {passive:false});
});

/**************** Pattern (straight segments + tight radius hit + auto midpoints) ****************/
const PAT_EXPECT=[1,2,3,5,7,8,9];
const PAT_REPS=3;

let patAttempt=1, patPath=[], patCtx=null, patRect=null, patDownActive=false;
let nodeCenters=[], nodeRadius=24; // px; set on resize
const patCanvas = $('pattern-canvas'), patGrid = $('pattern-grid');

function enterPattern(){
  $('head').innerText='Pattern'; $('body').innerText='Z ×10';
  showSection('stage-pattern');
  patAttempt=1; patPath=[]; $('pat-feedback').innerText='';
  $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
  
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
  // tighter hit radius (adjust 0.16 → 0.14 for stricter)
  nodeRadius = Math.max(12, Math.min(cw, ch) * 0.16);
  redrawPattern(); // clear
}

function redrawPattern(previewPoint){
  patCtx.clearRect(0,0,patCanvas.width, patCanvas.height);
  patCtx.lineWidth=6; patCtx.lineCap='round'; patCtx.strokeStyle='#1a73e8';
  // committed
  for (let i=1;i<patPath.length;i++){
    const a=nodeCenters[patPath[i-1]-1], b=nodeCenters[patPath[i]-1];
    patCtx.beginPath(); patCtx.moveTo(a.x,a.y); patCtx.lineTo(b.x,b.y); patCtx.stroke();
  }
  // preview dashed
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
  return bestIdx;
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
  
  redrawPattern({x,y});
}
function patMove(ev){
  if (!patDownActive) return;
  ev.preventDefault();
  const t=ev.touches?ev.touches[0]:ev;
  const x=clamp(t.clientX-patRect.left,0,patCanvas.width);
  const y=clamp(t.clientY-patRect.top ,0,patCanvas.height);
  const hit = nearestNodeByRadius(x,y);
  redrawPattern({x,y});
  if (hit && (!patPath.length || patPath[patPath.length-1]!==hit) && !patPath.includes(hit)){
    if (patPath.length){
      const mid = midpoint(patPath[patPath.length-1], hit);
      if (mid && !patPath.includes(mid)) patPath.push(mid);
    }
    patPath.push(hit);
    
    redrawPattern({x,y});
  }
}
function patUp(){
  if (!patDownActive) return;
  patDownActive=false;
  redrawPattern(null);
  const ok = JSON.stringify(patPath)===JSON.stringify(PAT_EXPECT);
  if (ok){
    sendIMU();
    patAttempt++;
    if (patAttempt> PAT_REPS) { nextMode = 'gesture'; return genericNext(); }
    $('pat-progress').innerText=`${patAttempt} / ${PAT_REPS}`;
    startIMU(`PAT${patAttempt}`);
    patPath=[]; 
    
    redrawPattern(null);
  }
}
function bindPatEvents(){
  patGrid.addEventListener('mousedown', patDown);
  patGrid.addEventListener('mousemove', patMove);
  window.addEventListener('mouseup', patUp);
  patGrid.addEventListener('touchstart', patDown, {passive:false});
  patGrid.addEventListener('touchmove', patMove, {passive:false});
  patGrid.addEventListener('touchend', patUp);
  // $('pat-reset').addEventListener('click', ()=>{ patPath=[]; redrawPattern(null); });
}

/**************** Gesture (use your proven core: points/strokes/times) ****************/
const GES_REPS=3;
let gesAttempt=1;

// old-project style vars
let isDown = false;
let points = [];      // current stroke sample points
let strokes = [];     // array of strokes (we only allow single stroke here)
let pointTimes = [];  // per-point ms since stroke start
let GestureContext = null;
let CanvasArea = null;
let strokeStartTime = -1;

function enterGesture(){
  $('head').innerText='Gesture'; $('body').innerText='Draw Z ×10';
  showSection('stage-gesture');
  gesAttempt=1; $('ges-feedback').innerText='';
  $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;

  // wire canvas
  const c=$('gesture-canvas');
  GestureContext = c.getContext('2d');
  resizeGesture();
  window.addEventListener('resize', resizeGesture);

  // bind core handlers (down/move/up)
  c.addEventListener('mousedown', gestureDown);
  c.addEventListener('mousemove', gestureMove);
  window.addEventListener('mouseup', gestureUp);
  c.addEventListener('touchstart', gestureDown, {passive:false});
  c.addEventListener('touchmove', gestureMove, {passive:false});
  c.addEventListener('touchend', gestureUp);

  $('ges-clear').addEventListener('click', clearGestureAll);
  $('ges-save').addEventListener('click', saveGesture);

  startIMU(`GES${gesAttempt}`);
}

/* sizing helpers */
function computeCanvasArea(canvas){
  const r = canvas.getBoundingClientRect();
  return { x:r.left, y:r.top, width:r.width, height:r.height };
}
function resizeGesture(){
  const c=$('gesture-canvas');
  const css = getComputedStyle(c);
  c.width = Math.round(parseFloat(css.width) || 560);
  c.height= Math.round(parseFloat(css.height) || 360);
  CanvasArea = computeCanvasArea(c);
  clearGesture(); // reset drawing style
}
function clearGesture(){
  const c=$('gesture-canvas');
  GestureContext.clearRect(0,0,c.width,c.height);
  GestureContext.lineWidth=6;
  GestureContext.lineCap='round';
  GestureContext.strokeStyle='#1a73e8';
}
function clearGestureAll(){
  points=[]; strokes=[]; pointTimes=[];
  clearGesture();
}

/* coordinate helpers */
function getX(event){ return useTouch ? event.touches[0].clientX : event.clientX; }
function getY(event){ return useTouch ? event.touches[0].clientY : event.clientY; }

/* core gesture handlers */
function gestureDown(event){
  // start on a clean canvas every stroke
  clearGestureAll();

  event.preventDefault();
  if (useTouch && event.touches.length !== 1) return;

  document.onselectstart = () => false;
  document.onmousedown   = () => false;

  isDown = true;
  strokeStartTime = Date.now();

  const x = getX(event) - CanvasArea.x;
  const y = getY(event) - CanvasArea.y;

  points.length = 1; points[0] = {x,y};
  pointTimes.length = 1; pointTimes[0] = 0;
}

function gestureMove(event){
  event.preventDefault();
  if (useTouch && event.touches.length !== 1) return;
  if (!isDown) return;

  const x = clamp(getX(event) - CanvasArea.x, 0, $('gesture-canvas').width);
  const y = clamp(getY(event) - CanvasArea.y, 0, $('gesture-canvas').height);

  points.push({x,y});
  pointTimes.push(Date.now() - strokeStartTime);

  const n = points.length;
  if (n >= 2){
    GestureContext.beginPath();
    GestureContext.moveTo(points[n-2].x, points[n-2].y);
    GestureContext.lineTo(points[n-1].x, points[n-1].y);
    GestureContext.closePath();
    GestureContext.stroke();
  }
}

function gestureUp(event){
  event.preventDefault();
  if (useTouch && event.touches && event.touches.length !== 0) return;

  document.onselectstart = () => true;
  document.onmousedown   = () => true;

  if (!isDown) return;
  isDown = false;

  if (points.length > 10){
    strokes = [ points.slice() ];
  } else {
    clearGestureAll();
  }
}

/* save attempt */
function saveGesture(){
  if (!strokes.length || !strokes[0] || strokes[0].length < 5){
    $('ges-feedback').innerText='Draw first'; return;
  }

  const packed = strokes[0].map((p,i)=>({ x: Math.round(p.x), y: Math.round(p.y), t: pointTimes[i]||0 }));
  const payload = JSON.stringify({
    type:'gesture_stroke',
    subject:userId,
    stage:`GES${gesAttempt}`,
    data: packed
  });

  if (WS && WS.readyState===WebSocket.OPEN) WS.send(payload);
  else WS?.addEventListener('open', ()=>WS.send(payload), {once:true});

  sendIMU(); // finish attempt IMU

  gesAttempt++;
  if (gesAttempt>GES_REPS){
    nextMode = 'done';
    window.removeEventListener('devicemotion', onMotion);
    return genericNext();
  }

  $('ges-progress').innerText=`${gesAttempt} / ${GES_REPS}`;
  $('ges-feedback').innerText='Saved';

  clearGestureAll();
  startIMU(`GES${gesAttempt}`);
}

/**************** boot *****************/
mode = 'user';
display();
startWebSocket();


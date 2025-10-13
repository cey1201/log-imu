/****************************************************************************************
 * Multi-Input Z Task (PIN → PATTERN → GESTURE)
 * - No CSV, no beeps. 
 * - Logs IMU at ~60Hz and sends a batch **per attempt** with `stage` marker:
 *   { type:'imu_log', subject, stage: 'PIN1'|'PAT7'|'GES10', data:[...] }
 * - Keeps your original element IDs & white layout.
 ****************************************************************************************/

/* ------------ DOM references (kept from your original structure) ------------ */
const head = document.getElementById('head');
const body = document.getElementById('body');

const stageUser    = document.getElementById('stage-user');
const stagePIN     = document.getElementById('stage-pin');
const stagePAT     = document.getElementById('stage-pattern');
const stageGES     = document.getElementById('stage-gesture');
const stageDONE    = document.getElementById('stage-done');

const btnPerm      = document.getElementById('btn-permission');
const btnStart     = document.getElementById('btn-start');

const PINdisplay   = document.getElementById('PIN_display');
const PINcontainer = document.getElementById('PIN_container');
const pinButtons   = document.querySelectorAll('.PIN_button');
const pinProgress  = document.getElementById('pin-progress');
const pinFeedback  = document.getElementById('pin-feedback');

const patProgress  = document.getElementById('pat-progress');
const patPathEl    = document.getElementById('pat-path');
const patFeedback  = document.getElementById('pat-feedback');
const patGrid      = document.getElementById('pattern-grid');
const patCanvas    = document.getElementById('pattern-canvas');
const patReset     = document.getElementById('pat-reset');

const gesProgress  = document.getElementById('ges-progress');
const gesCanvas    = document.getElementById('gesture-canvas');
const gesClear     = document.getElementById('ges-clear');
const gesSave      = document.getElementById('ges-save');

/* ------------ utilities ------------ */
const useTouchscreen = ('ontouchstart' in document.documentElement);
const getDownEvent = () => (useTouchscreen ? 'touchstart' : 'mousedown');
const getMoveEvent = () => (useTouchscreen ? 'touchmove'  : 'mousemove');
const getUpEvent   = () => (useTouchscreen ? 'touchend'   : 'mouseup');

const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

function getWSUrl(){
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

/* ------------ global state ------------ */
let userId = '';
let WS = null;

let rotationRate, accelerationIncludingGravity;
let motionListener = false;
let imuInterval = null;
let imuLog = [];
let logging = false;
let currentStageLabel = ''; // e.g., 'PIN1', 'PAT4', 'GES10'

/* ------------ WebSocket ------------ */
function startWebSocket(){
  try {
    WS = new WebSocket(getWSUrl());
    WS.onopen  = ()=>console.log('WebSocket connected');
    WS.onerror = (e)=>console.error('WebSocket error', e);
    WS.onclose = ()=>console.log('WebSocket closed');
  } catch (e) { console.error('WS create error', e); }
}
startWebSocket();

/* ------------ IMU handlers (same sensors as your previous file) ------------ */
function handleMotion(event){
  rotationRate = event.rotationRate;                         /* from your file :contentReference[oaicite:3]{index=3} */
  accelerationIncludingGravity = event.accelerationIncludingGravity;  /* :contentReference[oaicite:4]{index=4} */
}

function round(value, decimals = 4) {
  return typeof value === 'number' ? +value.toFixed(decimals) : 0;     /* :contentReference[oaicite:5]{index=5} */
}

function startIMU(stageLabel){
  if (!motionListener){
    window.addEventListener('devicemotion', handleMotion);
    motionListener = true;
  }
  if (imuInterval) clearInterval(imuInterval);
  imuLog = [];
  logging = true;
  currentStageLabel = stageLabel;

  imuInterval = setInterval(()=>{
    if (!accelerationIncludingGravity || !rotationRate || !logging) return;
    imuLog.push({
      uid: userId,
      stage: currentStageLabel,         // <- per-row stage tag
      accX: round(accelerationIncludingGravity.x, 4),
      accY: round(accelerationIncludingGravity.y, 4),
      accZ: round(accelerationIncludingGravity.z, 4),
      gyroX: round(rotationRate.beta, 4),
      gyroY: round(rotationRate.gamma, 4),
      gyroZ: round(rotationRate.alpha, 4),
      timestamp: Date.now()
    });
  }, 1000/60);
}

function sendIMUBatchAndClear() {
  logging = false;
  clearInterval(imuInterval);
  imuInterval = null;

  const payload = JSON.stringify({
    type: 'imu_log',
    subject: userId,
    stage: currentStageLabel,  // <- batch stage marker (e.g., 'PIN3')
    data: imuLog
  });

  if (WS && WS.readyState === WebSocket.OPEN) {
    WS.send(payload);
    console.log('IMU log sent:', currentStageLabel, imuLog.length);
  } else if (WS) {
    WS.addEventListener('open', ()=>WS.send(payload), {once:true});
  }
  imuLog = [];
}

/* ------------ permission flow (keeps your pattern) ------------ */
function requestMotionPermission(){
  if (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function'){
    DeviceMotionEvent.requestPermission()
      .then((state)=>{
        if (state === 'granted'){
          btnStart.disabled = false;
          body.innerText = 'Motion permission granted.';
        } else {
          body.innerText = 'Permission denied.';
        }
      })
      .catch((err)=>{
        console.error(err);
        body.innerText = 'Error requesting permission.';
      });
  } else {
    // non-iOS: permission API not required
    btnStart.disabled = false;
    body.innerText = 'Ready.';
  }
}
btnPerm.addEventListener('click', requestMotionPermission);

document.getElementById('subjectNo').addEventListener('input', ()=>{
  userId = document.getElementById('subjectNo').value.trim();
  btnStart.disabled = userId.length === 0;
});

btnStart.addEventListener('click', ()=>{
  if (!userId) { alert('Enter subject number'); return; }
  enterPINStage();
});

/* ------------ stage routing ------------ */
function showOnly(id){
  [stageUser, stagePIN, stagePAT, stageGES, stageDONE].forEach(s=>{
    s.classList.toggle('hidden', s.id !== id);
  });
}

/* ===================== Stage 1: PIN (1-3-7-9) ===================== */
const PIN_SEQ = ['1','3','7','9'];
const PIN_REPS = 10;
let pinAttempt = 1;
let pinBuffer = '';

function enterPINStage(){
  head.innerText = 'PIN Stage';
  body.innerText = 'Enter 1 → 3 → 7 → 9 (10 times).';
  showOnly('stage-pin');
  pinAttempt = 1;
  pinBuffer = '';
  PINdisplay.innerText = '••••';
  pinProgress.innerText = `Attempt ${pinAttempt} / ${PIN_REPS}`;
  pinFeedback.innerText = '';
  startIMU(`PIN${pinAttempt}`);
}

function handlePINPress(digit){
  pinBuffer += digit;
  PINdisplay.innerText = '•'.repeat(Math.min(pinBuffer.length, 4));
  if (pinBuffer.length === 4){
    if (pinBuffer === PIN_SEQ.join('')){
      pinFeedback.innerText = 'Correct';
      pinFeedback.className = 'feedback ok';

      // send batch for this attempt
      sendIMUBatchAndClear();

      pinAttempt++;
      if (pinAttempt > PIN_REPS){
        enterPatternStage();
        return;
      }
      pinProgress.innerText = `Attempt ${pinAttempt} / ${PIN_REPS}`;
      pinBuffer = '';
      PINdisplay.innerText = '••••';
      startIMU(`PIN${pinAttempt}`);
    } else {
      pinFeedback.innerText = 'Incorrect — try again (1 3 7 9)';
      pinFeedback.className = 'feedback err';
      pinBuffer = '';
      PINdisplay.innerText = '••••';
      // keep same attempt/stage label until correct
    }
  }
}

pinButtons.forEach(btn=>{
  const handler = (ev)=>{ ev.preventDefault(); handlePINPress(btn.innerText.trim()); };
  btn.addEventListener('mousedown', handler);
  btn.addEventListener('touchstart', handler, {passive:false});
});

/* ===================== Stage 2: Pattern “Z” ===================== */
const PATTERN_EXPECTED = [1,2,3,5,7,8,9];
const PATTERN_REPS = 10;
let patAttempt = 1;
let patCtx, patRect;
let patActive = false;
let patPath = [];

function enterPatternStage(){
  head.innerText = 'Pattern Stage';
  body.innerText = 'Draw a “Z” on the 3×3 grid (10 times).';
  showOnly('stage-pattern');
  patAttempt = 1;
  patPath = [];
  patFeedback.innerText = '';
  patProgress.innerText = `Attempt ${patAttempt} / ${PATTERN_REPS}`;
  patPathEl.innerText = 'Path: []';
  patCtx = patCanvas.getContext('2d');
  resizePatternCanvas();
  window.addEventListener('resize', resizePatternCanvas);
  bindPatternEvents();
  startIMU(`PAT${patAttempt}`);
}

function resizePatternCanvas(){
  const grid = patGrid;
  patCanvas.width = grid.clientWidth;
  patCanvas.height = grid.clientHeight;
  patRect = grid.getBoundingClientRect();
  clearPatternCanvas();
}
function clearPatternCanvas(){
  patCtx.clearRect(0,0,patCanvas.width, patCanvas.height);
  patCtx.lineWidth = 6;
  patCtx.lineCap = 'round';
  patCtx.strokeStyle = '#1a73e8';
}

function bindPatternEvents(){
  patGrid.addEventListener('mousedown', patDown);
  patGrid.addEventListener('mousemove', patMove);
  window.addEventListener('mouseup', patUp);
  patGrid.addEventListener('touchstart', patDown, {passive:false});
  patGrid.addEventListener('touchmove', patMove, {passive:false});
  patGrid.addEventListener('touchend', patUp);
  patReset.addEventListener('click', ()=>{
    patPath = [];
    patPathEl.innerText = 'Path: []';
    clearPatternCanvas();
  });
}

function nearestIdx(x,y){
  const cw = patCanvas.width/3, ch = patCanvas.height/3;
  const c = clamp(Math.floor(x/cw),0,2), r = clamp(Math.floor(y/ch),0,2);
  return r*3 + c + 1;
}
function midpoint(a,b){
  const map = {
    '1-3':2,'3-1':2, '4-6':5,'6-4':5, '7-9':8,'9-7':8,
    '1-7':4,'7-1':4, '2-8':5,'8-2':5, '3-9':6,'9-3':6,
    '1-9':5,'9-1':5, '3-7':5,'7-3':5
  };
  return map[`${a}-${b}`] || null;
}

function patDown(ev){
  ev.preventDefault();
  clearPatternCanvas();
  patActive = true;
  patPath = [];
  const t = ev.touches ? ev.touches[0] : ev;
  const x = clamp(t.clientX - patRect.left, 0, patCanvas.width);
  const y = clamp(t.clientY - patRect.top, 0, patCanvas.height);
  patCtx.beginPath(); patCtx.moveTo(x,y);
  const idx = nearestIdx(x,y);
  if (!patPath.includes(idx)) patPath.push(idx);
  patPathEl.innerText = `Path: [${patPath.join(',')}]`;
}
function patMove(ev){
  if (!patActive) return;
  ev.preventDefault();
  const t = ev.touches ? ev.touches[0] : ev;
  const x = clamp(t.clientX - patRect.left, 0, patCanvas.width);
  const y = clamp(t.clientY - patRect.top, 0, patCanvas.height);
  patCtx.lineTo(x,y); patCtx.stroke();

  const idx = nearestIdx(x,y);
  if (!patPath.includes(idx)){
    const prev = patPath[patPath.length-1];
    const mid = midpoint(prev, idx);
    if (mid && !patPath.includes(mid)) patPath.push(mid);
    patPath.push(idx);
    patPathEl.innerText = `Path: [${patPath.join(',')}]`;
  }
}
function patUp(){
  if (!patActive) return;
  patActive = false;

  // validate Z
  const ok = JSON.stringify(patPath) === JSON.stringify(PATTERN_EXPECTED);
  patFeedback.innerText = ok ? 'Correct' : 'Not a Z — try again';
  patFeedback.className = 'feedback ' + (ok ? 'ok' : 'err');

  if (ok){
    // send batch for this attempt
    sendIMUBatchAndClear();

    patAttempt++;
    if (patAttempt > PATTERN_REPS){
      enterGestureStage();
      return;
    }
    patProgress.innerText = `Attempt ${patAttempt} / ${PATTERN_REPS}`;
    startIMU(`PAT${patAttempt}`);
  }
}

/* ===================== Stage 3: Gesture (free canvas) ===================== */
const GES_REPS = 10;
let gesAttempt = 1;
let gesCtx, gesRect, gesDrawing = false, gesStroke = [];

function enterGestureStage(){
  head.innerText = 'Gesture Stage';
  body.innerText = 'Draw a “Z” on the canvas (10 times).';
  showOnly('stage-gesture');
  gesAttempt = 1;
  gesFeedback.innerText = '';
  gesProgress.innerText = `Attempt ${gesAttempt} / ${GES_REPS}`;
  gesCtx = gesCanvas.getContext('2d');
  resizeGestureCanvas();
  window.addEventListener('resize', resizeGestureCanvas);

  gesCanvas.addEventListener('mousedown', gesDown);
  gesCanvas.addEventListener('mousemove', gesMove);
  window.addEventListener('mouseup', gesUp);
  gesCanvas.addEventListener('touchstart', gesDown, {passive:false});
  gesCanvas.addEventListener('touchmove', gesMove, {passive:false});
  gesCanvas.addEventListener('touchend', gesUp);

  gesClear.addEventListener('click', ()=>{ clearGesture(); gesStroke=[]; });
  gesSave.addEventListener('click', saveGestureAttempt);

  startIMU(`GES${gesAttempt}`);
}

function resizeGestureCanvas(){
  const css = getComputedStyle(gesCanvas);
  gesCanvas.width = Math.round(parseFloat(css.width));
  gesCanvas.height = Math.round(parseFloat(css.height));
  gesRect = gesCanvas.getBoundingClientRect();
  clearGesture();
}
function clearGesture(){
  gesCtx.clearRect(0,0,gesCanvas.width, gesCanvas.height);
  gesCtx.lineWidth = 6; gesCtx.lineCap='round'; gesCtx.strokeStyle='#1a73e8';
}
function gpos(ev){
  const t = ev.touches ? ev.touches[0] : ev;
  const x = clamp((t.clientX - gesRect.left),0,gesCanvas.width);
  const y = clamp((t.clientY - gesRect.top),0,gesCanvas.height);
  return {x,y};
}
function gesDown(ev){
  ev.preventDefault();
  gesDrawing = true;
  const {x,y} = gpos(ev);
  gesCtx.beginPath(); gesCtx.moveTo(x,y);
  gesStroke = [{x,y,t:Date.now()}];
}
function gesMove(ev){
  if (!gesDrawing) return;
  ev.preventDefault();
  const {x,y} = gpos(ev);
  gesCtx.lineTo(x,y); gesCtx.stroke();
  gesStroke.push({x,y,t:Date.now()});
}
function gesUp(){
  if (!gesDrawing) return;
  gesDrawing = false;
}

function saveGestureAttempt(){
  if (gesStroke.length < 5){
    gesFeedback.innerText = 'Please draw before saving.';
    gesFeedback.className = 'feedback warn';
    return;
  }

  // send stroke immediately (optional separate record)
  const strokePayload = JSON.stringify({
    type: 'gesture_stroke',
    subject: userId,
    stage: `GES${gesAttempt}`,
    data: gesStroke
  });
  if (WS && WS.readyState === WebSocket.OPEN) WS.send(strokePayload);
  else if (WS) WS.addEventListener('open', ()=>WS.send(strokePayload), {once:true});

  // send IMU batch for this attempt
  sendIMUBatchAndClear();

  // advance
  gesAttempt++;
  if (gesAttempt > GES_REPS){
    head.innerText = 'Done';
    body.innerText = '';
    showOnly('stage-done');
    // optional: stop motion
    window.removeEventListener('devicemotion', handleMotion);
    motionListener = false;
    return;
  }
  gesProgress.innerText = `Attempt ${gesAttempt} / ${GES_REPS}`;
  gesFeedback.innerText = 'Saved.';
  gesFeedback.className = 'feedback ok';
  clearGesture(); gesStroke = [];
  startIMU(`GES${gesAttempt}`);
}

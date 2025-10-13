/******************************************************************************************************************************************************
 * FUNC: FrontEnd
 */

const scr             = document.getElementById('screen');
const head            = document.getElementById('head');
const body            = document.getElementById('body');
const go              = document.getElementById('go');

const demographics    = document.getElementById('demographics');

const PINdisplay      = document.getElementById('PIN_display');
const PINcontainer    = document.getElementById('PIN_container');
const buttons         = document.querySelectorAll('.PIN_button');


const useTouchscreen = ('ontouchstart' in document.documentElement);
const getDownEvent    = function () {if (useTouchscreen) {return 'touchstart';} else {return 'mousedown';}}
const getMoveEvent    = function () {if (useTouchscreen) {return 'touchmove'; } else {return 'mousemove';}}
const getUpEvent      = function () {if (useTouchscreen) {return 'touchend';  } else {return 'mouseup';}}

const getX = function (event) {if (useTouchscreen) {return event.touches[0].clientX;} else {return event.clientX;}}
const getY = function (event) {if (useTouchscreen) {return event.touches[0].clientY;} else {return event.clientY;}}



let subID = "";
let pin               = '';
let displayStartTime  = -1;
let mode              = 'load';
let nextMode;
let check_count       = 0;
let interval          = -1;
let topPINS;
let rotationRate;
let accelerationIncludingGravity;
let shuffledPINS;
let pinBlocks = [];
let currentBlock;
let blockSize;

let cnt_PINS = 0;
let status_PINS = "released";
let btn;

let block_cnt = 0;
let numberBlock = 5;

let imuInterval = null;
let imuSocket = null;
let imuLog = [];

let IMULoggingStatus = false;
let motionListener = false;

// socket to connect to my computer
function startWebSocket() {
  imuSocket = new WebSocket('wss://192.168.0.139:3000');

  imuSocket.onopen = () => {
    console.log("WebSocket connection established.");
  };

  imuSocket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };

  imuSocket.onclose = () => {
    console.log("WebSocket connection closed.");
  };
}


buttons.forEach(button => {
  button.addEventListener('mousedown', PINdown);
  button.addEventListener('mouseup', PINup);
  button.addEventListener('touchstart', PINdown);
  button.addEventListener('touchend', PINup);
});

function PINdown(event) {
  event.preventDefault(); // Prevent default touch behavior
  btn = event.target;
  status_PINS = "btn_" + btn.innerText;
  console.log(status_PINS);
}

function PINup(event) {
  event.preventDefault(); // Prevent default touch behavior

  const targetPIN = currentBlock[cnt_PINS];
  status_PINS = "released";

  const key = event.target.innerText;
  pin += key;
  PINdisplay.innerText = '*'.repeat(pin.length);

  if (pin.length === targetPIN.length) {
    if (pin === targetPIN) {
      console.log("PIN correct");
      cnt_PINS += 1;
    } else {
      console.log("Incorrect PIN.");
    }

    if (cnt_PINS >= currentBlock.length) {
      console.log("PIN entries in block complete!");
      cnt_PINS = 0;
      block_cnt += 1;
      
      // export via websocket
      stopIMULogging(); 
      
      if (block_cnt >= numberBlock) {        
        // Optional: End message or transition
        head.innerText = "All PIN entries complete.";
        body.innerText = "Thank you for participating.";
        body.style.fontSize = "16px";
        PINcontainer.style.display = 'none';
        PINdisplay.style.display = 'none';
      } else {
        nextMode = 'start_PIN';
        genericNext();  
      }     
    } else {
      nextMode = 'enter_PIN';
      genericNext();  
    }

    pin = '';
    PINdisplay.innerText = '';
  }
}



/******************************************************************************************************************************************************
 * FUNC: BackEnd
 */

function loadCSV() {
  fetch('top_PINS.csv')
  .then(res => res.text())
  .then(csvText => {    
    // console.log(csvText);
    topPINS = csvText;
    topPINS = topPINS.split('\r\n');
  })
  .catch(err => console.error(err));
}


function sendData() {
  const data = {
    time: new Date().toISOString(),
    value: Math.random()
  };

  fetch('/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  .then(res => {
    if (res.ok) console.log("Data sent!");
    else console.error("Failed to send");
  });
}

    
function requestMotionPermission() {
    // Check if DeviceMotionEvent is supported
    if (window.DeviceMotionEvent) {
        // Request permission to access motion sensors
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission()
                .then(permissionState => {
                    if (permissionState === 'granted') {
                        // Permission granted, continue to the next step
                        nextMode = 'init'; // Assuming nextMode and genericNext are defined elsewhere
                        genericNext(); // Function to proceed to the next step
                    } else {
                        // Permission denied, display a message
                        console.log('Motion sensor permission denied.');
                        head.innerText = "Permission Denied";
                        body.innerText = "Thank you for showing interest in this study. If you accidently canceled on permission, clear browser data and reload this page again.";
                    }
                })
                .catch(error => {
                    // Handle any errors
                    head.innerText = "System Error";
                    body.innerText = "Try this page later or on other device";
                    console.error('Error requesting motion sensor permission:', error);
                });
        } else {
            console.log('Motion sensor supported and permission not supported - proceed!');
            nextMode = 'init'; // Assuming nextMode and genericNext are defined elsewhere
            genericNext(); // Function to proceed to the next step
        }
    } else {
        console.log('Device motion not supported.');
        head.innerText = "Device motion not supported on your phone";
        body.innerText = "Thank you for showing interest in this study";
    }
}


const DBfound = function() {
  check_count ++;
  console.log("number of trials to load PIN data:" + check_count);

  if (!!topPINS) {
    mode = nextMode;
    hideAll();
    display();
  } else if ( check_count <= 10 ) { 
    if ( !topPINS ) {
      loadCSV();
    }    

    setTimeout(DBfound, interval);

  } else {
    console.log("Error occured while reading PIN data!");
    head.innerText = "System error, check WIFI connection.."
  }
} 


function handleMotion(event) {
    // // Extract acceleration data from the event
    // var acceleration = event.acceleration;
    // Extract rotation rate data from the event
    rotationRate = event.rotationRate;

    // Extract acceleration including gravity data from the event
    accelerationIncludingGravity = event.accelerationIncludingGravity;
}


/******************************************************************************************************************************************************
 * FUNC: App Architecture
 */
function hideAll() {
    PINcontainer.style.display      = 'none';
    PINdisplay.style.display        = 'none';
    body.style.display              = 'none';
    head.style.display              = 'none';
    go.style.display                = 'none';
}


const genericNext = function () {

  if (nextMode == 'enter_PIN') {

    if (mode == 'start_PIN' ) {
      playBeepStart();  
      mode = nextMode;
      // Wait 200ms after beep starts before switching screen
      setTimeout(() => {
        hideAll();
        display();
      }, 200);
    } else {
      mode = nextMode;
      hideAll();
      display();
    }    
  } else if (nextMode == 'start_PIN' && block_cnt > 0) {
    mode = nextMode;

    if (block_cnt > 0) {
      playBeepEnd();
  
      // Wait 200ms after beep starts before switching screen
      setTimeout(() => {
        hideAll();
        display();
      }, 200);  
    } else {
      hideAll();
      display();
    }
    
  } else {
    mode = nextMode;
    body.removeEventListener(getUpEvent(), genericNext);
    hideAll();
    display();
  }
    
}


const display = function() {

  displayStartTime = new Date().getTime();

  switch (mode) {

    case 'load':
      console.log("Read Top 100 PIn data from local computer");
      head.style.display         = 'block';
      body.style.display         = 'block';
      head.innerText = "Loading . . .";
      nextMode = 'permission';

      check_count = 0;
      interval = 1000;
      setTimeout(DBfound, interval);

      break; 


    case 'permission':
      console.log("Mode - Permission Motion Control");
      head.style.display         = 'block';
      body.style.display         = 'block';
      go.style.display           = 'block';

      head.innerText = "Please allow the device motion control on your device!";
      body.innerText = "";
      go.innerHTML   = "Proceed";

      
      go.addEventListener(getUpEvent(), requestMotionPermission);

      break;

    case 'init':
      if (DeviceMotionEvent.permissionState == 'denied') {
          console.log('Device motion denial.');
          go.removeEventListener(getUpEvent(), requestMotionPermission);
          head.innerText = "Device motion control " + DeviceMotionEvent.permissionState;
          body.innerText = "Try this study on alternative devices..";
      } else {
          // if running device motion, turn this off
          window.removeEventListener('devicemotion', handleMotion);
          
          console.log('Enter subject information');  
          head.style.display         = 'block';
          body.style.display         = 'block';
          go.style.display           = 'block';

          head.innerText = "Enter Subject ID";
          body.innerText = "";
          demographics.style.display = 'block';
              
          // set to 300 PINs for real study
          shuffledPINS = topPINS.splice(0, 300);
          shuffledPINS = shuffleArray(shuffledPINS, 1);

          blockSize = shuffledPINS.length / 5;
          // n/5 pins per block
          for (let i = 0; i < 5; i++) {
            const block = shuffledPINS.slice(i * blockSize, (i + 1) * blockSize);
            pinBlocks.push(block);
          }

        

          nextMode = 'start_PIN'; 
          go.removeEventListener(getUpEvent(), requestMotionPermission);
          go.addEventListener(getUpEvent(), genericNext);
          go.innerText="Next";  
      }
                
      break;            

    case 'start_PIN':
      
      console.log("PIN entry intro/start");
      
      // Turn this events off in this stage 
      if (motionListener) {
        window.removeEventListener('devicemotion', handleMotion);     
        motionListener = false;
      }    
      
      head.style.display         = 'block';
      body.style.display         = 'block';
      go.style.display           = 'block';

      demographics.style.display = 'none';
      // save subject number
      subID = document.getElementById("subjectNo").value + "_bk" + block_cnt;

      head.innerText = "PIN Entry Session ( " + (block_cnt+1) + "/" + numberBlock + " )";
      if (block_cnt == 0) {         
        body.innerText = "You will now proceed to repeatedly enter 4-digit PIN displayed on the screen. \n\n For experimenter -- start/sync the video";  
        body.style.fontSize = "16px";
      } else {        
        body.innerText = "In this stage, you can take up to 1 minute break to proceed. \n\n For experimenter -- start/sync the video";
        body.style.fontSize = "16px";
      } 
      nextMode = 'enter_PIN';
      go.addEventListener(getUpEvent(), genericNext);
      go.innerText="Tap to begin";

      break;

    case 'enter_PIN':

      if (!motionListener) {
        window.addEventListener('devicemotion', handleMotion);   
        motionListener = true;
      }    
      if (!IMULoggingStatus) {
        startIMULogging();
      }
      
      
      console.log("start sessions");
      head.style.display         = 'block';
      body.style.display         = 'block';

      currentBlock = pinBlocks[block_cnt];
      head.innerText = "Enter the give PIN ( " + (cnt_PINS+1) + "/" + blockSize + " )"; 
      body.innerText = currentBlock[cnt_PINS];
      body.style.fontSize = "30px";

      PINdisplay.style.display = 'block';
      PINdisplay.style.fontSize = "35px";
      PINcontainer.style.display = 'block';


      break;

  }
};


/******************************************************************************************************************************************************
 * FUNC: Implementation / logger
 */

function round(value, decimals = 4) {
  return typeof value === 'number' ? +value.toFixed(decimals) : 0;
}

function shuffleArray(array, rep) {
    const arr = [];
    for (var i = 0; i < array.length; i++) {
        for (var j = 0; j < rep; j++) {
            arr.push(array[i]);
        }
    }

    // Fisher-Yates shuffle algorithm
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];        
    }
    return arr;
}


function startIMULogging() {
  IMULoggingStatus = true;
  
  if (imuInterval) clearInterval(imuInterval);

  imuLog = [];

  imuInterval = setInterval(() => {
    if (!accelerationIncludingGravity || !rotationRate) return;

    const logEntry = {
      subject: subID,
      block: block_cnt,
      matchTarget: shuffledPINS[cnt_PINS],
      status: status_PINS,
      accX: round(accelerationIncludingGravity.x, 4),
      accY: round(accelerationIncludingGravity.y, 4),
      accZ: round(accelerationIncludingGravity.z, 4),
      gyroX: round(rotationRate.beta, 4),
      gyroY: round(rotationRate.gamma, 4),
      gyroZ: round(rotationRate.alpha, 4),
      timestamp: Date.now()
    };

    // console.log(logEntry);
    imuLog.push(logEntry);

  }, 1000 / 60); // ~60Hz
}

function stopIMULogging() {
  IMULoggingStatus = false;
  
  clearInterval(imuInterval);
  imuInterval = null;

  const payload = JSON.stringify({
    type: "imu_log",
    subject: subID,
    data: imuLog
  });

  if (imuSocket && imuSocket.readyState === WebSocket.OPEN) {
    imuSocket.send(payload);
    console.log("IMU log sent to server via WebSocket.");
  } else {
    imuSocket.addEventListener('open', () => {
      imuSocket.send(payload);
      console.log("IMU log sent after WebSocket opened.");
    });
  }
}

function playBeepStart() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = 'sine'; // smooth tone
  oscillator.frequency.setValueAtTime(600, ctx.currentTime);         // start low
  oscillator.frequency.linearRampToValueAtTime(1200, ctx.currentTime + 0.2); // sweep up

  gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.2); // 200ms

  console.log("Start beep at:", performance.now());
}

function playBeepEnd() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(1200, ctx.currentTime);         // start high
  oscillator.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.3); // sweep down

  gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.3); // 300ms for emphasis

  console.log("End beep at:", performance.now());
}


hideAll();
display();
startWebSocket(); 

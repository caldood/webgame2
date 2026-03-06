'use strict';
/* ============================================================
   Ferrari Sprint — game.js
   Pseudo-3D lap racing (OutRun style)
   HTML5 Canvas | Vanilla JS | Mobile-first
   ============================================================ */

// ─── Canvas setup ─────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

let W, H;
function resize() {
  W = canvas.width  = canvas.clientWidth;
  H = canvas.height = canvas.clientHeight;
}
resize();
window.addEventListener('resize', resize);

// ─── DOM refs ─────────────────────────────────────────────────
const startScreen    = document.getElementById('start-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const hud            = document.getElementById('hud');
const hudLap         = document.getElementById('hudScore');   // "LAP"
const hudSpeed       = document.getElementById('hudSpeed');
const hudTime        = document.getElementById('hudBest');    // "LAP TIME"
const finalTimeEl    = document.getElementById('finalScore'); // total time
const bestLapEl      = document.getElementById('bestScore');  // best lap
const startBestEl    = document.getElementById('startBest');
const lapMsgEl       = document.getElementById('near-miss');  // lap flash msg
const startBtn       = document.getElementById('startBtn');
const restartBtn     = document.getElementById('restartBtn');
const touchLeft      = document.getElementById('touch-left');
const touchRight     = document.getElementById('touch-right');

// ─── Race constants ────────────────────────────────────────────
const TOTAL_LAPS = 3;

// Fixed circuit layout — same every lap
const LAP_SECTIONS = [
  {len: 4000, curve:  0   },  // start / finish straight
  {len: 2500, curve:  0.85},  // right turn 1
  {len: 1500, curve:  0   },  // short straight
  {len: 2000, curve: -1.3 },  // left hairpin
  {len: 1000, curve:  0   },
  {len: 3000, curve:  0.6 },  // right sweeper
  {len: 1500, curve: -0.5 },  // left kink
  {len: 2000, curve:  0   },  // back straight
  {len: 2500, curve:  1.1 },  // right chicane entry
  {len: 1500, curve: -0.9 },  // left chicane exit
  {len: 2500, curve:  0   },  // final straight back to start
];
const LAP_LENGTH = LAP_SECTIONS.reduce((a, s) => a + s.len, 0); // 24000

// Ratio of finish-line z-units to game-distance units
// (matches the rate stationary objects move in the road z system)
const FINISH_Z_RATE = 0.08 / 400;

// ─── Game state ───────────────────────────────────────────────
let state = 'start'; // 'start' | 'playing' | 'dead'
let raf;

// Physics
let playerX    = 0;
let speed      = 0;
let targetSpeed= 0;
let distance   = 0;
let curve      = 0;
let curveDrift = 0;
let roadZ      = 0;

// Steering
let steerLeft  = false;
let steerRight = false;

// Screen shake (from going off-track)
let shakeX = 0, shakeY = 0, shakeMag = 0;

// Lap tracking
let lapCount    = 0;   // laps completed
let lapTime     = 0;   // current lap elapsed seconds
let totalTime   = 0;   // total race elapsed seconds
let bestLapTime = 0;   // best lap this session (0 = none)
let finishLineZ = 0;   // z-depth of the next finish line crossing
let lapMsgTimer = 0;   // seconds remaining for lap message display

// Persisted best lap (in seconds)
let storedBest = parseFloat(localStorage.getItem('ferrariLapBest') || '0');

// ─── Colours ──────────────────────────────────────────────────
const COLORS = {
  roadLight:  '#606060',
  roadDark:   '#555555',
  curbRed:    '#E8001D',
  curbWhite:  '#F0F0F0',
  grassLight: '#3AA335',
  grassDark:  '#2D8029',
  laneLight:  '#CCCCCC',
  laneDark:   '#AAAAAA',
};

// ─── Clouds ───────────────────────────────────────────────────
let clouds = Array.from({length: 8}, () => ({
  x: Math.random(), y: 0.05 + Math.random() * 0.18,
  w: 0.08 + Math.random() * 0.12,
  speed: 0.00005 + Math.random() * 0.00005,
}));

// ─── Track curve (loops every LAP_LENGTH) ─────────────────────
function getTrackCurve(d) {
  let p = d % LAP_LENGTH;
  for (const s of LAP_SECTIONS) {
    if (p <= s.len) return s.curve;
    p -= s.len;
  }
  return 0;
}

// ─── Time formatting  (m:ss.cc) ───────────────────────────────
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ─── Game init ────────────────────────────────────────────────
function initGame() {
  playerX     = 0;
  speed       = 0.3;
  targetSpeed = 0.5;
  distance    = 0;
  curve       = 0;
  curveDrift  = 0;
  roadZ       = 0;
  shakeX = shakeY = shakeMag = 0;
  lapCount    = 0;
  lapTime     = 0;
  totalTime   = 0;
  bestLapTime = 0;
  finishLineZ = LAP_LENGTH * FINISH_Z_RATE;
  lapMsgTimer = 0;
  lapMsgEl.classList.add('hidden');
}

// ─── Update ───────────────────────────────────────────────────
let prevT = 0;
function update(dt) {
  if (state !== 'playing') return;

  const dts = dt / 1000;

  // Speed ramp — constant ceiling for a fair time trial
  const maxSpeed = 0.85;
  targetSpeed = Math.min(maxSpeed, targetSpeed + dts * 0.03);
  speed += (targetSpeed - speed) * dts * 2;

  // Distance
  const distDelta = speed * 400 * dts;
  distance += distDelta;

  // Track curve
  curve = getTrackCurve(distance);

  // Steering
  let steer = 0;
  if (steerLeft)  steer -= 1;
  if (steerRight) steer += 1;

  curveDrift += curve * speed * dts * 0.4;
  playerX    += steer * dts * 2.2 * speed;
  playerX    += curveDrift * dts * 0.15;
  curveDrift *= (1 - dts * 2);

  // Grass friction — going off track slows you significantly
  const onTrack = Math.abs(playerX) < 1.05;
  if (!onTrack) {
    speed       *= 0.94;
    targetSpeed *= 0.97;
    shakeMag     = 5;
  }
  playerX = Math.max(-1.8, Math.min(1.8, playerX));

  // Road scroll
  roadZ += speed * 0.012;

  // Shake decay
  shakeMag *= 0.88;
  shakeX = (Math.random() - 0.5) * shakeMag * 2;
  shakeY = (Math.random() - 0.5) * shakeMag;

  // Lap timing
  lapTime   += dts;
  totalTime += dts;

  // Advance finish line toward player
  finishLineZ -= speed * dts * 0.08;

  // Lap complete?
  if (finishLineZ <= 0) {
    lapCount++;

    if (bestLapTime === 0 || lapTime < bestLapTime) bestLapTime = lapTime;

    if (lapCount >= TOTAL_LAPS) {
      endRace();
      return;
    }

    lapTime     = 0;
    finishLineZ = LAP_LENGTH * FINISH_Z_RATE;

    lapMsgEl.textContent = `LAP ${lapCount + 1}`;
    lapMsgEl.classList.remove('hidden');
    lapMsgTimer = 2.0;
  }

  // Lap message timer
  if (lapMsgTimer > 0) {
    lapMsgTimer -= dts;
    if (lapMsgTimer <= 0) lapMsgEl.classList.add('hidden');
  }

  // Clouds drift
  for (const c of clouds) {
    c.x -= c.speed * speed * 60;
    if (c.x < -c.w) c.x = 1 + c.w;
  }

  // HUD
  hudLap.textContent   = `${lapCount + 1} / ${TOTAL_LAPS}`;
  hudSpeed.textContent = Math.floor(120 + speed * 280);
  hudTime.textContent  = formatTime(lapTime);
}

// ─── Draw ─────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (shakeMag > 0.5) ctx.translate(shakeX, shakeY);

  drawSky();
  drawRoad();
  drawPlayerCar();

  ctx.restore();

  if (speed > 0.7 && state === 'playing') drawSpeedLines();
}

// ─── Sky & Background ─────────────────────────────────────────
function drawSky() {
  const horizon = H * 0.38;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0,   '#1a1a6e');
  sky.addColorStop(0.4, '#2563EB');
  sky.addColorStop(1,   '#7DD3FC');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  // Sun
  const sunX = W * 0.72, sunY = horizon * 0.45, sunR = W * 0.07;
  const sunG = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2);
  sunG.addColorStop(0,   '#FFFDE7');
  sunG.addColorStop(0.3, '#FDD835');
  sunG.addColorStop(1,   'rgba(253,216,53,0)');
  ctx.fillStyle = sunG;
  ctx.fillRect(0, 0, W, horizon);

  for (const c of clouds) drawCloud(c.x * W, c.y * H, c.w * W);

  drawMountains(horizon);
  drawStands(horizon);

  ctx.fillStyle = '#3AA335';
  ctx.fillRect(0, horizon, W, H - horizon);
}

function drawCloud(cx, cy, cw) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const ch = cw * 0.35;
  ctx.beginPath();
  ctx.ellipse(cx,          cy,          cw*0.5,  ch*0.55, 0, 0, Math.PI*2);
  ctx.ellipse(cx-cw*0.28,  cy+ch*0.1,  cw*0.32, ch*0.45, 0, 0, Math.PI*2);
  ctx.ellipse(cx+cw*0.28,  cy+ch*0.1,  cw*0.3,  ch*0.4,  0, 0, Math.PI*2);
  ctx.fill();
}

function drawMountains(horizon) {
  ctx.fillStyle = '#1E3A5F';
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  const pts = [[0.05,0.7],[0.15,0.45],[0.25,0.6],[0.35,0.38],[0.5,0.55],
               [0.6,0.35],[0.72,0.5],[0.82,0.4],[0.92,0.55],[1,0.48],[1,1],[0,1]];
  for (const p of pts) ctx.lineTo(p[0]*W, horizon*(0.2 + p[1]*0.8));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  [[0.15,0.45],[0.35,0.38],[0.6,0.35],[0.82,0.4]].forEach(([px,py]) => {
    const mx = px*W, my = horizon*(0.2+py*0.8);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx-W*0.025, my+H*0.03);
    ctx.lineTo(mx+W*0.025, my+H*0.03);
    ctx.closePath();
    ctx.fill();
  });
}

function drawStands(horizon) {
  ctx.fillStyle = '#2D3748';
  ctx.fillRect(0,      horizon*0.65, W*0.2, horizon*0.35);
  ctx.fillRect(W*0.8,  horizon*0.65, W*0.2, horizon*0.35);

  for (let row=0; row<3; row++) {
    for (let col=0; col<8; col++) {
      const hue = col * 45;
      ctx.fillStyle = `hsl(${hue},70%,60%)`;
      ctx.beginPath();
      ctx.arc(col*W*0.022+W*0.01, horizon*(0.7+row*0.08), W*0.008, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W*0.82+col*W*0.022, horizon*(0.7+row*0.08), W*0.008, 0, Math.PI*2);
      ctx.fill();
    }
  }

  const bannerColors = ['#E8001D','#FFD700','#1E3A8A'];
  for (let b=0; b<3; b++) {
    ctx.fillStyle = bannerColors[b];
    ctx.fillRect(b*W*0.065+W*0.01, horizon*0.64, W*0.055, H*0.015);
    ctx.fillRect(W*0.82+b*W*0.065, horizon*0.64, W*0.055, H*0.015);
  }
}

// ─── Road rendering (pseudo-3D strips) ────────────────────────
function drawRoad() {
  const horizon = H * 0.38;
  const roadH   = H - horizon;
  const stripes = 80;
  const camX    = playerX * 0.5;

  for (let s = 0; s < stripes; s++) {
    const tNear = s       / stripes;
    const tFar  = (s + 1) / stripes;

    const yNear = horizon + roadH * (1 - tNear * tNear);
    const yFar  = horizon + roadH * (1 - tFar  * tFar);

    const cxNear = W/2 - camX * (1-tNear) * W * 0.9;
    const cxFar  = W/2 - camX * (1-tFar)  * W * 0.9;

    const rwNear = W * 0.38 * (1 - tNear * 0.7);
    const rwFar  = W * 0.38 * (1 - tFar  * 0.7);

    const stripe = (Math.floor(s * 0.5 + roadZ * 8)) % 2;

    // Grass
    ctx.fillStyle = stripe ? COLORS.grassLight : COLORS.grassDark;
    ctx.fillRect(0, yFar, W, yNear - yFar);

    // Road
    ctx.fillStyle = stripe ? COLORS.roadLight : COLORS.roadDark;
    ctx.beginPath();
    ctx.moveTo(cxNear - rwNear, yNear);
    ctx.lineTo(cxNear + rwNear, yNear);
    ctx.lineTo(cxFar  + rwFar,  yFar);
    ctx.lineTo(cxFar  - rwFar,  yFar);
    ctx.closePath();
    ctx.fill();

    // Curbs
    const curbW  = rwNear * 0.07;
    const curbWf = rwFar  * 0.07;
    const curbColor = (Math.floor(s * 0.7 + roadZ * 5)) % 2 ? COLORS.curbRed : COLORS.curbWhite;
    ctx.fillStyle = curbColor;
    ctx.beginPath();
    ctx.moveTo(cxNear - rwNear,         yNear);
    ctx.lineTo(cxNear - rwNear + curbW, yNear);
    ctx.lineTo(cxFar  - rwFar + curbWf, yFar);
    ctx.lineTo(cxFar  - rwFar,          yFar);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cxNear + rwNear - curbW, yNear);
    ctx.lineTo(cxNear + rwNear,         yNear);
    ctx.lineTo(cxFar  + rwFar,          yFar);
    ctx.lineTo(cxFar  + rwFar - curbWf, yFar);
    ctx.closePath();
    ctx.fill();

    // Centre dashes
    if (stripe) {
      const dw  = Math.max(1, rwNear * 0.025);
      const dwf = Math.max(1, rwFar  * 0.025);
      ctx.fillStyle = COLORS.laneLight;
      ctx.beginPath();
      ctx.moveTo(cxNear - dw,  yNear);
      ctx.lineTo(cxNear + dw,  yNear);
      ctx.lineTo(cxFar  + dwf, yFar);
      ctx.lineTo(cxFar  - dwf, yFar);
      ctx.closePath();
      ctx.fill();
    }

    // Armco barriers (far strips)
    if (s > stripes * 0.7) {
      const bh = (yNear - yFar) * 0.4;
      ctx.fillStyle = '#C0C0C0';
      ctx.fillRect(cxFar - rwFar - curbWf - rwFar*0.06, yFar, rwFar*0.055, bh);
      ctx.fillRect(cxFar + rwFar + curbWf,               yFar, rwFar*0.055, bh);
    }
  }

  // Finish line (drawn over road strips)
  if (state === 'playing') drawFinishLine(finishLineZ);

  // Road surface vignette
  const vig = ctx.createLinearGradient(0, H*0.38, 0, H);
  vig.addColorStop(0,   'rgba(0,0,0,0.35)');
  vig.addColorStop(0.3, 'rgba(0,0,0,0)');
  vig.addColorStop(1,   'rgba(0,0,0,0.2)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, H*0.38, W, H*0.62);
}

// ─── Finish line (checkered strip) ────────────────────────────
function drawFinishLine(z) {
  if (z <= 0 || z > 2.5) return;

  const t     = 1 - z / 2.5;          // 0 = at horizon, 1 = at player
  const screenY = H * 0.38 + (H * 0.62) * (t * t);
  const tNear   = 1 - t;              // maps to strip depth (0=near, 1=far)
  const rw      = W * 0.38 * (1 - tNear * 0.7);
  const cx      = W/2 - playerX * 0.5 * (1-tNear) * W * 0.9;
  const lineH   = Math.max(3, rw * 0.14);
  const squares = 10;
  const sw      = (rw * 2) / squares;

  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#000';
    ctx.fillRect(cx - rw + i * sw, screenY - lineH / 2, sw + 0.5, lineH);
  }

  // Second row (offset)
  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#000' : '#fff';
    ctx.fillRect(cx - rw + i * sw, screenY + lineH / 2, sw + 0.5, lineH);
  }
}

// ─── Speed lines ──────────────────────────────────────────────
function drawSpeedLines() {
  const alpha = (speed - 0.7) / 0.6;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.3})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 20; i++) {
    const x   = (Math.sin(i * 1.618 * roadZ) * 0.5 + 0.5) * W;
    const y   = H * 0.38 + Math.random() * H * 0.62;
    const len = 20 + Math.random() * 60;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + len);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Player car ───────────────────────────────────────────────
function drawPlayerCar() {
  const cx = W / 2;
  const cy = H * 0.78;
  const cw = Math.min(W * 0.22, 110);
  const ch = cw * 0.48;

  const lean = (steerRight ? 1 : steerLeft ? -1 : 0) * 0.06;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, ch*0.55, cw*0.5, ch*0.2, 0, 0, Math.PI*2);
  ctx.fill();

  const hw = cw/2, hh = ch/2;

  // Rear wing
  ctx.fillStyle = '#C00016';
  ctx.fillRect(-hw*0.7,  -hh*0.9,  hw*1.4,  ch*0.12);
  ctx.fillRect(-hw*0.72, -hh*0.95, hw*0.04, ch*0.18);
  ctx.fillRect( hw*0.68, -hh*0.95, hw*0.04, ch*0.18);

  // Body — Ferrari red
  ctx.fillStyle = '#E8001D';
  ctx.beginPath();
  ctx.moveTo(-hw*0.5,  hh*0.5);
  ctx.lineTo( hw*0.5,  hh*0.5);
  ctx.lineTo( hw*0.58, -hh*0.1);
  ctx.lineTo( hw*0.38, -hh*0.85);
  ctx.lineTo(-hw*0.38, -hh*0.85);
  ctx.lineTo(-hw*0.58, -hh*0.1);
  ctx.closePath();
  ctx.fill();

  // Side pods
  ctx.fillStyle = '#CC0016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.6,  hh*0.3);
  ctx.lineTo(-hw*0.6,  -hh*0.2);
  ctx.lineTo(-hw*0.38, -hh*0.4);
  ctx.lineTo(-hw*0.35,  hh*0.35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo( hw*0.6,  hh*0.3);
  ctx.lineTo( hw*0.6,  -hh*0.2);
  ctx.lineTo( hw*0.38, -hh*0.4);
  ctx.lineTo( hw*0.35,  hh*0.35);
  ctx.closePath();
  ctx.fill();

  // Yellow accents
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(-hw*0.12, -hh*0.6, hw*0.24, ch*0.08);
  ctx.fillRect(-hw*0.4,   hh*0.1, hw*0.8,  ch*0.06);

  // Cockpit
  ctx.fillStyle = '#0A0A14';
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.1, hw*0.22, hh*0.32, 0, 0, Math.PI*2);
  ctx.fill();

  // Helmet
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.2, hw*0.14, hh*0.2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = '#1E1E1E';
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.14, hw*0.12, hh*0.1, 0, 0, Math.PI*2);
  ctx.fill();

  // Halo
  ctx.strokeStyle = '#C0A000';
  ctx.lineWidth = ch * 0.035;
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.18, hw*0.22, hh*0.08, 0, Math.PI, Math.PI*2);
  ctx.stroke();

  // Front wing
  ctx.fillStyle = '#C00016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.75, -hh*0.75);
  ctx.lineTo( hw*0.75, -hh*0.75);
  ctx.lineTo( hw*0.55, -hh*0.88);
  ctx.lineTo(-hw*0.55, -hh*0.88);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-hw*0.78, -hh*0.92, hw*0.06, hh*0.2);
  ctx.fillRect( hw*0.72, -hh*0.92, hw*0.06, hh*0.2);

  // Wheels
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.ellipse(-hw*0.68,  hh*0.35, hw*0.17, hh*0.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( hw*0.68,  hh*0.35, hw*0.17, hh*0.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-hw*0.62, -hh*0.55, hw*0.15, hh*0.24, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( hw*0.62, -hh*0.55, hw*0.15, hh*0.24, 0, 0, Math.PI*2); ctx.fill();

  // Rims
  ctx.fillStyle = '#C0C0C0';
  [[-hw*0.68, hh*0.35], [hw*0.68, hh*0.35], [-hw*0.62, -hh*0.55], [hw*0.62, -hh*0.55]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.ellipse(wx, wy, hw*0.07, hh*0.12, 0, 0, Math.PI*2); ctx.fill();
  });

  // Exhaust glow
  if (speed > 0.4) {
    const glow = ctx.createRadialGradient(0, hh*0.55, 0, 0, hh*0.55, ch*0.25);
    glow.addColorStop(0,   `rgba(255,160,0,${(speed-0.4)*0.8})`);
    glow.addColorStop(0.5, `rgba(255,80,0,${(speed-0.4)*0.4})`);
    glow.addColorStop(1,   'rgba(255,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-hw, hh*0.35, hw*2, ch*0.5);
  }

  ctx.restore();
}

// ─── End race ─────────────────────────────────────────────────
function endRace() {
  state = 'dead';

  if (navigator.vibrate) navigator.vibrate([60, 30, 100]);

  if (storedBest === 0 || bestLapTime < storedBest) {
    storedBest = bestLapTime;
    localStorage.setItem('ferrariLapBest', bestLapTime);
  }

  setTouchZonesActive(false);
  setTimeout(() => {
    finalTimeEl.textContent = formatTime(totalTime);
    bestLapEl.textContent   = bestLapTime > 0 ? formatTime(bestLapTime) : '--:--.--';
    gameoverScreen.classList.add('active');
    hud.classList.add('hidden');
    lapMsgEl.classList.add('hidden');
  }, 600);
}

// ─── Game loop ────────────────────────────────────────────────
function loop(ts) {
  const dt = Math.min(ts - prevT, 50);
  prevT = ts;
  update(dt);
  draw();
  raf = requestAnimationFrame(loop);
}

// ─── Controls ─────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft')  steerLeft  = true;
  if (e.key === 'ArrowRight') steerRight = true;
  if ((e.key === ' ' || e.key === 'Enter') && state === 'start') startGame();
});
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowLeft')  steerLeft  = false;
  if (e.key === 'ArrowRight') steerRight = false;
});

touchLeft.addEventListener('touchstart',  e => { e.preventDefault(); steerLeft  = true;  }, {passive:false});
touchLeft.addEventListener('touchend',    e => { e.preventDefault(); steerLeft  = false; }, {passive:false});
touchLeft.addEventListener('touchcancel', () => { steerLeft  = false; });

touchRight.addEventListener('touchstart',  e => { e.preventDefault(); steerRight = true;  }, {passive:false});
touchRight.addEventListener('touchend',    e => { e.preventDefault(); steerRight = false; }, {passive:false});
touchRight.addEventListener('touchcancel', () => { steerRight = false; });

// ─── Start / Restart ──────────────────────────────────────────
function setTouchZonesActive(active) {
  const pe = active ? 'auto' : 'none';
  touchLeft.style.pointerEvents  = pe;
  touchRight.style.pointerEvents = pe;
}

function startGame() {
  if (state === 'playing') return;
  state = 'playing';
  initGame();
  startScreen.classList.remove('active');
  gameoverScreen.classList.remove('active');
  hud.classList.remove('hidden');
  lapMsgEl.classList.add('hidden');
  setTouchZonesActive(true);
  prevT = performance.now();
  if (!raf) raf = requestAnimationFrame(loop);
}

// Button listeners
startBtn.addEventListener('click',    startGame);
startBtn.addEventListener('touchend', e => { e.preventDefault(); startGame(); }, {passive:false});

restartBtn.addEventListener('click',    () => { gameoverScreen.classList.remove('active'); startGame(); });
restartBtn.addEventListener('touchend', e => { e.preventDefault(); gameoverScreen.classList.remove('active'); startGame(); }, {passive:false});

// Tap-anywhere fallback for iOS
startScreen.addEventListener('touchend', e => {
  e.preventDefault();
  if (state !== 'playing') startGame();
}, {passive:false});

gameoverScreen.addEventListener('touchend', e => {
  e.preventDefault();
  gameoverScreen.classList.remove('active');
  startGame();
}, {passive:false});

// Update best on start screen
function updateStartBest() {
  const b = parseFloat(localStorage.getItem('ferrariLapBest') || '0');
  if (b > 0) startBestEl.textContent = 'BEST LAP: ' + formatTime(b);
}
updateStartBest();

// ─── Idle animation on start screen ───────────────────────────
function idleLoop(ts) {
  if (state !== 'start') return;
  roadZ += 0.006;
  for (const c of clouds) {
    c.x -= c.speed * 30;
    if (c.x < -c.w) c.x = 1 + c.w;
  }
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  drawSky();
  drawRoad();
  drawPlayerCar();
  ctx.restore();
  requestAnimationFrame(idleLoop);
}

prevT = performance.now();
requestAnimationFrame(ts => { prevT = ts; idleLoop(ts); });

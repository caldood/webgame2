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
const hudLap         = document.getElementById('hudScore');
const hudSpeed       = document.getElementById('hudSpeed');
const hudTime        = document.getElementById('hudBest');
const finalTimeEl    = document.getElementById('finalScore');
const bestLapEl      = document.getElementById('bestScore');
const startBestEl    = document.getElementById('startBest');
const lapMsgEl       = document.getElementById('near-miss');
const startBtn       = document.getElementById('startBtn');
const restartBtn     = document.getElementById('restartBtn');
const touchLeft      = document.getElementById('touch-left');
const touchRight     = document.getElementById('touch-right');

// ─── Race constants ────────────────────────────────────────────
const TOTAL_LAPS = 3;

const LAP_SECTIONS = [
  {len: 4000, curve:  0.00},  // start/finish straight
  {len: 2200, curve:  0.55},  // right turn 1
  {len: 1200, curve:  0.00},  // short straight
  {len: 1800, curve: -0.75},  // left hairpin
  {len:  800, curve:  0.00},
  {len: 3000, curve:  0.40},  // right sweeper
  {len: 1500, curve: -0.35},  // left kink
  {len: 2000, curve:  0.00},  // back straight
  {len: 2200, curve:  0.65},  // right chicane entry
  {len: 1500, curve: -0.60},  // left chicane exit
  {len: 2300, curve:  0.00},  // final straight
];
const LAP_LENGTH    = LAP_SECTIONS.reduce((a, s) => a + s.len, 0); // 22500
const FINISH_Z_RATE = 0.08 / 400; // z-units per game-distance unit

// ─── AI cars ──────────────────────────────────────────────────
const MAX_AI = 5;
const AI_COLORS = [
  { body: '#00D2BE', accent: '#fff',    dark: '#009E8E' }, // Mercedes
  { body: '#0600EF', accent: '#CC0000', dark: '#0400B0' }, // Red Bull
  { body: '#FF8700', accent: '#fff',    dark: '#C06500' }, // McLaren
  { body: '#006F62', accent: '#fff',    dark: '#004D44' }, // Aston Martin
  { body: '#2293D1', accent: '#fff',    dark: '#1668A0' }, // Alpine
];

// ─── Game state ───────────────────────────────────────────────
let state = 'start';
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

// Screen shake
let shakeX = 0, shakeY = 0, shakeMag = 0;

// Lap tracking
let lapCount    = 0;
let lapTime     = 0;
let totalTime   = 0;
let bestLapTime = 0;
let finishLineZ = 0;
let lapMsgTimer = 0;

// AI cars
let aiCars = [];

// Persisted best lap
let storedBest = parseFloat(localStorage.getItem('ferrariLapBest') || '0');

// ─── Colours ──────────────────────────────────────────────────
const COLORS = {
  roadLight:  '#5A5A5A',
  roadDark:   '#4E4E4E',
  curbRed:    '#E8001D',
  curbWhite:  '#F0F0F0',
  grassLight: '#3AA335',
  grassDark:  '#2D8029',
  laneLight:  '#BBBBBB',
};

// ─── Clouds ───────────────────────────────────────────────────
let clouds = Array.from({length: 8}, () => ({
  x: Math.random(), y: 0.05 + Math.random() * 0.18,
  w: 0.08 + Math.random() * 0.12,
  speed: 0.00005 + Math.random() * 0.00005,
}));

// ─── Track curve ──────────────────────────────────────────────
function getTrackCurve(d) {
  let p = d % LAP_LENGTH;
  for (const s of LAP_SECTIONS) {
    if (p <= s.len) return s.curve;
    p -= s.len;
  }
  return 0;
}

// ─── Time format ──────────────────────────────────────────────
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

// ─── Init ─────────────────────────────────────────────────────
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

  // Spawn AI cars spread around the track ahead
  aiCars = [];
  for (let i = 0; i < MAX_AI; i++) {
    aiCars.push({
      x:     (Math.random() - 0.5) * 1.3,
      z:     0.55 + i * 0.42 + Math.random() * 0.25,
      color: AI_COLORS[i % AI_COLORS.length],
      speed: 0.42 + Math.random() * 0.16,
    });
  }
}

// ─── Update ───────────────────────────────────────────────────
let prevT = 0;
function update(dt) {
  if (state !== 'playing') return;

  const dts = dt / 1000;

  // Speed
  const maxSpeed = 0.85;
  targetSpeed = Math.min(maxSpeed, targetSpeed + dts * 0.03);
  speed += (targetSpeed - speed) * dts * 2;

  const distDelta = speed * 400 * dts;
  distance += distDelta;

  // Track curve — smooth transitions between sections
  const targetCurve = getTrackCurve(distance);
  curve += (targetCurve - curve) * Math.min(1, dts * 2.8);

  // Steering
  let steer = 0;
  if (steerLeft)  steer -= 1;
  if (steerRight) steer += 1;

  curveDrift -= curve * speed * dts * 0.4;  // road bends right → drift left, steer right to follow
  playerX    += steer * dts * 2.2 * speed;
  playerX    += curveDrift * dts * 0.15;
  curveDrift *= (1 - dts * 2);

  // Grass — slows significantly
  const onTrack = Math.abs(playerX) < 1.05;
  if (!onTrack) {
    speed       *= 0.94;
    targetSpeed *= 0.97;
    shakeMag     = 5;
  }
  playerX = Math.max(-1.8, Math.min(1.8, playerX));

  roadZ += speed * 0.012;

  shakeMag *= 0.88;
  shakeX = (Math.random() - 0.5) * shakeMag * 2;
  shakeY = (Math.random() - 0.5) * shakeMag;

  lapTime   += dts;
  totalTime += dts;

  // Finish line approach
  finishLineZ -= speed * dts * 0.08;

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

  if (lapMsgTimer > 0) {
    lapMsgTimer -= dts;
    if (lapMsgTimer <= 0) lapMsgEl.classList.add('hidden');
  }

  // AI cars
  for (const ai of aiCars) {
    ai.z -= (speed - ai.speed * 0.72) * dts * 0.08;

    // Passed — respawn ahead
    if (ai.z <= -0.3) {
      ai.z     = 1.6 + Math.random() * 1.2;
      ai.x     = (Math.random() - 0.5) * 1.3;
      ai.speed = 0.42 + Math.random() * 0.16;
    }

    // Soft bump — slows player, no crash
    if (ai.z > 0.02 && ai.z < 0.20) {
      if (Math.abs(playerX - ai.x) < 0.30) {
        speed       *= 0.90;
        targetSpeed *= 0.93;
        shakeMag     = 7;
      }
    }
  }

  // Clouds
  for (const c of clouds) {
    c.x -= c.speed * speed * 60;
    if (c.x < -c.w) c.x = 1 + c.w;
  }

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
  if (speed > 0.68 && state === 'playing') drawSpeedLines();
}

// ─── Sky ──────────────────────────────────────────────────────
function drawSky() {
  const horizon = H * 0.38;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0,   '#12126a');
  sky.addColorStop(0.4, '#1a55cc');
  sky.addColorStop(1,   '#6ec6f5');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  const sunX = W * 0.72, sunY = horizon * 0.42, sunR = W * 0.065;
  const sunG = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.2);
  sunG.addColorStop(0,   '#FFFDE7');
  sunG.addColorStop(0.25,'#FDD835');
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
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  const ch = cw * 0.35;
  ctx.beginPath();
  ctx.ellipse(cx,         cy,         cw*0.50, ch*0.55, 0, 0, Math.PI*2);
  ctx.ellipse(cx-cw*0.28, cy+ch*0.1,  cw*0.32, ch*0.45, 0, 0, Math.PI*2);
  ctx.ellipse(cx+cw*0.28, cy+ch*0.1,  cw*0.30, ch*0.40, 0, 0, Math.PI*2);
  ctx.fill();
}

function drawMountains(horizon) {
  ctx.fillStyle = '#1a3358';
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  [[0.05,0.70],[0.15,0.44],[0.25,0.60],[0.35,0.37],[0.50,0.54],
   [0.60,0.34],[0.72,0.50],[0.82,0.39],[0.92,0.54],[1,0.47],[1,1],[0,1]]
    .forEach(([px,py]) => ctx.lineTo(px*W, horizon*(0.2+py*0.8)));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  [[0.15,0.44],[0.35,0.37],[0.60,0.34],[0.82,0.39]].forEach(([px,py]) => {
    const mx = px*W, my = horizon*(0.2+py*0.8);
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx-W*0.023, my+H*0.028);
    ctx.lineTo(mx+W*0.023, my+H*0.028);
    ctx.closePath();
    ctx.fill();
  });
}

function drawStands(horizon) {
  ctx.fillStyle = '#252f3d';
  ctx.fillRect(0,     horizon*0.65, W*0.20, horizon*0.35);
  ctx.fillRect(W*0.8, horizon*0.65, W*0.20, horizon*0.35);

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 9; col++) {
      ctx.fillStyle = `hsl(${col*40},70%,58%)`;
      ctx.beginPath();
      ctx.arc(col*W*0.020+W*0.01, horizon*(0.70+row*0.08), W*0.0075, 0, Math.PI*2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(W*0.82+col*W*0.020, horizon*(0.70+row*0.08), W*0.0075, 0, Math.PI*2);
      ctx.fill();
    }
  }

  ['#E8001D','#FFD700','#1E3A8A'].forEach((col, b) => {
    ctx.fillStyle = col;
    ctx.fillRect(b*W*0.062+W*0.010, horizon*0.64, W*0.052, H*0.013);
    ctx.fillRect(W*0.820+b*W*0.062, horizon*0.64, W*0.052, H*0.013);
  });
}

// ─── Road (pseudo-3D with visual curves) ──────────────────────
function drawRoad() {
  const horizon = H * 0.38;
  const roadH   = H - horizon;
  const stripes = 80;
  const camX    = playerX * 0.5;

  // Linear curve accumulation (OutRun-style): each strip adds a small
  // lateral step so the road bends progressively toward the horizon.
  const CURVE_STEP = W * 0.005;   // offset added per strip (≈0.22–0.30W at horizon for medium/tight turns)
  let curveSumX = 0;             // running lateral offset

  for (let s = 0; s < stripes; s++) {
    const tNear = s       / stripes;
    const tFar  = (s + 1) / stripes;

    const yNear = horizon + roadH * (1 - tNear * tNear);
    const yFar  = horizon + roadH * (1 - tFar  * tFar);

    const curveNear = curveSumX;
    curveSumX      += curve * CURVE_STEP;
    const curveFar  = curveSumX;

    const cxNear = W/2 - camX * (1-tNear) * W * 0.88 + curveNear;
    const cxFar  = W/2 - camX * (1-tFar)  * W * 0.88 + curveFar;

    const rwNear = W * 0.40 * (1 - tNear * 0.70);
    const rwFar  = W * 0.40 * (1 - tFar  * 0.70);

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
    const curbW  = rwNear * 0.075;
    const curbWf = rwFar  * 0.075;
    const curbCol = (Math.floor(s * 0.7 + roadZ * 5)) % 2 ? COLORS.curbRed : COLORS.curbWhite;
    ctx.fillStyle = curbCol;
    ctx.beginPath();
    ctx.moveTo(cxNear - rwNear,          yNear);
    ctx.lineTo(cxNear - rwNear + curbW,  yNear);
    ctx.lineTo(cxFar  - rwFar  + curbWf, yFar);
    ctx.lineTo(cxFar  - rwFar,           yFar);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cxNear + rwNear - curbW,  yNear);
    ctx.lineTo(cxNear + rwNear,          yNear);
    ctx.lineTo(cxFar  + rwFar,           yFar);
    ctx.lineTo(cxFar  + rwFar  - curbWf, yFar);
    ctx.closePath();
    ctx.fill();

    // Centre dashes
    if (stripe) {
      const dw  = Math.max(1, rwNear * 0.022);
      const dwf = Math.max(1, rwFar  * 0.022);
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
    if (s > stripes * 0.68) {
      const bh = (yNear - yFar) * 0.45;
      ctx.fillStyle = '#C8C8C8';
      ctx.fillRect(cxFar - rwFar - curbWf - rwFar*0.065, yFar, rwFar*0.055, bh);
      ctx.fillRect(cxFar + rwFar + curbWf,                yFar, rwFar*0.055, bh);
    }
  }

  // horizonCurveX = total lateral offset accumulated to the horizon.
  // For an object at z-depth, its offset scales linearly: (z/2.5) * horizonCurveX
  const horizonCurveX = curveSumX;

  // AI cars (sorted far-to-near for proper draw order)
  const sortedAI = [...aiCars].sort((a, b) => b.z - a.z);
  for (const ai of sortedAI) {
    if (ai.z <= 0.01 || ai.z > 2.8) continue;
    const t  = 1 - Math.min(1, ai.z / 2.5);
    if (t < 0.02) continue;
    const zF  = Math.min(1, ai.z / 2.5);
    const csx = zF * horizonCurveX;           // linear, consistent with road strips
    const screenX = W/2 + (ai.x - camX) * t * W * 0.44 + csx;
    const screenY = H * 0.38 + (H * 0.62) * (t * t);
    const cw = W * 0.115 * t;
    const ch = cw * 0.48;
    drawAICar(screenX, screenY, cw, ch, ai.color);
  }

  // Finish line
  if (state === 'playing') drawFinishLine(finishLineZ, camX, horizonCurveX);

  // Vignette
  const vig = ctx.createLinearGradient(0, H*0.38, 0, H);
  vig.addColorStop(0,   'rgba(0,0,0,0.38)');
  vig.addColorStop(0.28,'rgba(0,0,0,0)');
  vig.addColorStop(1,   'rgba(0,0,0,0.22)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, H*0.38, W, H*0.62);
}

// ─── Finish line ──────────────────────────────────────────────
function drawFinishLine(z, camX, horizonCurveX) {
  if (z <= 0 || z > 2.5) return;
  const t     = 1 - z / 2.5;        // t_ai: 1=at player, 0=horizon
  const tNear = 1 - t;               // strip depth: 0=near, 1=far (= z/2.5)
  const screenY = H * 0.38 + (H * 0.62) * (t * t);
  const rw    = W * 0.40 * (1 - tNear * 0.70);
  const cx    = W/2 - camX * (1-tNear) * W * 0.88 + tNear * horizonCurveX;
  const lineH = Math.max(3, rw * 0.13);
  const sq    = 10;
  const sw    = (rw * 2) / sq;

  for (let i = 0; i < sq; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#fff' : '#111';
    ctx.fillRect(cx - rw + i * sw, screenY - lineH, sw + 0.5, lineH);
  }
  for (let i = 0; i < sq; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#111' : '#fff';
    ctx.fillRect(cx - rw + i * sw, screenY, sw + 0.5, lineH);
  }
}

// ─── AI car ───────────────────────────────────────────────────
function drawAICar(cx, cy, cw, ch, col) {
  const x = cx - cw/2, y = cy - ch;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + ch*0.06, cw*0.46, ch*0.10, 0, 0, Math.PI*2);
  ctx.fill();

  // Rear wing
  ctx.fillStyle = col.dark;
  ctx.fillRect(x - cw*0.02, y + ch*0.00, cw*1.04, ch*0.12);
  ctx.fillRect(x + cw*0.04, y + ch*0.11, cw*0.92, ch*0.10);

  // Body
  const bg = ctx.createLinearGradient(x, 0, x+cw, 0);
  bg.addColorStop(0,   col.dark);
  bg.addColorStop(0.35, col.body);
  bg.addColorStop(0.65, col.body);
  bg.addColorStop(1,   col.dark);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(x + cw*0.10, y + ch*0.78);
  ctx.lineTo(x + cw*0.90, y + ch*0.78);
  ctx.lineTo(x + cw*0.96, y + ch*0.35);
  ctx.lineTo(x + cw*0.72, y + ch*0.08);
  ctx.lineTo(x + cw*0.28, y + ch*0.08);
  ctx.lineTo(x + cw*0.04, y + ch*0.35);
  ctx.closePath();
  ctx.fill();

  // Sidepod intakes
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(x+cw*0.10, y+ch*0.45, cw*0.075, ch*0.13, -0.2, 0, Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x+cw*0.90, y+ch*0.45, cw*0.075, ch*0.13,  0.2, 0, Math.PI*2);
  ctx.fill();

  // Accent stripe
  ctx.fillStyle = col.accent;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x + cw*0.18, y + ch*0.48, cw*0.64, ch*0.10);
  ctx.globalAlpha = 1;

  // Cockpit
  ctx.fillStyle = '#0a0a14';
  ctx.beginPath();
  ctx.moveTo(x + cw*0.37, y + ch*0.20);
  ctx.lineTo(x + cw*0.63, y + ch*0.20);
  ctx.lineTo(x + cw*0.57, y + ch*0.46);
  ctx.lineTo(x + cw*0.43, y + ch*0.46);
  ctx.closePath();
  ctx.fill();

  // Front wing
  ctx.fillStyle = col.body;
  ctx.beginPath();
  ctx.moveTo(x - cw*0.07, y + ch*0.82);
  ctx.lineTo(x + cw*1.07, y + ch*0.82);
  ctx.lineTo(x + cw*0.93, y + ch*0.94);
  ctx.lineTo(x + cw*0.07, y + ch*0.94);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - cw*0.08, y + ch*0.80, cw*0.08, ch*0.16);
  ctx.fillRect(x +  cw,     y + ch*0.80, cw*0.08, ch*0.16);

  // Wheels
  ctx.fillStyle = '#111';
  [[0.09,0.58],[0.91,0.58],[0.16,0.22],[0.84,0.22]].forEach(([rx,ry]) => {
    ctx.beginPath();
    ctx.ellipse(x+cw*rx, y+ch*ry, cw*0.13, ch*0.15, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#777';
    ctx.beginPath();
    ctx.ellipse(x+cw*rx, y+ch*ry, cw*0.07, ch*0.08, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.fillStyle = '#111';
  });
}

// ─── Speed lines ──────────────────────────────────────────────
function drawSpeedLines() {
  const alpha = (speed - 0.68) / 0.55;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.28})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 22; i++) {
    const x   = (Math.sin(i * 1.618 * roadZ) * 0.5 + 0.5) * W;
    const y   = H * 0.38 + Math.random() * H * 0.62;
    const len = 18 + Math.random() * 55;
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
  const cy = H * 0.80;
  const cw = Math.min(W * 0.30, 160);
  const ch = cw * 0.44;
  const hw = cw / 2, hh = ch / 2;

  const lean = (steerRight ? 1 : steerLeft ? -1 : 0) * 0.05;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.ellipse(0, ch * 0.62, cw * 0.50, ch * 0.17, 0, 0, Math.PI*2);
  ctx.fill();

  // ── Floor / diffuser ──────────────────────────────────────────
  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(-hw * 0.56, hh * 0.38, cw * 1.12, ch * 0.14);
  // Diffuser fins
  ctx.fillStyle = '#C00016';
  for (let f = 0; f < 6; f++) {
    ctx.fillRect(-hw * 0.46 + f * hw * 0.20, hh * 0.40, 1.5, ch * 0.10);
  }

  // ── Rear wing ─────────────────────────────────────────────────
  // Upper plane
  ctx.fillStyle = '#A80012';
  ctx.fillRect(-hw * 0.82, -hh * 1.04, hw * 1.64, ch * 0.14);
  // Lower plane
  ctx.fillStyle = '#C40016';
  ctx.fillRect(-hw * 0.75, -hh * 0.91, hw * 1.50, ch * 0.11);
  // Endplates
  ctx.fillStyle = '#8A0010';
  ctx.fillRect(-hw * 0.84, -hh * 1.04, hw * 0.065, ch * 0.25);
  ctx.fillRect( hw * 0.775,-hh * 1.04, hw * 0.065, ch * 0.25);
  // Swan-neck pillars
  ctx.fillStyle = '#B40014';
  ctx.fillRect(-hw * 0.13, -hh * 0.90, hw * 0.056, ch * 0.23);
  ctx.fillRect( hw * 0.074,-hh * 0.90, hw * 0.056, ch * 0.23);

  // ── Body underside / carbon floor ─────────────────────────────
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(-hw * 0.54, hh * 0.52);
  ctx.lineTo( hw * 0.54, hh * 0.52);
  ctx.lineTo( hw * 0.64, -hh * 0.28);
  ctx.lineTo( hw * 0.28, -hh * 0.92);
  ctx.lineTo(-hw * 0.28, -hh * 0.92);
  ctx.lineTo(-hw * 0.64, -hh * 0.28);
  ctx.closePath();
  ctx.fill();

  // ── Main body ─────────────────────────────────────────────────
  const bodyG = ctx.createLinearGradient(-hw * 0.5, 0, hw * 0.5, 0);
  bodyG.addColorStop(0,    '#B50015');
  bodyG.addColorStop(0.28, '#E8001D');
  bodyG.addColorStop(0.50, '#FF1F34');
  bodyG.addColorStop(0.72, '#E8001D');
  bodyG.addColorStop(1,    '#B50015');
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.moveTo(-hw * 0.50, hh * 0.46);
  ctx.lineTo( hw * 0.50, hh * 0.46);
  ctx.lineTo( hw * 0.60, -hh * 0.20);
  ctx.lineTo( hw * 0.36, -hh * 0.88);
  ctx.lineTo(-hw * 0.36, -hh * 0.88);
  ctx.lineTo(-hw * 0.60, -hh * 0.20);
  ctx.closePath();
  ctx.fill();

  // ── Sidepods ──────────────────────────────────────────────────
  // Left
  const spG_L = ctx.createLinearGradient(-hw*0.74, 0, -hw*0.38, 0);
  spG_L.addColorStop(0, '#9A0012');
  spG_L.addColorStop(1, '#CC0016');
  ctx.fillStyle = spG_L;
  ctx.beginPath();
  ctx.moveTo(-hw*0.64, hh*0.42);
  ctx.lineTo(-hw*0.76, -hh*0.05);
  ctx.lineTo(-hw*0.58, -hh*0.40);
  ctx.lineTo(-hw*0.44, -hh*0.50);
  ctx.lineTo(-hw*0.39, hh*0.32);
  ctx.closePath();
  ctx.fill();
  // Intake
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(-hw*0.65, -hh*0.06, hw*0.092, hh*0.17, -0.18, 0, Math.PI*2);
  ctx.fill();
  // Highlight
  ctx.fillStyle = 'rgba(255,100,100,0.18)';
  ctx.beginPath();
  ctx.ellipse(-hw*0.60, -hh*0.10, hw*0.055, hh*0.09, -0.2, 0, Math.PI*2);
  ctx.fill();

  // Right
  const spG_R = ctx.createLinearGradient(hw*0.38, 0, hw*0.74, 0);
  spG_R.addColorStop(0, '#CC0016');
  spG_R.addColorStop(1, '#9A0012');
  ctx.fillStyle = spG_R;
  ctx.beginPath();
  ctx.moveTo( hw*0.64, hh*0.42);
  ctx.lineTo( hw*0.76, -hh*0.05);
  ctx.lineTo( hw*0.58, -hh*0.40);
  ctx.lineTo( hw*0.44, -hh*0.50);
  ctx.lineTo( hw*0.39, hh*0.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(hw*0.65, -hh*0.06, hw*0.092, hh*0.17, 0.18, 0, Math.PI*2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,100,100,0.18)';
  ctx.beginPath();
  ctx.ellipse(hw*0.60, -hh*0.10, hw*0.055, hh*0.09, 0.2, 0, Math.PI*2);
  ctx.fill();

  // ── Shark fin / engine cover ───────────────────────────────────
  ctx.fillStyle = '#C80016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.062, -hh*0.30);
  ctx.lineTo( hw*0.062, -hh*0.30);
  ctx.lineTo( hw*0.040, -hh*0.88);
  ctx.lineTo(0,         -hh*0.91);
  ctx.lineTo(-hw*0.040, -hh*0.88);
  ctx.closePath();
  ctx.fill();

  // ── Yellow livery stripes ──────────────────────────────────────
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(-hw*0.105, -hh*0.70, hw*0.21, ch*0.058);   // nose stripe
  ctx.fillRect(-hw*0.40,   hh*0.10, hw*0.80, ch*0.052);   // body belt
  ctx.fillStyle = 'rgba(255,215,0,0.65)';
  ctx.fillRect(-hw*0.63,  hh*0.01, hw*0.22, ch*0.038);    // left side
  ctx.fillRect( hw*0.41,  hh*0.01, hw*0.22, ch*0.038);    // right side

  // ── Cockpit surround ──────────────────────────────────────────
  ctx.fillStyle = '#C80016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.22, -hh*0.05);
  ctx.lineTo( hw*0.22, -hh*0.05);
  ctx.lineTo( hw*0.17, -hh*0.46);
  ctx.lineTo(-hw*0.17, -hh*0.46);
  ctx.closePath();
  ctx.fill();

  // Cockpit opening
  ctx.fillStyle = '#06060e';
  ctx.beginPath();
  ctx.moveTo(-hw*0.17, -hh*0.08);
  ctx.lineTo( hw*0.17, -hh*0.08);
  ctx.lineTo( hw*0.13, -hh*0.44);
  ctx.lineTo(-hw*0.13, -hh*0.44);
  ctx.closePath();
  ctx.fill();

  // ── Halo ──────────────────────────────────────────────────────
  ctx.strokeStyle = '#A88000';
  ctx.lineWidth = ch * 0.048;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.27, hw*0.20, hh*0.090, 0, Math.PI, Math.PI*2);
  ctx.stroke();
  // Halo centre pillar
  ctx.fillStyle = '#A88000';
  ctx.fillRect(-hw*0.020, -hh*0.40, hw*0.040, hh*0.20);

  // ── Helmet ────────────────────────────────────────────────────
  const helG = ctx.createRadialGradient(-hw*0.04, -hh*0.35, 0, 0, -hh*0.28, hw*0.18);
  helG.addColorStop(0, '#FFE840');
  helG.addColorStop(0.7,'#FFD700');
  helG.addColorStop(1,  '#C8A000');
  ctx.fillStyle = helG;
  ctx.beginPath();
  ctx.ellipse(0, -hh*0.30, hw*0.138, hh*0.185, 0, 0, Math.PI*2);
  ctx.fill();
  // Visor
  ctx.fillStyle = '#1a3050';
  ctx.beginPath();
  ctx.moveTo(-hw*0.10, -hh*0.28);
  ctx.lineTo( hw*0.10, -hh*0.28);
  ctx.lineTo( hw*0.08, -hh*0.17);
  ctx.lineTo(-hw*0.08, -hh*0.17);
  ctx.closePath();
  ctx.fill();
  // Visor sheen
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(-hw*0.032, -hh*0.26, hw*0.038, hh*0.040, -0.3, 0, Math.PI*2);
  ctx.fill();

  // ── Front wing ────────────────────────────────────────────────
  // Main plane
  ctx.fillStyle = '#A80012';
  ctx.beginPath();
  ctx.moveTo(-hw*0.90, -hh*0.75);
  ctx.lineTo( hw*0.90, -hh*0.75);
  ctx.lineTo( hw*0.64, -hh*0.87);
  ctx.lineTo(-hw*0.64, -hh*0.87);
  ctx.closePath();
  ctx.fill();
  // Upper cascade
  ctx.fillStyle = '#C80016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.80, -hh*0.71);
  ctx.lineTo( hw*0.80, -hh*0.71);
  ctx.lineTo( hw*0.60, -hh*0.76);
  ctx.lineTo(-hw*0.60, -hh*0.76);
  ctx.closePath();
  ctx.fill();
  // Second cascade
  ctx.fillStyle = '#E8001D';
  ctx.beginPath();
  ctx.moveTo(-hw*0.60, -hh*0.87);
  ctx.lineTo( hw*0.60, -hh*0.87);
  ctx.lineTo( hw*0.46, -hh*0.94);
  ctx.lineTo(-hw*0.46, -hh*0.94);
  ctx.closePath();
  ctx.fill();
  // Endplates
  ctx.fillStyle = '#8A0010';
  ctx.fillRect(-hw*0.93, -hh*0.95, hw*0.066, hh*0.26);
  ctx.fillRect( hw*0.864,-hh*0.95, hw*0.066, hh*0.26);
  // Yellow front wing stripe
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(-hw*0.56, -hh*0.87, hw*1.12, ch*0.018);

  // ── Wheels ────────────────────────────────────────────────────
  drawWheel(-hw*0.70,  hh*0.30, hw*0.200, hh*0.300);  // rear left
  drawWheel( hw*0.70,  hh*0.30, hw*0.200, hh*0.300);  // rear right
  drawWheel(-hw*0.635,-hh*0.56, hw*0.170, hh*0.250);  // front left
  drawWheel( hw*0.635,-hh*0.56, hw*0.170, hh*0.250);  // front right

  // ── Exhaust glow ──────────────────────────────────────────────
  if (speed > 0.36) {
    const a = Math.min(1, (speed - 0.36) * 1.6);
    const eg = ctx.createRadialGradient(0, hh*0.48, 0, 0, hh*0.50, ch*0.32);
    eg.addColorStop(0,   `rgba(255,220,30,${a*0.95})`);
    eg.addColorStop(0.25,`rgba(255,120,0,${a*0.70})`);
    eg.addColorStop(0.60,`rgba(220,30,0,${a*0.35})`);
    eg.addColorStop(1,   'rgba(180,0,0,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(-hw*0.5, hh*0.28, cw, ch*0.58);
  }

  ctx.restore();
}

// ─── Wheel helper ─────────────────────────────────────────────
function drawWheel(wx, wy, rw, rh) {
  // Tire
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.ellipse(wx, wy, rw, rh, 0, 0, Math.PI*2);
  ctx.fill();

  // Tire edge highlight (simulates rounded profile)
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = rw * 0.14;
  ctx.beginPath();
  ctx.ellipse(wx, wy, rw, rh, 0, 0, Math.PI*2);
  ctx.stroke();

  // Rim gradient
  const rg = ctx.createRadialGradient(wx - rw*0.18, wy - rh*0.22, 0, wx, wy, rw*0.70);
  rg.addColorStop(0,   '#E8E8E8');
  rg.addColorStop(0.55,'#A0A0A0');
  rg.addColorStop(1,   '#555');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.ellipse(wx, wy, rw*0.68, rh*0.68, 0, 0, Math.PI*2);
  ctx.fill();

  // Spokes (5-spoke)
  ctx.strokeStyle = '#888';
  ctx.lineWidth = Math.max(1, rw * 0.11);
  ctx.lineCap = 'round';
  const spinAngle = roadZ * 3.5;
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2 + spinAngle;
    ctx.beginPath();
    ctx.moveTo(wx + Math.cos(a) * rw * 0.14, wy + Math.sin(a) * rh * 0.14);
    ctx.lineTo(wx + Math.cos(a) * rw * 0.60, wy + Math.sin(a) * rh * 0.60);
    ctx.stroke();
  }

  // Brake disc glow (visible through rim)
  if (speed > 0.38) {
    const ba = Math.min(0.7, (speed - 0.38) * 0.8);
    ctx.fillStyle = `rgba(255,110,0,${ba})`;
    ctx.beginPath();
    ctx.ellipse(wx, wy, rw*0.42, rh*0.42, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // Hub
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.ellipse(wx, wy, rw*0.18, rh*0.18, 0, 0, Math.PI*2);
  ctx.fill();
  // Hub nut (Ferrari yellow)
  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.ellipse(wx, wy, rw*0.08, rh*0.08, 0, 0, Math.PI*2);
  ctx.fill();
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

startBtn.addEventListener('click',    startGame);
startBtn.addEventListener('touchend', e => { e.preventDefault(); startGame(); }, {passive:false});
restartBtn.addEventListener('click',    () => { gameoverScreen.classList.remove('active'); startGame(); });
restartBtn.addEventListener('touchend', e => { e.preventDefault(); gameoverScreen.classList.remove('active'); startGame(); }, {passive:false});
startScreen.addEventListener('touchend', e => { e.preventDefault(); if (state !== 'playing') startGame(); }, {passive:false});
gameoverScreen.addEventListener('touchend', e => { e.preventDefault(); gameoverScreen.classList.remove('active'); startGame(); }, {passive:false});

function updateStartBest() {
  const b = parseFloat(localStorage.getItem('ferrariLapBest') || '0');
  if (b > 0) startBestEl.textContent = 'BEST LAP: ' + formatTime(b);
}
updateStartBest();

// ─── Idle animation ───────────────────────────────────────────
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

'use strict';
/* ============================================================
   Ferrari Sprint — game.js
   Pseudo-3D arcade racer (OutRun style)
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
const startScreen   = document.getElementById('start-screen');
const gameoverScreen= document.getElementById('gameover-screen');
const hud           = document.getElementById('hud');
const hudScore      = document.getElementById('hudScore');
const hudSpeed      = document.getElementById('hudSpeed');
const hudBest       = document.getElementById('hudBest');
const finalScoreEl  = document.getElementById('finalScore');
const bestScoreEl   = document.getElementById('bestScore');
const startBestEl   = document.getElementById('startBest');
const nearMissEl    = document.getElementById('near-miss');
const startBtn      = document.getElementById('startBtn');
const restartBtn    = document.getElementById('restartBtn');
const touchLeft     = document.getElementById('touch-left');
const touchRight    = document.getElementById('touch-right');

// ─── Game state ───────────────────────────────────────────────
let state = 'start'; // 'start' | 'playing' | 'dead'
let score = 0;
let bestScore = parseInt(localStorage.getItem('ferrariSprintBest') || '0');
let raf;

// Physics
let playerX    = 0;      // -1..1 (lane position)
let speed      = 0;      // current speed (0..1)
let targetSpeed= 0;
let distance   = 0;      // total distance
let curve      = 0;      // current track curve (-1..1)
let curveDrift = 0;      // accumulated drift from curve

// Road scroll
let roadZ      = 0;

// Steering
let steerLeft  = false;
let steerRight = false;

// Screen shake
let shakeX = 0, shakeY = 0, shakeMag = 0;

// Near miss
let nearMissTimer = 0;

// Crash flash
let crashFlash = 0;

// ─── Road segments ────────────────────────────────────────────
const NUM_SEG   = 200;
const SEG_LEN   = 200;   // logical length of each segment

// Segment types and colours
const COLORS = {
  roadLight:   '#606060',
  roadDark:    '#555555',
  curbRed:     '#E8001D',
  curbWhite:   '#F0F0F0',
  grassLight:  '#3AA335',
  grassDark:   '#2D8029',
  laneLight:   '#CCCCCC',
  laneDark:    '#AAAAAA',
};

// ─── AI cars ──────────────────────────────────────────────────
const MAX_AI = 6;
let aiCars = [];

// Car colours for AI
const AI_COLORS = [
  { body:'#1E3A8A', accent:'#60A5FA' }, // blue
  { body:'#065F46', accent:'#34D399' }, // green
  { body:'#7C3AED', accent:'#C4B5FD' }, // purple
  { body:'#D97706', accent:'#FCD34D' }, // orange
  { body:'#111827', accent:'#9CA3AF' }, // dark
  { body:'#BE123C', accent:'#FB7185' }, // pink-red
];

// ─── Obstacle / cone array ────────────────────────────────────
let obstacles = [];

// ─── Clouds ───────────────────────────────────────────────────
let clouds = Array.from({length:8}, (_,i) => ({
  x: Math.random(), y: 0.05 + Math.random()*0.18,
  w: 0.08 + Math.random()*0.12, speed: 0.00005 + Math.random()*0.00005
}));

// ─── Track curve segments ─────────────────────────────────────
// We generate a procedural list of straight/curve sections
const TRACK_SECTIONS = [];
function genTrack() {
  TRACK_SECTIONS.length = 0;
  TRACK_SECTIONS.push({len:800, curve:0});
  for (let i=0; i<40; i++) {
    const c = (Math.random()-0.5)*2;
    TRACK_SECTIONS.push({len:300+Math.random()*600, curve:c});
    if (Math.random()<0.3) TRACK_SECTIONS.push({len:200+Math.random()*300, curve:0});
  }
}
genTrack();

let trackPos  = 0; // position along TRACK_SECTIONS in total distance units
let sectionIdx= 0;
let sectionPos= 0;

function getTrackCurve(d) {
  let p = d % TRACK_SECTIONS.reduce((a,s)=>a+s.len,0);
  for (let s of TRACK_SECTIONS) {
    if (p <= s.len) return s.curve;
    p -= s.len;
  }
  return 0;
}

// ─── Pseudo-3D projection ─────────────────────────────────────
// We render N strips from horizon (top) to player (bottom)
const DRAW_DIST  = 150;  // segments to draw
const CAMERA_H   = 1500; // camera height
const CAMERA_D   = 0.84; // depth (field of view tuning)

function projectRoad(segZ, playerCamX) {
  // segZ: 0=at player, large=far
  const z      = segZ;
  if (z <= 0) return null;
  const scale  = CAMERA_D / z;
  const screenX= W/2 + scale * (playerCamX) * W * 0.5;
  const screenY= H/2 + scale * CAMERA_H;
  const roadW  = scale * W * 0.5;
  return { screenX, screenY, roadW, scale };
}

// ─── Game init ────────────────────────────────────────────────
function initGame() {
  playerX    = 0;
  speed      = 0.3;
  targetSpeed= 0.5;
  distance   = 0;
  curve      = 0;
  curveDrift = 0;
  roadZ      = 0;
  shakeX     = shakeY = shakeMag = 0;
  crashFlash = 0;
  nearMissTimer = 0;
  score      = 0;
  sectionIdx = 0;
  sectionPos = 0;
  aiCars     = [];
  obstacles  = [];
  genTrack();

  for (let i=0; i<4; i++) spawnAICar();
}

function spawnAICar() {
  if (aiCars.length >= MAX_AI) return;
  const col = AI_COLORS[Math.floor(Math.random()*AI_COLORS.length)];
  aiCars.push({
    x:  (Math.random()-0.5)*1.4,
    z:  0.5 + Math.random()*1.5,
    color: col,
    speed: 0.2 + Math.random()*0.35,
    wobble: 0,
    wobbleT: 0,
  });
}

function spawnObstacle() {
  obstacles.push({
    x: (Math.random()-0.5)*1.6,
    z: 1.5 + Math.random()*0.5,
    type: Math.random()<0.5 ? 'cone' : 'debris',
  });
}

// ─── Update ───────────────────────────────────────────────────
let prevT = 0;
function update(dt) {
  if (state !== 'playing') return;

  const dts = dt / 1000;

  // Speed ramp
  const maxSpeed = 0.8 + Math.min(distance/5000, 0.6);
  targetSpeed = Math.min(maxSpeed, targetSpeed + dts * 0.02);
  speed += (targetSpeed - speed) * dts * 2;

  // Distance
  const distDelta = speed * 400 * dts;
  distance += distDelta;
  score = Math.floor(distance * 0.5);

  // Track curve
  curve = getTrackCurve(distance);

  // Steering
  let steer = 0;
  if (steerLeft)  steer -= 1;
  if (steerRight) steer += 1;

  // Curve pushes player
  curveDrift += curve * speed * dts * 0.4;
  playerX    += steer * dts * 2.2 * speed;
  playerX    += curveDrift * dts * 0.15;
  curveDrift *= (1 - dts * 2);

  // Clamp
  const onTrack = Math.abs(playerX) < 1.05;
  if (!onTrack) {
    speed *= 0.96; // friction on grass
    targetSpeed *= 0.98;
  }
  playerX = Math.max(-1.8, Math.min(1.8, playerX));

  // Road scroll
  roadZ += speed * 0.012;

  // Shake decay
  shakeMag *= 0.88;
  shakeX = (Math.random()-0.5)*shakeMag*2;
  shakeY = (Math.random()-0.5)*shakeMag;
  crashFlash = Math.max(0, crashFlash - dts*3);

  // Near miss timer
  if (nearMissTimer > 0) {
    nearMissTimer -= dts;
    if (nearMissTimer <= 0) {
      nearMissEl.classList.add('hidden');
    }
  }

  // AI cars
  for (let i = aiCars.length-1; i >= 0; i--) {
    const ai = aiCars[i];
    ai.wobbleT += dts * 1.5;
    ai.wobble = Math.sin(ai.wobbleT) * 0.003;
    ai.x += ai.wobble;

    // Move toward player (relative)
    ai.z -= (speed - ai.speed * 0.5) * dts * 0.08;

    if (ai.z <= 0.01) {
      aiCars.splice(i, 1);
      spawnAICar();
      continue;
    }
    if (ai.z > 3) {
      aiCars.splice(i, 1);
      continue;
    }

    // Collision with player
    if (ai.z < 0.18 && ai.z > 0.04) {
      const dx = Math.abs(playerX - ai.x);
      if (dx < 0.28) {
        endGame();
        return;
      } else if (dx < 0.5 && nearMissTimer <= 0) {
        nearMissTimer = 1.5;
        score += 500;
        nearMissEl.classList.remove('hidden');
      }
    }
  }

  // Obstacle movement
  for (let i = obstacles.length-1; i >= 0; i--) {
    const ob = obstacles[i];
    ob.z -= speed * dts * 0.09;
    if (ob.z <= 0.01) { obstacles.splice(i,1); continue; }

    if (ob.z < 0.15 && ob.z > 0.03) {
      const dx = Math.abs(playerX - ob.x);
      if (dx < 0.2) {
        endGame();
        return;
      }
    }
  }

  // Spawn management
  if (Math.random() < dts * (1 + distance/3000)) {
    spawnAICar();
  }
  if (obstacles.length < 3 && Math.random() < dts * 0.4) {
    spawnObstacle();
  }

  // Cloud drift
  for (const c of clouds) {
    c.x -= c.speed * speed * 60;
    if (c.x < -c.w) c.x = 1 + c.w;
  }

  // Update HUD
  hudScore.textContent = score.toLocaleString();
  hudSpeed.textContent = Math.floor(120 + speed * 280);
  hudBest.textContent  = Math.max(score, bestScore).toLocaleString();
}

// ─── Draw ─────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  ctx.save();
  if (shakeMag > 0.5) {
    ctx.translate(shakeX, shakeY);
  }

  drawSky();
  drawRoad();
  drawPlayerCar();

  ctx.restore();

  // Crash flash overlay
  if (crashFlash > 0) {
    ctx.fillStyle = `rgba(255,50,50,${crashFlash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Speed overlay at high speed
  if (speed > 0.7 && state === 'playing') {
    drawSpeedLines();
  }
}

// ─── Sky & Background ─────────────────────────────────────────
function drawSky() {
  const horizon = H * 0.38;

  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0,   '#1a1a6e');
  sky.addColorStop(0.4, '#2563EB');
  sky.addColorStop(1,   '#7DD3FC');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, horizon);

  // Sun
  const sunX = W * 0.72;
  const sunY = horizon * 0.45;
  const sunR = W * 0.07;
  const sunG = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR*2);
  sunG.addColorStop(0,   '#FFFDE7');
  sunG.addColorStop(0.3, '#FDD835');
  sunG.addColorStop(1,   'rgba(253,216,53,0)');
  ctx.fillStyle = sunG;
  ctx.fillRect(0, 0, W, horizon);

  // Clouds
  for (const c of clouds) {
    drawCloud(c.x * W, c.y * H, c.w * W);
  }

  // Mountains / city silhouette
  drawMountains(horizon);

  // Crowd stands (simple rectangles with people)
  drawStands(horizon);

  // Grass beyond road
  ctx.fillStyle = '#3AA335';
  ctx.fillRect(0, horizon, W, H - horizon);
}

function drawCloud(cx, cy, cw) {
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const ch = cw * 0.35;
  ctx.beginPath();
  ctx.ellipse(cx,       cy,       cw*0.5, ch*0.55, 0, 0, Math.PI*2);
  ctx.ellipse(cx-cw*0.28, cy+ch*0.1, cw*0.32, ch*0.45, 0, 0, Math.PI*2);
  ctx.ellipse(cx+cw*0.28, cy+ch*0.1, cw*0.3,  ch*0.4,  0, 0, Math.PI*2);
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

  // Snow caps
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
  // Left stand
  ctx.fillStyle = '#2D3748';
  ctx.fillRect(0, horizon*0.65, W*0.2, horizon*0.35);
  // Right stand
  ctx.fillRect(W*0.8, horizon*0.65, W*0.2, horizon*0.35);

  // Crowd dots
  for (let row=0; row<3; row++) {
    for (let col=0; col<8; col++) {
      const hue = col*45;
      ctx.fillStyle = `hsl(${hue},70%,60%)`;
      // Left
      ctx.beginPath();
      ctx.arc(col*W*0.022+W*0.01, horizon*(0.7+row*0.08), W*0.008, 0, Math.PI*2);
      ctx.fill();
      // Right
      ctx.beginPath();
      ctx.arc(W*0.82+col*W*0.022, horizon*(0.7+row*0.08), W*0.008, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Banners on stands
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

  // We draw horizontal strips from top (far) to bottom (near)
  // Each strip alternates road colors and has curbs at edges

  const stripes  = 80; // number of horizontal strips
  let camX = playerX * 0.5; // camera follows player a bit

  // Perspective: strips near horizon are thin, near player are thick
  // Use quadratic distribution for better perspective feel
  let prevY = horizon;

  // Draw strips bottom to top for proper occlusion
  for (let s = 0; s < stripes; s++) {
    // t=0 nearest, t=1 horizon
    const tNear = s / stripes;
    const tFar  = (s + 1) / stripes;

    const yNear = horizon + roadH * (1 - tNear * tNear);
    const yFar  = horizon + roadH * (1 - tFar  * tFar);

    const scaleNear = 1 - tNear;
    const scaleFar  = 1 - tFar;

    const cxNear = W/2 - camX * scaleNear * W * 0.9;
    const cxFar  = W/2 - camX * scaleFar  * W * 0.9;

    // Road half-width at this depth
    const rwNear = W * 0.38 * (1 - tNear * 0.7);
    const rwFar  = W * 0.38 * (1 - tFar  * 0.7);

    // Alternating colour (based on road scroll)
    const stripe = (Math.floor(s * 0.5 + roadZ * 8)) % 2;

    // Grass
    ctx.fillStyle = stripe ? COLORS.grassLight : COLORS.grassDark;
    ctx.fillRect(0, yFar, W, yNear - yFar);

    // Road trapezoid
    ctx.fillStyle = stripe ? COLORS.roadLight : COLORS.roadDark;
    ctx.beginPath();
    ctx.moveTo(cxNear - rwNear, yNear);
    ctx.lineTo(cxNear + rwNear, yNear);
    ctx.lineTo(cxFar  + rwFar,  yFar);
    ctx.lineTo(cxFar  - rwFar,  yFar);
    ctx.closePath();
    ctx.fill();

    // Curbs
    const curbW = rwNear * 0.07;
    const curbWf = rwFar * 0.07;
    const curbColor = (Math.floor(s * 0.7 + roadZ * 5)) % 2 ? COLORS.curbRed : COLORS.curbWhite;
    ctx.fillStyle = curbColor;
    // Left curb
    ctx.beginPath();
    ctx.moveTo(cxNear - rwNear,        yNear);
    ctx.lineTo(cxNear - rwNear + curbW, yNear);
    ctx.lineTo(cxFar  - rwFar  + curbWf, yFar);
    ctx.lineTo(cxFar  - rwFar,          yFar);
    ctx.closePath();
    ctx.fill();
    // Right curb
    ctx.beginPath();
    ctx.moveTo(cxNear + rwNear - curbW, yNear);
    ctx.lineTo(cxNear + rwNear,         yNear);
    ctx.lineTo(cxFar  + rwFar,          yFar);
    ctx.lineTo(cxFar  + rwFar  - curbWf, yFar);
    ctx.closePath();
    ctx.fill();

    // Centre lane dashes
    if (stripe) {
      const dw = Math.max(1, rwNear * 0.025);
      const dwf = Math.max(1, rwFar * 0.025);
      ctx.fillStyle = COLORS.laneLight;
      ctx.beginPath();
      ctx.moveTo(cxNear - dw, yNear);
      ctx.lineTo(cxNear + dw, yNear);
      ctx.lineTo(cxFar  + dwf, yFar);
      ctx.lineTo(cxFar  - dwf, yFar);
      ctx.closePath();
      ctx.fill();
    }

    // Barriers (armco) - simple lines near top of road section
    if (s > stripes * 0.7) {
      const bh = (yNear - yFar) * 0.4;
      ctx.fillStyle = '#C0C0C0';
      ctx.fillRect(cxFar - rwFar - curbWf - rwFar*0.06, yFar, rwFar*0.055, bh);
      ctx.fillRect(cxFar + rwFar + curbWf, yFar, rwFar*0.055, bh);
    }
  }

  // Draw AI cars
  const sortedAI = [...aiCars].sort((a,b) => b.z - a.z);
  for (const ai of sortedAI) {
    const t = 1 - Math.min(1, ai.z / 2.5);
    if (t < 0.02) continue;
    const screenX = W/2 + (ai.x - camX) * t * W * 0.45;
    const screenY = H * 0.38 + (H * 0.62) * (t * t);
    const carW    = W * 0.10 * t;
    const carH    = carW * 0.5;
    drawAICar(screenX, screenY, carW, carH, ai.color);
  }

  // Draw obstacles
  for (const ob of obstacles) {
    const t = 1 - Math.min(1, ob.z / 2.5);
    if (t < 0.02) continue;
    const screenX = W/2 + (ob.x - camX) * t * W * 0.45;
    const screenY = H * 0.38 + (H * 0.62) * (t * t);
    const sz = W * 0.025 * t;
    if (ob.type === 'cone') drawCone(screenX, screenY, sz);
    else drawDebris(screenX, screenY, sz);
  }

  // Road surface vignette
  const vig = ctx.createLinearGradient(0, H*0.38, 0, H);
  vig.addColorStop(0, 'rgba(0,0,0,0.35)');
  vig.addColorStop(0.3, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, H*0.38, W, H*0.62);
}

// ─── AI car shape ─────────────────────────────────────────────
function drawAICar(cx, cy, cw, ch, col) {
  const x = cx - cw/2, y = cy - ch;

  // Body
  ctx.fillStyle = col.body;
  ctx.beginPath();
  ctx.roundRect(x, y + ch*0.2, cw, ch*0.55, 2);
  ctx.fill();

  // Cockpit
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.roundRect(x + cw*0.3, y + ch*0.05, cw*0.4, ch*0.3, 2);
  ctx.fill();

  // Front wing
  ctx.fillStyle = col.body;
  ctx.fillRect(x - cw*0.06, y + ch*0.68, cw*1.12, ch*0.1);

  // Rear wing
  ctx.fillRect(x + cw*0.1, y + ch*0.1, cw*0.8, ch*0.08);

  // Accent stripe
  ctx.fillStyle = col.accent;
  ctx.fillRect(x + cw*0.15, y + ch*0.32, cw*0.7, ch*0.1);

  // Wheels
  ctx.fillStyle = '#1a1a1a';
  [[0.05,0.62],[0.8,0.62],[0.05,0.32],[0.8,0.32]].forEach(([rx,ry]) => {
    ctx.beginPath();
    ctx.ellipse(x+cw*rx, y+ch*ry, cw*0.12, ch*0.13, 0, 0, Math.PI*2);
    ctx.fill();
  });
}

// ─── Cone ─────────────────────────────────────────────────────
function drawCone(cx, cy, sz) {
  // Orange cone
  ctx.fillStyle = '#FF6B00';
  ctx.beginPath();
  ctx.moveTo(cx, cy - sz*2.5);
  ctx.lineTo(cx - sz, cy);
  ctx.lineTo(cx + sz, cy);
  ctx.closePath();
  ctx.fill();
  // White stripe
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx - sz*0.5, cy - sz);
  ctx.lineTo(cx + sz*0.5, cy - sz);
  ctx.lineTo(cx + sz*0.3, cy - sz*0.5);
  ctx.lineTo(cx - sz*0.3, cy - sz*0.5);
  ctx.closePath();
  ctx.fill();
  // Base
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - sz*1.2, cy, sz*2.4, sz*0.3);
}

// ─── Debris ───────────────────────────────────────────────────
function drawDebris(cx, cy, sz) {
  ctx.fillStyle = '#888';
  for (let i=0; i<4; i++) {
    const dx = (Math.sin(i*1.57)*sz*1.5);
    const dy = (Math.cos(i*1.57)*sz*0.8);
    ctx.fillRect(cx+dx-sz*0.4, cy+dy-sz*0.4, sz*0.8, sz*0.8);
  }
}

// ─── Speed lines ──────────────────────────────────────────────
function drawSpeedLines() {
  const alpha = (speed - 0.7) / 0.6;
  ctx.save();
  ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.3})`;
  ctx.lineWidth = 1;
  for (let i=0; i<20; i++) {
    const x = (Math.sin(i * 1.618 * roadZ) * 0.5 + 0.5) * W;
    const y = H * 0.38 + Math.random() * H * 0.62;
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
  const cx  = W / 2;
  const cy  = H * 0.78;
  const cw  = Math.min(W * 0.22, 110);
  const ch  = cw * 0.48;

  // Lean with steering
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
  ctx.fillRect(-hw*0.7, -hh*0.9, hw*1.4, ch*0.12);
  ctx.fillRect(-hw*0.72,-hh*0.95, hw*0.04, ch*0.18); // left pillar
  ctx.fillRect( hw*0.68,-hh*0.95, hw*0.04, ch*0.18); // right pillar

  // Main body — Ferrari red
  ctx.fillStyle = '#E8001D';
  ctx.beginPath();
  ctx.moveTo(-hw*0.5,  hh*0.5);   // rear left
  ctx.lineTo( hw*0.5,  hh*0.5);   // rear right
  ctx.lineTo( hw*0.58, -hh*0.1);  // side right
  ctx.lineTo( hw*0.38, -hh*0.85); // nose right
  ctx.lineTo(-hw*0.38, -hh*0.85); // nose left
  ctx.lineTo(-hw*0.58, -hh*0.1);  // side left
  ctx.closePath();
  ctx.fill();

  // Side pods
  ctx.fillStyle = '#CC0016';
  ctx.beginPath();
  ctx.moveTo(-hw*0.6, hh*0.3);
  ctx.lineTo(-hw*0.6,-hh*0.2);
  ctx.lineTo(-hw*0.38,-hh*0.4);
  ctx.lineTo(-hw*0.35, hh*0.35);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(hw*0.6, hh*0.3);
  ctx.lineTo(hw*0.6,-hh*0.2);
  ctx.lineTo(hw*0.38,-hh*0.4);
  ctx.lineTo(hw*0.35, hh*0.35);
  ctx.closePath();
  ctx.fill();

  // Yellow accents (Ferrari livery)
  ctx.fillStyle = '#FFD700';
  ctx.fillRect(-hw*0.12, -hh*0.6, hw*0.24, ch*0.08); // nose stripe
  ctx.fillRect(-hw*0.4,   hh*0.1,  hw*0.8,  ch*0.06); // body stripe

  // Cockpit opening
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
  // Front wing endplates
  ctx.fillRect(-hw*0.78, -hh*0.92, hw*0.06, hh*0.2);
  ctx.fillRect( hw*0.72, -hh*0.92, hw*0.06, hh*0.2);

  // Wheels
  ctx.fillStyle = '#1a1a1a';
  // Rear
  ctx.beginPath(); ctx.ellipse(-hw*0.68, hh*0.35, hw*0.17, hh*0.28, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( hw*0.68, hh*0.35, hw*0.17, hh*0.28, 0, 0, Math.PI*2); ctx.fill();
  // Front
  ctx.beginPath(); ctx.ellipse(-hw*0.62,-hh*0.55, hw*0.15, hh*0.24, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse( hw*0.62,-hh*0.55, hw*0.15, hh*0.24, 0, 0, Math.PI*2); ctx.fill();

  // Wheel rims
  ctx.fillStyle = '#C0C0C0';
  [[-hw*0.68,hh*0.35],[ hw*0.68,hh*0.35],[-hw*0.62,-hh*0.55],[ hw*0.62,-hh*0.55]].forEach(([wx,wy]) => {
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

// ─── End game ─────────────────────────────────────────────────
function endGame() {
  state = 'dead';
  crashFlash = 1;
  shakeMag = 12;

  // Vibrate
  if (navigator.vibrate) navigator.vibrate([80, 40, 120]);

  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('ferrariSprintBest', bestScore);
  }

  setTouchZonesActive(false);
  setTimeout(() => {
    finalScoreEl.textContent = score.toLocaleString();
    bestScoreEl.textContent  = bestScore.toLocaleString();
    gameoverScreen.classList.add('active');
    hud.classList.add('hidden');
    nearMissEl.classList.add('hidden');
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

// Touch zones
touchLeft.addEventListener('touchstart',  e => { e.preventDefault(); steerLeft  = true;  }, {passive:false});
touchLeft.addEventListener('touchend',    e => { e.preventDefault(); steerLeft  = false; }, {passive:false});
touchLeft.addEventListener('touchcancel', e => { steerLeft  = false; });

touchRight.addEventListener('touchstart',  e => { e.preventDefault(); steerRight = true;  }, {passive:false});
touchRight.addEventListener('touchend',    e => { e.preventDefault(); steerRight = false; }, {passive:false});
touchRight.addEventListener('touchcancel', e => { steerRight = false; });

// ─── Start / Restart ──────────────────────────────────────────
function setTouchZonesActive(active) {
  const pe = active ? 'auto' : 'none';
  touchLeft.style.pointerEvents  = pe;
  touchRight.style.pointerEvents = pe;
}

function startGame() {
  state = 'playing';
  initGame();
  startScreen.classList.remove('active');
  gameoverScreen.classList.remove('active');
  hud.classList.remove('hidden');
  nearMissEl.classList.add('hidden');
  setTouchZonesActive(true);
  prevT = performance.now();
  if (!raf) raf = requestAnimationFrame(loop);
}

startBtn.addEventListener('click',    startGame);
startBtn.addEventListener('touchend', e => { e.preventDefault(); startGame(); }, {passive:false});

restartBtn.addEventListener('click',    () => { gameoverScreen.classList.remove('active'); startGame(); });
restartBtn.addEventListener('touchend', e => { e.preventDefault(); gameoverScreen.classList.remove('active'); startGame(); }, {passive:false});

// Update best score on start screen
function updateStartBest() {
  const b = parseInt(localStorage.getItem('ferrariSprintBest') || '0');
  if (b > 0) startBestEl.textContent = 'BEST: ' + b.toLocaleString();
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

// Initial idle draw
prevT = performance.now();
requestAnimationFrame(ts => { prevT = ts; idleLoop(ts); });

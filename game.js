(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreValue = document.getElementById('scoreValue');
  const coinValue = document.getElementById('coinValue');
  const bestValue = document.getElementById('bestValue');
  const finalScoreValue = document.getElementById('finalScoreValue');
  const finalCoinValue = document.getElementById('finalCoinValue');
  const finalBestValue = document.getElementById('finalBestValue');
  const startScreen = document.getElementById('startScreen');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const playButton = document.getElementById('playButton');
  const restartButton = document.getElementById('restartButton');
  const controlButtons = document.querySelectorAll('[data-control]');

  const STORAGE_KEY = 'trollrunner_arcade_high_score_v1';
  const lanes = [-1, 0, 1];

  // Replace these paths as real game sprites/sounds are created.
  const assetPaths = {
    player: '/assets/images/troll-buffguyfigure.png',
    intro: '/assets/images/troll-gamewithmefigure.png',
    runner: '/assets/images/troll-runnerfigure.png',
    stick: '/assets/images/troll-stickfigure.png',
    jumpSound: '/assets/audio/jump.mp3',
    coinSound: '/assets/audio/coin.mp3',
    crashSound: '/assets/audio/crash.mp3',
  };

  const assets = {
    player: loadImage(assetPaths.player),
    runner: loadImage(assetPaths.runner),
  };

  const state = {
    mode: 'start',
    width: 0,
    height: 0,
    dpr: 1,
    centerX: 0,
    horizonY: 0,
    groundY: 0,
    laneWidth: 0,
    lastTime: 0,
    score: 0,
    coins: 0,
    best: readBestScore(),
    speed: 0.32,
    spawnTimer: 0,
    coinTimer: 0,
    shake: 0,
    objects: [],
    player: {
      lane: 0,
      targetLane: 0,
      laneVisual: 0,
      jumpTime: 0,
      slideTime: 0,
      moveCooldown: 0,
    },
  };

  bestValue.textContent = String(state.best);
  document.body.dataset.gameState = state.mode;
  resizeCanvas();
  drawScene(0);

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('keydown', handleKeydown);
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

  playButton.addEventListener('click', () => startGameWithIntro());
  restartButton.addEventListener('click', () => startGameWithIntro(true));
  controlButtons.forEach((button) => {
    button.addEventListener('click', () => performControl(button.dataset.control));
  });

  let touchStartX = 0;
  let touchStartY = 0;

  function loadImage(src) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    return image;
  }

  function readBestScore() {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) ? Math.max(0, Math.floor(saved)) : 0;
  }

  function saveBestScore(score) {
    if (score > state.best) {
      state.best = score;
      localStorage.setItem(STORAGE_KEY, String(score));
      bestValue.textContent = String(score);
    }
  }

  function resizeCanvas() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.floor(window.innerWidth);
    state.height = Math.floor(window.innerHeight);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    state.centerX = state.width / 2;
    state.horizonY = state.height * 0.24;
    state.groundY = state.height - Math.max(116, state.height * 0.16);
    state.laneWidth = Math.min(156, state.width * 0.26);
  }

  function resetGame() {
    state.mode = 'playing';
    document.body.dataset.gameState = state.mode;
    state.lastTime = performance.now();
    state.score = 0;
    state.coins = 0;
    state.speed = 0.32;
    state.spawnTimer = 0.5;
    state.coinTimer = 0.35;
    state.shake = 0;
    state.objects = [];
    Object.assign(state.player, {
      lane: 0,
      targetLane: 0,
      laneVisual: 0,
      jumpTime: 0,
      slideTime: 0,
      moveCooldown: 0,
    });
    updateHud();
  }

  function startGameWithIntro(isRestart = false) {
    gameOverScreen.classList.remove('is-visible');
    if (isRestart) {
      startScreen.classList.add('is-visible');
    }
    startScreen.classList.add('is-zooming');
    window.setTimeout(() => {
      startScreen.classList.remove('is-visible', 'is-zooming');
      resetGame();
      requestAnimationFrame(tick);
    }, 720);
  }

  function tick(now) {
    const dt = Math.min((now - state.lastTime) / 1000, 0.033);
    state.lastTime = now;

    if (state.mode === 'playing') {
      update(dt);
      drawScene(dt);
      requestAnimationFrame(tick);
      return;
    }

    drawScene(dt);
  }

  function update(dt) {
    const player = state.player;
    player.moveCooldown = Math.max(0, player.moveCooldown - dt);
    player.jumpTime = Math.max(0, player.jumpTime - dt);
    player.slideTime = Math.max(0, player.slideTime - dt);
    player.laneVisual += (player.targetLane - player.laneVisual) * Math.min(1, dt * 14);

    state.speed += dt * 0.009;
    state.score += dt * (42 + state.speed * 70);
    state.shake = Math.max(0, state.shake - dt * 28);

    spawnObjects(dt);

    for (const object of state.objects) {
      object.z -= state.speed * dt * object.speed;
      if (object.kind === 'coin') {
        object.spin += dt * 8;
      }
    }

    checkCollisions();
    state.objects = state.objects.filter((object) => object.z > -0.18 && !object.collected);
    updateHud();
  }

  function spawnObjects(dt) {
    state.spawnTimer -= dt;
    state.coinTimer -= dt;

    if (state.spawnTimer <= 0) {
      const obstacleTypes = ['candle', 'rug', 'trap', 'chart'];
      const type = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)];
      state.objects.push({
        kind: 'obstacle',
        type,
        lane: lanes[Math.floor(Math.random() * lanes.length)],
        z: 1.05,
        speed: 1,
      });
      state.spawnTimer = Math.max(0.58, 1.15 - state.speed * 0.7) + Math.random() * 0.42;
    }

    if (state.coinTimer <= 0) {
      const lane = lanes[Math.floor(Math.random() * lanes.length)];
      const rowCount = Math.random() > 0.62 ? 3 : 1;
      for (let i = 0; i < rowCount; i += 1) {
        state.objects.push({
          kind: 'coin',
          lane,
          z: 1.04 + i * 0.09,
          speed: 1,
          spin: Math.random() * Math.PI,
          collected: false,
        });
      }
      state.coinTimer = 0.72 + Math.random() * 0.85;
    }
  }

  function checkCollisions() {
    const player = state.player;
    const jumpHeight = getJumpHeight();
    const isSliding = player.slideTime > 0;

    for (const object of state.objects) {
      if (object.z > 0.14 || object.z < -0.08 || object.lane !== player.targetLane) {
        continue;
      }

      if (object.kind === 'coin') {
        object.collected = true;
        state.coins += 1;
        state.score += 30;
        continue;
      }

      const avoidedLow = (object.type === 'rug' || object.type === 'trap') && jumpHeight > 42;
      const avoidedHigh = object.type === 'candle' && isSliding;
      if (!avoidedLow && !avoidedHigh) {
        endGame();
        return;
      }
    }
  }

  function endGame() {
    state.mode = 'gameover';
    document.body.dataset.gameState = state.mode;
    state.shake = 12;
    const finalScore = Math.floor(state.score);
    saveBestScore(finalScore);
    finalScoreValue.textContent = String(finalScore);
    finalCoinValue.textContent = String(state.coins);
    finalBestValue.textContent = String(state.best);
    gameOverScreen.classList.add('is-visible');
    drawScene(0);
  }

  function updateHud() {
    scoreValue.textContent = String(Math.floor(state.score));
    coinValue.textContent = String(state.coins);
    bestValue.textContent = String(state.best);
  }

  function performControl(control) {
    if (state.mode !== 'playing') {
      return;
    }

    const player = state.player;
    if ((control === 'left' || control === 'right') && player.moveCooldown <= 0) {
      const direction = control === 'left' ? -1 : 1;
      const nextLane = clamp(player.targetLane + direction, -1, 1);
      player.targetLane = nextLane;
      player.lane = nextLane;
      player.moveCooldown = 0.08;
      return;
    }

    if (control === 'jump' && player.jumpTime <= 0 && player.slideTime <= 0) {
      player.jumpTime = 0.62;
      return;
    }

    if (control === 'slide' && player.slideTime <= 0 && player.jumpTime <= 0) {
      player.slideTime = 0.58;
    }
  }

  function handleKeydown(event) {
    const key = event.key.toLowerCase();
    const controlMap = {
      arrowleft: 'left',
      a: 'left',
      arrowright: 'right',
      d: 'right',
      arrowup: 'jump',
      w: 'jump',
      ' ': 'jump',
      arrowdown: 'slide',
      s: 'slide',
    };

    const control = controlMap[key];
    if (control) {
      event.preventDefault();
      performControl(control);
    }
  }

  function handleTouchStart(event) {
    if (!event.changedTouches.length) return;
    event.preventDefault();
    touchStartX = event.changedTouches[0].clientX;
    touchStartY = event.changedTouches[0].clientY;
  }

  function handleTouchEnd(event) {
    if (!event.changedTouches.length) return;
    event.preventDefault();
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const distance = Math.hypot(dx, dy);

    if (distance < 28) {
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      performControl(dx > 0 ? 'right' : 'left');
    } else {
      performControl(dy > 0 ? 'slide' : 'jump');
    }
  }

  function drawScene(dt) {
    const shakeX = state.shake ? (Math.random() - 0.5) * state.shake : 0;
    const shakeY = state.shake ? (Math.random() - 0.5) * state.shake : 0;

    ctx.save();
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.translate(shakeX, shakeY);
    drawSky();
    drawCity();
    drawTrack(dt);
    drawObjects();
    drawRunner();
    drawPlayer();
    ctx.restore();
  }

  function drawSky() {
    const gradient = ctx.createLinearGradient(0, 0, 0, state.height);
    gradient.addColorStop(0, '#080b15');
    gradient.addColorStop(0.48, '#16113b');
    gradient.addColorStop(1, '#07111c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, state.width, state.height);

    ctx.fillStyle = 'rgba(54, 247, 255, 0.13)';
    for (let i = 0; i < 20; i += 1) {
      const x = (i * 139 + performance.now() * 0.015) % (state.width + 80) - 40;
      const y = 36 + (i * 47) % Math.max(160, state.horizonY);
      ctx.fillRect(x, y, 22, 2);
    }
  }

  function drawCity() {
    const base = state.horizonY + 34;
    for (let i = 0; i < 18; i += 1) {
      const w = 34 + (i % 4) * 16;
      const h = 72 + (i * 29) % 130;
      const x = i * (state.width / 15) - 40;
      ctx.fillStyle = i % 2 ? 'rgba(26, 37, 70, 0.9)' : 'rgba(20, 29, 55, 0.9)';
      ctx.fillRect(x, base - h, w, h);
      ctx.fillStyle = i % 3 ? 'rgba(200, 255, 56, 0.34)' : 'rgba(255, 61, 110, 0.32)';
      for (let y = base - h + 14; y < base - 10; y += 22) {
        ctx.fillRect(x + 8, y, w - 16, 3);
      }
    }
  }

  function drawTrack(dt) {
    const bottomLeft = state.centerX - state.laneWidth * 2.05;
    const bottomRight = state.centerX + state.laneWidth * 2.05;
    const topLeft = state.centerX - 56;
    const topRight = state.centerX + 56;

    const trackGradient = ctx.createLinearGradient(0, state.horizonY, 0, state.groundY + 80);
    trackGradient.addColorStop(0, '#2b2752');
    trackGradient.addColorStop(1, '#10192b');
    ctx.fillStyle = trackGradient;
    ctx.beginPath();
    ctx.moveTo(topLeft, state.horizonY);
    ctx.lineTo(topRight, state.horizonY);
    ctx.lineTo(bottomRight, state.height);
    ctx.lineTo(bottomLeft, state.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(54, 247, 255, 0.46)';
    ctx.lineWidth = 2;
    for (const lane of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(state.centerX + lane * 44, state.horizonY);
      ctx.lineTo(state.centerX + lane * state.laneWidth, state.height);
      ctx.stroke();
    }

    const offset = ((performance.now() * 0.08) % 48) / 48;
    for (let i = 0; i < 18; i += 1) {
      const t = (i + offset) / 18;
      const y = lerp(state.horizonY, state.height, t * t);
      const half = lerp(56, state.laneWidth * 2.05, t);
      ctx.strokeStyle = `rgba(255, 211, 77, ${0.08 + t * 0.32})`;
      ctx.lineWidth = lerp(1, 5, t);
      ctx.beginPath();
      ctx.moveTo(state.centerX - half, y);
      ctx.lineTo(state.centerX + half, y);
      ctx.stroke();
    }
  }

  function drawObjects() {
    const sorted = [...state.objects].sort((a, b) => b.z - a.z);
    for (const object of sorted) {
      const point = project(object.lane, object.z);
      if (object.kind === 'coin') {
        drawCoin(point.x, point.y, point.scale, object.spin);
      } else {
        drawObstacle(object, point);
      }
    }
  }

  function drawCoin(x, y, scale, spin) {
    const radius = 14 * scale;
    ctx.save();
    ctx.translate(x, y - 48 * scale);
    ctx.scale(Math.max(0.28, Math.abs(Math.cos(spin))), 1);
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = '#fff4a4';
    ctx.lineWidth = Math.max(2, 3 * scale);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#15120b';
    ctx.font = `${Math.max(10, 13 * scale)}px Arial Black, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', 0, 1);
    ctx.restore();
  }

  function drawObstacle(object, point) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.scale(point.scale, point.scale);
    if (object.type === 'candle') drawCandle();
    if (object.type === 'rug') drawRug();
    if (object.type === 'trap') drawTrap();
    if (object.type === 'chart') drawChart();
    ctx.restore();
  }

  function drawCandle() {
    ctx.fillStyle = '#ff3d6e';
    ctx.fillRect(-17, -116, 34, 92);
    ctx.fillStyle = '#8b102c';
    ctx.fillRect(-17, -32, 34, 12);
    ctx.fillStyle = '#36f7ff';
    ctx.fillRect(-24, -126, 48, 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-5, -104, 10, 52);
  }

  function drawRug() {
    ctx.fillStyle = '#a663ff';
    ctx.fillRect(-46, -22, 92, 18);
    ctx.fillStyle = '#ff3d6e';
    ctx.fillRect(-38, -18, 76, 6);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(-44, -4, 88, 6);
  }

  function drawTrap() {
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(-48, -6);
    ctx.lineTo(-24, -42);
    ctx.lineTo(0, -6);
    ctx.lineTo(24, -42);
    ctx.lineTo(48, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff3d6e';
    ctx.fillRect(-52, -6, 104, 12);
  }

  function drawChart() {
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = '#ff3d6e';
    ctx.lineWidth = 6;
    ctx.fillRect(-44, -88, 88, 66);
    ctx.strokeRect(-44, -88, 88, 66);
    ctx.strokeStyle = '#c8ff38';
    ctx.beginPath();
    ctx.moveTo(-34, -38);
    ctx.lineTo(-14, -54);
    ctx.lineTo(4, -48);
    ctx.lineTo(22, -74);
    ctx.lineTo(36, -30);
    ctx.stroke();
  }

  function drawRunner() {
    const t = performance.now() * 0.012;
    const point = project(0, 0.28);
    ctx.save();
    ctx.translate(point.x, point.y - 14 * point.scale);
    ctx.scale(point.scale * 0.58, point.scale * 0.58);
    ctx.strokeStyle = '#f7fbff';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.arc(0, -82, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -66);
    ctx.lineTo(0, -24);
    ctx.moveTo(0, -52);
    ctx.lineTo(-22, -34 + Math.sin(t) * 7);
    ctx.moveTo(0, -52);
    ctx.lineTo(24, -38 - Math.sin(t) * 7);
    ctx.moveTo(0, -24);
    ctx.lineTo(-18, 16 - Math.sin(t) * 8);
    ctx.moveTo(0, -24);
    ctx.lineTo(20, 16 + Math.sin(t) * 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer() {
    const player = state.player;
    const jumpHeight = getJumpHeight();
    const isSliding = player.slideTime > 0;
    const point = project(player.laneVisual, 0);
    const bob = Math.sin(performance.now() * 0.018) * 4;
    const x = point.x;
    const y = point.y - jumpHeight + bob;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(point.scale, point.scale);
    if (isSliding) {
      ctx.rotate(-0.14);
      ctx.scale(1.1, 0.72);
      ctx.translate(0, 34);
    }

    const playerImage = assets.player;
    if (playerImage.complete && playerImage.naturalWidth) {
      // Crop around the buff Trollrunner figure so the wide source image's empty area does not become the sprite.
      ctx.drawImage(playerImage, 45, 92, 760, 610, -86, -154, 172, 144);
    } else {
      drawFallbackTroll();
    }

    ctx.restore();
  }

  function drawFallbackTroll() {
    ctx.fillStyle = '#2457ff';
    ctx.fillRect(-26, -98, 52, 62);
    ctx.fillStyle = '#f7fbff';
    ctx.beginPath();
    ctx.arc(0, -122, 27, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#101010';
    ctx.beginPath();
    ctx.arc(-9, -127, 3, 0, Math.PI * 2);
    ctx.arc(10, -127, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#101010';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(1, -117, 14, 0.08, Math.PI - 0.08, false);
    ctx.stroke();
    ctx.strokeStyle = '#f7fbff';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(-22, -88);
    ctx.lineTo(-42, -58);
    ctx.moveTo(22, -88);
    ctx.lineTo(44, -58);
    ctx.moveTo(-14, -36);
    ctx.lineTo(-28, 18);
    ctx.moveTo(14, -36);
    ctx.lineTo(28, 18);
    ctx.stroke();
  }

  function project(lane, z) {
    const depth = clamp(1 - z, 0, 1.18);
    const curve = depth * depth * (3 - 2 * depth);
    return {
      x: state.centerX + lane * state.laneWidth * curve,
      y: lerp(state.horizonY, state.groundY, curve),
      scale: lerp(0.28, 1.15, curve),
    };
  }

  function getJumpHeight() {
    if (state.player.jumpTime <= 0) return 0;
    const progress = 1 - state.player.jumpTime / 0.62;
    return Math.sin(progress * Math.PI) * Math.min(128, state.height * 0.18);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }
})();

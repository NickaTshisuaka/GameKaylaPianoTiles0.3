/* ======================================================
  gamelogic.js — Hybrid (Readable + Optimized)
  - 4 columns
  - non-overlapping spawn
  - safe restart (clears RAF & intervals)
  - theme selector (Arcade / Calm / SciFi)
  - safe DOM guards
  Paste PART 1..6 in order into gamelogic.js
====================================================== */

(() => {
  // ---------- Config ----------
  const TILE_HEIGHT = 150;
  const SPAWN_INTERVAL = 500; // base ms between spawns (scales by speed)
  const PERFECT_ZONE = 60;
  const MAX_LIVES = 3;
  const NUM_COLS = 4; // confirmed by you
  const BOARD_OFFSCREEN_CUTOFF = 900;
  const PERFECT_LINE_BOTTOM = 150;   // matches CSS --perfect-line
  const HIT_DETECTION_RANGE = 200;

  // ---------- Game container state ----------
  const game = {
    state: 'menu', // 'menu' | 'playing' | 'gameover'
    tiles: [],     // {id, col, y, hit, missed}
    nextTileId: 1,
    score: 0,
    highScore: Number(localStorage.getItem('pt_highscore') || 0),
    combo: 0,
    bestCombo: 0,
    lives: MAX_LIVES,
    speed: 2,
    rafId: null,
    lastSpawn: 0,
    spawnIntervalTimer: null,
    themePlayer: null,
    activeTheme: 'Arcade',
    soundEnabled: true
  };

  // ---------- DOM refs (resolved on DOMContentLoaded) ----------
  let board, perfectLineEl, scoreEl, livesEl, comboEl, speedEl, menu, startBtn, bestEl, toggleSoundBtn, gameover, restartBtn, goScore, goCombo, storedBest, newHighEl, feedbackContainer, themeBtn;

  function resolveDOM() {
    board = document.getElementById('board');
    perfectLineEl = document.getElementById('perfectLine');
    scoreEl = document.getElementById('score');
    livesEl = document.getElementById('lives');
    comboEl = document.getElementById('combo');
    speedEl = document.getElementById('speedIndicator');
    menu = document.getElementById('menu');
    startBtn = document.getElementById('startBtn');
    bestEl = document.getElementById('best');
    toggleSoundBtn = document.getElementById('toggleSound');
    gameover = document.getElementById('gameover');
    restartBtn = document.getElementById('restartBtn');
    goScore = document.getElementById('go-score');
    goCombo = document.getElementById('go-combo');
    storedBest = document.getElementById('storedBest');
    newHighEl = document.getElementById('newHigh');
    feedbackContainer = document.getElementById('feedbackContainer');
    themeBtn = document.getElementById('themeBtn'); // might be created by script
  }

  // ---------- Audio ----------
  let audioCtx = null;
  function ensureAudioCtx() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
      console.warn('AudioContext unavailable', e);
    }
  }

  function playBeep(freq = 440, duration = 0.08, type = 'sine', volume = 0.28) {
    if (!game.soundEnabled) return;
    if (!audioCtx) ensureAudioCtx();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(duration, 0.02));
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn('playBeep error', e);
    }
  }

  function scheduleTone(freq, startAfterMs = 0, duration = 120, type = 'sine', volume = 0.18) {
    if (!game.soundEnabled) return () => {};
    if (!audioCtx) ensureAudioCtx();
    if (!audioCtx) return () => {};
    const start = audioCtx.currentTime + startAfterMs / 1000;
    const stop = start + duration / 1000;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(volume, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, stop);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(stop);
    return () => {
      try { osc.stop(); } catch (e) {}
    };
  }




    // ---------- Helpers ----------
  function perfectLineY() {
    if (!board) return 0;
    const rect = board.getBoundingClientRect();
    const perfectBottom = rect.bottom - PERFECT_LINE_BOTTOM;
    return perfectBottom - rect.top;
  }

  function safeSetText(el, val) {
    if (!el) return;
    el.textContent = val;
  }

  // ---------- Theme Players ----------
  // returns {start, stop} for each theme
  function createArcadeTheme() {
    let timers = [];
    function start() {
      if (!game.soundEnabled) return;
      ensureAudioCtx();
      stop();
      let i = 0;
      const notes = [880, 660, 740, 990];
      timers.push(setInterval(() => {
        const n = notes[i % notes.length];
        playBeep(n, 0.12, 'square', 0.18);
        if (i % 2 === 0) scheduleTone(n * 1.5, 60, 60, 'triangle', 0.08);
        i++;
      }, 260));
      timers.push(setInterval(() => playBeep(110, 0.18, 'sawtooth', 0.06), 800));
    }
    function stop() { timers.forEach(t => clearInterval(t)); timers=[]; }
    return { start, stop };
  }

  function createCalmTheme() {
    let timers = [];
    function start() {
      if (!game.soundEnabled) return;
      ensureAudioCtx();
      stop();
      timers.push(setInterval(() => playBeep(220, 0.9, 'sine', 0.04), 1200));
      timers.push(setInterval(() => scheduleTone(440, 0, 180, 'triangle', 0.08), 1800));
    }
    function stop() { timers.forEach(t => clearInterval(t)); timers=[]; }
    return { start, stop };
  }

  function createSciFiTheme() {
    let timers = [];
    function start() {
      if (!game.soundEnabled) return;
      ensureAudioCtx();
      stop();
      timers.push(setInterval(() => playBeep(130, 0.9, 'sine', 0.06), 1400));
      timers.push(setInterval(() => playBeep(1200 + Math.random() * 600, 0.06, 'square', 0.06), 500 + Math.random() * 700));
    }
    function stop() { timers.forEach(t => clearInterval(t)); timers=[]; }
    return { start, stop };
  }

  const themePlayers = {
    Arcade: createArcadeTheme(),
    Calm: createCalmTheme(),
    SciFi: createSciFiTheme()
  };

  function startTheme(name) {
    if (!game.soundEnabled) return;
    if (game.themePlayer && game.themePlayer.stop) game.themePlayer.stop();
    game.themePlayer = themePlayers[name];
    if (game.themePlayer && game.themePlayer.start) game.themePlayer.start();
    game.activeTheme = name;
    updateThemeButtonLabel();
  }
  function stopTheme() {
    if (game.themePlayer && game.themePlayer.stop) game.themePlayer.stop();
    game.themePlayer = null;
  }

  // ---------- Tile spawn (non-overlapping) ----------
function spawnTile(initialY = -TILE_HEIGHT) {
  const MIN_GAP = TILE_HEIGHT * 1.2; // minimum vertical space before another tile can appear in the same column

  // Track the lowest Y value for each column
  const lastYs = new Array(NUM_COLS).fill(-Infinity);

  for (let t of game.tiles) {
    if (t.col >= 0 && t.col < NUM_COLS) {
      lastYs[t.col] = Math.max(lastYs[t.col], t.y);
    }
  }

  // Determine which columns are safe to spawn in
  const safeCols = [];
  for (let c = 0; c < NUM_COLS; c++) {
    const lastY = lastYs[c];

    // If the last tile in this column is below MIN_GAP,
    // this column is safe to spawn in
    if (lastY < 0 || lastY > MIN_GAP) {
      safeCols.push(c);
    }
  }

  // If no column is safe, delay spawning until next cycle
  if (safeCols.length === 0) return;

  // Choose a safe random column
  const col = safeCols[Math.floor(Math.random() * safeCols.length)];

  // Create the tile DOM element
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.style.left = `${(100 / NUM_COLS) * col}%`;
  tile.style.width = `${100 / NUM_COLS}%`;
  tile.style.top = initialY + "px";

  // Store tile data in game structure
  const tileObj = {
    el: tile,
    col: col,
    y: initialY,
    hit: false
  };

  game.board.appendChild(tile);
  game.tiles.push(tileObj);
}


  function createTileElement(tile) {
    if (!board) return;
    const el = document.createElement('div');
    el.className = 'tile';
    el.style.left = `${(tile.col * 100) / NUM_COLS}%`;
    el.style.width = `${100 / NUM_COLS}%`;
    el.style.height = `${TILE_HEIGHT}px`;
    el.dataset.id = tile.id;

    el.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      handleTileClick(tile.id, tile.col);
    }, { passive: false });

    board.appendChild(el);
  }

  function updateTileElements() {
    if (!board) return;
    const elements = board.querySelectorAll('.tile');
    elements.forEach(el => {
      const id = Number(el.dataset.id);
      const tile = game.tiles.find(t => t.id === id);
      if (!tile) { el.remove(); return; }
      el.style.top = `${tile.y}px`;
      el.classList.toggle('hit', !!tile.hit);
      el.classList.toggle('missed', !!tile.missed);
    });
  }

  function cleanupTiles() {
    game.tiles = game.tiles.filter(t => {
      if (t.y > BOARD_OFFSCREEN_CUTOFF) {
        const el = board.querySelector(`.tile[data-id="${t.id}"]`);
        if (el) el.remove();
        console.log("Active tiles:", game.tiles.length);
        return false;

      }
      return true;
    });
  }








  // ---------- Scoring & interactions ----------
  function handleTileClick(tileId, col) {
    if (game.state !== 'playing') return;
    const tile = game.tiles.find(t => t.id === tileId);
    if (!tile || tile.hit || tile.missed) return;

    const tileBottom = tile.y + TILE_HEIGHT;
    const distance = Math.abs(tileBottom - perfectLineY());
    if (distance > HIT_DETECTION_RANGE) return; // too far

    tile.hit = true;

    let points = 1;
    let feedback = '';
    if (distance < 20) {
      points = 10; feedback = '✨ PERFECT!'; playBeep(880,0.12); setTimeout(()=>playBeep(1100,0.08),50);
    } else if (distance < 40) {
      points = 5; feedback='👍 GREAT!'; playBeep(660,0.12);
    } else if (distance < PERFECT_ZONE) {
      points = 3; feedback='✓ GOOD'; playBeep(550,0.1);
    } else {
      points = 1; playBeep(440,0.08);
    }

    game.score += points;
    game.combo += 1;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    game.speed = Math.min(game.speed + 0.01, 8);

    showFeedback(feedback || `+${points}`, col, false);
    renderHUD();
  }

  function handleEmptyClick(col) {
    if (game.state !== 'playing') return;
    game.combo = 0;
    game.lives -= 1;
    showFeedback('❌ MISS!', col, true);
    playBeep(180,0.22,'sawtooth');
    if (game.lives <= 0) setTimeout(endGame, 300);
    renderHUD();
  }

  function markTileMiss(tile) {
    if (tile.hit || tile.missed) return;
    tile.missed = true;
    game.combo = 0;
    game.lives -= 1;
    showFeedback('❌ MISS!', tile.col, true);
    playBeep(200,0.28,'sawtooth');
    if (game.lives <= 0) setTimeout(endGame, 300);
  }

  function showFeedback(text, col, isError=false) {
    if (!feedbackContainer) return;
    const id = `f${Date.now()}${Math.random()}`;
    const el = document.createElement('div');
    el.className = 'feedback';
    el.id = id;
    el.style.left = `${(col * 100) / NUM_COLS + (100 / (NUM_COLS * 2))}%`;
    el.style.top = `50%`;
    el.style.color = isError ? 'var(--tile-miss)' : 'var(--tile-hit)';
    el.textContent = text;
    feedbackContainer.appendChild(el);
    setTimeout(()=>{ const e = document.getElementById(id); if(e) e.remove(); }, 900);
  }

  function renderHUD() {
    safeSetText(scoreEl, String(game.score));
    if (livesEl) {
      livesEl.innerHTML = '';
      for (let i=0;i<MAX_LIVES;i++){
        const sp = document.createElement('div');
        sp.textContent = i < game.lives ? '❤️' : '🖤';
        sp.style.fontSize = '20px';
        sp.style.opacity = i < game.lives ? '1' : '0.35';
        livesEl.appendChild(sp);
      }
    }
    if (comboEl) {
      comboEl.textContent = `🔥 ${game.combo}x COMBO`;
      comboEl.classList.toggle('hidden', game.combo < 3);
    }
    if (speedEl) speedEl.textContent = `${(game.speed || 2).toFixed(1)}x`;
    if (bestEl) bestEl.textContent = game.highScore > 0 ? `Best: ${game.highScore}` : '';
    if (storedBest) storedBest.textContent = game.highScore;
  }

  // ---------- Game Loop (single RAF) ----------
  function startLoop() {
    stopLoop(); // make sure only one RAF runs
    game.lastSpawn = performance.now();
    game.state = 'playing';

    function loop(now) {
      if (game.state !== 'playing') { game.rafId = null; return; }
      const delta = now - (game._lastTime || now);
      game._lastTime = now;

      // move tiles
      for (let t of game.tiles) t.y += (game.speed || 2) * (delta / 16);

      // check misses relative to perfect line
      const pY = perfectLineY();
      for (let t of game.tiles) {
        if (!t.hit && !t.missed && t.y > pY + 100) markTileMiss(t);
      }

      cleanupTiles();

      // spawn new tile with linear speed scaling
      if (now - game.lastSpawn > SPAWN_INTERVAL / (game.speed || 2)) {
        spawnTile();
        game.lastSpawn = now;
      }

      updateTileElements();
      renderHUD();
      game.rafId = requestAnimationFrame(loop);
    }

    game.rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (game.rafId) cancelAnimationFrame(game.rafId);
    game.rafId = null;
    game._lastTime = null;
  }









    // ---------- Spawn interval safe manager (in case we used setInterval somewhere) ----------
  function clearSpawnInterval() {
    if (game.spawnIntervalTimer) {
      clearInterval(game.spawnIntervalTimer);
      game.spawnIntervalTimer = null;
    }
  }

  // ---------- Start / Stop / Restart ----------
  function startGame() {
    // resume audio context on user gesture
    try { audioCtx && audioCtx.resume && audioCtx.resume(); } catch(e) {}

    // hide overlays
    if (menu) { menu.classList.add('hidden'); menu.style.display = 'none'; }
    if (gameover) { gameover.classList.add('hidden'); gameover.style.display = 'none'; }

    // clear previous loops and tiles
    stopLoop();
    clearSpawnInterval();
    document.querySelectorAll('.tile').forEach(n => n.remove());
    game.tiles = [];
    game.nextTileId = 1;

    // reset stats
    game.state = 'playing';
    game.score = 0;
    game.combo = 0;
    game.bestCombo = 0;
    game.lives = MAX_LIVES;
    game.speed = 2;

    renderHUD();

    // spawn a few initial tiles spaced out for visuals
    for (let i=0;i<4;i++){
      setTimeout(()=>spawnTile(-200 - (i*200)), i*150);
    }

    // start main RAF loop
    startLoop();

    // start theme if sound enabled
    if (game.soundEnabled) startTheme(game.activeTheme);

    console.info('Game started (startGame called)');
  }

  function endGame() {
    // stop loops
    stopLoop();
    clearSpawnInterval();

    game.state = 'gameover';

    safeSetText(goScore, String(game.score));
    safeSetText(goCombo, String(game.bestCombo));
    if (newHighEl) newHighEl.classList.toggle('hidden', game.score < game.highScore);

    if (gameover) { gameover.classList.remove('hidden'); gameover.style.display = ''; }
    if (menu) menu.classList.add('hidden');

    if (game.score > game.highScore) {
      game.highScore = game.score;
      localStorage.setItem('pt_highscore', String(game.highScore));
    }

    renderHUD();

    // stop theme and optionally close audio context
    stopTheme();
    try { audioCtx?.close?.(); audioCtx = null; } catch (e) {}
    console.info('Game ended (endGame called). Score:', game.score, 'HighScore:', game.highScore);
  }

  // ---------- Event wiring & UI helpers ----------
  function ensureThemeButton() {
    if (!menu || !startBtn) return;
    if (document.getElementById('themeBtn')) {
      themeBtn = document.getElementById('themeBtn');
      updateThemeButtonLabel();
      return;
    }
    const btn = document.createElement('button');
    btn.id = 'themeBtn';
    btn.className = 'big-btn';
    btn.type = 'button';
    btn.style.marginTop = '10px';
    btn.textContent = `Theme: ${game.activeTheme}`;
    startBtn.insertAdjacentElement('afterend', btn);
    themeBtn = btn;
  }

  function updateThemeButtonLabel() {
    if (!themeBtn) return;
    themeBtn.textContent = `Theme: ${game.activeTheme}`;
  }

  function onThemeClick() {
    const order = ['Arcade','Calm','SciFi'];
    const idx = order.indexOf(game.activeTheme);
    const next = order[(idx + 1) % order.length];
    game.activeTheme = next;
    updateThemeButtonLabel();
    if (game.state === 'playing' && game.soundEnabled) startTheme(game.activeTheme);
  }

  function onToggleSound() {
    game.soundEnabled = !game.soundEnabled;
    if (toggleSoundBtn) toggleSoundBtn.textContent = `Sound: ${game.soundEnabled ? 'On' : 'Off'}`;
    if (!game.soundEnabled) {
      stopTheme();
      try { audioCtx?.suspend?.(); } catch(e){}
    } else {
      ensureAudioCtx();
      if (game.state === 'playing') startTheme(game.activeTheme);
    }
  }







    function wireEvents() {
    ensureThemeButton();

    if (startBtn) {
      startBtn.removeEventListener('click', startGame);
      startBtn.addEventListener('click', startGame);
    }
    if (restartBtn) {
      restartBtn.removeEventListener('click', startGame);
      restartBtn.addEventListener('click', startGame);
    }
    if (themeBtn) {
      themeBtn.removeEventListener('click', onThemeClick);
      themeBtn.addEventListener('click', onThemeClick);
    }
    if (toggleSoundBtn) {
      toggleSoundBtn.removeEventListener('click', onToggleSound);
      toggleSoundBtn.addEventListener('click', onToggleSound);
    }

    // keyboard handler
    window.removeEventListener('keydown', window.__piano_tiles_keydown);
    window.__piano_tiles_keydown = function(e) {
      if (game.state !== 'playing') return;
      const map = { '1':0,'2':1,'3':2,'4':3,'a':0,'s':1,'d':2,'f':3 };
      const col = map[e.key];
      if (col === undefined) return;
      const clickedTile = game.tiles.find(t => !t.hit && !t.missed && t.col === col && Math.abs((t.y + TILE_HEIGHT) - perfectLineY()) < HIT_DETECTION_RANGE);
      if (!clickedTile) {
        handleEmptyClick(col);
      } else {
        handleTileClick(clickedTile.id, col);
      }
    };
    window.addEventListener('keydown', window.__piano_tiles_keydown);

    window.removeEventListener('resize', window.__piano_tiles_resize);
    window.__piano_tiles_resize = () => { buildColumns(); };
    window.addEventListener('resize', window.__piano_tiles_resize);
  }

  // ---------- Columns + layout ----------
  function buildColumns() {
    if (!board) return;
    board.innerHTML = '';
    for (let c=0;c<NUM_COLS;c++){
      const col = document.createElement('div');
      col.className = 'column';
      col.style.left = `${(c * 100) / NUM_COLS}%`;
      col.style.width = `${100 / NUM_COLS}%`;
      col.dataset.col = c;
      col.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (game.state !== 'playing') return;
        const clickedTile = game.tiles.find(t => !t.hit && !t.missed && t.col === c && Math.abs((t.y + TILE_HEIGHT) - perfectLineY()) < HIT_DETECTION_RANGE);
        if (!clickedTile) handleEmptyClick(c);
        else handleTileClick(clickedTile.id, c);
      }, { passive: false });
      board.appendChild(col);
    }
    if (perfectLineEl) perfectLineEl.style.bottom = PERFECT_LINE_BOTTOM + 'px';
  }










    // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', () => {
    resolveDOM();
    buildColumns();
    wireEvents();
    renderHUD();

    // overlays initial
    if (menu) menu.classList.remove('hidden');
    if (gameover) gameover.classList.add('hidden');

    // set initial texts
    if (bestEl) bestEl.textContent = game.highScore > 0 ? `Best: ${game.highScore}` : '';
    if (storedBest) storedBest.textContent = game.highScore;
    if (toggleSoundBtn) toggleSoundBtn.textContent = `Sound: ${game.soundEnabled ? 'On' : 'Off'}`;

    console.info('gamelogic.js loaded — DOM ready. highScore:', game.highScore);
  });

  // Expose debug API
  window.__pianoTilesDebug = {
    getState: () => ({
      state: game.state,
      score: game.score,
      lives: game.lives,
      tilesCount: game.tiles.length,
      rafId: game.rafId,
      lastSpawn: game.lastSpawn,
      nextTileId: game.nextTileId,
      highScore: game.highScore,
      activeTheme: game.activeTheme
    }),
    startGame,
    endGame,
    spawnTile,
    clearAll: () => {
      stopLoop();
      clearSpawnInterval();
      stopTheme();
      document.querySelectorAll('.tile').forEach(t => t.remove());
      game.tiles = [];
      game.nextTileId = 1;
      game.score = 0;
      game.lives = MAX_LIVES;
      game.state = 'menu';
      renderHUD();
      console.info('Cleared all game state via debug');
    }
  };
})();

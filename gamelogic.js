(() => {
  // ---------- Config (use measured TILE_HEIGHT, fallback to 150) ----------
  let TILE_HEIGHT = 150; // will be measured at runtime
  const SPAWN_INTERVAL = 500; // base ms between spawns
  const PERFECT_ZONE = 60;
  const MAX_LIVES = 3;
  const NUM_COLS = 4;
  const BOARD_OFFSCREEN_CUTOFF = 900;
  const PERFECT_LINE_BOTTOM = 150; // matches CSS --perfect-line
  const HIT_DETECTION_RANGE = 260; // perfect for phones

  // ---------- State ----------
  let gameState = "menu"; // menu | playing | gameover
  let score = 0;
  let highScore = Number(localStorage.getItem("pt_highscore") || 0);
  let combo = 0;
  let bestCombo = 0;
  let lives = MAX_LIVES;
  let speed = 1;

  let tiles = []; // { id, col, y, hit, missed }
  let nextTileId = 1;
  let lastSpawn = 0;
  let rafId = null;
  let spawnIntervalTimer = null;

  // audio/theme
  let audioCtx = null;
  let soundEnabled = true;
  const THEMES = ["Arcade", "Calm", "SciFi"];
  let activeTheme = "Arcade";
  let themePlayer = null;
  // ---------- Snippet Music ----------
  let snippetMusic = null;
  // const SNIPPETS = ["public/assets/snippet1.mp3", "public/assets/snippet2.mp3"];

  // ---------- DOM refs (resolved after DOMContentLoaded) ----------
  let board,
    perfectLineEl,
    scoreEl,
    livesEl,
    comboEl,
    speedEl,
    menu,
    startBtn,
    bestEl,
    toggleSoundBtn,
    gameover,
    restartBtn,
    goScore,
    goCombo,
    storedBest,
    newHighEl,
    feedbackContainer,
    themeBtn;

  // ---------- Measure actual tile height (important to avoid overlap) ----------
  function measureTileHeight() {
    // create a temporary tile element, measure, remove
    const temp = document.createElement("div");
    temp.className = "tile";
    temp.style.position = "absolute";
    temp.style.visibility = "hidden";
    temp.style.top = "-9999px";
    // ensure it has width so any responsive rules apply
    temp.style.width = "25%";
    document.body.appendChild(temp);
    const measured = temp.offsetHeight;
    document.body.removeChild(temp);
    if (measured && typeof measured === "number") {
      TILE_HEIGHT = measured;
    } else {
      TILE_HEIGHT = 150; // fallback
    }
    console.info("Measured TILE_HEIGHT =", TILE_HEIGHT);
  }

  // ---------- DOM resolve ----------
  function resolveDOM() {
    board = document.getElementById("board");
    perfectLineEl = document.getElementById("perfectLine");
    scoreEl = document.getElementById("score");
    livesEl = document.getElementById("lives");
    comboEl = document.getElementById("combo");
    speedEl = document.getElementById("speedIndicator");
    menu = document.getElementById("menu");
    startBtn = document.getElementById("startBtn");
    bestEl = document.getElementById("best");
    toggleSoundBtn = document.getElementById("toggleSound");
    gameover = document.getElementById("gameover");
    restartBtn = document.getElementById("restartBtn");
    goScore = document.getElementById("go-score");
    goCombo = document.getElementById("go-combo");
    storedBest = document.getElementById("storedBest");
    newHighEl = document.getElementById("newHigh");
    feedbackContainer = document.getElementById("feedbackContainer");
    themeBtn = document.getElementById("themeBtn"); // may be created dynamically
  }

  // ---------- Audio helpers ----------
  function ensureAudioCtx() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
      console.warn("AudioContext not available", e);
    }
  }

  function playBeep(freq = 440, duration = 0.08, type = "sine", volume = 0.28) {
    if (!soundEnabled) return;
    if (!audioCtx) ensureAudioCtx();
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        now + Math.max(duration, 0.02)
      );
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn("playBeep error", e);
    }
  }

  function scheduleTone(
    freq,
    startAfterMs = 0,
    duration = 120,
    type = "sine",
    volume = 0.18
  ) {
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
      try {
        osc.stop();
      } catch (e) {}
    };
  }

  function playSnippet(index = 0, loop = true) {
    stopSnippet();
    const src = SNIPPETS[index % SNIPPETS.length];
    snippetMusic = new Audio(src);
    snippetMusic.loop = loop;
    snippetMusic.volume = 0.3; // adjust volume as needed
    snippetMusic.play().catch((e) => console.warn("Snippet play error", e));
  }

  function stopSnippet() {
    if (snippetMusic) {
      snippetMusic.pause();
      snippetMusic.currentTime = 0;
      snippetMusic = null;
    }
  }

  // ---------- Perfect line calc ----------
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

  // ---------- Theme players ----------
  function createArcadeTheme() {
    let timers = [];
    function start() {
      if (!soundEnabled) return;
      ensureAudioCtx();
      stopArcade();
      let i = 0;
      const notes = [880, 660, 740, 990];
      timers.push(
        setInterval(() => {
          const n = notes[i % notes.length];
          playBeep(n, 0.12, "square", 0.18);
          if (i % 2 === 0) scheduleTone(n * 1.5, 60, 60, "triangle", 0.08);
          i++;
        }, 260)
      );
      timers.push(
        setInterval(() => playBeep(110, 0.18, "sawtooth", 0.06), 800)
      );
    }
    function stopArcade() {
      timers.forEach((t) => clearInterval(t));
      timers = [];
    }
    return { start, stop: stopArcade };
  }
  function createCalmTheme() {
    let timers = [];
    function start() {
      if (!soundEnabled) return;
      ensureAudioCtx();
      stopCalm();
      timers.push(setInterval(() => playBeep(220, 0.9, "sine", 0.04), 1200));
      timers.push(
        setInterval(
          () => scheduleTone(440, 0, 180, "triangle", 0.08),
          1800 + Math.random() * 400
        )
      );
    }
    function stopCalm() {
      timers.forEach((t) => clearInterval(t));
      timers = [];
    }
    return { start, stop: stopCalm };
  }
  function createSciFiTheme() {
    let timers = [];
    function start() {
      if (!soundEnabled) return;
      ensureAudioCtx();
      stopSciFi();
      timers.push(setInterval(() => playBeep(130, 0.9, "sine", 0.06), 1400));
      timers.push(
        setInterval(
          () => playBeep(1200 + Math.random() * 600, 0.06, "square", 0.06),
          500 + Math.random() * 700
        )
      );
    }
    function stopSciFi() {
      timers.forEach((t) => clearInterval(t));
      timers = [];
    }
    return { start, stop: stopSciFi };
  }

  const themePlayers = {
    Arcade: createArcadeTheme(),
    Calm: createCalmTheme(),
    SciFi: createSciFiTheme(),
  };

  function startTheme(name) {
    if (!soundEnabled) return;
    if (themePlayer && themePlayer.stop) themePlayer.stop();
    themePlayer = themePlayers[name];
    if (themePlayer && themePlayer.start) themePlayer.start();
    activeTheme = name;
    updateThemeButtonLabel();
  }

  function stopTheme() {
    if (themePlayer && themePlayer.stop) themePlayer.stop();
    themePlayer = null;
  }

  // ---------- Tile management (non-overlap) ----------
  function spawnTile(initialY = -TILE_HEIGHT) {
    // Minimum vertical gap required for same column
    const MIN_GAP = Math.max(Math.round(TILE_HEIGHT * 1.25), 1);

    // Find last tile y per column
    const lastYs = new Array(NUM_COLS).fill(-Infinity);
    for (const t of tiles) {
      if (typeof t.col === "number" && t.col >= 0 && t.col < NUM_COLS) {
        lastYs[t.col] = Math.max(lastYs[t.col], t.y);
      }
    }

    // build safe column list: either empty or lastY > MIN_GAP
    const safeCols = [];
    for (let c = 0; c < NUM_COLS; c++) {
      const ly = lastYs[c];
      // if no tile in column OR last tile has moved down far enough
      if (ly === -Infinity || ly > MIN_GAP) safeCols.push(c);
    }

    // nothing safe right now — skip spawn
    if (safeCols.length === 0) return;

    const col = safeCols[Math.floor(Math.random() * safeCols.length)];
    const tile = {
      id: nextTileId++,
      col,
      y: initialY,
      hit: false,
      missed: false,
    };
    tiles.push(tile);
    createTileElement(tile);
  }

  function createTileElement(tile) {
    if (!board) return;
    const el = document.createElement("div");
    el.className = "tile";
    el.style.left = `${(tile.col * 100) / NUM_COLS}%`;
    el.style.width = `${100 / NUM_COLS}%`;
    // set top later in updateTileElements; set height style for consistent measurement
    el.style.height = `${TILE_HEIGHT}px`;
    el.dataset.id = tile.id;
    el.addEventListener(
      "pointerdown",
      function (ev) {
        ev.preventDefault();
        handleTileClick(tile.id, tile.col);
      },
      { passive: false }
    );
    board.appendChild(el);
  }

  function updateTileElements() {
    if (!board) return;
    const elements = board.querySelectorAll(".tile");
    elements.forEach((el) => {
      const id = Number(el.dataset.id);
      const tile = tiles.find((t) => t.id === id);
      if (!tile) {
        el.remove();
        return;
      }
      el.style.top = `${tile.y}px`;
      el.classList.toggle("hit", !!tile.hit);
      el.classList.toggle("missed", !!tile.missed);
    });
  }

  function cleanupTiles() {
    tiles = tiles.filter((t) => {
      if (t.y > BOARD_OFFSCREEN_CUTOFF) {
        const el = board && board.querySelector(`.tile[data-id="${t.id}"]`);
        if (el) el.remove();
        return false;
      }
      return true;
    });
  }

  // ---------- Scoring & hit detection ----------
  function handleTileClick(tileId, col) {
    if (gameState !== "playing") return;
    const tile = tiles.find((t) => t.id === tileId);
    if (!tile || tile.hit || tile.missed) return;

    const tileBottom = tile.y + TILE_HEIGHT;
    const distance = Math.abs(tileBottom - perfectLineY());
    if (distance > HIT_DETECTION_RANGE) return;

    tile.hit = true;
    let points = 1;
    let feedback = "";
    if (distance < 20) {
      points = 10;
      feedback = "✨ PERFECT!";
      playBeep(880, 0.12);
      setTimeout(() => playBeep(1100, 0.08), 50);
    } else if (distance < 40) {
      points = 5;
      feedback = "👍 GREAT!";
      playBeep(660, 0.12);
    } else if (distance < PERFECT_ZONE) {
      points = 3;
      feedback = "✓ GOOD";
      playBeep(550, 0.1);
    } else {
      points = 1;
      playBeep(440, 0.08);
    }

    score += points;
    combo += 1;
    bestCombo = Math.max(bestCombo, combo);
    speed = Math.min(speed + 0.01, 1);

    showFeedback(feedback || `+${points}`, col, false);
    renderHUD();
  }

  function handleEmptyClick(col) {
    if (gameState !== "playing") return;
    combo = 0;
    lives -= 1;
    showFeedback("❌ MISS!", col, true);
    playBeep(180, 0.22, "sawtooth");
    if (lives <= 0) setTimeout(endGame, 300);
    renderHUD();
  }

  function markTileMiss(tile) {
    if (tile.hit || tile.missed) return;
    tile.missed = true;
    combo = 0;
    lives -= 1;
    showFeedback("❌ MISS!", tile.col, true);
    playBeep(200, 0.28, "sawtooth");
    if (lives <= 0) setTimeout(endGame, 300);
  }

  function showFeedback(text, col, isError = false) {
    if (!feedbackContainer) return;
    const id = `f${Date.now()}${Math.random()}`;
    const el = document.createElement("div");
    el.className = "feedback";
    el.id = id;
    el.style.left = `${(col * 100) / NUM_COLS + 100 / (NUM_COLS * 2)}%`;
    el.style.top = `50%`;
    el.style.color = isError ? "var(--tile-miss)" : "var(--tile-hit)";
    el.textContent = text;
    feedbackContainer.appendChild(el);
    setTimeout(() => {
      const e = document.getElementById(id);
      if (e) e.remove();
    }, 900);
  }

  function renderHUD() {
    safeSetText(scoreEl, String(score));
    if (livesEl) {
      livesEl.innerHTML = "";
      for (let i = 0; i < MAX_LIVES; i++) {
        const sp = document.createElement("div");
        sp.textContent = i < lives ? "❤️" : "🖤";
        sp.style.fontSize = "20px";
        sp.style.opacity = i < lives ? "1" : "0.35";
        livesEl.appendChild(sp);
      }
    }
    if (comboEl) {
      comboEl.textContent = `🔥 ${combo}x COMBO`;
      comboEl.classList.toggle("hidden", combo < 3);
    }
    if (speedEl) speedEl.textContent = `${speed.toFixed(1)}x`;
    if (bestEl) bestEl.textContent = highScore > 0 ? `Best: ${highScore}` : "";
    if (storedBest) storedBest.textContent = highScore;
  }

  // ---------- Game Loop ----------
  function startLoop() {
    stopLoop();
    let lastTime = performance.now();
    lastSpawn = performance.now();
    gameState = "playing";
    function loop(now) {
      const delta = now - lastTime;
      lastTime = now;

      // move tiles
      tiles.forEach((tile) => (tile.y += speed * (delta / 3)));

      // check misses
      const pY = perfectLineY();
      tiles.forEach((tile) => {
        if (!tile.hit && !tile.missed && tile.y > pY + 100) markTileMiss(tile);
      });

      cleanupTiles();

      // spawn new tiles scaled linearly with speed
      if (now - lastSpawn > SPAWN_INTERVAL / Math.max(0.1, speed)) {
        spawnTile();
        lastSpawn = now;
      }

      updateTileElements();
      renderHUD();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function clearSpawnTimers() {
    if (spawnIntervalTimer) {
      clearInterval(spawnIntervalTimer);
      spawnIntervalTimer = null;
    }
  }

  // ---------- Controls ----------
  function startGame() {
    try {
      audioCtx && audioCtx.resume && audioCtx.resume();
    } catch (e) {}
    // hide overlays
    if (menu) {
      menu.classList.add("hidden");
      menu.style.display = "none";
    }
    if (gameover) {
      gameover.classList.add("hidden");
      gameover.style.display = "none";
    }

    // clear old
    stopLoop();
    clearSpawnTimers();
    document.querySelectorAll(".tile").forEach((n) => n.remove());
    tiles = [];
    nextTileId = 1;

    // reset state
    gameState = "playing";
    score = 0;
    combo = 0;
    bestCombo = 0;
    lives = MAX_LIVES;
    speed = 1;
    renderHUD();

    // initial spawn: use TILE_HEIGHT measured value to space them
    for (let i = 0; i < 4; i++) {
      const spacing = Math.round(TILE_HEIGHT * 1.5);
      setTimeout(() => spawnTile(-TILE_HEIGHT - i * spacing), i * 150);
    }

    startLoop();
    if (soundEnabled) {
      startTheme(activeTheme);
      playSnippet(0); // Play background music
    }
  }

  function endGame() {
    stopLoop();
    clearSpawnTimers();
    gameState = "gameover";

    safeSetText(goScore, String(score));
    safeSetText(goCombo, String(bestCombo));
    if (newHighEl) newHighEl.classList.toggle("hidden", score < highScore);
    if (gameover) {
      gameover.classList.remove("hidden");
      gameover.style.display = "";
    }
    if (menu) menu.classList.add("hidden");

    if (score > highScore) {
      highScore = score;
      localStorage.setItem("pt_highscore", String(highScore));
    }
    renderHUD();

    stopTheme();
    try { audioCtx?.close?.(); audioCtx = null; } catch (e) {}
    console.info(
      "Game ended (endGame called). Score:",
      score,
      "HighScore:",
      highScore
    );
    stopSnippet();
  }

  // ---------- Events & UI wiring ----------
  function updateThemeButtonLabel() {
    if (themeBtn) themeBtn.textContent = `Theme: ${activeTheme}`;
  }

  function onThemeClick() {
    const idx = THEMES.indexOf(activeTheme);
    const next = THEMES[(idx + 1) % THEMES.length];
    activeTheme = next;
    updateThemeButtonLabel();
    if (gameState === "playing" && soundEnabled) startTheme(activeTheme);
  }

  function onToggleSound() {
    soundEnabled = !soundEnabled;
    if (toggleSoundBtn)
      toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;
    if (!soundEnabled) {
      stopTheme();
      try {
        audioCtx?.suspend?.();
      } catch (e) {}
    } else {
      ensureAudioCtx();
      if (gameState === "playing") startTheme(activeTheme);
    }
  }

  function onKeyDown(e) {
    if (gameState !== "playing") return;
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, s: 1, d: 2, f: 3 };
    const col = map[e.key];
    if (col === undefined) return;
    const clickedTile = tiles.find(
      (t) =>
        !t.hit &&
        !t.missed &&
        t.col === col &&
        Math.abs(t.y + TILE_HEIGHT - perfectLineY()) < HIT_DETECTION_RANGE
    );
    if (!clickedTile) handleEmptyClick(col);
    else handleTileClick(clickedTile.id, col);
  }

  function wireEvents() {
    // ensure theme button (insert after start button)
    if (menu && startBtn && !document.getElementById("themeBtn")) {
      const btn = document.createElement("button");
      btn.id = "themeBtn";
      btn.className = "big-btn";
      btn.type = "button";
      btn.style.marginTop = "10px";
      btn.textContent = `Theme: ${activeTheme}`;
      startBtn.insertAdjacentElement("afterend", btn);
      themeBtn = btn;
    } else {
      themeBtn = document.getElementById("themeBtn");
    }

    if (startBtn) {
      startBtn.removeEventListener("click", startGame);
      startBtn.addEventListener("click", startGame);
    }
    if (restartBtn) {
      restartBtn.removeEventListener("click", startGame);
      restartBtn.addEventListener("click", startGame);
    }
    if (themeBtn) {
      themeBtn.removeEventListener("click", onThemeClick);
      themeBtn.addEventListener("click", onThemeClick);
      updateThemeButtonLabel();
    }
    if (toggleSoundBtn) {
      toggleSoundBtn.removeEventListener("click", onToggleSound);
      toggleSoundBtn.addEventListener("click", onToggleSound);
    }

    window.removeEventListener("keydown", onKeyDown);
    window.addEventListener("keydown", onKeyDown);

    window.removeEventListener("resize", handleResize);
    window.addEventListener("resize", handleResize);
  }

  function handleResize() {
    // re-measure tile height because layout may change
    measureTileHeight();
    buildColumns();
  }

  // ---------- Columns + layout ----------
  function buildColumns() {
    if (!board) return;
    board.innerHTML = "";
    for (let c = 0; c < NUM_COLS; c++) {
      const col = document.createElement("div");
      col.className = "column";
      col.style.left = `${(c * 100) / NUM_COLS}%`;
      col.style.width = `${100 / NUM_COLS}%`;
      col.dataset.col = c;
      col.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          if (gameState !== "playing") return;

          const pLine = perfectLineY();

          // find all tiles in this column
          const candidates = tiles
            .filter((t) => !t.hit && !t.missed && t.col === c)
            .map((t) => ({
              tile: t,
              dist: Math.abs(t.y + TILE_HEIGHT - pLine),
            }));

          candidates.sort((a, b) => a.dist - b.dist);

          // no tile or too far → miss
          if (
            candidates.length === 0 ||
            candidates[0].dist > HIT_DETECTION_RANGE
          ) {
            handleEmptyClick(c);
            return;
          }

          // hit closest tile
          handleTileClick(candidates[0].tile.id, c);
        },
        { passive: false }
      );
      board.appendChild(col);
    }
    if (perfectLineEl) perfectLineEl.style.bottom = PERFECT_LINE_BOTTOM + "px";
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    resolveDOM();
    // measure tile height from CSS so spawn spacing is accurate
    measureTileHeight();
    buildColumns();
    wireEvents();
    renderHUD();
    // overlays initial state
    if (menu) menu.classList.remove("hidden");
    if (gameover) gameover.classList.add("hidden");
    // set UI text
    if (bestEl) bestEl.textContent = highScore > 0 ? `Best: ${highScore}` : "";
    if (storedBest) storedBest.textContent = highScore;
    if (toggleSoundBtn)
      toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;
    console.info(
      "gamelogic.js loaded — DOM ready. highScore:",
      highScore,
      "Measured TILE_HEIGHT:",
      TILE_HEIGHT
    );
  });

  // ---------- Debug API ----------
  window.__pianoTilesDebug = {
    startGame,
    endGame,
    spawnTile,
    getState: () => ({
      gameState,
      score,
      lives,
      tilesCount: tiles.length,
      rafId,
      highScore,
      activeTheme,
      TILE_HEIGHT,
    }),
  };

  // ---------- Expose helpers to internal scope (functions used by debug API) ----------
  // they are already defined above; no exports required here.
})();

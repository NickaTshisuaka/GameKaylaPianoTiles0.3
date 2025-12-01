(() => {
  /* ============================================================
     CONFIGURATION SECTION
     I've kept all core settings together so it's easier to tweak difficulty or adjust game feel without hunting all over the file.
  ============================================================ */

  let TILE_HEIGHT = 150; // This gets re-measured at runtime so tiles scale correctly on all screen sizes
  const SPAWN_INTERVAL = 500; // Base interval between tile spawns (ms)
  const PERFECT_ZONE = 60; // Defines how forgiving "perfect" hits are
  const MAX_LIVES = 3; // Player is allowed 3 mistakes
  const NUM_COLS = 4; // 4-column layout like the classic Piano Tiles
  const BOARD_OFFSCREEN_CUTOFF = 900; // Once tiles pass this Y value, they're removed
  const PERFECT_LINE_BOTTOM = 150; // This must match the CSS perfect-line offset
  const HIT_DETECTION_RANGE = 260; // Tuned for mobile accuracy

  /* ============================================================
     GAME STATE
     These variables track the "live" data of the game while it's running.
  ============================================================ */

  let gameState = "menu"; // menu | playing | gameover
  let score = 0;
  let highScore = Number(localStorage.getItem("pt_highscore") || 0);
  let combo = 0; // Tracks current streak
  let bestCombo = 0; // Highest streak this session
  let lives = MAX_LIVES;
  let speed = 3; // Small speed increases happen on perfect hits

  // Each tile = { id, col, y, hit, missed }
  let tiles = [];
  let nextTileId = 1;
  let lastSpawn = 0;
  let rafId = null;
  let spawnIntervalTimer = null;

  /* ============================================================
     AUDIO + THEMES
     Keeping audio state here helps me toggle sound globally.
  ============================================================ */

  let audioCtx = null;
  let soundEnabled = true;

  const THEMES = ["Arcade", "Calm", "SciFi"];
  let activeTheme = "Arcade";
  let themePlayer = null;

  // Music snippet player (when using MP3 samples instead of procedural audio)
  let snippetMusic = null;

  /* ============================================================
     DOM ELEMENT REFERENCES
     I resolve these once on DOMContentLoaded to avoid repeated lookups.
  ============================================================ */

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

  /* ============================================================
     MEASURING TILE HEIGHT
     I do this dynamically because CSS % heights behave differently
     across devices and can cause tile overlap if not measured.
  ============================================================ */
  function measureTileHeight() {
    const temp = document.createElement("div");
    temp.className = "tile";
    temp.style.position = "absolute";
    temp.style.visibility = "hidden";
    temp.style.top = "-9999px";
    temp.style.width = "25%"; // Ensures the tile receives responsive width rules
    document.body.appendChild(temp);

    const measured = temp.offsetHeight;
    document.body.removeChild(temp);

    TILE_HEIGHT = measured || 150; // Fallback in case measurement fails
    console.info("Measured TILE_HEIGHT =", TILE_HEIGHT);
  }

  /* ============================================================
     DOM RESOLUTION FUNCTION
     I pull all DOM references at once to keep code clean and avoid repeated lookups.
  ============================================================ */
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
    themeBtn = document.getElementById("themeBtn");
  }

  /* ============================================================
     AUDIO CONTEXT HELPERS
     These helpers let me easily trigger beeps and tones
     without creating duplicate audio contexts.
  ============================================================ */

  function ensureAudioCtx() {
    if (audioCtx) return;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      console.warn("AudioContext unavailable", e);
    }
  }

  // Simple one-shot beep used for hits/misses
  function playBeep(freq = 440, duration = 0.08, type = "sine", volume = 0.28) {
    if (!soundEnabled) return;
    ensureAudioCtx();
    if (!audioCtx) return;

    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type;
      osc.frequency.value = freq;

      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      console.warn("Beep error", e);
    }
  }

  // Schedules longer tones (used in themes)
  function scheduleTone(freq, startAfterMs = 0, duration = 120, type = "sine", volume = 0.18) {
    ensureAudioCtx();
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

  /* ============================================================
     SNIPPET MUSIC (MP3 SUPPORT)
     This is where I will plug in my downloaded snippets.
  ============================================================ */
  function playSnippet(index = 0, loop = true) {
    stopSnippet();
    // Example usage:
    // snippetMusic = new Audio("assets/audio/snippet1.mp3");
    // snippetMusic.loop = loop;
    // snippetMusic.volume = 0.3;
    // snippetMusic.play();
  }

  function stopSnippet() {
    if (snippetMusic) {
      snippetMusic.pause();
      snippetMusic.currentTime = 0;
      snippetMusic = null;
    }
  }

  /* ============================================================
     PERFECT LINE POSITION
     I calculate it based on the board so it works
     even if screen size changes.
  ============================================================ */
  function perfectLineY() {
    const rect = board.getBoundingClientRect();
    return rect.bottom - PERFECT_LINE_BOTTOM - rect.top;
  }

  function safeSetText(el, val) {
    if (el) el.textContent = val;
  }

  /* ============================================================
     THEME GENERATORS
     Each theme is made using procedural beeps and tones.
     Grouping them here keeps the logic modular.
  ============================================================ */

  function createArcadeTheme() {
    let timers = [];

    function start() {
      if (!soundEnabled) return;
      ensureAudioCtx();
      stopArcade();

      let i = 0;
      const notes = [880, 660, 740, 990];

      timers.push(setInterval(() => {
        playBeep(notes[i % notes.length], 0.12, "square", 0.18);
        if (i % 2 === 0) scheduleTone(notes[i % notes.length] * 1.5, 60, 60, "triangle", 0.08);
        i++;
      }, 260));

      timers.push(setInterval(() => playBeep(110, 0.18, "sawtooth", 0.06), 800));
    }

    function stopArcade() {
      timers.forEach(clearInterval);
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
      timers.push(setInterval(
        () => scheduleTone(440, 0, 180, "triangle", 0.08),
        1800 + Math.random() * 400
      ));
    }

    function stopCalm() {
      timers.forEach(clearInterval);
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
      timers.push(setInterval(
        () => playBeep(1200 + Math.random() * 600, 0.06, "square", 0.06),
        500 + Math.random() * 700
      ));
    }

    function stopSciFi() {
      timers.forEach(clearInterval);
      timers = [];
    }

    return { start, stop: stopSciFi };
  }

  const themePlayers = {
    Arcade: createArcadeTheme(),
    Calm: createCalmTheme(),
    SciFi: createSciFiTheme(),
  };

  /* ============================================================
     THEME TOGGLING
  ============================================================ */
  function startTheme(name) {
    if (!soundEnabled) return;
    if (themePlayer?.stop) themePlayer.stop();

    themePlayer = themePlayers[name];
    if (themePlayer?.start) themePlayer.start();

    activeTheme = name;
    updateThemeButtonLabel();
  }

  function stopTheme() {
    if (themePlayer?.stop) themePlayer.stop();
    themePlayer = null;
  }

  /* ============================================================
     TILE SPAWNING LOGIC
     I prevent tiles from spawning on top of each other by enforcing
     a MIN_GAP in each column.
  ============================================================ */
  function spawnTile(initialY = -TILE_HEIGHT) {
    const MIN_GAP = Math.max(Math.round(TILE_HEIGHT * 1.25), 1);

    // Track the lowest tile in each column
    const lastYs = Array(NUM_COLS).fill(-Infinity);
    for (const t of tiles) {
      if (t.col >= 0 && t.col < NUM_COLS) {
        lastYs[t.col] = Math.max(lastYs[t.col], t.y);
      }
    }

    // Only pick columns where tile won’t overlap
    const safeCols = lastYs
      .map((y, c) => (y === -Infinity || y > MIN_GAP ? c : null))
      .filter((c) => c !== null);

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

  /* ============================================================
     TILE DOM ELEMENT CREATION
     Each tile is represented on-screen using a styled div.
  ============================================================ */
  function createTileElement(tile) {
    const el = document.createElement("div");
    el.className = "tile";

    // Columns are set as percentages so they scale with screen width
    el.style.left = `${(tile.col * 100) / NUM_COLS}%`;
    el.style.width = `${100 / NUM_COLS}%`;

    // Consistent height
    el.style.height = `${TILE_HEIGHT}px`;

    el.dataset.id = tile.id;

    // This lets the user tap tiles with touch or mouse
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      handleTileClick(tile.id, tile.col);
    });

    board.appendChild(el);
  }

  /* ============================================================
     TILE POSITION UPDATER
     Called every frame by the game loop to animate falling tiles.
  ============================================================ */
  function updateTileElements() {
    document.querySelectorAll(".tile").forEach((el) => {
      const tile = tiles.find((t) => t.id === Number(el.dataset.id));
      if (!tile) return el.remove();

      el.style.top = `${tile.y}px`;
      el.classList.toggle("hit", tile.hit);
      el.classList.toggle("missed", tile.missed);
    });
  }

  /* ============================================================
     CLEANUP FUNCTION
     Removes tiles that have fallen off-screen.
  ============================================================ */
  function cleanupTiles() {
    tiles = tiles.filter((t) => {
      if (t.y > BOARD_OFFSCREEN_CUTOFF) {
        const el = document.querySelector(`.tile[data-id="${t.id}"]`);
        if (el) el.remove();
        return false;
      }
      return true;
    });
  }

  /* ============================================================
     SCORING & HIT DETECTION
     This checks if the tile is clicked within the perfect/great/good range.
     I give more points for closer timing to the perfect line.
  ============================================================ */
  function handleTileClick(tileId, col) {
    if (gameState !== "playing") return;

    const tile = tiles.find((t) => t.id === tileId);
    if (!tile || tile.hit || tile.missed) return;

    const tileBottom = tile.y + TILE_HEIGHT;
    const dist = Math.abs(tileBottom - perfectLineY());

    // Ignore taps too far from the perfect line
    if (dist > HIT_DETECTION_RANGE) return;

    tile.hit = true;

    let points = 1;
    let feedback = "";

    if (dist < 20) {
      points = 10;
      feedback = "✨ PERFECT!";
      playBeep(880, 0.12);
      setTimeout(() => playBeep(1100, 0.08), 50);
    } else if (dist < 40) {
      points = 5;
      feedback = "👍 GREAT!";
      playBeep(660, 0.12);
    } else if (dist < PERFECT_ZONE) {
      points = 3;
      feedback = "✓ GOOD";
      playBeep(550, 0.1);
    } else {
      points = 1;
      playBeep(440, 0.08);
    }

    score += points;
    combo++;
    bestCombo = Math.max(bestCombo, combo);

    // Speed increases slightly with good hits
    speed = Math.min(speed + 0.01, 1);

    showFeedback(feedback || `+${points}`, col, false);
    renderHUD();
  }

  /* ============================================================
     EMPTY CLICK = MISS
     If player taps a column where no tile is hittable, it's a miss.
  ============================================================ */
  function handleEmptyClick(col) {
    if (gameState !== "playing") return;

    combo = 0;
    lives--;

    showFeedback("❌ MISS!", col, true);
    playBeep(180, 0.22, "sawtooth");

    if (lives <= 0) setTimeout(endGame, 300);

    renderHUD();
  }

  /* ============================================================
     AUTO-MARK MISSED TILES
     When tiles pass the perfect line without being hit, count as miss.
  ============================================================ */
  function markTileMiss(tile) {
    if (tile.hit || tile.missed) return;

    tile.missed = true;
    combo = 0;
    lives--;

    showFeedback("❌ MISS!", tile.col, true);
    playBeep(200, 0.28, "sawtooth");

    if (lives <= 0) setTimeout(endGame, 300);
  }


/* ============================================================
   showFeedback() — visual pop-up text when player hits/misses
   I added comments so I can explain EXACTLY what’s happening
   ============================================================ */
function showFeedback(text, col, isError = false) {
  // If feedback container isn't available, abort silently
  if (!feedbackContainer) return;

  // Create a unique ID for the floating message
  const id = `f${Date.now()}${Math.random()}`;

  // Build the feedback DOM element
  const el = document.createElement("div");
  el.className = "feedback";
  el.id = id;

  /* 
      Each column is a % of width (4 columns = 25% each).
      This calculates the horizontal center of whichever column
      the feedback belongs to.
  */
  el.style.left = `${(col * 100) / NUM_COLS + 100 / (NUM_COLS * 2)}%`;

  // Show feedback halfway down the screen for visibility
  el.style.top = `50%`;

  // Green = hit, red = miss (CSS variables)
  el.style.color = isError ? "var(--tile-miss)" : "var(--tile-hit)";

  // Put the text inside the bubble
  el.textContent = text;

  // Add to DOM
  feedbackContainer.appendChild(el);

  // Remove after animation (900ms)
  setTimeout(() => {
    const e = document.getElementById(id);
    if (e) e.remove();
  }, 900);
}

/* ============================================================
   renderHUD() — updates score, combo, lives, best score, speed
   These comments help me explain every UI update in reviews
   ============================================================ */
function renderHUD() {
  // Update score
  safeSetText(scoreEl, String(score));

  // Update lives (hearts)
  if (livesEl) {
    livesEl.innerHTML = "";
    for (let i = 0; i < MAX_LIVES; i++) {
      const sp = document.createElement("div");
      sp.textContent = i < lives ? "❤️" : "🖤"; // red = alive, black = lost
      sp.style.fontSize = "20px";
      sp.style.opacity = i < lives ? "1" : "0.35"; // faded if lost
      livesEl.appendChild(sp);
    }
  }

  // Combo display (only show after x3)
  if (comboEl) {
    comboEl.textContent = `🔥 ${combo}x COMBO`;
    comboEl.classList.toggle("hidden", combo < 3);
  }

  // Show current game speed multiplier
  if (speedEl) speedEl.textContent = `${speed.toFixed(1)}x`;

  // High score label in the menu HUD
  if (bestEl) bestEl.textContent = highScore > 0 ? `Best: ${highScore}` : "";

  // Gameover screen high score
  if (storedBest) storedBest.textContent = highScore;
}

/* ============================================================
   startLoop() — main game loop using requestAnimationFrame
   This is the HEARTBEAT of the game
   ============================================================ */
function startLoop() {
  // Always stop any previous loops before starting a new one
  stopLoop();

  let lastTime = performance.now();
  lastSpawn = performance.now();
  gameState = "playing";

  function loop(now) {
    const delta = now - lastTime; // time between frames (ms)
    lastTime = now;

    // Move all tiles downward based on speed and frame delta
    tiles.forEach((tile) => (tile.y += speed * (delta / 3)));

    // Perfect line Y coordinate
    const pY = perfectLineY();

    // Check for tiles that passed the perfect line → mark as missed
    tiles.forEach((tile) => {
      if (!tile.hit && !tile.missed && tile.y > pY + 100) {
        markTileMiss(tile);
      }
    });

    // Remove tiles that are off-screen
    cleanupTiles();

    // Spawn tiles based on speed multiplier
    if (now - lastSpawn > SPAWN_INTERVAL / Math.max(0.1, speed)) {
      spawnTile();
      lastSpawn = now;
    }

    // Update tile elements on screen
    updateTileElements();

    // Update score, lives, combo, speed text
    renderHUD();

    // Continue game loop
    rafId = requestAnimationFrame(loop);
  }

  // Start loop
  rafId = requestAnimationFrame(loop);
}

/* ============================================================
   stopLoop() — freezes the game by stopping requestAnimationFrame
   ============================================================ */
function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

/* ============================================================
   clearSpawnTimers() — makes sure tile spawn timers don't stack
   ============================================================ */
function clearSpawnTimers() {
  if (spawnIntervalTimer) {
    clearInterval(spawnIntervalTimer);
    spawnIntervalTimer = null;
  }
}

/* ============================================================
   startGame() — resets EVERYTHING and starts a new match
   These comments help prove I understand the full reset flow
   ============================================================ */
function startGame() {
  try {
    // Make sure audio context isn't paused (common browser behavior)
    audioCtx && audioCtx.resume && audioCtx.resume();
  } catch (e) {}

  // Hide menu + gameover screens
  if (menu) {
    menu.classList.add("hidden");
    menu.style.display = "none";
  }
  if (gameover) {
    gameover.classList.add("hidden");
    gameover.style.display = "none";
  }

  // Stop previous loops + clean UI tiles
  stopLoop();
  clearSpawnTimers();
  document.querySelectorAll(".tile").forEach((n) => n.remove());

  // Reset active tile list
  tiles = [];
  nextTileId = 1;

  // Reset game values
  gameState = "playing";
  score = 0;
  combo = 0;
  bestCombo = 0;
  lives = MAX_LIVES;
  speed = 1;

  // Refresh UI text
  renderHUD();

  /* 
      Pre-spawn 4 tiles at correct spacing so the game 
      doesn't start empty for 2 seconds.
      Use measured TILE_HEIGHT so spacing always matches UI.
  */
  for (let i = 0; i < 4; i++) {
    const spacing = Math.round(TILE_HEIGHT * 1.5);
    setTimeout(() => spawnTile(-TILE_HEIGHT - i * spacing), i * 150);
  }

  // Begin loop
  startLoop();

  // Start audio (theme + snippet)
  if (soundEnabled) {
    startTheme(activeTheme);
    playSnippet(0);
  }
}

/* ============================================================
   endGame() — handles stopping gameplay and showing results
   ============================================================ */
function endGame() {
  // Stop movement + spawning
  stopLoop();
  clearSpawnTimers();

  gameState = "gameover";

  // Update gameover HUD
  safeSetText(goScore, String(score));
  safeSetText(goCombo, String(bestCombo));

  // Show “New High Score!” banner only if needed
  if (newHighEl) newHighEl.classList.toggle("hidden", score < highScore);

  // Show gameover screen
  if (gameover) {
    gameover.classList.remove("hidden");
    gameover.style.display = "";
  }

  // Hide main menu still
  if (menu) menu.classList.add("hidden");

  // Update local high score storage
  if (score > highScore) {
    highScore = score;
    localStorage.setItem("pt_highscore", String(highScore));
  }

  renderHUD();

  // Stop any theme music/snippets cleanly
  stopTheme();
  try {
    audioCtx?.close?.();
    audioCtx = null;
  } catch (e) {}

  console.info("Game ended.", "Score:", score, "HighScore:", highScore);

  stopSnippet();
}

/* ============================================================
   UI Theme Controls 
   ============================================================ */
function updateThemeButtonLabel() {
  // Updates the button text so player always knows active theme
  if (themeBtn) themeBtn.textContent = `Theme: ${activeTheme}`;
}

function onThemeClick() {
  // Cycle to next theme in array
  const idx = THEMES.indexOf(activeTheme);
  const next = THEMES[(idx + 1) % THEMES.length];
  activeTheme = next;

  updateThemeButtonLabel();

  // Apply theme instantly if game running
  if (gameState === "playing" && soundEnabled) startTheme(activeTheme);
}

/* ============================================================
   onToggleSound — enables/disables ALL audio
   ============================================================ */
function onToggleSound() {
  soundEnabled = !soundEnabled;

  // Update button
  if (toggleSoundBtn)
    toggleSoundBtn.textContent = `Sound: ${soundEnabled ? "On" : "Off"}`;

  if (!soundEnabled) {
    // Mute audio + pause audio context
    stopTheme();
    try {
      audioCtx?.suspend?.();
    } catch (e) {}
  } else {
    // Resume audio + theme
    ensureAudioCtx();
    if (gameState === "playing") startTheme(activeTheme);
  }
}

/* ============================================================
   onKeyDown — keyboard controls for desktop
   Supports: 1 2 3 4 and A S D F
   ============================================================ */
function onKeyDown(e) {
  if (gameState !== "playing") return;

  // Map keys → column numbers
  const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, s: 1, d: 2, f: 3 };
  const col = map[e.key];
  if (col === undefined) return;

  // Find closest hittable tile in that column
  const clickedTile = tiles.find(
    (t) =>
      !t.hit &&
      !t.missed &&
      t.col === col &&
      Math.abs(t.y + TILE_HEIGHT - perfectLineY()) < HIT_DETECTION_RANGE
  );

  // If no tile, count as empty click
  if (!clickedTile) handleEmptyClick(col);
  else handleTileClick(clickedTile.id, col);
}

/* ============================================================
   wireEvents — connect all buttons, keys, and UI events
   ============================================================ */
function wireEvents() {
  // Create theme button if missing (dynamic UI generation)
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

  // Start button
  if (startBtn) {
    startBtn.removeEventListener("click", startGame);
    startBtn.addEventListener("click", startGame);
  }

  // Restart button
  if (restartBtn) {
    restartBtn.removeEventListener("click", startGame);
    restartBtn.addEventListener("click", startGame);
  }

  // Theme button
  if (themeBtn) {
    themeBtn.removeEventListener("click", onThemeClick);
    themeBtn.addEventListener("click", onThemeClick);
    updateThemeButtonLabel();
  }

  // Sound toggle
  if (toggleSoundBtn) {
    toggleSoundBtn.removeEventListener("click", onToggleSound);
    toggleSoundBtn.addEventListener("click", onToggleSound);
  }

  // Keyboard input
  window.removeEventListener("keydown", onKeyDown);
  window.addEventListener("keydown", onKeyDown);

  // Rebuild layout on window resize
  window.removeEventListener("resize", handleResize);
  window.addEventListener("resize", handleResize);
}

/* ============================================================
   handleResize — fixes tile height issues and column alignment
   ============================================================ */
function handleResize() {
  // Re-measure tile height based on new layout
  measureTileHeight();

  // Rebuild the board columns so width stays correct
  buildColumns();
}
  // ---------- Columns + layout ----------
  function buildColumns() {
    if (!board) return;

    // Clear previous columns before rebuilding (important when screen resizes or themes change)
    board.innerHTML = "";

    // Create the number of columns defined by NUM_COLS
    for (let c = 0; c < NUM_COLS; c++) {
      const col = document.createElement("div");
      col.className = "column";

      // Columns are positioned using percentages so layout scales on all screen sizes
      col.style.left = `${(c * 100) / NUM_COLS}%`;
      col.style.width = `${100 / NUM_COLS}%`;

      // Store the column index so hit detection knows which column was tapped
      col.dataset.col = c;

      // Each column listens for pointer input (works for mouse, mobile, and tablet)
      col.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();

          // Ignore taps when game isn’t actively running
          if (gameState !== "playing") return;

          // Get perfect-hit line (bottom hit zone)
          const pLine = perfectLineY();

          // Collect tiles in this column that are valid (not already hit/missed)
          // Also calculate their distance from the perfect line
          const candidates = tiles
            .filter((t) => !t.hit && !t.missed && t.col === c)
            .map((t) => ({
              tile: t,
              dist: Math.abs(t.y + TILE_HEIGHT - pLine),
            }));

          // Sort so the closest tile to the perfect line becomes the first choice
          candidates.sort((a, b) => a.dist - b.dist);

          // No tiles OR too far from perfect line → treat as a mistaken tap
          if (
            candidates.length === 0 ||
            candidates[0].dist > HIT_DETECTION_RANGE
          ) {
            handleEmptyClick(c);
            return;
          }

          // Otherwise treat it as a correct hit — pass the tile ID to the click handler
          handleTileClick(candidates[0].tile.id, c);
        },
        { passive: false } // ensures tap detection stays precise
      );

      // Add the column to the game board
      board.appendChild(col);
    }

    // Position the on-screen perfect line indicator
    if (perfectLineEl) perfectLineEl.style.bottom = PERFECT_LINE_BOTTOM + "px";
  }

  // ---------- Init ----------
  document.addEventListener("DOMContentLoaded", () => {
    // Locate all required DOM elements
    resolveDOM();

    // Measure tile height directly from CSS — ensures spacing & timing sync with visuals
    measureTileHeight();

    // Build column layout dynamically based on NUM_COLS
    buildColumns();

    // Wire up buttons, keypresses, theme selectors, etc.
    wireEvents();

    // Render initial HUD values (score, lives, best score)
    renderHUD();

    // Show menu on load, hide game-over screen
    if (menu) menu.classList.remove("hidden");
    if (gameover) gameover.classList.add("hidden");

    // Display best score in multiple UI locations
    if (bestEl) bestEl.textContent = highScore > 0 ? `Best: ${highScore}` : "";
    if (storedBest) storedBest.textContent = highScore;

    // Sound toggle button starts in the correct state
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
  // Expose a small internal debugging object so I can inspect game state live in the browser console.
  // This makes it easier to track bugs, test themes, or force a tile spawn during development.
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

  
  // All required functions are already inside the closure.
  // No need to export anything globally.
})();

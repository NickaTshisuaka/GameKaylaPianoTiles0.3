// === MAGIC PIANO TILES – BEAT SYNC + HEARTS & MISS INDICATORS ===

// === GAME STATE ===
let score = 0;
let combo = 0;
let bestCombo = 0;
let highScore = parseInt(localStorage.getItem('pianoTilesHighScore')) || 0;

let speed = 2;
let gameActive = false;
let gameOver = false;

const MAX_LIVES = 3;
let lives = MAX_LIVES;
let fallbackInterval = null;

// === TILE/COLUMN MANAGEMENT ===
const NUM_COLS = 4;
let activeTiles = [false, false, false, false]; 
let previousColumn = -1;

// === AUDIO ===
let audioCtx = null;
let musicSource = null;
let analyser = null;
let dataArray = null;
let musicBuffer = null;
let musicLoaded = false;

// === BEAT DETECTION ===
let beatThreshold = 130;
let lastBeatTime = 0;
const BEAT_COOLDOWN = 250; // ms
let beatTimes = [];
let averageBeatInterval = 0;

// === DEBUG VISUALIZER ===
let debugCanvas, debugCtx;
function setupDebugOverlay() {
    debugCanvas = document.createElement('canvas');
    debugCanvas.width = 400;
    debugCanvas.height = 80;
    debugCanvas.style.position = 'absolute';
    debugCanvas.style.bottom = '0';
    debugCanvas.style.left = '50%';
    debugCanvas.style.transform = 'translateX(-50%)';
    debugCanvas.style.zIndex = '200';
    debugCanvas.style.opacity = '0.8';
    document.body.appendChild(debugCanvas);
    debugCtx = debugCanvas.getContext('2d');
}
setupDebugOverlay();

// === CACHED DOM ===
const container = document.getElementById('gameContainer');
const board = document.getElementById('gameBoard');
const livesContainer = document.getElementById('livesContainer');

// === HEART/LIVES SYSTEM ===
function initLives() {
    livesContainer.innerHTML = '';
    for (let i = 0; i < MAX_LIVES; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart';
        heart.textContent = '❤️';
        livesContainer.appendChild(heart);
    }
}

function loseLife() {
    if (lives <= 0) return;
    const heartEl = livesContainer.children[lives - 1];
    heartEl.textContent = '🖤';
    heartEl.classList.add('lost');
    lives--;

    livesContainer.classList.add('shake');
    setTimeout(() => livesContainer.classList.remove('shake'), 300);

    if (lives <= 0) setTimeout(() => endGame(), 500);
}

function flashHearts() {
    livesContainer.classList.add('flash');
    setTimeout(() => livesContainer.classList.remove('flash'), 200);
}

// Initialize hearts
initLives();

// === AUDIO SYSTEM ===
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playBeep(freq = 440, duration = 0.1, type = 'sine') {
    initAudio();
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = freq;
        osc.type = type;
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
        console.warn('Audio error:', e);
    }
}

async function loadMusic() {
    initAudio();
    try {
        const response = await fetch('music/beat.mp3');
        const arrayBuffer = await response.arrayBuffer();
        musicBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        musicLoaded = true;
        console.log('🎵 Music loaded! Duration:', musicBuffer.duration, 'seconds');
        return true;
    } catch (error) {
        console.log('❌ Music not found - using fallback timer');
        musicLoaded = false;
        return false;
    }
}

function playMusic() {
    if (!musicLoaded || !musicBuffer) return;
    initAudio();
    stopMusic();

    musicSource = audioCtx.createBufferSource();
    musicSource.buffer = musicBuffer;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    dataArray = new Uint8Array(analyser.frequencyBinCount);

    musicSource.connect(analyser);
    analyser.connect(audioCtx.destination);

    musicSource.onended = () => {
        if (gameActive && !gameOver) gameComplete();
    };

    musicSource.start(0);
    console.log('🎶 Music is playing...');
    detectBeats();
}

function stopMusic() {
    try {
        if (musicSource) {
            musicSource.onended = null;
            musicSource.stop();
            musicSource.disconnect();
            musicSource = null;
        }
    } catch {}
    if (analyser) {
        try { analyser.disconnect(); } catch {}
        analyser = null;
    }
    if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
    }
    console.log('🔇 Music stopped');
}

// === BEAT DETECTION ===
function detectBeats() {
    if (!gameActive || gameOver || !analyser) return;
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < 20; i++) sum += dataArray[i];
    const bassAvg = sum / 20;

    const now = performance.now();

    if (bassAvg > beatThreshold && (now - lastBeatTime) > BEAT_COOLDOWN) {
        const interval = now - lastBeatTime;
        lastBeatTime = now;

        beatTimes.push(interval);
        if (beatTimes.length > 6) beatTimes.shift();
        averageBeatInterval = beatTimes.reduce((a, b) => a + b, 0) / beatTimes.length || 600;

        const predictedNextBeat = now + averageBeatInterval;
        const TILE_FALL_DURATION = 1000;
        const spawnDelay = Math.max(predictedNextBeat - now - TILE_FALL_DURATION, 0);

        setTimeout(() => {
            if (gameActive && !gameOver) spawnTile();
        }, spawnDelay);

        drawDebugPulse();
        const oldThreshold = beatThreshold;
        beatThreshold = 200;
        setTimeout(() => (beatThreshold = oldThreshold), 200);
    }

    drawVisualizer();
    requestAnimationFrame(detectBeats);
}

// === DEBUG VISUALIZER ===
function drawVisualizer() {
    if (!debugCtx || !analyser) return;
    const WIDTH = debugCanvas.width;
    const HEIGHT = debugCanvas.height;

    analyser.getByteFrequencyData(dataArray);
    debugCtx.fillStyle = "rgba(0,0,0,0.3)";
    debugCtx.fillRect(0, 0, WIDTH, HEIGHT);

    const barWidth = (WIDTH / dataArray.length) * 3;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
        const barHeight = dataArray[i] / 3;
        debugCtx.fillStyle = `hsl(${i * 2}, 70%, 60%)`;
        debugCtx.fillRect(x, HEIGHT - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }

    debugCtx.fillStyle = "white";
    debugCtx.font = "14px Arial";
    const bpm = (60000 / averageBeatInterval).toFixed(1);
    debugCtx.fillText(`Tempo: ${bpm} BPM`, 10, 18);
}

function drawDebugPulse() {
    if (!debugCtx) return;
    const WIDTH = debugCanvas.width;
    const HEIGHT = debugCanvas.height;
    const radius = 20;

    debugCtx.beginPath();
    debugCtx.arc(WIDTH - 40, HEIGHT / 2, radius, 0, Math.PI * 2);
    debugCtx.fillStyle = "rgba(255, 255, 0, 0.7)";
    debugCtx.fill();
    setTimeout(() => {
        debugCtx.clearRect(WIDTH - 70, 0, 70, HEIGHT);
    }, 180);
}

// === TILE MANAGEMENT ===
function spawnTile() {
    if (!gameActive || gameOver) return;
    const available = [];
    for (let i = 0; i < NUM_COLS; i++) if (!activeTiles[i]) available.push(i);
    if (available.length === 0) return;

    let col = available[Math.floor(Math.random() * available.length)];
    if (available.length > 1 && col === previousColumn) {
        const others = available.filter(c => c !== previousColumn);
        if (others.length > 0) col = others[Math.floor(Math.random() * others.length)];
    }
    previousColumn = col;
    activeTiles[col] = true;

    const columnEl = board.querySelector(`.column[data-col="${col}"]`);
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.top = '-150px';
    tile.dataset.hit = 'false';
    tile.dataset.col = col;
    columnEl.appendChild(tile);
    tile.addEventListener('click', () => handleTileClick(tile, col));
    animateTile(tile, col);
}

function animateTile(tile, col) {
    let position = -150;
    const perfectLine = document.getElementById('perfectLine');
    const perfectY = perfectLine ? perfectLine.getBoundingClientRect().top : 500;

    function move() {
        if (gameOver || !tile.parentElement) {
            cleanupTile(tile, col);
            return;
        }
        position += speed;
        tile.style.top = position + 'px';
        const tileBottom = tile.getBoundingClientRect().bottom;
        if (tileBottom > perfectY + 50 && tile.dataset.hit === 'false') {
            handleMiss(tile, col);
            return;
        }
        if (position > 800) {
            cleanupTile(tile, col);
            return;
        }
        requestAnimationFrame(move);
    }
    requestAnimationFrame(move);
}

function cleanupTile(tile, col) {
    try { if (tile && tile.parentElement) tile.remove(); } catch {}
    if (col >= 0 && col < NUM_COLS) activeTiles[col] = false;
}

// === TILE CLICK HANDLING ===
function handleTileClick(tile, col) {
    if (!gameActive || gameOver) return;
    if (tile.dataset.hit === 'true') return;

    tile.dataset.hit = 'true';
    tile.classList.add('hit');
    
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    
    const tileBottom = tile.getBoundingClientRect().bottom;
    const perfectLine = document.getElementById('perfectLine');
    const perfectY = perfectLine ? perfectLine.getBoundingClientRect().top : 500;
    const distance = Math.abs(tileBottom - perfectY);
    
    if (distance < 30) {
        score += 5;
        const tileRect = tile.getBoundingClientRect();
        showPopup('✨ PERFECT!', tileRect.top - 50, '#00ff88');
        flashHearts();
        spawnParticles(tileRect.left + tileRect.width/2, tileRect.top + tileRect.height/2);
        playBeep(880, 0.15);
        setTimeout(() => playBeep(1100, 0.1), 50);
    } else {
        score += 1;
        playBeep(440 + combo * 20, 0.1);
    }
    
    updateScore();
    updateCombo();
    
    activeTiles[col] = false;
    tile.remove();
    speed += 0.02;
}

// === HANDLE MISS ===
function handleMiss(tile, col) {
    if (tile.dataset.missed) return;
    tile.dataset.missed = 'true';
    tile.classList.add('missed');

    const rect = tile.getBoundingClientRect();
    showPopup('❌ MISSED!', rect.top, '#ff4444');

    combo = 0;
    updateCombo();

    playBeep(200, 0.3, 'sawtooth');

    cleanupTile(tile, col);
    loseLife();
}

// === EMPTY SPACE CLICK ===
board.addEventListener('click', (e) => {
    if (!gameActive || gameOver) return;

    if (!e.target.classList.contains('tile')) {
        // Determine clicked column
        const rect = board.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const col = Math.floor(clickX / (rect.width / NUM_COLS));

        // Flash red block
        const columnEl = board.querySelector(`.column[data-col="${col}"]`);
        const flash = document.createElement('div');
        flash.className = 'tile missed';
        flash.style.top = '500px';
        flash.style.backgroundColor = 'red';
        columnEl.appendChild(flash);
        setTimeout(() => flash.remove(), 300);

        combo = 0;
        updateCombo();
        playBeep(180, 0.12, 'sawtooth');
        showPopup('❌ WRONG!', e.clientY, '#ff4444');
        loseLife();
    }
});

// === PARTICLE SYSTEM ===
function spawnParticles(x, y, color = '#00ff88', count = 10) {
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        particle.style.backgroundColor = color;
        document.body.appendChild(particle);

        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;

        const lifetime = 500;
        const start = performance.now();

        function move() {
            const now = performance.now();
            const dt = now - start;
            if (dt > lifetime) {
                particle.remove();
                return;
            }
            particle.style.left = x + vx * (dt / 20) + 'px';
            particle.style.top = y + vy * (dt / 20) + 'px';
            requestAnimationFrame(move);
        }
        move();
    }
}

// === UI UPDATES ===
function updateScore() {
    document.getElementById('score').textContent = score;
    document.getElementById('speedIndicator').textContent = `Speed: ${speed.toFixed(1)}x`;
    if (score > highScore) {
        highScore = score;
        localStorage.setItem('pianoTilesHighScore', highScore);
    }
    document.getElementById('highScore').textContent = `Best: ${highScore}`;
}

function updateCombo() {
    const comboEl = document.getElementById('combo');
    if (combo >= 3) {
        comboEl.textContent = `🔥 ${combo}x Combo!`;
        comboEl.classList.add('show');
    } else {
        comboEl.classList.remove('show');
    }
}

function showPopup(text, y, color = '#fff') {
    const popup = document.createElement('div');
    popup.className = 'popup';
    popup.textContent = text;
    popup.style.position = 'absolute';
    popup.style.left = '50%';
    popup.style.top = y + 'px';
    popup.style.transform = 'translateX(-50%)';
    popup.style.color = color;
    popup.style.fontSize = '24px';
    popup.style.fontWeight = 'bold';
    popup.style.zIndex = '150';
    popup.style.pointerEvents = 'none';
    popup.style.animation = 'popupFade 1s forwards';
    
    container.appendChild(popup);
    setTimeout(() => popup.remove(), 1000);
}

// === GAME FLOW ===
async function startGame() {
    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('gameOverScreen').classList.remove('show');

    gameActive = true;
    gameOver = false;
    score = 0;
    combo = 0;
    bestCombo = 0;
    lives = MAX_LIVES;
    speed = 2;
    activeTiles = [false, false, false, false];
    previousColumn = -1;

    document.querySelectorAll('.tile').forEach(t => t.remove());
    initLives();
    updateScore();
    updateCombo();

    if (!musicLoaded) await loadMusic();

    if (musicLoaded) {
        playMusic();
    } else {
        fallbackInterval = setInterval(() => {
            if (gameActive && !gameOver) spawnTile();
        }, 700);
    }
}

function endGame() {
    if (gameOver) return;
    gameOver = true;
    gameActive = false;
    stopMusic();

    updateScore();

    setTimeout(() => {
        document.getElementById('finalScore').textContent = score;
        document.getElementById('finalCombo').textContent = bestCombo;
        document.getElementById('finalHighScore').textContent = highScore;
        document.getElementById('gameOverScreen').classList.add('show');
    }, 500);
}

function gameComplete() {
    if (gameOver) return;
    gameOver = true;
    gameActive = false;
    stopMusic();

    updateScore();

    setTimeout(() => {
        document.getElementById('finalScore').textContent = score;
        document.getElementById('finalCombo').textContent = bestCombo;
        document.getElementById('finalHighScore').textContent = highScore;

        const gameOverScreen = document.getElementById('gameOverScreen');
        const title = gameOverScreen.querySelector('h1');
        if (title) title.textContent = '🎉 Song Complete!';
        gameOverScreen.classList.add('show');
    }, 500);
}

function restartGame() {
    document.getElementById('gameOverScreen').classList.remove('show');
    startGame();
}

// === INITIALIZATION ===
updateScore();
initLives();

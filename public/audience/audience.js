// =============================================
// VARIABLES GLOBALES
// =============================================
let userName = '';
let handRaised = false;
let gestureDetectionActive = false;
let hasVoted = false;

// MediaPipe
let hands = null;
let camera = null;

// Control anti-repetición del gesto
let lastHandGesture = '';
let handGestureTimeout = null;
const HAND_GESTURE_COOLDOWN = 2000;

// Dibujo recibido del presentador
let lastReceivedPoint = null;

// =============================================
// INICIALIZACIÓN
// =============================================
window.addEventListener('load', () => {
    // El modal de nombre bloquea todo hasta que el usuario confirme
    document.getElementById('name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') confirmName();
    });
});

// =============================================
// MODAL DE NOMBRE
// =============================================
function confirmName() {
    const input = document.getElementById('name-input').value.trim();
    if (!input) {
        document.getElementById('name-input').focus();
        return;
    }
    userName = input;
    document.getElementById('name-modal').style.display = 'none';

    // Arrancar todo una vez tenemos nombre
    initSocketListeners();
    initCamera();
    initDrawingCanvas();
    addNotification(`Bienvenido, ${userName} 👋`, false);
}

// =============================================
// CÁMARA Y MEDIAPIPE
// =============================================
function initCamera() {
    const videoEl = document.getElementById('camera-feed');
    const canvasEl = document.getElementById('gesture-canvas');
    const ctx = canvasEl.getContext('2d');

    hands = new Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
    });

    hands.onResults((results) => {
        // Ajustar canvas al tamaño real del video
        canvasEl.width  = videoEl.videoWidth  || canvasEl.offsetWidth;
        canvasEl.height = videoEl.videoHeight || canvasEl.offsetHeight;
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];

            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#f39c12', lineWidth: 2 });
            drawLandmarks(ctx, landmarks, { color: '#fff', lineWidth: 1, radius: 3 });

            if (gestureDetectionActive) {
                processAudienceGesture(landmarks);
            }
        }
    });

    camera = new Camera(videoEl, {
        onFrame: async () => {
            await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480,
    });

    camera.start()
        .then(() => {
            gestureDetectionActive = true;
            document.getElementById('status-gesture-detect').textContent = '👋 Detección: ON';
            document.getElementById('status-gesture-detect').classList.add('active');
        })
        .catch((err) => {
            addNotification('Error al iniciar cámara: ' + err.message, true);
        });
}

// =============================================
// DETECCIÓN DE GESTO — LEVANTAR MANO
// =============================================
function processAudienceGesture(landmarks) {
    const gesture = detectAudienceGesture(landmarks);

    if (gesture && gesture !== lastHandGesture) {
        lastHandGesture = gesture;
        clearTimeout(handGestureTimeout);
        handGestureTimeout = setTimeout(() => { lastHandGesture = ''; }, HAND_GESTURE_COOLDOWN);

        if (gesture === 'hand_up') {
            if (!handRaised) {
                raiseHand();
            }
        }

        if (gesture === 'fist') {
            if (handRaised) {
                lowerHand();
            }
        }
    }
}

function detectAudienceGesture(lm) {
    const thumbUp  = lm[4].y  < lm[3].y;
    const indexUp  = lm[8].y  < lm[6].y;
    const middleUp = lm[12].y < lm[10].y;
    const ringUp   = lm[16].y < lm[14].y;
    const pinkyUp  = lm[20].y < lm[18].y;

    // MANO ABIERTA (todos los dedos arriba) → levantar mano
    if (thumbUp && indexUp && middleUp && ringUp && pinkyUp) return 'hand_up';

    // PUÑO (ningún dedo arriba) → bajar mano
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) return 'fist';

    return null;
}

// =============================================
// LEVANTAR / BAJAR MANO
// =============================================
function toggleHandRaise() {
    if (!handRaised) {
        raiseHand();
    } else {
        lowerHand();
    }
}

function raiseHand() {
    handRaised = true;
    emitRaiseHand(userName);

    const btn = document.getElementById('btn-hand');
    const status = document.getElementById('status-hand');
    btn.textContent = '✋ Bajar mano';
    btn.classList.add('active');
    status.textContent = '✋ Mano: ON';
    status.classList.add('active');

    addNotification('✋ Mano levantada — el presentador ha sido notificado', false);
}

function lowerHand() {
    handRaised = false;
    emitLowerHand();

    const btn = document.getElementById('btn-hand');
    const status = document.getElementById('status-hand');
    btn.textContent = '✋ Levantar mano';
    btn.classList.remove('active');
    status.textContent = '✋ Mano: OFF';
    status.classList.remove('active');
}

// =============================================
// CANVAS DE DIBUJO (recibido del presentador)
// =============================================
function initDrawingCanvas() {
    const canvas = document.getElementById('draw-canvas');
    const container = document.getElementById('slide-container');

    const resize = () => {
        canvas.width  = container.offsetWidth;
        canvas.height = container.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);
}

function applyDrawPoint(data) {
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');

    // Convertir coordenadas normalizadas (0-1) a píxeles del canvas
    const x = data.x * canvas.width;
    const y = data.y * canvas.height;

    ctx.strokeStyle = data.color || '#ff4757';
    ctx.lineWidth   = data.width || 4;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    if (data.isStart || !lastReceivedPoint) {
        ctx.beginPath();
        ctx.moveTo(x, y);
    } else {
        ctx.beginPath();
        ctx.moveTo(lastReceivedPoint.x, lastReceivedPoint.y);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    lastReceivedPoint = { x, y };
}

function clearDrawingCanvas() {
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    lastReceivedPoint = null;
}

// =============================================
// ENCUESTA
// =============================================
function renderPoll(poll, results) {
    const section  = document.getElementById('poll-section');
    const question = document.getElementById('poll-question');
    const options  = document.getElementById('poll-options');
    const resultsEl = document.getElementById('poll-results');
    const votedMsg = document.getElementById('poll-voted-msg');

    section.style.display = 'flex';
    question.textContent = poll.question;
    options.innerHTML = '';
    resultsEl.innerHTML = '';
    votedMsg.style.display = 'none';
    hasVoted = false;

    poll.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.onclick = () => votePoll(opt);
        options.appendChild(btn);
    });

    if (results) renderPollResults(results);
}

function votePoll(option) {
    if (hasVoted) return;
    hasVoted = true;
    emitPollVote(option);

    // Deshabilitar todos los botones tras votar
    document.querySelectorAll('#poll-options button').forEach(btn => {
        btn.disabled = true;
    });

    document.getElementById('poll-voted-msg').style.display = 'block';
    addNotification(`📊 Votaste: ${option}`, false);
}

function renderPollResults(results, total) {
    const container = document.getElementById('poll-results');
    container.innerHTML = '';

    const totalVotes = total || Object.values(results).reduce((a, b) => a + b, 0);

    Object.entries(results).forEach(([option, count]) => {
        const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
        const el = document.createElement('div');
        el.className = 'poll-result-item';
        el.innerHTML = `
            <div class="poll-option-label">${option}</div>
            <div class="poll-bar-wrap">
                <div class="poll-bar" style="width:${pct}%"></div>
            </div>
            <div class="poll-count">${count} (${pct}%)</div>
        `;
        container.appendChild(el);
    });

    if (totalVotes > 0) {
        const totalEl = document.createElement('div');
        totalEl.className = 'poll-total';
        totalEl.textContent = `Total: ${totalVotes} votos`;
        container.appendChild(totalEl);
    }
}

function closePoll(results) {
    renderPollResults(results);
    document.querySelectorAll('#poll-options button').forEach(btn => {
        btn.disabled = true;
    });
    addNotification('📊 Encuesta finalizada', false);
}

// =============================================
// SOCKET LISTENERS
// =============================================
function initSocketListeners() {

    // ─── DIAPOSITIVAS ─────────────────────────────────────────
    socket.on('presentation-state', (data) => {
        // Cargar diapositiva actual al conectarse
        if (data.totalSlides > 0) {
            const img = document.getElementById('slide-img');
            img.src = `/slides/slide${data.currentSlide + 1}.jpg`;
        }
        updateSlideCounter(data.currentSlide, data.totalSlides);
        updatePresentingStatus(data.isPresenting);

        if (data.zoomActive) {
            document.getElementById('zoom-overlay').style.display = 'block';
        }
        if (data.currentPoll) {
            renderPoll(data.currentPoll, data.pollResults);
        }
    });

    socket.on('slide-changed', (data) => {
        const img = document.getElementById('slide-img');
        img.src = `/slides/slide${data.slide + 1}.jpg`;
        updateSlideCounter(data.slide, null);
        clearDrawingCanvas();
    });

    socket.on('total-slides-set', (data) => {
        updateSlideCounter(null, data.total);
    });

    socket.on('presentation-toggled', (data) => {
        updatePresentingStatus(data.isPresenting);
    });

    // ─── PUNTERO ──────────────────────────────────────────────
    socket.on('pointer-moved', (data) => {
        const container = document.getElementById('slide-container');
        const dot = document.getElementById('pointer-dot');
        const rect = container.getBoundingClientRect();

        dot.style.display = 'block';
        dot.style.left = (data.x * rect.width)  + 'px';
        dot.style.top  = (data.y * rect.height) + 'px';
    });

    socket.on('pointer-hidden', () => {
        document.getElementById('pointer-dot').style.display = 'none';
    });

    // ─── ZOOM ─────────────────────────────────────────────────
    socket.on('zoom-activated', () => {
        document.getElementById('zoom-overlay').style.display = 'block';
    });

    socket.on('zoom-deactivated', () => {
        document.getElementById('zoom-overlay').style.display = 'none';
    });

    // ─── DIBUJO ───────────────────────────────────────────────
    socket.on('draw-point', (data) => {
        applyDrawPoint(data);
    });

    socket.on('drawing-cleared', () => {
        clearDrawingCanvas();
    });

    socket.on('drawing-history', (strokes) => {
        strokes.forEach(point => applyDrawPoint(point));
    });

    // ─── SUBTÍTULOS ───────────────────────────────────────────
    socket.on('subtitle', (data) => {
        const bar  = document.getElementById('subtitle-bar');
        const text = document.getElementById('subtitle-text');

        if (data.text && data.text.length > 0) {
            bar.style.display = 'block';
            text.textContent  = data.text;
        } else {
            bar.style.display = 'none';
            text.textContent  = '';
        }
    });

    // ─── ENCUESTA ─────────────────────────────────────────────
    socket.on('poll-started', (data) => {
        renderPoll(data.poll, data.results);
        addNotification('📊 Nueva encuesta disponible', false);
    });

    socket.on('poll-updated', (data) => {
        renderPollResults(data.results, data.total);
    });

    socket.on('poll-ended', (data) => {
        closePoll(data.results);
    });

    // ─── MANOS ────────────────────────────────────────────────
    socket.on('hand-lowered', (data) => {
        if (data.userId === socket.id && handRaised) {
            lowerHand();
            // Notificación más visible
            addNotification('🎤 ¡El presentador te ha dado el turno de palabra!', false);
            // Alerta sonora
            const audio = new AudioContext();
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            osc.connect(gain);
            gain.connect(audio.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.3, audio.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
            osc.start();
            osc.stop(audio.currentTime + 0.5);
        }
    });
    }

// =============================================
// UI HELPERS
// =============================================
function updateSlide(index, total) {
    if (index === null && index === undefined) return;

    // Construir ruta de la diapositiva
    const img = document.getElementById('slide-img');
    img.src = `/slides/slide${index + 1}.jpg`;

    updateSlideCounter(index, total);
}

function updateSlideCounter(index, total) {
    const el = document.getElementById('slide-counter');
    const parts = el.textContent.split('/').map(s => s.trim());
    const current = index !== null && index !== undefined ? index + 1 : parts[0];
    const totalVal = total !== null && total !== undefined ? total : parts[1];
    el.textContent = `${current} / ${totalVal}`;
}

function updatePresentingStatus(isPresenting) {
    const el = document.getElementById('status-presenting');
    if (isPresenting) {
        el.textContent = '▶ Presentación en curso';
        el.classList.add('active');
    } else {
        el.textContent = '⏸ Presentación no iniciada';
        el.classList.remove('active');
    }
}

function addNotification(message, isAlert) {
    const container = document.getElementById('notifications');
    const el = document.createElement('div');
    el.className = 'notification' + (isAlert ? ' alert' : '');
    el.textContent = message;
    container.prepend(el);
    while (container.children.length > 5) container.removeChild(container.lastChild);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}
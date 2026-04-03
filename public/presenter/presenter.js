// =============================================
// VARIABLES GLOBALES
// =============================================
let slides = [];
let currentSlide = 0;
let isPresenting = false;
let voiceActive = false;
let gestureActive = false;
let zoomActive = false;
let zoomScale = 1;
let zoomTarget = { x: 0.5, y: 0.5 };
let prevIndexX = null;
let prevIndexY = null;
let swipeCooldown = false;

// MediaPipe
let hands = null;
let camera = null;

// Control de gestos
let lastGesture = '';
let gestureTimeout = null;
const GESTURE_COOLDOWN = 1000;
const PINCH_CLOSE_DISTANCE = 0.08;
const PINCH_OPEN_DISTANCE = 0.1;
const PINCH_MID_DISTANCE = 0.065;
const ZOOM_STEP = 0.45;
const MAX_ZOOM_SCALE = 3.25;
let prevPinchDistance = null;
let participants = [];

// ─── DIBUJO ───────────────────────────────────────────────────
let drawingMode = false;
let isDrawing = false;
let lastDrawPoint = null;
const DRAW_COLOR = '#ff4757';
const DRAW_WIDTH = 4;

// ─── SUBTÍTULOS ───────────────────────────────────────────────
let subtitlesActive = false;
let subtitleTimeout = null;

// ─── ENCUESTA ─────────────────────────────────────────────────
let pollActive = false;
let pendingPollQuestion = null; // guardamos la pregunta mientras esperamos opciones

// =============================================
// INICIALIZACIÓN
// =============================================
window.addEventListener('load', async () => {
    await loadSlides();
    emitRegisterParticipant('presenter', 'Presentador');
    initCamera();
    initSocketListeners();
    initDrawingCanvas();
});

// =============================================
// DIAPOSITIVAS
// =============================================
async function loadSlides() {
    try {
        const response = await fetch('/api/slides');
        const data = await response.json();
        slides = data.slides || [];
    } catch (error) {
        addLog('Error cargando diapositivas: ' + error.message);
        slides = [];
    }

    emitSetTotalSlides(slides.length, slides);
    updateSlideCounter();

    if (slides.length > 0) {
        showSlide(0);
    } else {
        document.getElementById('slide-img').alt = 'No hay diapositivas en /public/slides/';
    }
}

function showSlide(index) {
    if (index < 0 || index >= slides.length) return;
    currentSlide = index;
    document.getElementById('slide-img').src = slides[index].url;
    updateSlideCounter();
    emitChangeSlide(index);
    addLog(`Diapositiva ${index + 1}`);
    // Limpiar canvas de dibujo al cambiar diapositiva
    clearDrawingCanvas();
}

function nextSlide() {
    if (currentSlide < slides.length - 1) showSlide(currentSlide + 1);
}

function prevSlide() {
    if (currentSlide > 0) showSlide(currentSlide - 1);
}

function goToSlide(number) {
    const index = number - 1;
    if (index >= 0 && index < slides.length) showSlide(index);
}

function updateSlideCounter() {
    document.getElementById('slide-counter').textContent =
        `${currentSlide + 1} / ${slides.length}`;
}

// =============================================
// PRESENTACIÓN (inicio / fin)
// =============================================
function togglePresentation() {
    isPresenting = !isPresenting;
    const btn = document.getElementById('btn-start');

    if (isPresenting) {
        btn.textContent = '⏹ Detener';
        btn.classList.add('active');
        addNotification('Presentación iniciada', false);
        gestureActive = true;
        document.getElementById('status-gesture').textContent = '👋 Gestos: ON';
        document.getElementById('status-gesture').classList.add('active');
    } else {
        btn.textContent = '▶ Iniciar';
        btn.classList.remove('active');
        addNotification('Presentación detenida', false);
        gestureActive = false;
        document.getElementById('status-gesture').textContent = '👋 Gestos: OFF';
        document.getElementById('status-gesture').classList.remove('active');
        deactivateZoom();
    }

    emitTogglePresentation(isPresenting);
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
        canvasEl.width = videoEl.videoWidth || 200;
        canvasEl.height = videoEl.videoHeight || 150;
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];

            drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#7c6af7', lineWidth: 2 });
            drawLandmarks(ctx, landmarks, { color: '#fff', lineWidth: 1, radius: 3 });

            if (gestureActive) {
                processGesture(landmarks);
            }
        } else {
            // Si no hay mano visible y estábamos dibujando, cortamos el trazo
            if (isDrawing) {
                isDrawing = false;
                lastDrawPoint = null;
            }
            hidePointer();
        }
    });

    camera = new Camera(videoEl, {
        onFrame: async () => {
            await hands.send({ image: videoEl });
        },
        width: 640,
        height: 480,
    });

    camera.start().then(() => {
        addLog('Cámara iniciada');
    }).catch((err) => {
        addLog('Error cámara: ' + err.message);
    });
}

// =============================================
// PROCESAMIENTO DE GESTOS
// =============================================
function processGesture(landmarks) {
    // En modo dibujo, el índice dibuja en el canvas
    if (drawingMode) {
        handleDrawingGesture(landmarks);
        return;
    }

    const gesture = detectGesture(landmarks);

    if (gesture && gesture !== lastGesture) {
        lastGesture = gesture;
        clearTimeout(gestureTimeout);
        gestureTimeout = setTimeout(() => { lastGesture = ''; }, GESTURE_COOLDOWN);
        executeGesture(gesture, landmarks);
    }

    updatePointer(landmarks);
}

function detectGesture(lm) {
    const thumbUp  = lm[4].y < lm[3].y;
    const indexUp  = lm[8].y < lm[6].y;
    const middleUp = lm[12].y < lm[10].y;
    const ringUp   = lm[16].y < lm[14].y;
    const pinkyUp  = lm[20].y < lm[18].y;
    const pinchDistance = distanceBetween(lm[4], lm[8]);
    const pinchGestureCandidate =
        lm[4].x < lm[8].x + 0.22 &&
        Math.abs(lm[4].y - lm[8].y) < 0.28;

    if (pinchGestureCandidate && prevPinchDistance !== null && !swipeCooldown) {
        if (prevPinchDistance < PINCH_CLOSE_DISTANCE && pinchDistance > PINCH_OPEN_DISTANCE) {
            prevPinchDistance = pinchDistance;
            prevIndexX = null;
            prevIndexY = null;
            swipeCooldown = true;
            setTimeout(() => { swipeCooldown = false; }, GESTURE_COOLDOWN);
            return 'pinch_out';
        }

    }

    if (pinchGestureCandidate) {
        prevPinchDistance = pinchDistance;
    } else {
        prevPinchDistance = null;
    }

    if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
        prevIndexX = null;
        prevIndexY = null;
        return 'fist';
    }

    if (indexUp && middleUp && !ringUp && !pinkyUp) {
        prevIndexX = null;
        prevIndexY = null;
        return 'two_fingers';
    }

    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        const currentX = lm[8].x;

        if (prevIndexX !== null && !swipeCooldown) {
            const delta = currentX - prevIndexX;
            const deltaY = lm[8].y - prevIndexY;

            if (delta > 0.05 && Math.abs(deltaY) < 0.08) {
                prevIndexX = currentX;
                prevIndexY = lm[8].y;
                swipeCooldown = true;
                setTimeout(() => { swipeCooldown = false; }, GESTURE_COOLDOWN);
                return 'swipe_right';
            }
            if (delta < -0.05 && Math.abs(deltaY) < 0.08) {
                prevIndexX = currentX;
                prevIndexY = lm[8].y;
                swipeCooldown = true;
                setTimeout(() => { swipeCooldown = false; }, GESTURE_COOLDOWN);
                return 'swipe_left';
            }
        }

        prevIndexX = currentX;
        prevIndexY = lm[8].y;
        return 'pointing';
    }

    prevIndexX = null;
    prevIndexY = null;
    return null;
}

function executeGesture(gesture, landmarks) {
    switch (gesture) {
        case 'swipe_right':
            prevSlide();
            addNotification('Diapositiva anterior', false);
            addLog('Gesto: swipe derecha');
            break;

        case 'swipe_left':
            nextSlide();
            addNotification('Siguiente diapositiva', false);
            addLog('Gesto: swipe izquierda');
            break;

        case 'pinch_out':
            increaseZoom(1 - landmarks[8].x, landmarks[8].y);
            addNotification(`Zoom + (${zoomScale.toFixed(2)}x)`, false);
            addLog('Gesto: pellizco hacia fuera (zoom +)');
            break;


        case 'fist':
            if (zoomActive) {
                deactivateZoom();
                addNotification('Zoom desactivado', false);
                addLog('Gesto: cerrar puno (zoom OFF)');
            }
            break;

        case 'two_fingers':
            break;
    }
}

function distanceBetween(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// =============================================
// PUNTERO EN PANTALLA
// =============================================
function updatePointer(landmarks) {
    const slideContainer = document.getElementById('slide-container');
    const rect = slideContainer.getBoundingClientRect();
    const dot = document.getElementById('pointer-dot');

    const x = (1 - landmarks[8].x);
    const y = landmarks[8].y;

    const px = x * rect.width;
    const py = y * rect.height;

    dot.style.display = 'block';
    dot.style.left = px + 'px';
    dot.style.top = py + 'px';

    emitPointerMove(x, y);
}

function updateDrawingCursor(landmarks) {
    const slideContainer = document.getElementById('slide-container');
    const rect = slideContainer.getBoundingClientRect();
    const dot = document.getElementById('pointer-dot');

    const x = (1 - landmarks[8].x) * rect.width;
    const y = landmarks[8].y * rect.height;

    dot.classList.add('drawing-cursor');
    dot.textContent = '✏️';
    dot.style.display = 'block';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
}

function hidePointer() {
    const dot = document.getElementById('pointer-dot');
    dot.style.display = 'none';
    dot.textContent = '';
    dot.classList.remove('drawing-cursor');
    emitPointerHide();
}

// =============================================
// ZOOM
// =============================================
function increaseZoom(x, y) {
    zoomTarget = { x, y };
    zoomScale = Math.min(MAX_ZOOM_SCALE, zoomScale + ZOOM_STEP);
    zoomActive = zoomScale > 1;
    renderZoomState();
}

function decreaseZoom() {
    zoomScale = Math.max(1, zoomScale - ZOOM_STEP);
    zoomActive = zoomScale > 1;
    renderZoomState();
}

function activateZoom(x, y) {
    increaseZoom(x, y);
}

function deactivateZoom() {
    zoomScale = 1;
    zoomActive = false;
    renderZoomState();
}

function renderZoomState() {
    document.getElementById('zoom-overlay').style.display = zoomActive ? 'block' : 'none';
    applyZoomVisual(zoomActive, zoomTarget, zoomScale);

    if (zoomActive) {
        emitZoomActivate(zoomTarget.x, zoomTarget.y, zoomScale);
    } else {
        emitZoomDeactivate();
    }
}

function applyZoomVisual(active, target, scale = 1) {
    const appliedScale = active ? scale : 1;
    const origin = `${target.x * 100}% ${target.y * 100}%`;

    ['slide-img', 'draw-canvas'].forEach((id) => {
        const element = document.getElementById(id);
        element.style.transformOrigin = origin;
        element.style.transform = `scale(${appliedScale})`;
    });
}

// =============================================
// DIBUJO SOBRE LA DIAPOSITIVA
// =============================================
function initDrawingCanvas() {
    const canvas = document.getElementById('draw-canvas');
    const slideContainer = document.getElementById('slide-container');

    // El canvas de dibujo se redimensiona con el contenedor
    const resizeCanvas = () => {
        canvas.width = slideContainer.offsetWidth;
        canvas.height = slideContainer.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function toggleDrawingMode() {
    drawingMode = !drawingMode;
    const canvas = document.getElementById('draw-canvas');
    const btn = document.getElementById('btn-draw');

    if (drawingMode) {
        canvas.style.pointerEvents = 'none'; // el dibujo lo hace el gesto, no el ratón
        btn.classList.add('active');
        addNotification('✏️ Modo dibujo ON', false);
        addLog('Dibujo activado');
        document.getElementById('pointer-dot').classList.add('drawing-cursor');
    } else {
        isDrawing = false;
        lastDrawPoint = null;
        btn.classList.remove('active');
        addNotification('✏️ Modo dibujo OFF', false);
        addLog('Dibujo desactivado');
        hidePointer();
    }
}

function handleDrawingGesture(landmarks) {
    const indexUp  = landmarks[8].y < landmarks[6].y;
    const middleUp = landmarks[12].y < landmarks[10].y;
    const ringUp   = landmarks[16].y < landmarks[14].y;
    const pinkyUp  = landmarks[20].y < landmarks[18].y;

    // Solo índice levantado → dibuja
    const shouldDraw = indexUp && !middleUp && !ringUp && !pinkyUp;

    const slideContainer = document.getElementById('slide-container');
    const rect = slideContainer.getBoundingClientRect();
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');

    const x = (1 - landmarks[8].x) * canvas.width;
    const y = landmarks[8].y * canvas.height;
    updateDrawingCursor(landmarks);

    // Normalizado para enviar por socket (0-1)
    const nx = x / canvas.width;
    const ny = y / canvas.height;

    if (shouldDraw) {
        ctx.strokeStyle = DRAW_COLOR;
        ctx.lineWidth = DRAW_WIDTH;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (!isDrawing || !lastDrawPoint) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            isDrawing = true;
            emitDrawPoint(nx, ny, true, DRAW_COLOR, DRAW_WIDTH);
        } else {
            ctx.beginPath();
            ctx.moveTo(lastDrawPoint.x, lastDrawPoint.y);
            ctx.lineTo(x, y);
            ctx.stroke();
            emitDrawPoint(nx, ny, false, DRAW_COLOR, DRAW_WIDTH);
        }

        lastDrawPoint = { x, y };
    } else {
        // Mano levantada con más dedos → cortar trazo
        if (isDrawing) {
            isDrawing = false;
            lastDrawPoint = null;
        }
    }
}

function clearDrawingCanvas() {
    const canvas = document.getElementById('draw-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    emitDrawingClear();
}

// =============================================
// SUBTÍTULOS
// =============================================
function toggleSubtitles() {
    subtitlesActive = !subtitlesActive;
    const btn = document.getElementById('btn-subtitles');
    const el = document.getElementById('subtitle-bar');

    if (subtitlesActive) {
        btn.classList.add('active');
        el.style.display = 'block';
        addNotification('📝 Subtítulos ON', false);
        addLog('Subtítulos activados');
    } else {
        btn.classList.remove('active');
        el.style.display = 'none';
        addLog('Subtítulos desactivados');
    }
}

function updateSubtitle(text) {
    if (!subtitlesActive) return;
    const el = document.getElementById('subtitle-text');
    el.textContent = text;

    // Emitir al audience
    emitSubtitle(text);

    // Limpiar subtítulo tras 4 segundos de silencio
    clearTimeout(subtitleTimeout);
    subtitleTimeout = setTimeout(() => {
        el.textContent = '';
        emitSubtitle('');
    }, 4000);
}

// =============================================
// VOZ
// =============================================
function toggleVoice() {
    voiceActive = !voiceActive;
    const btn = document.getElementById('btn-voice');
    const statusEl = document.getElementById('status-voice');

    if (voiceActive) {
        btn.classList.add('active');
        statusEl.textContent = '🎙 Voz: ON';
        statusEl.classList.add('active');
        startVoiceRecognition();
    } else {
        btn.classList.remove('active');
        statusEl.textContent = '🎙 Voz: OFF';
        statusEl.classList.remove('active');
        stopVoiceRecognition();
    }
}

let recognition = null;
let lastVoiceSnippet = '';

function startVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addNotification('Tu navegador no soporta reconocimiento de voz', true);
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
        // Solo actualizar el log, sin overlay
        addLog('Reconocimiento de voz activo');
    };

    recognition.onresult = (event) => {
        const result = event.results[event.resultIndex];
        if (!result || !result[0]) return;

        const transcript = result[0].transcript.toLowerCase().trim();
        if (!transcript) return;

        const isFinal = result.isFinal;

        if (isFinal || transcript !== lastVoiceSnippet) {
            addLog('Voz captada: "' + transcript + '"');
            lastVoiceSnippet = transcript;
        }

        updateSubtitle(transcript);

        if (isFinal) {
            lastVoiceSnippet = '';
            processVoiceCommand(transcript);
        }
    };

    recognition.onend = () => {
        if (voiceActive) recognition.start();
    };

    recognition.onerror = (e) => {
        addLog('Error voz: ' + e.error);
    };

    recognition.start();
}

function stopVoiceRecognition() {
    if (recognition) {
        recognition.stop();
        recognition = null;
    }
}

function processVoiceCommand(transcript) {
    if (transcript.includes('siguiente') || transcript.includes('avanzar')) {
        nextSlide();
        addLog('Voz: siguiente');
        return;
    }
    if (transcript.includes('anterior') || transcript.includes('retroceder') || transcript.includes('atras')) {
        prevSlide();
        addLog('Voz: anterior');
        return;
    }
    const matchSlide = transcript.match(/diapositiva\s+(\d+)/);
    if (matchSlide) {
        goToSlide(parseInt(matchSlide[1]));
        addLog('Voz: ir a diapositiva ' + matchSlide[1]);
        return;
    }

    if (transcript.includes('iniciar') || transcript.includes('empezar') || transcript.includes('comenzar')) {
        if (!isPresenting) togglePresentation();
        addLog('Voz: iniciar');
        return;
    }
    if (transcript.includes('pausar') || transcript.includes('pausa')) {
        if (isPresenting) togglePresentation();
        addLog('Voz: pausar');
        return;
    }

    if (transcript === 'lanzar encuesta') {
        pendingPollQuestion = 'Encuesta rapida';
        addNotification('Pregunta guardada: "Encuesta rapida". Di "opciones Si No" o "opciones A B C"', false);
        addLog('Voz: pregunta encuesta = "Encuesta rapida"');
        return;
    }

    const matchPoll = transcript.match(/lanzar encuesta\s+(.+)/);
    if (matchPoll) {
        pendingPollQuestion = matchPoll[1].trim();
        addNotification('Pregunta guardada: "' + pendingPollQuestion + '". Di "opciones Si No" o "opciones A B C"', false);
        addLog('Voz: pregunta encuesta = "' + pendingPollQuestion + '"');
        return;
    }

    const matchOptions = transcript.match(/opciones\s+(.+)/);
    if (matchOptions && pendingPollQuestion) {
        const options = matchOptions[1].trim().split(/\s+/);
        emitPollStart(pendingPollQuestion, options);
        pollActive = true;
        pendingPollQuestion = null;
        addNotification('Encuesta lanzada', false);
        addLog('Voz: encuesta iniciada');
        return;
    }

    if (transcript.includes('cerrar encuesta') || transcript.includes('finalizar encuesta')) {
        emitPollEnd();
        pollActive = false;
        addNotification('Encuesta cerrada', false);
        addLog('Voz: encuesta cerrada');
        return;
    }

    if (
        transcript.includes('finalizar presentacion') ||
        transcript.includes('terminar presentacion') ||
        transcript.includes('cerrar presentacion')
    ) {
        confirmFinish();
        addLog('Voz: finalizar presentacion');
        return;
    }

    if (transcript.includes('quitar zoom') || transcript.includes('quitar zum') || transcript.includes('reducir')) {
        deactivateZoom();
        addLog('Voz: zoom desactivado');
        return;
    }
    if (transcript.includes('zoom') || transcript.includes('zum') || transcript.includes('ampliar')) {
        increaseZoom(0.5, 0.5);
        addLog('Voz: zoom activado (' + zoomScale.toFixed(2) + 'x)');
        return;
    }

    if (
        transcript.includes('dejar de dibujar') ||
        transcript.includes('salir dibujo') ||
        transcript.includes('desactivar dibujo') ||
        transcript.includes('desactivar dibujar')
    ) {
        if (drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo desactivado');
        return;
    }
    if (transcript.includes('dibujar') || transcript.includes('modo dibujo') || transcript.includes('activar dibujo')) {
        if (!drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo activado');
        return;
    }
    if (transcript.includes('borrar') || transcript.includes('limpiar')) {
        clearDrawingCanvas();
        addNotification('Pizarra limpiada', false);
        addLog('Voz: borrar dibujo');
        return;
    }

    if (
        transcript.includes('desactivar subtitulos') ||
        transcript.includes('desactivar subt?tulos') ||
        transcript.includes('subtitulos off') ||
        transcript.includes('subt?tulos off')
    ) {
        if (subtitlesActive) toggleSubtitles();
        addLog('Voz: subtitulos OFF');
        return;
    }
    if (
        transcript.includes('activar subtitulos') ||
        transcript.includes('activar subt?tulos') ||
        transcript.includes('subtitulos on') ||
        transcript.includes('subt?tulos on') ||
        transcript.includes('subtitulos') ||
        transcript.includes('subt?tulos')
    ) {
        if (!subtitlesActive) toggleSubtitles();
        addLog('Voz: subtitulos ON');
        return;
    }
}

// =============================================
// CONFIRMACIÓN DE SALIDA
// =============================================
function confirmFinish() {
    const confirmed = confirm('¿Finalizar la presentación?');
    if (confirmed) {
        isPresenting = false;
        emitTogglePresentation(false);
        addNotification('Presentación finalizada', true);
        document.getElementById('btn-start').textContent = '▶ Iniciar';
        document.getElementById('btn-start').classList.remove('active');
        if (drawingMode) toggleDrawingMode();
        if (subtitlesActive) toggleSubtitles();
    }
}

// =============================================
// PANTALLA COMPLETA
// =============================================
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// =============================================
// SOCKET LISTENERS
// =============================================
function initSocketListeners() {
    socket.on('hand-raised', (data) => {
        addHandToList(data.userId, data.name);
        addNotification(`✋ ${data.name} levantó la mano`, true);
    });

    socket.on('hand-lowered', (data) => {
        removeHandFromList(data.userId);
    });

    socket.on('presentation-state', (data) => {
        slides = data.slides || slides;
        updateSlideCounter();
        participants = data.participants || [];
        renderParticipants(participants);

        if (Array.isArray(data.handRaised)) {
            document.getElementById('hands-list').innerHTML = '';
            data.handRaised.forEach((entry) => addHandToList(entry.userId, entry.name));
        }
    });

    socket.on('participants-updated', (data) => {
        participants = data || [];
        renderParticipants(participants);
    });

    socket.on('poll-updated', (data) => {
        updatePollResults(data.results, data.total);
    });

    socket.on('poll-started', (data) => {
        updatePollResults(data.results, 0);
        addNotification(`📊 Encuesta iniciada: ${data.poll.question}`, false);
    });

    socket.on('poll-ended', (data) => {
        updatePollResults(data.results, null);
        addNotification('📊 Encuesta finalizada', false);
    });
}

// =============================================
// UI — ENCUESTA (panel del presentador)
// =============================================
function updatePollResults(results, total) {
    const container = document.getElementById('poll-results');
    if (!container) return;

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

// =============================================
// UI HELPERS
// =============================================
function addNotification(message, isAlert) {
    const container = document.getElementById('notifications');
    const el = document.createElement('div');
    el.className = 'notification' + (isAlert ? ' alert' : '');
    el.textContent = message;
    container.prepend(el);
    while (container.children.length > 5) container.removeChild(container.lastChild);
}

function addLog(message) {
    const container = document.getElementById('command-log');
    const el = document.createElement('div');
    el.className = 'log-item';
    const time = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.innerHTML = `<span>${time}</span> ${message}`;
    container.prepend(el);
    while (container.children.length > 10) container.removeChild(container.lastChild);
}

function addHandToList(userId, name) {
    const container = document.getElementById('hands-list');
    if (document.getElementById('hand-' + userId)) return;
    const el = document.createElement('div');
    el.className = 'hand-item';
    el.id = 'hand-' + userId;
    el.innerHTML = `✋ ${name} <button onclick="dismissHand('${userId}')">Dar turno</button>`;
    container.appendChild(el);
}

function renderParticipants(list) {
    const container = document.getElementById('participants-list');
    if (!container) return;

    container.innerHTML = '';

    list.forEach((participant) => {
        const item = document.createElement('div');
        item.className = 'participant-item' + (participant.hasTurn ? ' turn-active' : '');

        const icon = participant.role === 'presenter' ? '🎤' : '👤';
        const roleLabel = participant.role === 'presenter' ? 'Presentador' : 'Espectador';
        const hand = participant.handRaised ? '<span class="participant-hand">✋</span>' : '';

        item.innerHTML = `
            <div class="participant-main">
                <span>${icon}</span>
                <span class="participant-name">${participant.name}</span>
            </div>
            <div class="participant-main">
                <span class="participant-role">${roleLabel}</span>
                ${hand}
            </div>
        `;

        container.appendChild(item);
    });
}

function removeHandFromList(userId) {
    const el = document.getElementById('hand-' + userId);
    if (el) el.remove();
}

function dismissHand(userId) {
    emitGrantTurn(userId);
    removeHandFromList(userId);
    addNotification('Turno cedido', false);
}

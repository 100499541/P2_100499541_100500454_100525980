// =============================================
// VARIABLES GLOBALES
// =============================================
let slides = [];
let currentSlide = 0;
let isPresenting = false;
let voiceActive = false;
let gestureActive = false;
let zoomActive = false;
let prevIndexX = null;
let swipeCooldown = false;

// MediaPipe
let hands = null;
let camera = null;

// Control de gestos
let lastGesture = '';
let gestureTimeout = null;
const GESTURE_COOLDOWN = 1000;

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
window.addEventListener('load', () => {
    loadSlides();
    initCamera();
    initSocketListeners();
    initDrawingCanvas();
});

// =============================================
// DIAPOSITIVAS
// =============================================
function loadSlides() {
    slides = [
        '/slides/slide1.jpg',
        '/slides/slide2.jpg',
    ];

    emitSetTotalSlides(slides.length);
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
    document.getElementById('slide-img').src = slides[index];
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

    // MANO ABIERTA → pausa/reanuda
    if (thumbUp && indexUp && middleUp && ringUp && pinkyUp) {
        prevIndexX = null;
        return 'open_hand';
    }

    // PUÑO → finalizar
    if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
        prevIndexX = null;
        return 'fist';
    }

    // PULGAR SOLO → zoom
    if (thumbUp && !indexUp && !middleUp && !ringUp && !pinkyUp) {
        prevIndexX = null;
        return 'thumb_up';
    }

    // DOS DEDOS → puntero
    if (indexUp && middleUp && !ringUp && !pinkyUp) {
        prevIndexX = null;
        return 'two_fingers';
    }

    // SWIPE: índice solo, rastrear movimiento entre frames
    if (indexUp && !middleUp && !ringUp && !pinkyUp) {
        const currentX = lm[8].x;

        if (prevIndexX !== null && !swipeCooldown) {
            const delta = currentX - prevIndexX;

            if (delta > 0.08) {
                prevIndexX = currentX;
                swipeCooldown = true;
                setTimeout(() => { swipeCooldown = false; }, GESTURE_COOLDOWN);
                return 'swipe_right'; // mano va a la derecha → diapositiva anterior (espejo)
            }
            if (delta < -0.08) {
                prevIndexX = currentX;
                swipeCooldown = true;
                setTimeout(() => { swipeCooldown = false; }, GESTURE_COOLDOWN);
                return 'swipe_left'; // mano va a la izquierda → siguiente
            }
        }

        prevIndexX = currentX;
        return 'pointing';
    }

    prevIndexX = null;
    return null;
}

function executeGesture(gesture, landmarks) {
    switch (gesture) {
        case 'swipe_right':
            prevSlide();  // espejo: mano derecha = retroceder
            addNotification('👈 Diapositiva anterior', false);
            addLog('Gesto: swipe derecha');
            break;

        case 'swipe_left':
            nextSlide();  // espejo: mano izquierda = avanzar
            addNotification('👉 Siguiente diapositiva', false);
            addLog('Gesto: swipe izquierda');
            break;

        // case 'open_hand':
         //   togglePresentation();
          //  addLog('Gesto: mano abierta (pausa/inicio)');
          //  break;

     //   case 'fist':
            if (isPresenting) confirmFinish();
            addLog('Gesto: puño (fin)');
            break;

        case 'thumb_up':
            if (!zoomActive) {
                activateZoom(landmarks[4].x, landmarks[4].y);
                addNotification('🔍 Zoom activado', false);
                addLog('Gesto: pulgar arriba (zoom ON)');
            } else {
                deactivateZoom();
                addLog('Gesto: pulgar arriba (zoom OFF)');
            }
            break;

        case 'two_fingers':
            addLog('Gesto: dos dedos (puntero)');
            break;
    }
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

// =============================================
// ZOOM
// =============================================
function activateZoom(x, y) {
    zoomActive = true;
    document.getElementById('zoom-overlay').style.display = 'block';
    emitZoomActivate(x, y);
}

function deactivateZoom() {
    zoomActive = false;
    document.getElementById('zoom-overlay').style.display = 'none';
    emitZoomDeactivate();
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
        // Ocultar puntero mientras dibujamos
        document.getElementById('pointer-dot').style.display = 'none';
    } else {
        isDrawing = false;
        lastDrawPoint = null;
        btn.classList.remove('active');
        addNotification('✏️ Modo dibujo OFF', false);
        addLog('Dibujo desactivado');
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
        const results = Array.from(event.results);
        const transcript = results
            .map(r => r[0].transcript)
            .join('')
            .toLowerCase()
            .trim();

        // Mostrar en el log en vez del overlay
        addLog(`🎙 "${transcript}"`);

        updateSubtitle(transcript);

        const isFinal = results[results.length - 1].isFinal;
        if (isFinal) {
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
    // ─── NAVEGACIÓN ───────────────────────────────────────────
    if (transcript.includes('siguiente') || transcript.includes('avanzar')) {
        nextSlide();
        addLog('Voz: siguiente');
        return;
    }
    if (transcript.includes('anterior') || transcript.includes('retroceder') || transcript.includes('atrás')) {
        prevSlide();
        addLog('Voz: anterior');
        return;
    }
    const matchSlide = transcript.match(/diapositiva\s+(\d+)/);
    if (matchSlide) {
        goToSlide(parseInt(matchSlide[1]));
        addLog(`Voz: ir a diapositiva ${matchSlide[1]}`);
        return;
    }

    // ─── CONTROL PRINCIPAL ────────────────────────────────────
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

    // ─── SALIDA ───────────────────────────────────────────────
    if (transcript.includes('finalizar') || transcript.includes('terminar') || transcript.includes('cerrar')) {
        confirmFinish();
        addLog('Voz: finalizar');
        return;
    }

    // ─── ZOOM ─────────────────────────────────────────────────
    if (transcript.includes('zoom') || transcript.includes('ampliar')) {
        if (!zoomActive) activateZoom(0.5, 0.5);
        addLog('Voz: zoom activado');
        return;
    }
    if (transcript.includes('quitar zoom') || transcript.includes('reducir')) {
        deactivateZoom();
        addLog('Voz: zoom desactivado');
        return;
    }

    // ─── DIBUJO ───────────────────────────────────────────────
    if (transcript.includes('dibujar') || transcript.includes('modo dibujo') || transcript.includes('activar dibujo')) {
        if (!drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo activado');
        return;
    }
    if (transcript.includes('dejar de dibujar') || transcript.includes('salir dibujo') || transcript.includes('desactivar dibujo')) {
        if (drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo desactivado');
        return;
    }
    if (transcript.includes('borrar') || transcript.includes('limpiar')) {
        clearDrawingCanvas();
        addNotification('🗑️ Pizarra limpiada', false);
        addLog('Voz: borrar dibujo');
        return;
    }

    // ─── SUBTÍTULOS ───────────────────────────────────────────
    if (transcript.includes('activar subtítulos') || transcript.includes('subtítulos on')) {
        if (!subtitlesActive) toggleSubtitles();
        addLog('Voz: subtítulos ON');
        return;
    }
    if (transcript.includes('desactivar subtítulos') || transcript.includes('subtítulos off')) {
        if (subtitlesActive) toggleSubtitles();
        addLog('Voz: subtítulos OFF');
        return;
    }

    // ─── ENCUESTA ─────────────────────────────────────────────
    // Flujo: "lanzar encuesta [pregunta]" → luego "opciones [A] [B] [C]"
    const matchPoll = transcript.match(/lanzar encuesta\s+(.+)/);
    if (matchPoll) {
        pendingPollQuestion = matchPoll[1].trim();
        addNotification(`📊 Pregunta guardada: "${pendingPollQuestion}". Di "opciones Sí No" o "opciones A B C"`, false);
        addLog(`Voz: pregunta encuesta = "${pendingPollQuestion}"`);
        return;
    }

    const matchOptions = transcript.match(/opciones\s+(.+)/);
    if (matchOptions && pendingPollQuestion) {
        const options = matchOptions[1].trim().split(/\s+/);
        emitPollStart(pendingPollQuestion, options);
        pollActive = true;
        pendingPollQuestion = null;
        addNotification(`📊 Encuesta lanzada`, false);
        addLog(`Voz: encuesta iniciada`);
        return;
    }

    if (transcript.includes('cerrar encuesta') || transcript.includes('finalizar encuesta')) {
        emitPollEnd();
        pollActive = false;
        addNotification('📊 Encuesta cerrada', false);
        addLog('Voz: encuesta cerrada');
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

    socket.on('poll-updated', (data) => {
        updatePollResults(data.results, data.total);
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

function removeHandFromList(userId) {
    const el = document.getElementById('hand-' + userId);
    if (el) el.remove();
}

function dismissHand(userId) {
    socket.emit('lower-hand', { userId });
    removeHandFromList(userId);
    addNotification('Turno cedido', false);
}
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
let cameraSnapshots = {};
let galleryExpanded = false;
let cameraBroadcastInterval = null;
let cameraEnabled = true;
let micEnabled = false;
let localAudioStream = null;
let localAudioTrack = null;
const audioPeerConnections = new Map();
const remoteAudioElements = new Map();

// --- DIBUJO ---------------------------------------------------
let drawingMode = false;
let isDrawing = false;
let lastDrawPoint = null;
const DRAW_COLOR = '#ff4757';
const DRAW_WIDTH = 4;

// --- SUBTÍTULOS -----------------------------------------------
let subtitlesActive = false;
let subtitleTimeout = null;

// --- ENCUESTA -------------------------------------------------
let pollActive = false;
let pendingPollQuestion = null; // guardamos la pregunta mientras esperamos opciones
let pollOptionsCaptureActive = false;
let pollDraftOptions = [];
let pendingPollOption = null;
let pollOptionCommitTimer = null;
let pollFinalizeTimer = null;
const POLL_OPTION_COMMIT_DELAY = 3000;
const POLL_NEXT_OPTION_WAIT_DELAY = 5000;

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
        btn.textContent = '\u23F9 Detener';
        btn.classList.add('active');
        addNotification('Presentación iniciada', false);
        gestureActive = true;
        document.getElementById('status-gesture').textContent = '\uD83D\uDC4B Gestos: ON';
        document.getElementById('status-gesture').classList.add('active');
    } else {
        btn.textContent = '\u25B6 Iniciar';
        btn.classList.remove('active');
        addNotification('Presentación detenida', false);
        gestureActive = false;
        document.getElementById('status-gesture').textContent = '\uD83D\uDC4B Gestos: OFF';
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

function startCameraBroadcast(videoEl) {
    if (cameraBroadcastInterval) clearInterval(cameraBroadcastInterval);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const sendFrame = () => {
        if (!videoEl.videoWidth || !videoEl.videoHeight) return;

        canvas.width = 320;
        canvas.height = 180;
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        emitCameraFrame(canvas.toDataURL('image/jpeg', 0.6));
    };

    sendFrame();
    cameraBroadcastInterval = setInterval(sendFrame, 1500);
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
    dot.textContent = '\u270F\uFE0F';
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
        addNotification('\u270F\uFE0F Modo dibujo ON', false);
        addLog('Dibujo activado');
        document.getElementById('pointer-dot').classList.add('drawing-cursor');
    } else {
        isDrawing = false;
        lastDrawPoint = null;
        btn.classList.remove('active');
        addNotification('\u270F\uFE0F Modo dibujo OFF', false);
        addLog('Dibujo desactivado');
        hidePointer();
    }
}

function handleDrawingGesture(landmarks) {
    const indexUp  = landmarks[8].y < landmarks[6].y;
    const middleUp = landmarks[12].y < landmarks[10].y;
    const ringUp   = landmarks[16].y < landmarks[14].y;
    const pinkyUp  = landmarks[20].y < landmarks[18].y;

    // Solo índice levantado ? dibuja
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
        // Mano levantada con más dedos ? cortar trazo
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
        addNotification('\uD83D\uDCDD Subtítulos ON', false);
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
        statusEl.textContent = '\uD83C\uDFA4 Voz: ON';
        statusEl.classList.add('active');
        startVoiceRecognition();
    } else {
        btn.classList.remove('active');
        statusEl.textContent = '\uD83C\uDFA4 Voz: OFF';
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

function normalizeVoiceText(text) {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[.,;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isReservedCommand(normalizedTranscript) {
    return [
        'siguiente', 'avanzar', 'anterior', 'retroceder', 'atras',
        'diapositiva', 'iniciar', 'empezar', 'comenzar', 'pausar', 'pausa',
        'cerrar encuesta', 'finalizar encuesta', 'finalizar presentacion',
        'terminar presentacion', 'cerrar presentacion', 'quitar zoom',
        'quitar zum', 'reducir', 'zoom', 'zum', 'ampliar', 'dejar de dibujar',
        'salir dibujo', 'desactivar dibujo', 'desactivar dibujar',
        'dibujar', 'modo dibujo', 'activar dibujo', 'borrar', 'limpiar',
        'desactivar subtitulos', 'subtitulos off', 'activar subtitulos', 'subtitulos on'
    ].some((command) => normalizedTranscript.includes(command));
}

function startPollOptionsCapture(initialChunk = '') {
    pollOptionsCaptureActive = true;
    pollDraftOptions = [];
    pendingPollOption = null;
    clearTimeout(pollOptionCommitTimer);
    clearTimeout(pollFinalizeTimer);
    setPollCaptureStatus('Esperando primera opcion...');

    if (initialChunk) {
        queuePollOption(initialChunk);
    } else {
        updatePollDraftPreview();
    }
}

function parseSinglePollOption(text) {
    const normalizedText = normalizeVoiceText(text);
    const letterMap = {
        a: 0,
        b: 1,
        be: 1,
        ve: 1,
        c: 2,
        ce: 2,
        se: 2,
        d: 3,
        de: 3,
        e: 4,
        f: 5,
    };
    const markerRegex = /(?:^|\s)(?:opcion|respuesta)?\s*(a|b|be|ve|c|ce|se|d|de|e|f)\s*[:\-]?\s*/g;
    const matches = Array.from(normalizedText.matchAll(markerRegex));
    if (matches.length === 0) return null;

    const lastMatch = matches[matches.length - 1];
    const optionKey = lastMatch[1];
    const optionIndex = letterMap[optionKey];
    if (optionIndex === undefined) return null;

    const markerEnd = lastMatch.index + lastMatch[0].length;
    const label = normalizedText.slice(markerEnd).trim();
    if (!label) return null;

    return { index: optionIndex, label };
}

function queuePollOption(chunk) {
    const parsedOption = parseSinglePollOption(chunk);
    if (!parsedOption || !parsedOption.label) return false;

    if (pendingPollOption) {
        commitPendingPollOption();
    }

    pendingPollOption = parsedOption;
    clearTimeout(pollOptionCommitTimer);
    clearTimeout(pollFinalizeTimer);
    setPollCaptureStatus(`Guardando opcion ${String.fromCharCode(65 + parsedOption.index)}...`);
    updatePollDraftPreview();
    pollOptionCommitTimer = setTimeout(commitPendingPollOption, POLL_OPTION_COMMIT_DELAY);
    return true;
}

function commitPendingPollOption() {
    if (!pendingPollOption) return;

    pollDraftOptions[pendingPollOption.index] = pendingPollOption.label;
    pendingPollOption = null;
    updatePollDraftPreview();
    setPollCaptureStatus('Esperando siguiente opcion...');
    clearTimeout(pollFinalizeTimer);
    pollFinalizeTimer = setTimeout(finalizePendingPoll, POLL_NEXT_OPTION_WAIT_DELAY);
}

function getPollDraftOptions() {
    return pollDraftOptions.filter(Boolean);
}

function setPollCaptureStatus(message = '') {
    const statusEl = document.getElementById('poll-capture-status');
    if (!statusEl) return;

    statusEl.textContent = message;
    statusEl.style.display = message ? 'block' : 'none';
}

function updatePollDraftPreview() {
    const previewEl = document.getElementById('poll-draft-preview');
    const questionEl = document.getElementById('poll-question-label');
    const options = getPollDraftOptions();
    if (!previewEl || !questionEl) return;

    if (!pendingPollQuestion) {
        previewEl.style.display = 'none';
        previewEl.innerHTML = '';
        questionEl.textContent = 'Sin encuesta activa';
        setPollCaptureStatus('');
        return;
    }

    questionEl.textContent = `Pregunta: ${pendingPollQuestion}`;
    previewEl.style.display = pollOptionsCaptureActive || options.length > 0 ? 'block' : 'none';
    previewEl.innerHTML = `
        <strong>Borrador por voz</strong><br>
        ${options.length > 0 ? options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('<br>') : 'Esperando opciones...'}
    `;
}

function finalizePendingPoll() {
    clearTimeout(pollOptionCommitTimer);
    clearTimeout(pollFinalizeTimer);

    const options = getPollDraftOptions();
    if (!pendingPollQuestion || options.length === 0) {
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        updatePollDraftPreview();
        setPollCaptureStatus('');
        addNotification('No se pudieron interpretar las opciones de la encuesta', true);
        addLog('Voz: encuesta cancelada por opciones inválidas');
        return;
    }

    emitPollStart(pendingPollQuestion, options);
    pollActive = true;
    pollOptionsCaptureActive = false;
    pollDraftOptions = [];
    pendingPollOption = null;
    document.getElementById('poll-results').innerHTML = '';
    document.getElementById('poll-question-label').textContent = `Pregunta: ${pendingPollQuestion}`;
    document.getElementById('poll-draft-preview').style.display = 'none';
    document.getElementById('poll-draft-preview').innerHTML = '';
    setPollCaptureStatus('');
    addNotification('Encuesta lanzada', false);
    addLog('Voz: encuesta iniciada');
}

function processVoiceCommand(transcript) {
    const normalizedTranscript = normalizeVoiceText(transcript);

    if (normalizedTranscript.includes('siguiente') || normalizedTranscript.includes('avanzar')) {
        nextSlide();
        addLog('Voz: siguiente');
        return;
    }
    if (
        normalizedTranscript.includes('anterior') ||
        normalizedTranscript.includes('retroceder') ||
        normalizedTranscript.includes('atras')
    ) {
        prevSlide();
        addLog('Voz: anterior');
        return;
    }
    const matchSlide = normalizedTranscript.match(/diapositiva\s+(\d+)/);
    if (matchSlide) {
        goToSlide(parseInt(matchSlide[1]));
        addLog('Voz: ir a diapositiva ' + matchSlide[1]);
        return;
    }

    if (
        normalizedTranscript.includes('iniciar') ||
        normalizedTranscript.includes('empezar') ||
        normalizedTranscript.includes('comenzar')
    ) {
        if (!isPresenting) togglePresentation();
        addLog('Voz: iniciar');
        return;
    }
    if (normalizedTranscript.includes('pausar') || normalizedTranscript.includes('pausa')) {
        if (isPresenting) togglePresentation();
        addLog('Voz: pausar');
        return;
    }

    if (normalizedTranscript === 'lanzar encuesta') {
        pendingPollQuestion = 'Encuesta rapida';
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        clearTimeout(pollOptionCommitTimer);
        clearTimeout(pollFinalizeTimer);
        setPollCaptureStatus('');
        updatePollDraftPreview();
        addNotification('Pregunta guardada: "Encuesta rapida". Di "opciones Si No" o "opciones A B C"', false);
        addLog('Voz: pregunta encuesta = "Encuesta rapida"');
        return;
    }

    const matchPoll = normalizedTranscript.match(/lanzar encuesta\s+(.+)/);
    if (matchPoll) {
        pendingPollQuestion = matchPoll[1].trim();
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        clearTimeout(pollOptionCommitTimer);
        clearTimeout(pollFinalizeTimer);
        setPollCaptureStatus('');
        updatePollDraftPreview();
        addNotification('Pregunta guardada: "' + pendingPollQuestion + '". Di "opciones Si No" o "opciones A B C"', false);
        addLog('Voz: pregunta encuesta = "' + pendingPollQuestion + '"');
        return;
    }

    if (pendingPollQuestion && normalizedTranscript === 'opciones') {
        startPollOptionsCapture();
        addNotification('Escuchando opciones de la encuesta...', false);
        addLog('Voz: captura de opciones iniciada');
        return;
    }

    const matchOptions = normalizedTranscript.match(/opciones\s+(.+)/);
    if (matchOptions && pendingPollQuestion) {
        startPollOptionsCapture(matchOptions[1].trim());
        addNotification('Opciones de encuesta en captura', false);
        addLog('Voz: opciones de encuesta capturadas');
        return;
    }

    if (pollOptionsCaptureActive && pendingPollQuestion && !isReservedCommand(normalizedTranscript)) {
        if (queuePollOption(normalizedTranscript)) {
            addLog('Voz: opcion de encuesta capturada');
        }
        return;
    }

    if (normalizedTranscript.includes('cerrar encuesta') || normalizedTranscript.includes('finalizar encuesta')) {
        emitPollEnd();
        pollActive = false;
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        clearTimeout(pollOptionCommitTimer);
        clearTimeout(pollFinalizeTimer);
        setPollCaptureStatus('');
        updatePollDraftPreview();
        addNotification('Encuesta cerrada', false);
        addLog('Voz: encuesta cerrada');
        return;
    }

    if (
        normalizedTranscript.includes('finalizar presentacion') ||
        normalizedTranscript.includes('terminar presentacion') ||
        normalizedTranscript.includes('cerrar presentacion')
    ) {
        confirmFinish();
        addLog('Voz: finalizar presentacion');
        return;
    }

    if (
        normalizedTranscript.includes('quitar zoom') ||
        normalizedTranscript.includes('quitar zum') ||
        normalizedTranscript.includes('reducir')
    ) {
        deactivateZoom();
        addLog('Voz: zoom desactivado');
        return;
    }
    if (
        normalizedTranscript.includes('zoom') ||
        normalizedTranscript.includes('zum') ||
        normalizedTranscript.includes('ampliar')
    ) {
        increaseZoom(0.5, 0.5);
        addLog('Voz: zoom activado (' + zoomScale.toFixed(2) + 'x)');
        return;
    }

    if (
        normalizedTranscript.includes('dejar de dibujar') ||
        normalizedTranscript.includes('salir dibujo') ||
        normalizedTranscript.includes('desactivar dibujo') ||
        normalizedTranscript.includes('desactivar dibujar')
    ) {
        if (drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo desactivado');
        return;
    }
    if (
        normalizedTranscript.includes('dibujar') ||
        normalizedTranscript.includes('modo dibujo') ||
        normalizedTranscript.includes('activar dibujo')
    ) {
        if (!drawingMode) toggleDrawingMode();
        addLog('Voz: dibujo activado');
        return;
    }
    if (normalizedTranscript.includes('borrar') || normalizedTranscript.includes('limpiar')) {
        clearDrawingCanvas();
        addNotification('Pizarra limpiada', false);
        addLog('Voz: borrar dibujo');
        return;
    }

    if (
        normalizedTranscript.includes('desactivar subtitulos') ||
        normalizedTranscript.includes('subtitulos off')
    ) {
        if (subtitlesActive) toggleSubtitles();
        addLog('Voz: subtitulos OFF');
        return;
    }
    if (
        normalizedTranscript.includes('activar subtitulos') ||
        normalizedTranscript.includes('subtitulos on') ||
        normalizedTranscript.includes('subtitulos')
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
        document.getElementById('btn-start').textContent = '\u25B6 Iniciar';
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
        addNotification(`? ${data.name} levantó la mano`, true);
    });

    socket.on('hand-lowered', (data) => {
        removeHandFromList(data.userId);
    });

    socket.on('presentation-state', (data) => {
        slides = data.slides || slides;
        updateSlideCounter();
        participants = data.participants || [];
        cameraSnapshots = data.cameraSnapshots || cameraSnapshots;
        renderParticipants(participants);
        syncAudioReceivers();

        if (Array.isArray(data.handRaised)) {
            document.getElementById('hands-list').innerHTML = '';
            data.handRaised.forEach((entry) => addHandToList(entry.userId, entry.name));
        }
    });

    socket.on('participants-updated', (data) => {
        participants = data || [];
        renderParticipants(participants);
        syncAudioReceivers();
    });

    socket.on('camera-frame', (data) => {
        cameraSnapshots[data.userId] = data.frame;
        renderParticipants(participants);
    });

    socket.on('camera-frame-cleared', (data) => {
        delete cameraSnapshots[data.userId];
        renderParticipants(participants);
    });

    socket.on('webrtc-offer', (data) => handleOffer(data.from, data.sdp));
    socket.on('webrtc-answer', (data) => handleAnswer(data.from, data.sdp));
    socket.on('webrtc-ice-candidate', (data) => handleIceCandidate(data.from, data.candidate));
    socket.on('audio-refresh', (data) => {
        if (data?.userId && data.userId !== socket.id) {
            rebuildAudioConnectionFor(data.userId);
        }
    });

    socket.on('poll-updated', (data) => {
        updatePollResults(data.results, data.total);
    });

    socket.on('poll-started', (data) => {
        updatePollResults(data.results, 0);
        addNotification(`\uD83D\uDCCA Encuesta iniciada: ${data.poll.question}`, false);
    });

    socket.on('poll-ended', (data) => {
        updatePollResults(data.results, null);
        addNotification('\uD83D\uDCCA Encuesta finalizada', false);
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
    el.innerHTML = `? ${name} <button onclick="dismissHand('${userId}')">Dar turno</button>`;
    container.appendChild(el);
}

function renderParticipants(list) {
    const container = document.getElementById('participants-list');
    if (!container) return;

    container.innerHTML = '';

    list.forEach((participant) => {
        const item = document.createElement('div');
        item.className = 'participant-item' + (participant.hasTurn ? ' turn-active' : '');

        const icon = participant.role === 'presenter' ? '\uD83C\uDFA4' : '\uD83D\uDC64';
        const roleLabel = participant.role === 'presenter' ? 'Presentador' : 'Espectador';
        const hand = participant.handRaised ? '<span class="participant-hand">\u270B</span>' : '';

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

function buildParticipantCard(participant, expanded) {
    const item = document.createElement('div');
    item.className = 'participant-item' + (participant.hasTurn ? ' turn-active' : '');

    const icon = participant.role === 'presenter' ? '\uD83C\uDFA4' : '\uD83D\uDC64';
    const roleLabel = participant.role === 'presenter' ? 'Presentador' : 'Espectador';
    const hand = participant.handRaised ? '<span class="participant-hand">\u270B</span>' : '';
    const cameraFrame = cameraSnapshots[participant.userId];
    const cameraContent = cameraFrame
        ? `<img src="${cameraFrame}" alt="Camara de ${participant.name}">`
        : `<div class="participant-camera-placeholder">${participant.cameraEnabled ? 'Camara activa' : 'Camara apagada'}</div>`;

    item.innerHTML = `
        <div class="participant-camera">${cameraContent}</div>
        <div class="participant-main">
            <span>${icon}</span>
            <span class="participant-name">${participant.name}</span>
        </div>
        <div class="participant-main">
            <span class="participant-role">${roleLabel}</span>
            ${hand}
        </div>
    `;

    if (!expanded) {
        item.style.minHeight = '0';
    }

    return item;
}

function renderParticipants(list) {
    const summaryContainer = document.getElementById('participants-list');
    const galleryContainer = document.getElementById('gallery-grid');
    if (!summaryContainer || !galleryContainer) return;

    summaryContainer.innerHTML = '';
    galleryContainer.innerHTML = '';

    list.slice(0, 4).forEach((participant) => {
        summaryContainer.appendChild(buildParticipantCard(participant, false));
    });

    list.forEach((participant) => {
        galleryContainer.appendChild(buildParticipantCard(participant, true));
    });
}

function toggleParticipantsView() {
    galleryExpanded = !galleryExpanded;
    document.body.classList.toggle('gallery-mode', galleryExpanded);
    const overlay = document.getElementById('gallery-overlay');
    if (overlay) {
        overlay.style.display = galleryExpanded ? 'block' : 'none';
    }
}

function updateCameraButton() {
    const btn = document.getElementById('btn-camera');
    if (!btn) return;
    btn.textContent = cameraEnabled ? '📷 Camara ON' : '📷 Camara OFF';
    btn.classList.toggle('active', cameraEnabled);
}

function toggleCamera() {
    const videoEl = document.getElementById('camera-feed');
    const videoTrack = videoEl?.srcObject?.getVideoTracks?.()[0];

    if (!videoTrack) {
        addNotification('No se pudo controlar la camara', true);
        return;
    }

    cameraEnabled = !cameraEnabled;
    videoTrack.enabled = cameraEnabled;
    syncLocalAudioTrackState();
    emitCameraStatus(cameraEnabled);
    updateCameraButton();

    if (cameraEnabled) {
        startCameraBroadcast(videoEl);
    } else {
        if (cameraBroadcastInterval) clearInterval(cameraBroadcastInterval);
        emitCameraClear();
    }

    if (micEnabled) emitAudioRefresh();
}

function updateMicButton() {
    const btn = document.getElementById('btn-mic');
    if (!btn) return;
    btn.textContent = micEnabled ? '🎤 Micro ON' : '🎤 Micro OFF';
    btn.classList.toggle('active', micEnabled);
}

function syncLocalAudioTrackState() {
    if (!localAudioTrack) return;
    localAudioTrack.enabled = micEnabled;

    audioPeerConnections.forEach((pc) => {
        pc.getSenders()
            .filter((sender) => sender.track && sender.track.kind === 'audio')
            .forEach((sender) => {
                sender.track.enabled = micEnabled;
            });
    });
}

async function toggleMicrophone() {
    if (micEnabled) {
        disableMicrophone();
        return;
    }

    try {
        if (!localAudioStream) {
            localAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            localAudioTrack = localAudioStream.getAudioTracks()[0];
        }

        micEnabled = true;
        syncLocalAudioTrackState();
        emitMicStatus(true);
        updateMicButton();
        syncAudioReceivers();
        emitAudioRefresh();
        addNotification('Microfono activado', false);
    } catch (error) {
        addNotification('No se pudo activar el microfono: ' + error.message, true);
    }
}

function disableMicrophone() {
    micEnabled = false;
    syncLocalAudioTrackState();
    emitMicStatus(false);
    updateMicButton();
    emitAudioRefresh();
}

function createPeerConnection(remoteId) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('webrtc-ice-candidate', {
                target: remoteId,
                candidate: event.candidate,
            });
        }
    };

    pc.ontrack = (event) => {
        attachRemoteAudio(remoteId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
            removeRemoteAudio(remoteId);
            audioPeerConnections.delete(remoteId);
        }
    };

    audioPeerConnections.set(remoteId, pc);
    return pc;
}

function attachRemoteAudio(remoteId, stream) {
    let audio = remoteAudioElements.get(remoteId);
    if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        remoteAudioElements.set(remoteId, audio);
        document.body.appendChild(audio);
    }

    if (audio.srcObject !== stream) {
        audio.srcObject = stream;
    }
}

function removeRemoteAudio(remoteId) {
    const audio = remoteAudioElements.get(remoteId);
    if (audio) {
        audio.srcObject = null;
        audio.remove();
        remoteAudioElements.delete(remoteId);
    }
}

function rebuildAudioConnectionFor(remoteId) {
    const pc = audioPeerConnections.get(remoteId);
    if (pc) {
        try { pc.close(); } catch {}
        audioPeerConnections.delete(remoteId);
    }
    removeRemoteAudio(remoteId);

    const participant = participants.find((entry) => entry.userId === remoteId);
    if (participant?.micEnabled) {
        setTimeout(() => createReceiveOffer(remoteId), 100);
    }
}

async function createReceiveOffer(remoteId) {
    const pc = audioPeerConnections.get(remoteId) || createPeerConnection(remoteId);
    if (pc.signalingState !== 'stable') return;

    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { target: remoteId, sdp: pc.localDescription });
}

function syncAudioReceivers() {
    participants
        .filter((participant) => participant.userId !== socket.id && participant.micEnabled)
        .forEach((participant) => {
            if (!audioPeerConnections.has(participant.userId)) {
                createReceiveOffer(participant.userId);
            }
        });

    audioPeerConnections.forEach((pc, remoteId) => {
        if (!participants.some((participant) => participant.userId === remoteId && participant.micEnabled)) {
            try { pc.close(); } catch {}
            removeRemoteAudio(remoteId);
            audioPeerConnections.delete(remoteId);
        }
    });
}

async function handleOffer(from, sdp) {
    const pc = audioPeerConnections.get(from) || createPeerConnection(from);

    if (localAudioTrack && !pc.getSenders().some((sender) => sender.track === localAudioTrack)) {
        pc.addTrack(localAudioTrack, localAudioStream);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { target: from, sdp: pc.localDescription });
}

async function handleAnswer(from, sdp) {
    const pc = audioPeerConnections.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIceCandidate(from, candidate) {
    const pc = audioPeerConnections.get(from);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {}
}

function setupExtendedPresenterHooks() {
    const videoEl = document.getElementById('camera-feed');
    updateCameraButton();
    updateMicButton();

    if (videoEl) {
        videoEl.addEventListener('loadeddata', () => {
            emitCameraStatus(true);
            startCameraBroadcast(videoEl);
        });
    }

    socket.on('camera-frame', (data) => {
        cameraSnapshots[data.userId] = data.frame;
        renderParticipants(participants);
    });

    socket.on('camera-frame-cleared', (data) => {
        delete cameraSnapshots[data.userId];
        renderParticipants(participants);
    });

    socket.on('poll-started', (data) => {
        pendingPollQuestion = data.poll.question;
        pollActive = true;
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        clearTimeout(pollOptionCommitTimer);
        clearTimeout(pollFinalizeTimer);
        setPollCaptureStatus('');
        const previewEl = document.getElementById('poll-draft-preview');
        if (previewEl) {
            previewEl.style.display = 'none';
            previewEl.innerHTML = '';
        }
        updatePollDraftPreview();
    });

    socket.on('poll-ended', () => {
        pollActive = false;
        const questionEl = document.getElementById('poll-question-label');
        if (questionEl && pendingPollQuestion) {
            questionEl.textContent = `Pregunta: ${pendingPollQuestion} (cerrada)`;
        }
        pollOptionsCaptureActive = false;
        pollDraftOptions = [];
        pendingPollOption = null;
        clearTimeout(pollOptionCommitTimer);
        clearTimeout(pollFinalizeTimer);
        setPollCaptureStatus('');
    });

    socket.on('presentation-state', (data) => {
        cameraSnapshots = data.cameraSnapshots || cameraSnapshots;
        if (data.currentPoll?.question) {
            pendingPollQuestion = data.currentPoll.question;
            document.getElementById('poll-question-label').textContent = `Pregunta: ${pendingPollQuestion}`;
        }
        renderParticipants(data.participants || participants);
    });
}

window.addEventListener('load', setupExtendedPresenterHooks);



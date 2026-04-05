// =============================================
// VARIABLES GLOBALES
// =============================================
let userName = '';
let handRaised = false;
let gestureDetectionActive = false;
let hasVoted = false;
let slides = [];
let participants = [];
let cameraSnapshots = {};
let galleryExpanded = false;
let cameraBroadcastInterval = null;
let cameraEnabled = true;
let micEnabled = false;
let micAllowed = false;
let micTurnTimer = null;
let localAudioStream = null;
let localAudioTrack = null;
const audioPeerConnections = new Map();
const remoteAudioElements = new Map();
const TURN_DURATION_MS = 2 * 60 * 1000;

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
    emitRegisterParticipant('audience', userName);

    // Arrancar todo una vez tenemos nombre
    initSocketListeners();
    initCamera();
    initDrawingCanvas();
    addNotification(`Bienvenido, ${userName} \uD83D\uDC4B`, false);
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
            document.getElementById('status-gesture-detect').textContent = '\uD83D\uDC4B Detección: ON';
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
    }
}

function detectAudienceGesture(lm) {
    const thumbUp  = lm[4].y  < lm[3].y;
    const indexUp  = lm[8].y  < lm[6].y;
    const middleUp = lm[12].y < lm[10].y;
    const ringUp   = lm[16].y < lm[14].y;
    const pinkyUp  = lm[20].y < lm[18].y;

    // MANO ABIERTA (todos los dedos arriba) ? levantar mano
    if (thumbUp && indexUp && middleUp && ringUp && pinkyUp) return 'hand_up';

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
    setHandRaised(true, true);
    addNotification('\u270B Mano levantada — el presentador ha sido notificado', false);
}

function lowerHand() {
    setHandRaised(false, true);
}

function setHandRaised(active, shouldEmit) {
    handRaised = active;
    const btn = document.getElementById('btn-hand');
    const status = document.getElementById('status-hand');

    if (active) {
        if (shouldEmit) emitRaiseHand(userName);
        btn.textContent = '\u270B Bajar mano';
        btn.classList.add('active');
        status.textContent = '\u270B Mano: ON';
        status.classList.add('active');
    } else {
        if (shouldEmit) emitLowerHand();
        btn.textContent = '\u270B Levantar mano';
        btn.classList.remove('active');
        status.textContent = '\u270B Mano: OFF';
        status.classList.remove('active');
    }
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
    addNotification(`\uD83D\uDCCA Votaste: ${option}`, false);
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
    const section = document.getElementById('poll-section');
    const question = document.getElementById('poll-question');
    const options = document.getElementById('poll-options');
    const resultsEl = document.getElementById('poll-results');
    const votedMsg = document.getElementById('poll-voted-msg');

    options.innerHTML = '';
    resultsEl.innerHTML = '';
    question.textContent = '';
    votedMsg.style.display = 'none';
    hasVoted = false;
    section.style.display = 'none';
    addNotification('\uD83D\uDCCA Encuesta finalizada', false);
}

// =============================================
// SOCKET LISTENERS
// =============================================
function initSocketListeners() {
    emitRequestPresentationState();
  
    // --- DIAPOSITIVAS -----------------------------------------
    socket.on('presentation-state', (data) => {
        slides = data.slides || [];
        // Cargar diapositiva actual al conectarse
        if (slides.length > 0 && data.currentSlide < slides.length) {
            const img = document.getElementById('slide-img');
            img.src = slides[data.currentSlide].url;
        }
        updateSlideCounter(data.currentSlide, data.totalSlides);
        updatePresentingStatus(data.isPresenting);
        participants = data.participants || [];
        renderParticipants(participants);
        syncAudienceAudioReceivers();

        if (data.zoomActive) {
            applyZoomState(true, data.zoomTarget, data.zoomScale);
        } else {
            applyZoomState(false, data.zoomTarget, 1);
        }
        if (data.currentPoll) {
            renderPoll(data.currentPoll, data.pollResults);
        }
    });

    socket.on('slide-changed', (data) => {
        const img = document.getElementById('slide-img');
        if (slides.length > data.slide) {
            img.src = slides[data.slide].url;
        }
        updateSlideCounter(data.slide, null);
        clearDrawingCanvas();
    });

    socket.on('total-slides-set', (data) => {
        updateSlideCounter(null, data.total);
    });

    socket.on('presentation-toggled', (data) => {
        updatePresentingStatus(data.isPresenting);
    });

    socket.on('participants-updated', (data) => {
        participants = data || [];
        renderParticipants(participants);
        syncAudienceAudioReceivers();
    });

    // --- PUNTERO ----------------------------------------------
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

    // --- ZOOM -------------------------------------------------
    socket.on('zoom-activated', (data) => {
        applyZoomState(true, data.target, data.scale);
    });

    socket.on('zoom-deactivated', () => {
        applyZoomState(false, { x: 0.5, y: 0.5 }, 1);
    });

    // --- DIBUJO -----------------------------------------------
    socket.on('draw-point', (data) => {
        applyDrawPoint(data);
    });

    socket.on('drawing-cleared', () => {
        clearDrawingCanvas();
    });

    socket.on('drawing-history', (strokes) => {
        strokes.forEach(point => applyDrawPoint(point));
    });

    // --- SUBTÍTULOS -------------------------------------------
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

    // --- ENCUESTA ---------------------------------------------
    socket.on('poll-started', (data) => {
        renderPoll(data.poll, data.results);
        addNotification('\uD83D\uDCCA Nueva encuesta disponible', false);
    });

    socket.on('poll-updated', (data) => {
        renderPollResults(data.results, data.total);
    });

    socket.on('poll-ended', (data) => {
        closePoll(data.results);
    });

    // --- MANOS ------------------------------------------------
    socket.on('hand-lowered', (data) => {
        if (data.userId === socket.id && handRaised) {
            setHandRaised(false, false);
        }
    });

    socket.on('turn-granted', () => {
        setHandRaised(false, false);
        startTurnWindow();
        addNotification('\uD83C\uDFA4 ¡El presentador te ha dado el turno de palabra!', false);
        playTurnGrantedSound();
    });

    socket.on('webrtc-offer', (data) => handleAudienceOffer(data.from, data.sdp));
    socket.on('webrtc-answer', (data) => handleAudienceAnswer(data.from, data.sdp));
    socket.on('webrtc-ice-candidate', (data) => handleAudienceIceCandidate(data.from, data.candidate));
    socket.on('audio-refresh', (data) => {
        if (data?.userId && data.userId !== socket.id) {
            rebuildAudienceAudioConnectionFor(data.userId);
        }
    });
}

function applyZoomState(active, target = { x: 0.5, y: 0.5 }, scale = 1) {
    const overlay = document.getElementById('zoom-overlay');
    overlay.style.display = active ? 'block' : 'none';

    const appliedScale = active ? scale : 1;
    const origin = `${target.x * 100}% ${target.y * 100}%`;

    ['slide-img', 'draw-canvas'].forEach((id) => {
        const element = document.getElementById(id);
        element.style.transformOrigin = origin;
        element.style.transform = `scale(${appliedScale})`;
    });
}

function playTurnGrantedSound() {
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
        el.textContent = '\u25B6 Presentación en curso';
        el.classList.add('active');
    } else {
        el.textContent = '\u23F8 Presentación no iniciada';
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

function startAudienceCameraBroadcast(videoEl) {
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

function buildAudienceParticipantCard(participant, expanded) {
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

    const summaryParticipants = list.filter((participant) => participant.role === 'presenter');
    (summaryParticipants.length ? summaryParticipants : list.slice(0, 1)).forEach((participant) => {
        summaryContainer.appendChild(buildAudienceParticipantCard(participant, false));
    });

    list.forEach((participant) => {
        galleryContainer.appendChild(buildAudienceParticipantCard(participant, true));
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
    syncAudienceLocalAudioTrackState();
    emitCameraStatus(cameraEnabled);
    updateCameraButton();

    if (cameraEnabled) {
        startAudienceCameraBroadcast(videoEl);
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
    btn.disabled = !micAllowed && !micEnabled;
}

function syncAudienceLocalAudioTrackState() {
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
    if (!micAllowed) {
        addNotification('Solo puedes activar el micro cuando te conceden turno', true);
        return;
    }

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
        syncAudienceLocalAudioTrackState();
        emitMicStatus(true);
        updateMicButton();
        syncAudienceAudioReceivers();
        emitAudioRefresh();
        addNotification('Microfono activado', false);
    } catch (error) {
        addNotification('No se pudo activar el microfono: ' + error.message, true);
    }
}

function disableMicrophone() {
    micEnabled = false;
    syncAudienceLocalAudioTrackState();
    emitMicStatus(false);
    updateMicButton();
    emitAudioRefresh();
}

function startTurnWindow() {
    micAllowed = true;
    updateMicButton();
    clearTimeout(micTurnTimer);
    micTurnTimer = setTimeout(() => {
        disableMicrophone();
        micAllowed = false;
        updateMicButton();
        emitReleaseTurn();
        addNotification('Tu turno de palabra ha finalizado', true);
    }, TURN_DURATION_MS);
}

function createAudiencePeerConnection(remoteId) {
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
        attachAudienceRemoteAudio(remoteId, event.streams[0]);
    };

    pc.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
            removeAudienceRemoteAudio(remoteId);
            audioPeerConnections.delete(remoteId);
        }
    };

    audioPeerConnections.set(remoteId, pc);
    return pc;
}

function attachAudienceRemoteAudio(remoteId, stream) {
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

function removeAudienceRemoteAudio(remoteId) {
    const audio = remoteAudioElements.get(remoteId);
    if (audio) {
        audio.srcObject = null;
        audio.remove();
        remoteAudioElements.delete(remoteId);
    }
}

function rebuildAudienceAudioConnectionFor(remoteId) {
    const pc = audioPeerConnections.get(remoteId);
    if (pc) {
        try { pc.close(); } catch {}
        audioPeerConnections.delete(remoteId);
    }
    removeAudienceRemoteAudio(remoteId);

    const participant = participants.find((entry) => entry.userId === remoteId);
    if (participant?.micEnabled) {
        setTimeout(() => createAudienceReceiveOffer(remoteId), 100);
    }
}

async function createAudienceReceiveOffer(remoteId) {
    const pc = audioPeerConnections.get(remoteId) || createAudiencePeerConnection(remoteId);
    if (pc.signalingState !== 'stable') return;

    pc.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { target: remoteId, sdp: pc.localDescription });
}

function syncAudienceAudioReceivers() {
    participants
        .filter((participant) => participant.userId !== socket.id && participant.micEnabled)
        .forEach((participant) => {
            if (!audioPeerConnections.has(participant.userId)) {
                createAudienceReceiveOffer(participant.userId);
            }
        });

    audioPeerConnections.forEach((pc, remoteId) => {
        if (!participants.some((participant) => participant.userId === remoteId && participant.micEnabled)) {
            try { pc.close(); } catch {}
            removeAudienceRemoteAudio(remoteId);
            audioPeerConnections.delete(remoteId);
        }
    });
}

async function handleAudienceOffer(from, sdp) {
    const pc = audioPeerConnections.get(from) || createAudiencePeerConnection(from);

    if (localAudioTrack && !pc.getSenders().some((sender) => sender.track === localAudioTrack)) {
        pc.addTrack(localAudioTrack, localAudioStream);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { target: from, sdp: pc.localDescription });
}

async function handleAudienceAnswer(from, sdp) {
    const pc = audioPeerConnections.get(from);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleAudienceIceCandidate(from, candidate) {
    const pc = audioPeerConnections.get(from);
    if (!pc) return;
    try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {}
}

function setupExtendedAudienceHooks() {
    const videoEl = document.getElementById('camera-feed');
    updateCameraButton();
    updateMicButton();

    if (videoEl) {
        videoEl.addEventListener('loadeddata', () => {
            emitCameraStatus(true);
            startAudienceCameraBroadcast(videoEl);
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

    socket.on('presentation-state', (data) => {
        cameraSnapshots = data.cameraSnapshots || cameraSnapshots;
        renderParticipants(data.participants || participants);
    });
}

window.addEventListener('load', setupExtendedAudienceHooks);



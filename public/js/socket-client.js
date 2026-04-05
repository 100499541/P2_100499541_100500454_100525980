// Conexión al servidor Socket.IO
const socket = io();

// Estado local de la presentación
const state = {
    currentSlide: 0,
    totalSlides: 0,
    isPresenting: false,
};

// Sincronizar estado al conectarse
socket.on('presentation-state', (data) => {
    state.currentSlide = data.currentSlide;
    state.totalSlides = data.totalSlides;
    state.isPresenting = data.isPresenting;
});

// ─── HELPERS PRESENTADOR ──────────────────────────────────────

function emitChangeSlide(index) {
    socket.emit('change-slide', { slide: index });
}

function emitTogglePresentation(isPresenting) {
    socket.emit('toggle-presentation', { isPresenting });
}

function emitZoomActivate(x, y, scale = 1) {
    socket.emit('zoom-activate', { target: { x, y }, scale });
}

function emitZoomDeactivate() {
    socket.emit('zoom-deactivate');
}

function emitPointerMove(x, y) {
    socket.emit('pointer-move', { x, y });
}

function emitPointerHide() {
    socket.emit('pointer-hide');
}

function emitSetTotalSlides(total, slides = []) {
    socket.emit('set-total-slides', { total, slides });
}

// ─── DIBUJO ───────────────────────────────────────────────────

function emitDrawPoint(x, y, isStart, color = '#ff4757', width = 4) {
    socket.emit('draw-point', { x, y, isStart, color, width });
}

function emitDrawingClear() {
    socket.emit('drawing-clear');
}

// ─── SUBTÍTULOS ───────────────────────────────────────────────

function emitSubtitle(text) {
    socket.emit('subtitle', { text });
}

// ─── ENCUESTA ─────────────────────────────────────────────────

function emitPollStart(question, options) {
    socket.emit('poll-start', { question, options });
}

function emitPollEnd() {
    socket.emit('poll-end');
}

// ─── HELPERS ESPECTADOR ───────────────────────────────────────

function emitRaiseHand(name) {
    socket.emit('raise-hand', { name });
}

function emitLowerHand() {
    socket.emit('lower-hand');
}

function emitPollVote(option) {
    socket.emit('poll-vote', { option });
}

function emitGrantTurn(userId) {
    socket.emit('grant-turn', { userId });
}

function emitRequestPresentationState() {
    socket.emit('request-presentation-state');
}

function emitRegisterParticipant(role, name) {
    socket.emit('register-participant', { role, name });
}

function emitCameraStatus(enabled) {
    socket.emit('camera-status', { enabled });
}

function emitCameraFrame(frame) {
    socket.emit('camera-frame', { frame });
}

function emitCameraClear() {
    socket.emit('camera-clear');
}

function emitMicStatus(enabled) {
    socket.emit('mic-status', { enabled });
}

function emitReleaseTurn() {
    socket.emit('release-turn');
}

function emitAudioRefresh() {
    socket.emit('audio-refresh');
}

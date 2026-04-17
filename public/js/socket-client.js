// Capa cliente de comunicacion en tiempo real.
// Este fichero encapsula la emision de eventos y ofrece una interfaz comun
// para los modulos de presentador y audiencia.
// Conexion al servidor Socket.IO
const socket = io();

// Estado minimo compartido por los clientes.
// Su finalidad es mantener una referencia ligera del progreso general de la
// presentacion para sincronizar la interfaz local.
// Estado local de la presentacion
const state = {
    currentSlide: 0,
    totalSlides: 0,
    isPresenting: false,
};

// Sincronizacion inicial con el estado difundido por el servidor.
// Este bloque actualiza la copia local de la sesion tan pronto como la
// conexion queda establecida.
// Sincronizar estado al conectarse
socket.on('presentation-state', (data) => {
    state.currentSlide = data.currentSlide;
    state.totalSlides = data.totalSlides;
    state.isPresenting = data.isPresenting;
});

// Primitivas de emision asociadas al rol de presentador.
// Agrupan las acciones de control global de la sesion para desacoplar la
// interfaz del detalle del protocolo de eventos.
// Helpers del presentador

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

// Operaciones de anotacion compartida.
// Este apartado envia los eventos necesarios para propagar trazos y acciones
// de limpieza sobre la capa de dibujo colaborativo.
// Dibujo

function emitDrawPoint(x, y, isStart, color = '#ff4757', width = 4) {
    socket.emit('draw-point', { x, y, isStart, color, width });
}

function emitDrawingClear() {
    socket.emit('drawing-clear');
}

// Emision de subtitulos.
// Su funcionalidad consiste en transferir el texto reconocido para mejorar
// la accesibilidad y la comprension de la presentacion.
// Subtitulos

function emitSubtitle(text) {
    socket.emit('subtitle', { text });
}

// Gestion de encuestas desde el cliente.
// Estas funciones permiten iniciar y finalizar dinamicas de participacion
// que despues son coordinadas por el servidor.
// Encuesta

function emitPollStart(question, options) {
    socket.emit('poll-start', { question, options });
}

function emitPollEnd() {
    socket.emit('poll-end');
}

// Primitivas de interaccion para la audiencia.
// Este bloque reune las acciones con las que los espectadores participan,
// solicitan turno y sincronizan sus capacidades audiovisuales.
// Helpers del espectador

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

function emitRevokeTurn(userId) {
    socket.emit('revoke-turn', { userId });
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

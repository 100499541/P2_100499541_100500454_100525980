// Capa cliente de comunicación en tiempo real
// Este fichero encapsula la emisión de eventos y ofrece una interfaz común para que el resto de módulos interactúe con el servidor a través de Socket.IO, 
// sin necesidad de conocer los detalles del protocolo de eventos
// -------------------- CONEXION Y ESTADO COMPARTIDO --------------------
const socket = io();

// Estado mínimo compartido por los clientes
// Su finalidad es conservar una referencia ligera del progreso general de la presentación, que se actualiza a través de eventos difundidos por el servidor 
// y puede ser consultada por cualquier módulo para adaptar su comportamiento o interfaz
const state = {
    currentSlide: 0,
    totalSlides: 0,
    isPresenting: false,
};

// Sincronización inicial con el estado difundido por el servidor
// Este bloque actualiza la copia local de la sesión tan pronto como la conexión se establece, 
// asegurando que el cliente refleje el estado actual de la presentación desde el primer momento, incluso si se une a mitad de la sesión
socket.on('presentation-state', (data) => {
    state.currentSlide = data.currentSlide;
    state.totalSlides = data.totalSlides;
    state.isPresenting = data.isPresenting;
});

// Primitivas de emisión asociadas al rol de presentador
// Agrupan las acciones de control global de la sesión para desacoplar la lógica de presentación de los detalles de comunicación, 
// permitiendo que el resto de módulos llamen a estas funciones sin preocuparse por la estructura de los eventos o la conexión con el servidor

// -------------------- EMISIONES DEL PRESENTADOR --------------------
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

// Operaciones de anotación compartida
// Este apartado envía los eventos necesarios para propagar trazos y acciones de dibujo colaborativo, 
// permitiendo que los participantes puedan interactuar visualmente sobre las diapositivas o un lienzo común, con una experiencia sincronizada y fluida

// -------------------- DIBUJO COLABORATIVO --------------------
function emitDrawPoint(x, y, isStart, color = '#ff4757', width = 4) {
    socket.emit('draw-point', { x, y, isStart, color, width });
}

function emitDrawingClear() {
    socket.emit('drawing-clear');
}

// Emisión de subtítulos
// Su funcionalidad consiste en transferir el texto reconocido para mejorar la accesibilidad y el seguimiento de la presentación, 
// sin que el servidor intervenga en el proceso de reconocimiento, actuando solo como un relay para distribuir los subtítulos a todos los clientes conectados

// -------------------- SUBTITULOS --------------------
function emitSubtitle(text) {
    socket.emit('subtitle', { text });
}

// Gestión de encuestas desde el cliente
// Estas funciones permiten iniciar y finalizar dinámicas de participación durante la presentación, facilitando la interacción con la audiencia 
// y la obtención de feedback en tiempo real a través de preguntas y opciones de respuesta

// -------------------- ENCUESTAS --------------------
function emitPollStart(question, options) {
    socket.emit('poll-start', { question, options });
}

function emitPollEnd() {
    socket.emit('poll-end');
}

// Primitivas de interacción para la audiencia
// Este bloque reúne las acciones con las que los espectadores participan, como solicitar el turno de palabra, votar en encuestas o compartir su estado de cámara y micrófono,

// -------------------- EMISIONES DE LA AUDIENCIA --------------------
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

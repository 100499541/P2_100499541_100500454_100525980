const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/presenter', (req, res) => {
    res.sendFile(__dirname + '/public/presenter/presenter.html');
});

app.get('/audience', (req, res) => {
    res.sendFile(__dirname + '/public/audience/audience.html');
});

// Estado compartido
let presentationState = {
    currentSlide: 0,
    totalSlides: 0,
    isPresenting: false,
    zoomActive: false,
    zoomTarget: { x: 0, y: 0 },
    handRaised: [],
    pointerPosition: null,
    drawingStrokes: [],   // historial de trazos para nuevos espectadores
    currentPoll: null,    // encuesta activa
    pollResults: {},      // votos por opción
    pollVoters: [],       // sockets que ya han votado
};

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);

    // Enviar estado actual al nuevo usuario
    socket.emit('presentation-state', presentationState);

    // Si hay trazos previos, enviarlos al nuevo espectador
    if (presentationState.drawingStrokes.length > 0) {
        socket.emit('drawing-history', presentationState.drawingStrokes);
    }

    // Si hay encuesta activa, enviarla al nuevo espectador
    if (presentationState.currentPoll) {
        socket.emit('poll-started', {
            poll: presentationState.currentPoll,
            results: presentationState.pollResults,
        });
    }

    // ─── EVENTOS DEL PRESENTADOR ───────────────────────────────

    socket.on('change-slide', (data) => {
        presentationState.currentSlide = data.slide;
        // Al cambiar diapositiva, limpiar trazos
        presentationState.drawingStrokes = [];
        io.emit('slide-changed', { slide: data.slide });
        io.emit('drawing-cleared');
        console.log(`Diapositiva: ${data.slide}`);
    });

    socket.on('toggle-presentation', (data) => {
        presentationState.isPresenting = data.isPresenting;
        io.emit('presentation-toggled', { isPresenting: data.isPresenting });
    });

    socket.on('zoom-activate', (data) => {
        presentationState.zoomActive = true;
        presentationState.zoomTarget = data.target;
        io.emit('zoom-activated', data);
    });

    socket.on('zoom-deactivate', () => {
        presentationState.zoomActive = false;
        io.emit('zoom-deactivated');
    });

    socket.on('pointer-move', (data) => {
        presentationState.pointerPosition = data;
        socket.broadcast.emit('pointer-moved', data);
    });

    socket.on('pointer-hide', () => {
        presentationState.pointerPosition = null;
        socket.broadcast.emit('pointer-hidden');
    });

    socket.on('set-total-slides', (data) => {
        presentationState.totalSlides = data.total;
        presentationState.slides = data.slides || [];
        io.emit('total-slides-set', { total: data.total });
        // Reenviar estado completo para espectadores que se conecten tarde
        io.emit('presentation-state', presentationState);
    });

    // ─── DIBUJO ───────────────────────────────────────────────

    // El presentador emite cada punto mientras dibuja
    socket.on('draw-point', (data) => {
        // data: { x, y, isStart, color, width }
        presentationState.drawingStrokes.push(data);
        socket.broadcast.emit('draw-point', data);
    });

    // Limpiar pizarra manualmente
    socket.on('drawing-clear', () => {
        presentationState.drawingStrokes = [];
        io.emit('drawing-cleared');
    });

    // ─── SUBTÍTULOS ───────────────────────────────────────────

    // El presentador emite el texto reconocido por voz
    socket.on('subtitle', (data) => {
        // data: { text }
        socket.broadcast.emit('subtitle', data);
    });

    // ─── ENCUESTA ─────────────────────────────────────────────

    socket.on('poll-start', (data) => {
        // data: { question, options: ['Sí', 'No', ...] }
        presentationState.currentPoll = data;
        presentationState.pollResults = {};
        presentationState.pollVoters = [];
        data.options.forEach(opt => {
            presentationState.pollResults[opt] = 0;
        });
        io.emit('poll-started', {
            poll: data,
            results: presentationState.pollResults,
        });
        console.log(`Encuesta iniciada: ${data.question}`);
    });

    socket.on('poll-vote', (data) => {
        // data: { option }
        if (!presentationState.currentPoll) return;
        if (presentationState.pollVoters.includes(socket.id)) return; // un voto por persona

        presentationState.pollVoters.push(socket.id);
        if (presentationState.pollResults[data.option] !== undefined) {
            presentationState.pollResults[data.option]++;
        }
        io.emit('poll-updated', {
            results: presentationState.pollResults,
            total: presentationState.pollVoters.length,
        });
    });

    socket.on('poll-end', () => {
        presentationState.currentPoll = null;
        io.emit('poll-ended', { results: presentationState.pollResults });
    });

    // ─── ESPECTADORES ─────────────────────────────────────────

    socket.on('raise-hand', (data) => {
        if (!data || !data.name) {
            console.log("⚠️ Usuario sin nombre levantó la mano");
        }

        io.emit('hand-raised', {
            userId: socket.id,
            name: data?.name || "Anónimo"
        });
    });

    socket.on('lower-hand', () => {
        presentationState.handRaised = presentationState.handRaised.filter(id => id !== socket.id);
        io.emit('hand-lowered', { userId: socket.id });
    });

    // ─── DESCONEXIÓN ──────────────────────────────────────────

    socket.on('disconnect', () => {
        presentationState.handRaised = presentationState.handRaised.filter(id => id !== socket.id);
        io.emit('hand-lowered', { userId: socket.id });
        console.log(`Desconectado: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
const express = require('express');
const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const SLIDES_DIR = path.join(__dirname, 'public', 'slides');

app.use(express.static('public'));

async function getSlidesList() {
    try {
        const entries = await fs.readdir(SLIDES_DIR, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
            .map((name, index) => ({
                id: index,
                name,
                url: `/slides/${encodeURIComponent(name)}`,
            }));
    } catch (error) {
        console.error('Error cargando diapositivas:', error.message);
        return [];
    }
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

app.get('/presenter', (req, res) => {
    res.sendFile(__dirname + '/public/presenter/presenter.html');
});

app.get('/audience', (req, res) => {
    res.sendFile(__dirname + '/public/audience/audience.html');
});

app.get('/api/slides', async (req, res) => {
    const slides = await getSlidesList();
    res.json({ slides, total: slides.length });
});

// Estado compartido
let presentationState = {
    currentSlide: 0,
    totalSlides: 0,
    slides: [],
    isPresenting: false,
    zoomActive: false,
    zoomScale: 1,
    zoomTarget: { x: 0, y: 0 },
    handRaised: [],
    pointerPosition: null,
    drawingStrokes: [],   // historial de trazos para nuevos espectadores
    currentPoll: null,    // encuesta activa
    pollResults: {},      // votos por opción
    pollVoters: [],       // sockets que ya han votado
};
const participants = new Map();
const cameraSnapshots = new Map();

function getParticipantsSnapshot() {
    return Array.from(participants.values())
        .sort((a, b) => {
            if (a.role === b.role) return a.name.localeCompare(b.name, 'es');
            return a.role === 'presenter' ? -1 : 1;
        });
}

function broadcastParticipants() {
    const snapshot = getParticipantsSnapshot();
    io.emit('participants-updated', snapshot);
    return snapshot;
}

io.on('connection', (socket) => {
    console.log(`Usuario conectado: ${socket.id}`);
    const emitInitialState = async () => {
        if (!presentationState.slides.length) {
            presentationState.slides = await getSlidesList();
            presentationState.totalSlides = presentationState.slides.length;
        }
        socket.emit('presentation-state', {
            ...presentationState,
            participants: getParticipantsSnapshot(),
            cameraSnapshots: Object.fromEntries(cameraSnapshots),
        });
    };

    emitInitialState();

    socket.on('request-presentation-state', () => {
        emitInitialState();
    });

    socket.on('register-participant', (data) => {
        const role = data?.role === 'presenter' ? 'presenter' : 'audience';
        const fallbackName = role === 'presenter' ? 'Presentador' : 'Espectador';
        participants.set(socket.id, {
            userId: socket.id,
            role,
            name: (data?.name || fallbackName).trim() || fallbackName,
            handRaised: participants.get(socket.id)?.handRaised || false,
            hasTurn: participants.get(socket.id)?.hasTurn || false,
            cameraEnabled: participants.get(socket.id)?.cameraEnabled || false,
        });
        broadcastParticipants();
    });

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
        presentationState.zoomScale = data.scale || presentationState.zoomScale || 1;
        io.emit('zoom-activated', data);
    });

    socket.on('zoom-deactivate', () => {
        presentationState.zoomActive = false;
        presentationState.zoomScale = 1;
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
        presentationState.slides = Array.isArray(data.slides) ? data.slides : presentationState.slides;
        io.emit('total-slides-set', { total: data.total });
        // Reenviar estado completo para espectadores que se conecten tarde
        io.emit('presentation-state', {
            ...presentationState,
            participants: getParticipantsSnapshot(),
        });
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
        presentationState.pollVoters = [];
        io.emit('poll-ended', { results: presentationState.pollResults });
    });

    socket.on('camera-status', (data) => {
        if (!participants.has(socket.id)) return;

        const participant = participants.get(socket.id);
        participant.cameraEnabled = !!data?.enabled;
        participants.set(socket.id, participant);
        broadcastParticipants();
    });

    socket.on('camera-frame', (data) => {
        if (!data?.frame) return;

        cameraSnapshots.set(socket.id, data.frame);
        io.emit('camera-frame', {
            userId: socket.id,
            frame: data.frame,
        });
    });

    // ─── ESPECTADORES ─────────────────────────────────────────

    socket.on('raise-hand', (data) => {
        if (!data || !data.name) {
            console.log("⚠️ Usuario sin nombre levantó la mano");
        }

        const existing = presentationState.handRaised.find((entry) => entry.userId === socket.id);
        if (!existing) {
            presentationState.handRaised.push({
                userId: socket.id,
                name: data?.name || 'Anónimo',
            });
        }

        if (participants.has(socket.id)) {
            const participant = participants.get(socket.id);
            participant.handRaised = true;
            participant.name = data?.name || participant.name;
            participants.set(socket.id, participant);
            broadcastParticipants();
        }

        io.emit('hand-raised', {
            userId: socket.id,
            name: data?.name || "Anónimo"
        });
    });

    socket.on('lower-hand', () => {
        presentationState.handRaised = presentationState.handRaised.filter((entry) => entry.userId !== socket.id);
        if (participants.has(socket.id)) {
            const participant = participants.get(socket.id);
            participant.handRaised = false;
            participants.set(socket.id, participant);
            broadcastParticipants();
        }
        io.emit('hand-lowered', { userId: socket.id });
    });

    socket.on('grant-turn', (data) => {
        const targetUserId = data?.userId;
        if (!targetUserId) return;

        participants.forEach((participant, participantId) => {
            participant.hasTurn = participantId === targetUserId;
            participants.set(participantId, participant);
        });
        presentationState.handRaised = presentationState.handRaised.filter((entry) => entry.userId !== targetUserId);
        if (participants.has(targetUserId)) {
            const participant = participants.get(targetUserId);
            participant.handRaised = false;
            participants.set(targetUserId, participant);
            broadcastParticipants();
        }
        io.emit('hand-lowered', { userId: targetUserId });
        io.to(targetUserId).emit('turn-granted', {
            userId: targetUserId,
            grantedBy: socket.id,
        });
    });

    // ─── DESCONEXIÓN ──────────────────────────────────────────

    socket.on('disconnect', () => {
        presentationState.handRaised = presentationState.handRaised.filter((entry) => entry.userId !== socket.id);
        participants.delete(socket.id);
        cameraSnapshots.delete(socket.id);
        broadcastParticipants();
        io.emit('hand-lowered', { userId: socket.id });
        io.emit('camera-frame-cleared', { userId: socket.id });
        console.log(`Desconectado: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

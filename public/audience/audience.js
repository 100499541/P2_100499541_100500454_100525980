// CONEXIÓN
const socket = io();
const userName = prompt("Introduce tu nombre") || "Usuario";

// REGISTRAR COMO AUDIENCE
socket.emit('register-role', 'audience');

// ELEMENTOS
const slideImage = document.getElementById('slide-image');
const pointer = document.getElementById('pointer');
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');

const subtitleText = document.getElementById('subtitle-text');

const pollContainer = document.getElementById('poll-container');
const pollQuestion = document.getElementById('poll-question');
const pollOptions = document.getElementById('poll-options');
const pollResults = document.getElementById('poll-results');

const raiseHandBtn = document.getElementById('raise-hand-btn');

// AJUSTAR CANVAS AL TAMAÑO
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);



// =========================
// 🎞️ SLIDES
// =========================
socket.on('slide-changed', (data) => {
    // data: { index, url }
    slideImage.src = data.url;
});



// =========================
// 🔴 PUNTERO
// =========================
socket.on('pointer-moved', (data) => {
    // data: { x, y }
    pointer.style.display = 'block';
    pointer.style.left = `${data.x * window.innerWidth}px`;
    pointer.style.top = `${data.y * window.innerHeight}px`;
});

socket.on('pointer-hidden', () => {
    pointer.style.display = 'none';
});



// =========================
// 🔍 ZOOM
// =========================
socket.on('zoom-activated', (data) => {
    // data: { scale }
    slideImage.style.transform = `scale(${data.scale})`;
});

socket.on('zoom-reset', () => {
    slideImage.style.transform = 'scale(1)';
});



// =========================
// ✏️ DIBUJO
// =========================
socket.on('draw-point', (data) => {
    // data: { x, y }
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(
        data.x * canvas.width,
        data.y * canvas.height,
        3,
        0,
        Math.PI * 2
    );
    ctx.fill();
});

socket.on('clear-draw', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});



// =========================
// 💬 SUBTÍTULOS
// =========================
socket.on('subtitle', (text) => {
    subtitleText.textContent = text;

    // auto fade
    setTimeout(() => {
        subtitleText.textContent = '';
    }, 4000);
});



// =========================
// 🗳️ ENCUESTAS
// =========================
socket.on('poll-started', (data) => {
    // data: { question, options }
    pollContainer.classList.remove('hidden');
    pollResults.classList.add('hidden');

    pollQuestion.textContent = data.question;
    pollOptions.innerHTML = '';

    data.options.forEach((option, index) => {
        const btn = document.createElement('button');
        btn.textContent = option;

        btn.addEventListener('click', () => {
            socket.emit('vote', { optionIndex: index });

            // bloquear tras votar
            pollOptions.innerHTML = '<p>✅ Voto enviado</p>';
        });

        pollOptions.appendChild(btn);
    });
});

socket.on('poll-results', (results) => {
    // results: [n, n, n]
    pollResults.classList.remove('hidden');
    pollResults.innerHTML = '<h4>Resultados:</h4>';

    results.forEach((count, i) => {
        const p = document.createElement('p');
        p.textContent = `Opción ${i + 1}: ${count} votos`;
        pollResults.appendChild(p);
    });
});

socket.on('poll-ended', () => {
    pollContainer.classList.add('hidden');
});



// =========================
// ✋ LEVANTAR MANO
// =========================
raiseHandBtn.addEventListener('click', () => {
    socket.emit('raise-hand', { name: userName });
    
    raiseHandBtn.textContent = "✋ Mano levantada";
    raiseHandBtn.disabled = true;
});



// =========================
// 🔄 ESTADO INICIAL
// =========================
socket.on('init-state', (state) => {
    // slide
    if (state.currentSlide) {
        slideImage.src = state.currentSlide;
    }

    // zoom
    if (state.zoomScale) {
        slideImage.style.transform = `scale(${state.zoomScale})`;
    }

    // dibujo previo
    if (state.drawHistory) {
        state.drawHistory.forEach(point => {
            ctx.beginPath();
            ctx.arc(
                point.x * canvas.width,
                point.y * canvas.height,
                3,
                0,
                Math.PI * 2
            );
            ctx.fillStyle = 'red';
            ctx.fill();
        });
    }
});
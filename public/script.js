const socket = io();

const setupScreen = document.getElementById('setupScreen');
const gameScreen = document.getElementById('gameScreen');
const createBtn = document.getElementById('createGameBtn');
const joinBtn = document.getElementById('joinGameBtn');
const playerNameInput = document.getElementById('playerName');
const iaLevel1 = document.getElementById('iaLevel1');
const iaLevel2 = document.getElementById('iaLevel2');
const gameIdInput = document.getElementById('gameIdInput');
const gameIdDisplay = document.getElementById('gameIdDisplay');
const board = document.getElementById('board');
const dice = document.getElementById('dice');
const rollBtn = document.getElementById('rollDiceBtn');
const turnMsg = document.getElementById('turnMessage');
const gameLog = document.getElementById('gameLog');
const notif = document.getElementById('notification');

let currentGameId = null;
let currentPlayerId = null;
let gameState = null;
let isMyTurn = false;

const COLOR_NAMES = ['red', 'green', 'yellow', 'blue'];

// ═══════════════════════════════════════════════════════════════
// GÉOMÉTRIE DU PLATEAU (Ajustée aux couleurs & directions Ludo)
// ═══════════════════════════════════════════════════════════════

function buildRing() {
    const p = [];
    for (let c = 0; c <= 5; c++) p.push([6, c]);
    for (let r = 5; r >= 0; r--) p.push([r, 6]);
    p.push([0, 7]);
    for (let r = 0; r <= 5; r++) p.push([r, 8]);
    for (let c = 9; c <= 14; c++) p.push([6, c]);
    p.push([7, 14]);
    for (let c = 14; c >= 9; c--) p.push([8, c]);
    for (let r = 9; r <= 14; r++) p.push([r, 8]);
    p.push([14, 7]);
    for (let r = 14; r >= 9; r--) p.push([r, 6]);
    for (let c = 5; c >= 0; c--) p.push([8, c]);
    p.push([7, 0]);
    return p;
}

const RING = buildRing();
const RING_LENGTH = RING.length; // 52

// 0: Rouge (Rouge part à [6,1]) | 1: Vert ([1,8]) | 2: Jaune ([8,13]) | 3: Bleu ([13,6])
const START_OFFSET = [1, 14, 27, 40];

const HOME_COLUMN = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],     // Rouge (Gauche -> Centre)
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],     // Vert (Haut -> Centre)
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]], // Jaune (Droite -> Centre)
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]  // Bleu (Bas -> Centre)
];

const YARD_SLOTS = [
    [[1, 1], [1, 4], [4, 1], [4, 4]],       // Rouge (Haut-Gauche)
    [[1, 10], [1, 13], [4, 10], [4, 13]],   // Vert (Haut-Droite)
    [[10, 10], [10, 13], [13, 10], [13, 13]], // Jaune (Bas-Droite)
    [[10, 1], [10, 4], [13, 1], [13, 4]]     // Bleu (Bas-Gauche)
];

const STEPS_TO_HOME_ENTRY = 51;
const STEPS_TOTAL = 57;
const START_CELLS = START_OFFSET.map(o => RING[o]);
const STAR_CELLS = START_OFFSET.map(o => RING[(o + 8) % RING_LENGTH]);

function pionCoord(color, steps, pionIndex) {
    if (steps === -1) return YARD_SLOTS[color][pionIndex];
    if (steps === STEPS_TOTAL) return [7, 7];
    if (steps < STEPS_TO_HOME_ENTRY) {
        return RING[(START_OFFSET[color] + steps) % RING_LENGTH];
    }
    return HOME_COLUMN[color][steps - STEPS_TO_HOME_ENTRY];
}

const RING_SET = new Set(RING.map(([r, c]) => r + ',' + c));
const STRETCH_SET = [0, 1, 2, 3].map(color => new Set(HOME_COLUMN[color].map(([r, c]) => r + ',' + c)));
const START_SET = new Set(START_CELLS.map(([r, c]) => r + ',' + c));
const STAR_SET = new Set(STAR_CELLS.map(([r, c]) => r + ',' + c));
const START_COLOR_BY_KEY = {};
START_CELLS.forEach(([r, c], i) => { START_COLOR_BY_KEY[r + ',' + c] = COLOR_NAMES[i]; });

// ═══════════════════════════════════════════════════════════════
// SOCKET EVENTS
// ═══════════════════════════════════════════════════════════════

socket.on('gameCreated', (data) => {
    currentGameId = data.gameId;
    currentPlayerId = data.playerId;
    gameState = data.gameState;
    setupScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameIdDisplay.textContent = currentGameId;
    updateUI();
    addLog('✅ Partie créée ! En attente d\'un second joueur...');
    showNotif('Partie #' + currentGameId + ' créée !', 'success');
});

socket.on('gameJoined', (data) => {
    currentPlayerId = data.playerId;
    gameState = data.gameState;
    setupScreen.classList.remove('active');
    gameScreen.classList.add('active');
    gameIdDisplay.textContent = currentGameId;
    updateUI();
    addLog('✅ Vous avez rejoint la partie !');
    showNotif('Rejoint !', 'success');
});

socket.on('gameStarted', (data) => {
    addLog('🎲 ' + data.message);
    showNotif('🎲 La partie commence !', 'success');
});

socket.on('gameState', (state) => {
    gameState = state;
    updateUI();
});

socket.on('gameLog', (msg) => {
    addLog(msg);
});

socket.on('error', (msg) => {
    showNotif(msg, 'error');
    addLog('❌ ' + msg);
});

// ═══════════════════════════════════════════════════════════════
// ACTIONS UTILISATEUR
// ═══════════════════════════════════════════════════════════════

createBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Joueur 1';
    socket.emit('createGame', {
        playerName: name,
        iaLevel1: iaLevel1.value,
        iaLevel2: iaLevel2.value,
    });
});

joinBtn.addEventListener('click', () => {
    const id = gameIdInput.value.trim();
    if (!id) { showNotif('Entrez un ID de partie', 'error'); return; }
    currentGameId = parseInt(id, 10);
    socket.emit('joinGame', {
        gameId: currentGameId,
        playerName: playerNameInput.value.trim() || 'Joueur 2',
    });
});

rollBtn.addEventListener('click', () => {
    if (!isMyTurn) { showNotif('❌ Ce n\'est pas votre tour', 'error'); return; }
    if (gameState.diceRolled) { showNotif('❌ Dé déjà lancé', 'error'); return; }
    socket.emit('rollDice', { gameId: currentGameId });
    rollBtn.disabled = true;
});

board.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const pionIdx = parseInt(cell.dataset.pionIndex, 10);
    if (isNaN(pionIdx)) return;
    if (!isMyTurn) { showNotif('❌ Ce n\'est pas votre tour', 'error'); return; }
    socket.emit('movePion', { gameId: currentGameId, pionIndex: pionIdx });
});

// ═══════════════════════════════════════════════════════════════
// RENDU DU PLATEAU
// ═══════════════════════════════════════════════════════════════

function updateUI() {
    if (!gameState) return;
    checkMyTurn();
    updatePlayers();
    renderBoard();
    updateDice();
    updateTurn();
}

function updatePlayers() {
    document.querySelectorAll('.player-tag').forEach((tag, i) => {
        const p = gameState.players[i];
        if (!p) return;
        tag.querySelector('.pname').textContent = p.name;
        const status = tag.querySelector('.pstatus');
        if (p.finished) {
            status.textContent = '🏆';
            tag.classList.add('finished');
        } else if (gameState.currentTurn === i) {
            status.textContent = '🎯';
            tag.classList.add('active');
        } else {
            status.textContent = p.isIA ? '🤖' : '⏳';
            tag.classList.remove('active');
        }
        if (gameState.currentTurn !== i) tag.classList.remove('active');
    });
}

function renderBoard() {
    board.innerHTML = '';
    const cellByKey = {};

    for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            const key = row + ',' + col;

            // 1. MAISONS (Yard 6x6)
            if (row < 6 && col < 6) {
                cell.classList.add('home-red');
            } else if (row < 6 && col > 8) {
                cell.classList.add('home-green');
            } else if (row > 8 && col > 8) {
                cell.classList.add('home-yellow');
            } else if (row > 8 && col < 6) {
                cell.classList.add('home-blue');
            }

            // 2. CENTRE DU PLATEAU (Arrivée 3x3)
            if (row === 7 && col === 7) cell.classList.add('center-mid');
            else if (row === 6 && col === 7) cell.classList.add('center-top');    // Vert
            else if (row === 8 && col === 7) cell.classList.add('center-bottom'); // Bleu
            else if (row === 7 && col === 6) cell.classList.add('center-left');   // Rouge
            else if (row === 7 && col === 8) cell.classList.add('center-right');  // Jaune

            // 3. CIRCUIT D'AVANCEMENT
            if (RING_SET.has(key)) cell.classList.add('path');

            // 4. COLONNES FINALES
            for (let c = 0; c < 4; c++) {
                if (STRETCH_SET[c].has(key)) cell.classList.add('stretch-' + COLOR_NAMES[c]);
            }

            // 5. CASES DE DÉPART (Spawn)
            if (START_SET.has(key)) {
                cell.classList.add('start');
                cell.classList.add('start-' + START_COLOR_BY_KEY[key]);
            }

            // 6. CASES SÉCURITÉ / ÉTOILES
            if (STAR_SET.has(key) || START_SET.has(key)) cell.classList.add('safe');

            cellByKey[key] = cell;
            board.appendChild(cell);
        }
    }

    // Placement des pions
    for (let p = 0; p < 4; p++) {
        const pions = gameState.pions[p];
        if (!pions) continue;
        for (let j = 0; j < pions.length; j++) {
            const steps = pions[j].steps;
            const [row, col] = pionCoord(p, steps, j);
            const key = row + ',' + col;
            const cellEl = cellByKey[key];
            if (!cellEl) continue;

            const pionDiv = document.createElement('div');
            pionDiv.className = `pion pion-${COLOR_NAMES[p]}`;
            const alreadyThere = cellEl.querySelectorAll('.pion').length;
            if (alreadyThere > 0) {
                pionDiv.classList.add('multiple');
                cellEl.querySelectorAll('.pion').forEach(el => el.classList.add('multiple'));
            }
            cellEl.appendChild(pionDiv);

            // Rendre cliquable si jouable
            if (p === currentPlayerId && steps !== STEPS_TOTAL) {
                const movable = (gameState.movablePions || []).some(
                    m => m.player === p && m.pionIndex === j
                );
                if (movable) {
                    cellEl.dataset.pionIndex = j;
                    cellEl.classList.add('has-pion');
                }
            }
        }
    }
}

function updateDice() {
    if (gameState.diceValue > 0) {
        const val = gameState.diceValue;
        const symbols = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
        dice.textContent = symbols[val - 1] || '🎲';
        dice.classList.add('rolling');
        setTimeout(() => dice.classList.remove('rolling'), 500);
    } else {
        dice.textContent = '🎲';
    }
}

function updateTurn() {
    const cp = gameState.players[gameState.currentTurn];
    if (!cp) return;

    if (gameState.phase === 'finished') {
        const winner = gameState.players[gameState.winner];
        turnMsg.innerHTML = `🏆 <strong>${winner ? winner.name : 'Un joueur'}</strong> a gagné !`;
        rollBtn.disabled = true;
        return;
    }
    if (gameState.phase === 'waiting') {
        turnMsg.innerHTML = `⏳ En attente d'un second joueur...`;
        rollBtn.disabled = true;
        return;
    }
    if (cp.isIA) {
        turnMsg.innerHTML = `🤖 ${cp.name} réfléchit...`;
        rollBtn.disabled = true;
    } else if (gameState.currentTurn === currentPlayerId) {
        turnMsg.innerHTML = gameState.diceRolled
            ? `🎯 <strong>Choisissez un pion à déplacer</strong>`
            : `🎯 <strong>C'est à vous !</strong>`;
        rollBtn.disabled = gameState.diceRolled;
    } else {
        turnMsg.innerHTML = `⏳ ${cp.name} joue...`;
        rollBtn.disabled = true;
    }
}

function checkMyTurn() {
    const cp = gameState.players[gameState.currentTurn];
    isMyTurn = cp && gameState.currentTurn === currentPlayerId && gameState.phase === 'playing' && !cp.isIA;
}

function addLog(msg) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = msg;
    gameLog.appendChild(entry);
    gameLog.scrollTop = gameLog.scrollHeight;
}

function showNotif(msg, type = 'info') {
    notif.textContent = msg;
    notif.className = 'show ' + type;
    clearTimeout(notif._timeout);
    notif._timeout = setTimeout(() => notif.classList.remove('show'), 4000);
}

// Raccourcis clavier
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && setupScreen.classList.contains('active')) {
        if (document.activeElement === gameIdInput) joinBtn.click();
        else createBtn.click();
    }
    if (e.key === ' ' && gameScreen.classList.contains('active')) {
        e.preventDefault();
        rollBtn.click();
    }
});

console.log('🎲 Ludo chargé avec plateau aligné !');
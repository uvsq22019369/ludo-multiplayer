const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const {
    RING_LENGTH,
    STEPS_TO_HOME_ENTRY,
    STEPS_TOTAL,
    isSafeStep,
} = require('./board');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const COLOR_NAMES = ['red', 'green', 'yellow', 'blue'];

/** @type {Map<number, Game>} */
const games = new Map();
let nextGameId = 1;

// ═══════════════════════════════════════════════════════════════
// MODÈLE DE PARTIE
// ═══════════════════════════════════════════════════════════════

function createGame(hostSocketId, hostName, iaLevel1, iaLevel2) {
    const gameId = nextGameId++;
    const game = {
        id: gameId,
        players: [
            { id: 0, name: hostName, socketId: hostSocketId, isIA: false, finished: false, connected: true },
            { id: 1, name: 'En attente...', socketId: null, isIA: false, finished: false, connected: false },
            { id: 2, name: 'IA 1', socketId: null, isIA: true, iaLevel: Number(iaLevel1) || 1, finished: false, connected: true },
            { id: 3, name: 'IA 2', socketId: null, isIA: true, iaLevel: Number(iaLevel2) || 1, finished: false, connected: true },
        ],
        // 4 pions par joueur, steps: -1 = maison, 0..55 = ring, 56..61 = colonne finale, 62 = arrivé
        pions: [
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
        ],
        currentTurn: 0,
        diceValue: 0,
        diceRolled: false,
        consecutiveSixes: 0,
        phase: 'waiting', // waiting | playing | finished
        winner: null,
        movablePions: [], // [{player, pionIndex}] valides pour le lancer actuel
    };
    games.set(gameId, game);
    return game;
}

function publicState(game) {
    // On renvoie tout sauf les socketId internes
    return {
        players: game.players.map(p => ({
            id: p.id, name: p.name, isIA: p.isIA, finished: p.finished, connected: p.connected,
        })),
        pions: game.pions,
        currentTurn: game.currentTurn,
        diceValue: game.diceValue,
        diceRolled: game.diceRolled,
        phase: game.phase,
        winner: game.winner,
        movablePions: game.movablePions,
    };
}

function broadcast(game) {
    io.to('game-' + game.id).emit('gameState', publicState(game));
}

function addLogAndNotify(game, message) {
    io.to('game-' + game.id).emit('gameLog', message);
}

// ═══════════════════════════════════════════════════════════════
// RÈGLES DU JEU
// ═══════════════════════════════════════════════════════════════

function getMovablePions(game, playerIdx, dice) {
    const movable = [];
    const pions = game.pions[playerIdx];
    for (let i = 0; i < pions.length; i++) {
        const steps = pions[i].steps;
        if (steps === STEPS_TOTAL) continue; // déjà arrivé
        if (steps === -1) {
            if (dice === 6) movable.push(i); // sort de la maison
            continue;
        }
        if (steps + dice <= STEPS_TOTAL) movable.push(i); // il faut le compte exact pour finir
    }
    return movable;
}

function movePionSteps(game, playerIdx, pionIndex, dice) {
    const pion = game.pions[playerIdx][pionIndex];
    const wasInYard = pion.steps === -1;
    pion.steps = wasInYard ? 0 : pion.steps + dice;

    let captured = false;

    // Capture : si on atterrit sur une case du ring (pas colonne finale) non sûre,
    // et occupée par un ou plusieurs pions adverses, ils repartent à la maison.
    if (pion.steps < STEPS_TO_HOME_ENTRY && !isSafeStep(playerIdx, pion.steps)) {
        const myAbsolute = (require('./board').START_OFFSET[playerIdx] + pion.steps) % RING_LENGTH;
        for (let p = 0; p < 4; p++) {
            if (p === playerIdx) continue;
            for (let j = 0; j < 4; j++) {
                const other = game.pions[p][j];
                if (other.steps < 0 || other.steps >= STEPS_TO_HOME_ENTRY) continue;
                const otherAbsolute = (require('./board').START_OFFSET[p] + other.steps) % RING_LENGTH;
                if (otherAbsolute === myAbsolute) {
                    other.steps = -1;
                    captured = true;
                }
            }
        }
    }

    if (pion.steps === STEPS_TOTAL) {
        const allHome = game.pions[playerIdx].every(p => p.steps === STEPS_TOTAL);
        if (allHome) {
            game.players[playerIdx].finished = true;
        }
    }

    return captured;
}

function checkWinner(game) {
    const p = game.players[game.currentTurn];
    if (p.finished) {
        game.phase = 'finished';
        game.winner = game.currentTurn;
        return true;
    }
    return false;
}

function nextTurn(game, extra) {
    if (!extra) {
        game.consecutiveSixes = 0;
        let next = game.currentTurn;
        do {
            next = (next + 1) % 4;
        } while (game.players[next].finished && next !== game.currentTurn);
        game.currentTurn = next;
    }
    game.diceValue = 0;
    game.diceRolled = false;
    game.movablePions = [];
}

// ═══════════════════════════════════════════════════════════════
// TOUR DE JEU (humain ou IA)
// ═══════════════════════════════════════════════════════════════

function doRoll(game) {
    const dice = 1 + Math.floor(Math.random() * 6);
    game.diceValue = dice;
    game.diceRolled = true;

    if (dice === 6) {
        game.consecutiveSixes++;
    } else {
        game.consecutiveSixes = 0;
    }

    // 3 six d'affilée -> tour perdu (règle classique)
    if (game.consecutiveSixes >= 3) {
        addLogAndNotify(game, `🎲 ${game.players[game.currentTurn].name} fait trois 6 d'affilée, tour perdu !`);
        broadcast(game);
        setTimeout(() => { nextTurn(game, false); broadcast(game); scheduleIfIA(game); }, 900);
        return;
    }

    const movable = getMovablePions(game, game.currentTurn, dice);
    game.movablePions = movable.map(pionIndex => ({ player: game.currentTurn, pionIndex }));

    broadcast(game);

    if (movable.length === 0) {
        // aucun coup possible : on passe (avec rejet si c'était un 6, sinon tour suivant)
        const rolledSix = dice === 6;
        addLogAndNotify(game, `🎲 ${game.players[game.currentTurn].name} fait ${dice}, aucun coup possible.`);
        setTimeout(() => {
            nextTurn(game, rolledSix);
            broadcast(game);
            scheduleIfIA(game);
        }, 900);
        return;
    }

    scheduleIfIA(game, true);
}

function doMove(game, playerIdx, pionIndex) {
    if (game.phase !== 'playing') return;
    if (game.currentTurn !== playerIdx) return;
    if (!game.diceRolled) return;
    if (!game.movablePions.some(m => m.pionIndex === pionIndex)) return;

    const dice = game.diceValue;
    const captured = movePionSteps(game, playerIdx, pionIndex, dice);
    const name = game.players[playerIdx].name;
    const colorLabel = COLOR_NAMES[playerIdx];

    if (captured) {
        addLogAndNotify(game, `💥 ${name} (${colorLabel}) mange un pion adverse !`);
    }

    const won = checkWinner(game);
    if (won) {
        addLogAndNotify(game, `🏆 ${name} a gagné la partie !`);
        broadcast(game);
        return;
    }

    const extraTurn = dice === 6;
    if (extraTurn) {
        addLogAndNotify(game, `🎲 ${name} rejoue (6 !)`);
    }

    nextTurn(game, extraTurn);
    broadcast(game);
    scheduleIfIA(game);
}

function scheduleIfIA(game, aboutToMove) {
    if (game.phase !== 'playing') return;
    const p = game.players[game.currentTurn];
    if (!p.isIA) return;

    if (!game.diceRolled) {
        setTimeout(() => {
            if (games.has(game.id) && game.phase === 'playing' && game.players[game.currentTurn].isIA) {
                doRoll(game);
            }
        }, 700);
    } else if (game.movablePions.length > 0) {
        setTimeout(() => {
            if (games.has(game.id) && game.phase === 'playing' && game.players[game.currentTurn].isIA) {
                const choice = chooseIAMove(game, game.currentTurn);
                doMove(game, game.currentTurn, choice);
            }
        }, 700);
    }
}

// ═══════════════════════════════════════════════════════════════
// INTELLIGENCE ARTIFICIELLE (3 niveaux)
// ═══════════════════════════════════════════════════════════════

function chooseIAMove(game, playerIdx) {
    const level = game.players[playerIdx].iaLevel || 1;
    const options = game.movablePions.filter(m => m.player === playerIdx).map(m => m.pionIndex);
    const dice = game.diceValue;

    if (level === 1) {
        return options[Math.floor(Math.random() * options.length)];
    }

    if (level === 2) {
        // Priorité : capture > pion le plus avancé > sortie de maison si 6
        const capture = findCaptureMove(game, playerIdx, options, dice);
        if (capture !== null) return capture;
        if (dice === 6) {
            const yardPion = options.find(i => game.pions[playerIdx][i].steps === -1);
            if (yardPion !== undefined) return yardPion;
        }
        return mostAdvanced(game, playerIdx, options);
    }

    // Niveau 3 : score pondéré
    let best = options[0];
    let bestScore = -Infinity;
    for (const idx of options) {
        const score = scoreMove(game, playerIdx, idx, dice);
        if (score > bestScore) {
            bestScore = score;
            best = idx;
        }
    }
    return best;
}

function findCaptureMove(game, playerIdx, options, dice) {
    const { START_OFFSET } = require('./board');
    for (const idx of options) {
        const pion = game.pions[playerIdx][idx];
        const futureSteps = pion.steps === -1 ? 0 : pion.steps + dice;
        if (futureSteps >= STEPS_TO_HOME_ENTRY) continue;
        if (isSafeStep(playerIdx, futureSteps)) continue;
        const absolute = (START_OFFSET[playerIdx] + futureSteps) % RING_LENGTH;
        for (let p = 0; p < 4; p++) {
            if (p === playerIdx) continue;
            for (let j = 0; j < 4; j++) {
                const other = game.pions[p][j];
                if (other.steps < 0 || other.steps >= STEPS_TO_HOME_ENTRY) continue;
                const otherAbs = (START_OFFSET[p] + other.steps) % RING_LENGTH;
                if (otherAbs === absolute) return idx;
            }
        }
    }
    return null;
}

function mostAdvanced(game, playerIdx, options) {
    let best = options[0];
    let bestSteps = -2;
    for (const idx of options) {
        const s = game.pions[playerIdx][idx].steps;
        if (s > bestSteps) { bestSteps = s; best = idx; }
    }
    return best;
}

function scoreMove(game, playerIdx, pionIndex, dice) {
    const { START_OFFSET } = require('./board');
    const pion = game.pions[playerIdx][pionIndex];
    const futureSteps = pion.steps === -1 ? 0 : pion.steps + dice;
    let score = 0;

    // Faire avancer un pion proche de l'arrivée = bon
    score += futureSteps * 2;

    // Terminer un pion = très bon
    if (futureSteps === STEPS_TOTAL) score += 100;

    // Sortir un nouveau pion si peu de pions en jeu = bon
    if (pion.steps === -1) score += 15;

    // Capturer un adversaire = excellent
    if (futureSteps < STEPS_TO_HOME_ENTRY && !isSafeStep(playerIdx, futureSteps)) {
        const absolute = (START_OFFSET[playerIdx] + futureSteps) % RING_LENGTH;
        for (let p = 0; p < 4; p++) {
            if (p === playerIdx) continue;
            for (let j = 0; j < 4; j++) {
                const other = game.pions[p][j];
                if (other.steps < 0 || other.steps >= STEPS_TO_HOME_ENTRY) continue;
                const otherAbs = (START_OFFSET[p] + other.steps) % RING_LENGTH;
                if (otherAbs === absolute) score += 120;
            }
        }
    }

    // Risque : si la case d'arrivée n'est pas sûre et qu'un adversaire est à 1-6 pas
    // derrière sur le ring, c'est dangereux
    if (futureSteps < STEPS_TO_HOME_ENTRY && !isSafeStep(playerIdx, futureSteps)) {
        const absolute = (START_OFFSET[playerIdx] + futureSteps) % RING_LENGTH;
        for (let p = 0; p < 4; p++) {
            if (p === playerIdx) continue;
            for (let j = 0; j < 4; j++) {
                const other = game.pions[p][j];
                if (other.steps < 0 || other.steps >= STEPS_TO_HOME_ENTRY) continue;
                const otherAbs = (START_OFFSET[p] + other.steps) % RING_LENGTH;
                const gap = (absolute - otherAbs + RING_LENGTH) % RING_LENGTH;
                if (gap >= 1 && gap <= 6) score -= 40;
            }
        }
    }

    return score;
}

// ═══════════════════════════════════════════════════════════════
// SOCKET.IO
// ═══════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    socket.on('createGame', ({ playerName, iaLevel1, iaLevel2 }) => {
        const game = createGame(socket.id, playerName || 'Joueur 1', iaLevel1, iaLevel2);
        socket.join('game-' + game.id);
        socket.emit('gameCreated', { gameId: game.id, playerId: 0, gameState: publicState(game) });
    });

    socket.on('joinGame', ({ gameId, playerName }) => {
        const game = games.get(Number(gameId));
        if (!game) { socket.emit('error', 'Partie introuvable.'); return; }
        if (game.players[1].connected) { socket.emit('error', 'Cette partie est déjà complète.'); return; }

        game.players[1].name = playerName || 'Joueur 2';
        game.players[1].socketId = socket.id;
        game.players[1].connected = true;

        socket.join('game-' + game.id);
        socket.emit('gameJoined', { playerId: 1, gameState: publicState(game) });

        game.phase = 'playing';
        io.to('game-' + game.id).emit('gameStarted', { message: 'Tous les joueurs sont prêts, la partie commence !' });
        broadcast(game);
        scheduleIfIA(game);
    });

    socket.on('rollDice', ({ gameId }) => {
        const game = games.get(Number(gameId));
        if (!game || game.phase !== 'playing') return;
        const playerIdx = game.players.findIndex(p => p.socketId === socket.id);
        if (playerIdx === -1 || playerIdx !== game.currentTurn || game.diceRolled) return;
        doRoll(game);
    });

    socket.on('movePion', ({ gameId, pionIndex }) => {
        const game = games.get(Number(gameId));
        if (!game || game.phase !== 'playing') return;
        const playerIdx = game.players.findIndex(p => p.socketId === socket.id);
        if (playerIdx === -1) return;
        doMove(game, playerIdx, pionIndex);
    });

    socket.on('disconnect', () => {
        for (const game of games.values()) {
            const p = game.players.find(pl => pl.socketId === socket.id);
            if (p) {
                p.connected = false;
                io.to('game-' + game.id).emit('error', `${p.name} s'est déconnecté.`);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎲 Ludo Multiplayer lancé sur http://localhost:${PORT}`);
});
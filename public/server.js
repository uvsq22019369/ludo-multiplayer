const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const games = {};
let gameCounter = 1;

const COLOR_NAMES = ['red', 'green', 'yellow', 'blue'];
const STEPS_TO_HOME_ENTRY = 51;
const STEPS_TOTAL = 57;
const RING_LENGTH = 52;
const START_OFFSET = [1, 14, 27, 40];

const YARD_SLOTS = [
    [[1, 1], [1, 4], [4, 1], [4, 4]],
    [[1, 10], [1, 13], [4, 10], [4, 13]],
    [[10, 10], [10, 13], [13, 10], [13, 13]],
    [[10, 1], [10, 4], [13, 1], [13, 4]]
];

const HOME_COLUMN = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]]
];

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
const STAR_CELLS = START_OFFSET.map(o => RING[(o + 8) % RING_LENGTH]);
const STAR_SET = new Set(STAR_CELLS.map(([r, c]) => r + ',' + c));

function pionCoord(color, steps, pionIndex) {
    if (steps === -1) return YARD_SLOTS[color][pionIndex];
    if (steps === STEPS_TOTAL) return [7, 7];
    if (steps < STEPS_TO_HOME_ENTRY) {
        return RING[(START_OFFSET[color] + steps) % RING_LENGTH];
    }
    return HOME_COLUMN[color][steps - STEPS_TO_HOME_ENTRY];
}

function createGameState() {
    return {
        phase: 'waiting',
        players: [],
        currentTurn: 0,
        diceValue: 0,
        diceRolled: false,
        pions: [
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }],
            [{ steps: -1 }, { steps: -1 }, { steps: -1 }, { steps: -1 }]
        ],
        movablePions: [],
        winner: null
    };
}

function getMovablePions(game, playerIndex, diceVal) {
    const playerPions = game.pions[playerIndex];
    const movables = [];

    playerPions.forEach((pion, idx) => {
        if (pion.steps === STEPS_TOTAL) return;

        if (pion.steps === -1) {
            if (diceVal === 6) movables.push({ player: playerIndex, pionIndex: idx });
            return;
        }

        if (pion.steps + diceVal <= STEPS_TOTAL) {
            movables.push({ player: playerIndex, pionIndex: idx });
        }
    });

    return movables;
}

function nextTurn(game) {
    game.diceRolled = false;
    game.diceValue = 0;
    game.movablePions = [];

    let next = (game.currentTurn + 1) % 4;
    while (game.players[next] && game.players[next].finished) {
        next = (next + 1) % 4;
    }
    game.currentTurn = next;

    if (game.players[next] && game.players[next].isIA && game.phase === 'playing') {
        setTimeout(() => playIATurn(game), 1000);
    }
}

function playIATurn(game) {
    if (game.phase !== 'playing') return;
    const playerIndex = game.currentTurn;
    const diceVal = Math.floor(Math.random() * 6) + 1;
    game.diceValue = diceVal;
    game.diceRolled = true;

    const movable = getMovablePions(game, playerIndex, diceVal);

    if (movable.length === 0) {
        setTimeout(() => {
            nextTurn(game);
            io.to(game.id).emit('gameState', game);
        }, 1000);
    } else {
        const chosen = movable[0];
        setTimeout(() => {
            movePionLogic(game, playerIndex, chosen.pionIndex);
            io.to(game.id).emit('gameState', game);
        }, 1000);
    }
    io.to(game.id).emit('gameState', game);
}

function movePionLogic(game, playerIndex, pionIndex) {
    const pion = game.pions[playerIndex][pionIndex];
    
    if (pion.steps === -1) {
        pion.steps = 0;
    } else {
        pion.steps += game.diceValue;
    }

    // Gestion de la capture
    if (pion.steps >= 0 && pion.steps < STEPS_TO_HOME_ENTRY) {
        const currentCoord = pionCoord(playerIndex, pion.steps, pionIndex);
        const isSafeCell = STAR_SET.has(currentCoord[0] + ',' + currentCoord[1]);

        if (!isSafeCell) {
            game.pions.forEach((otherPlayerPions, otherPlayerIdx) => {
                if (otherPlayerIdx !== playerIndex) {
                    otherPlayerPions.forEach((otherPion, otherPionIdx) => {
                        if (otherPion.steps >= 0 && otherPion.steps < STEPS_TO_HOME_ENTRY) {
                            const otherCoord = pionCoord(otherPlayerIdx, otherPion.steps, otherPionIdx);
                            if (currentCoord[0] === otherCoord[0] && currentCoord[1] === otherCoord[1]) {
                                otherPion.steps = -1;
                                io.to(game.id).emit('gameLog', `💥 ${game.players[playerIndex].name} a capturé un pion de ${game.players[otherPlayerIdx].name} !`);
                            }
                        }
                    });
                }
            });
        }
    }

    // Rejeu sur un 6
    if (game.diceValue === 6 && pion.steps !== STEPS_TOTAL) {
        game.diceRolled = false;
        game.diceValue = 0;
        game.movablePions = [];
    } else {
        nextTurn(game);
    }
}

io.on('connection', (socket) => {
    socket.on('createGame', ({ playerName, iaLevel1, iaLevel2 }) => {
        const gameId = gameCounter++;
        const game = createGameState();
        game.id = gameId;

        game.players.push({ id: socket.id, name: playerName, isIA: false, color: 0 });
        game.players.push({ id: null, name: 'Joueur 2', isIA: false, color: 1 });
        game.players.push({ id: null, name: 'IA 1 (' + iaLevel1 + ')', isIA: true, color: 2 });
        game.players.push({ id: null, name: 'IA 2 (' + iaLevel2 + ')', isIA: true, color: 3 });

        games[gameId] = game;
        socket.join(gameId);

        socket.emit('gameCreated', { gameId, playerId: 0, gameState: game });
    });

    socket.on('joinGame', ({ gameId, playerName }) => {
        const game = games[gameId];
        if (!game) {
            socket.emit('error', 'Partie introuvable');
            return;
        }
        if (game.phase !== 'waiting') {
            socket.emit('error', 'La partie a déjà commencé');
            return;
        }

        game.players[1] = { id: socket.id, name: playerName, isIA: false, color: 1 };
        game.phase = 'playing';
        socket.join(gameId);

        socket.emit('gameJoined', { gameId, playerId: 1, gameState: game });
        io.to(gameId).emit('gameStarted', { message: 'Le Joueur 2 a rejoint ! La partie commence.' });
        io.to(gameId).emit('gameState', game);
    });

    socket.on('rollDice', ({ gameId }) => {
        const game = games[gameId];
        if (!game || game.phase !== 'playing') return;

        const playerIndex = game.currentTurn;
        if (game.players[playerIndex].id !== socket.id) return;

        const diceValue = Math.floor(Math.random() * 6) + 1;
        game.diceValue = diceValue;
        game.diceRolled = true;

        const movable = getMovablePions(game, playerIndex, diceValue);
        game.movablePions = movable;

        if (movable.length === 0) {
            io.to(gameId).emit('gameLog', `🎲 ${game.players[playerIndex].name} a fait un ${diceValue}. Aucun coup possible.`);
            io.to(gameId).emit('gameState', game);

            setTimeout(() => {
                nextTurn(game);
                io.to(gameId).emit('gameState', game);
            }, 1000);
        } else if (movable.length === 1) {
            // DÉPLACEMENT AUTOMATIQUE SI UN SEUL PION JOUABLE
            const autoPion = movable[0];
            io.to(gameId).emit('gameLog', `🎲 ${game.players[playerIndex].name} a fait un ${diceValue}. (Coup automatique)`);
            io.to(gameId).emit('gameState', game);

            setTimeout(() => {
                movePionLogic(game, autoPion.player, autoPion.pionIndex);
                io.to(gameId).emit('gameState', game);
            }, 600);
        } else {
            io.to(gameId).emit('gameLog', `🎲 ${game.players[playerIndex].name} a fait un ${diceValue}.`);
            io.to(gameId).emit('gameState', game);
        }
    });

    socket.on('movePion', ({ gameId, pionIndex }) => {
        const game = games[gameId];
        if (!game || game.phase !== 'playing') return;

        const playerIndex = game.currentTurn;
        if (game.players[playerIndex].id !== socket.id) return;

        movePionLogic(game, playerIndex, pionIndex);
        io.to(gameId).emit('gameState', game);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur prêt sur le port ${PORT}`));
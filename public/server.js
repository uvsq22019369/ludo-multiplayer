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
const START_OFFSET = [1, 14, 27, 40];
const STEPS_TO_HOME_ENTRY = 51;
const STEPS_TOTAL = 57;

function createGameState() {
    return {
        phase: 'waiting', // waiting, playing, finished
        players: [],
        currentTurn: 0,
        diceValue: 0,
        diceRolled: false,
        yardAttempts: 0,
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
        if (pion.steps === STEPS_TOTAL) return; // Déjà arrivé

        // Sortie de l'écurie
        if (pion.steps === -1) {
            if (diceVal === 6) movables.push({ player: playerIndex, pionIndex: idx });
            return;
        }

        // Avancement sur le plateau
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
    game.yardAttempts = 0;

    let next = (game.currentTurn + 1) % 4;
    while (game.players[next] && game.players[next].finished) {
        next = (next + 1) % 4;
    }
    game.currentTurn = next;

    // Tour d'une IA
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
        const playerPions = game.pions[playerIndex];
        const allInYard = playerPions.every(p => p.steps === -1);

        if (allInYard && game.yardAttempts < 2) {
            game.yardAttempts++;
            game.diceRolled = false;
            setTimeout(() => playIATurn(game), 800);
            return;
        }

        setTimeout(() => {
            nextTurn(game);
            io.to(game.id).emit('gameState', game);
        }, 1000);
    } else {
        // L'IA choisit le premier pion jouable
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
        pion.steps = 0; // Sortie sur la première case
    } else {
        pion.steps += game.diceValue;
    }

    // Gestion du rejeu si 6
    if (game.diceValue === 6 && pion.steps !== STEPS_TOTAL) {
        game.diceRolled = false;
        game.diceValue = 0;
        game.movablePions = [];
        game.yardAttempts = 0;
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

        const playerPions = game.pions[playerIndex];
        const allInYard = playerPions.every(p => p.steps === -1);

        const movable = getMovablePions(game, playerIndex, diceValue);
        game.movablePions = movable;

        if (movable.length === 0) {
            if (allInYard) {
                game.yardAttempts = (game.yardAttempts || 0) + 1;
                if (game.yardAttempts < 3) {
                    game.diceRolled = false;
                    io.to(gameId).emit('gameLog', `🎲 ${game.players[playerIndex].name} a fait un ${diceValue} (${game.yardAttempts}/3 essais).`);
                    io.to(gameId).emit('gameState', game);
                    return;
                }
            }

            game.yardAttempts = 0;
            io.to(gameId).emit('gameLog', `🎲 ${game.players[playerIndex].name} a fait un ${diceValue}. Aucun coup possible.`);
            io.to(gameId).emit('gameState', game);

            setTimeout(() => {
                nextTurn(game);
                io.to(gameId).emit('gameState', game);
            }, 1200);
        } else {
            game.yardAttempts = 0;
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
// ═══════════════════════════════════════════════════════════════
// GÉOMÉTRIE DU PLATEAU LUDO 15x15
// ═══════════════════════════════════════════════════════════════
// Le plateau est une croix : 4 maisons de 6x6 dans les coins,
// reliées par des bras de 3 cases de large (lignes/colonnes 6,7,8).
// Le chemin extérieur (RING) fait 56 cases, réparties en 4 quarts
// de 14 cases (une case de départ tous les 14 pas, parfaitement
// symétrique). Chaque couleur a ensuite une colonne finale de 6
// cases menant au centre.
//
// Ordre des couleurs : 0=Rouge (haut-gauche), 1=Vert (haut-droite),
// 2=Jaune (bas-droite), 3=Bleu (bas-gauche).

function buildRing() {
    const path = [];
    for (let c = 0; c <= 5; c++) path.push([6, c]);          // bras gauche, voie haute
    path.push([6, 6]);                                        // coin
    for (let r = 5; r >= 0; r--) path.push([r, 6]);           // bras haut, voie gauche
    path.push([0, 7]);                                        // pointe haut
    for (let r = 0; r <= 5; r++) path.push([r, 8]);           // bras haut, voie droite
    path.push([6, 8]);                                        // coin
    for (let c = 9; c <= 14; c++) path.push([6, c]);          // bras droit, voie haute
    path.push([7, 14]);                                       // pointe droite
    for (let c = 14; c >= 9; c--) path.push([8, c]);          // bras droit, voie basse
    path.push([8, 8]);                                        // coin
    for (let r = 9; r <= 14; r++) path.push([r, 8]);          // bras bas, voie droite
    path.push([14, 7]);                                       // pointe bas
    for (let r = 14; r >= 9; r--) path.push([r, 6]);          // bras bas, voie gauche
    path.push([8, 6]);                                        // coin
    for (let c = 5; c >= 0; c--) path.push([8, c]);           // bras gauche, voie basse
    path.push([7, 0]);                                       // pointe gauche
    return path;
}

const RING = buildRing(); // 56 cellules [row, col]
const RING_LENGTH = RING.length; // 56

// Décalage de départ de chaque couleur sur le ring (index dans RING)
const START_OFFSET = [0, 14, 28, 42]; // rouge, vert, jaune, bleu

// Colonne finale (6 cases) de chaque couleur, de l'entrée vers le centre (7,7)
const HOME_COLUMN = [
    [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],       // rouge
    [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],       // vert
    [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],   // jaune
    [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],   // bleu
];

// Cases de départ (une par couleur) — toujours sûres
const START_CELLS = START_OFFSET.map(o => RING[o]);

// Cases étoile (sûres), à 8 pas de chaque départ — convention Ludo classique
const STAR_CELLS = START_OFFSET.map(o => RING[(o + 8) % RING_LENGTH]);

// Emplacements des 4 pions dans la maison (avant de sortir), par couleur
const YARD_SLOTS = [
    [[1, 1], [1, 3], [3, 1], [3, 3]],           // rouge
    [[1, 10], [1, 12], [3, 10], [3, 12]],       // vert
    [[10, 10], [10, 12], [12, 10], [12, 12]],   // jaune
    [[10, 1], [10, 3], [12, 1], [12, 3]],       // bleu
];

const STEPS_TO_HOME_ENTRY = RING_LENGTH; // 56 : le pion quitte le ring pour la colonne finale
const STEPS_TOTAL = RING_LENGTH + HOME_COLUMN[0].length; // 62 : arrivée complète

// Coordonnée absolue [row, col] d'un pion selon sa progression (steps)
// steps === -1        -> dans la maison (yard)
// steps 0..55         -> sur le ring commun
// steps 56..61        -> dans la colonne finale de sa couleur
// steps === 62         -> arrivé (fini)
function pionCoord(color, steps, pionIndex) {
    if (steps === -1) return YARD_SLOTS[color][pionIndex];
    if (steps === STEPS_TOTAL) return [7, 7]; // centre
    if (steps < STEPS_TO_HOME_ENTRY) {
        const idx = (START_OFFSET[color] + steps) % RING_LENGTH;
        return RING[idx];
    }
    return HOME_COLUMN[color][steps - STEPS_TO_HOME_ENTRY];
}

// Est-ce que la case atteinte à `steps` pour `color` est une case sûre
// (protégée contre la capture) ?
function isSafeStep(color, steps) {
    if (steps < 0 || steps >= STEPS_TO_HOME_ENTRY) return true; // colonne finale = toujours sûre
    const idx = (START_OFFSET[color] + steps) % RING_LENGTH;
    return START_OFFSET.includes(idx) || STAR_CELLS.some(([r, c]) => RING[idx][0] === r && RING[idx][1] === c);
}

module.exports = {
    RING,
    RING_LENGTH,
    START_OFFSET,
    HOME_COLUMN,
    START_CELLS,
    STAR_CELLS,
    YARD_SLOTS,
    STEPS_TO_HOME_ENTRY,
    STEPS_TOTAL,
    pionCoord,
    isSafeStep,
};
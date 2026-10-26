// node tests/moves-regression.cjs [html]
// A simple autopilot plays the real game (real player physics + real level generator) and logs every input:
// jump / slide / left / right. Reports the move mix; the design target is ~40% jumps (over hurdles and across
// gaps between trains), the rest lane changes and slides.
const { boot } = require('./runner-regression.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const app = boot(process.argv[2] || path.join(__dirname, '..', 'endless_runner.html'));
const engine = app.engine, p = app.player, api = app.context.window.RIFT;
engine.trainLiveries = app.run('CartoonArtFactory.createTrainLiveryTextures()');

const dt = 1 / 60;
const T_GROUND = 2 * p.baseJumpForce / -p.gravity, T_ROOF = 2 * 17.2 / -p.gravity;
const laneOf = (x) => Math.round(x / 3.2) + 1;
const front = (o) => o.z + o.halfLen, back = (o) => o.z - o.halfLen;
const moves = { jump: 0, slide: 0, left: 0, right: 0 }, causes = {};
let deaths = 0, frames = 0;
engine.triggerGameOver = function (kind) { deaths++; causes[kind] = (causes[kind] || 0) + 1; this.state = 'GAMEOVER'; };

function press(move) {
    moves[move]++;
    ({ jump: () => api.jump(), slide: () => api.slide(), left: () => api.moveLeft(), right: () => api.moveRight() })[move]();
}

// Train cars whose nose isn't covered by a ramp or the car in front: what you'd run into on the ground
function noses(lane) {
    const inLane = engine.obstacles.filter((o) => laneOf(o.x) === lane && (o.kind === 'TRAIN' || o.kind === 'RAMP'));
    return inLane.filter((o) => o.kind === 'TRAIN' && !o.ramped &&
        !inLane.some((q) => q !== o && back(q) <= front(o) + 1.5 && back(q) >= front(o) - 0.5));
}
function occupied(lane) {
    return engine.obstacles.some((o) => laneOf(o.x) === lane && o.kind === 'TRAIN' && back(o) <= 0.8 && front(o) >= -0.8);
}
// Seconds until a train nose reaches the player line in this lane (0 if a car is already there)
function timeToBlock(lane, S) {
    if (occupied(lane)) return 0;
    let t = Infinity;
    for (const o of noses(lane)) {
        if (front(o) > 0.5) continue;
        t = Math.min(t, -front(o) / (S + (o.relSpeed || 0)));
    }
    return t;
}
function rampSoon(lane, S) {
    return engine.obstacles.some((o) => laneOf(o.x) === lane && o.kind === 'RAMP' && front(o) < 0 && -front(o) / S < 1.6);
}
// Where the roof you're standing on ends (contiguous cars ahead in this lane), or null
function roofEnd(lane) {
    const cars = engine.obstacles.filter((o) => laneOf(o.x) === lane && o.kind === 'TRAIN');
    let cur = cars.find((o) => back(o) <= 0.6 && front(o) >= -0.6);
    if (!cur) return null;
    for (;;) {
        const next = cars.find((o) => o !== cur && front(o) <= back(cur) + 0.1 && front(o) >= back(cur) - 1.5);
        if (!next) return back(cur);
        cur = next;
    }
}

function think() {
    const S = engine.currentSpeed, L = laneOf(p.targetX);
    const airborne = p.isJumping || p.y > p.groundHeight + 0.1;
    const onRoof = p.isOnTrainRoof && p.y > 2.5;
    if (engine.isPlayerOnRamp(p.x, p.y)) return;

    if (onRoof) {
        if (airborne) return;
        const end = roofEnd(L);
        if (end === null) return;
        const nextNose = noses(L).filter((o) => front(o) < end && front(o) > end - 16).sort((a, b) => front(b) - front(a))[0];
        if (nextNose) {
            // Gap between trains: jump so the arc is centred over the gap
            if (-(end + front(nextNose)) / 2 <= S * T_ROOF / 2) press('jump');
            return;
        }
        if (-end < S * 0.3) {
            // Roof ends with nothing to jump to: step onto a neighbouring roof that goes on further
            for (const l of [L - 1, L + 1]) {
                const e = l >= 0 && l <= 2 ? roofEnd(l) : null;
                if (e !== null && e < end - 10) { press(l < L ? 'left' : 'right'); return; }
            }
        }
        return;
    }

    // On the ground: hurdles / barriers in this lane
    for (const o of engine.obstacles) {
        if (laneOf(o.x) !== L || o.z > 0.5) continue;
        if (o.kind === 'HURDLE' && !airborne && o.z >= -S * T_GROUND / 2 - 0.4 && o.z < -0.5) { press('jump'); return; }
        if (o.kind === 'HIGH_BARRIER' && !p.isSliding && -o.z / S < 0.22) { press('slide'); return; }
    }
    // A train nose coming in this lane: move to the safest neighbour (prefer one with a ramp coming)
    if (timeToBlock(L, S) < 0.6) {
        let best = null, bestScore = 0.4;
        for (const l of [L - 1, L + 1]) {
            if (l < 0 || l > 2 || occupied(l)) continue;
            const score = timeToBlock(l, S) + (rampSoon(l, S) ? 5 : 0);
            if (score > bestScore) { best = l; bestScore = score; }
        }
        if (best !== null) press(best < L ? 'left' : 'right');
    }
}

for (let seed = 1; seed <= 8; seed++) {
    app.run(`{ let s = ${seed * 104729}; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); }`);
    api.restartGame();
    engine.coinTrains = [];
    for (let f = 0; f < 60 * 180; f++) {
        if (engine.state !== 'PLAYING') { api.restartGame(); engine.coinTrains = []; }
        think();
        engine.updateSpeedAndPowerups(dt);
        p.update(dt, 1);
        engine.updateObstaclesAndOrbs(dt);
        frames++;
    }
}
const total = moves.jump + moves.slide + moves.left + moves.right;
const share = (n) => `${(100 * n / total).toFixed(0)}%`;
console.log(`moves ${total}: jump ${share(moves.jump)}, left/right ${share(moves.left + moves.right)}, slide ${share(moves.slide)}; ` +
    `bot deaths ${deaths} in ${(frames / 3600).toFixed(0)} min ${JSON.stringify(causes)}`);
const jumpShare = moves.jump / total;
assert.ok(jumpShare > 0.34 && jumpShare < 0.46, `jumps should be ~40% of moves (got ${(100 * jumpShare).toFixed(0)}%)`);
console.log('PASS move mix: ~40% jumps (hurdles + gaps between trains), the rest lane changes and slides');

// node tests/path-regression.cjs [html]
// Plays long seeded runs of the real level generator with the real speed curve and checks, every frame,
// that a way through exists at the player's line: on the ground, or across roofs reached via a ramp.
// Also reports how full the track is, so "too little trains" regressions show up as numbers.
const { boot } = require('./runner-regression.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const app = boot(process.argv[2] || path.join(__dirname, '..', 'endless_runner.html'));
const engine = app.engine;
engine.trainLiveries = app.run('CartoonArtFactory.createTrainLiveryTextures()');
const adj = (m) => ((m << 1) | (m >> 1)) & 0b111;

let walls = 0, clashes = 0, frames = 0, emptyFrames = 0, threeLaneFrames = 0, roofFrames = 0;
const seen = new Set(), stats = { trains: 0, moving: 0, ramps: 0, roofCoins: 0, coinMovers: 0, unboardable: 0 };
const isBlock = (e) => e === 'HURDLE' || e === 'HIGH_BARRIER';
for (let seed = 1; seed <= 12; seed++) {
    app.run(`{ let s = ${seed * 7919}; Math.random = () => ((s = (s * 16807) % 2147483647) / 2147483647); }`);
    Object.assign(engine, { obstacles: [], collectibles: [], powerupItems: [], trackEndZ: -70,
        distance: 0, currentSpeed: 30, state: 'PLAYING' });
    engine.powerups = { MAGNET: 0, SNEAKERS: 0, MULTIPLIER: 0 };
    engine.player.x = engine.player.targetX = 100; // keep the runner out of the lanes so nothing collides
    let ground = 0b111, roof = 0;
    const movers = new Map(); // oncoming car -> its train's record { coins, passing, boarded, passed }
    const trainsByKey = new Map();
    const dt = 1 / 60;
    for (let f = 0; f < 60 * 240; f++) {
        engine.updateSpeedAndPowerups(dt);
        engine.updateObstaclesAndOrbs(dt);
        let free = 0b111, top = 0, ramp = 0, rampLow = 0, ahead = 0;
        for (const o of engine.obstacles) {
            if (!seen.has(o)) {
                seen.add(o);
                if (o.kind === 'TRAIN') { stats.trains++; if (o.relSpeed > 0) stats.moving++; }
                if (o.relSpeed > 0) {
                    // Cars of one convoy appear in the same frame and lane
                    const key = `${f}:${o.x}`;
                    if (!trainsByKey.has(key)) trainsByKey.set(key, { coins: false, passing: 0, boarded: 0, passed: false });
                    const t = trainsByKey.get(key);
                    t.coins ||= engine.collectibles.some((c) => c.relSpeed && Math.abs(c.x - o.x) < 0.5 && Math.abs(c.z - o.z) < o.halfLen + 1);
                    movers.set(o, t);
                }
                if (o.kind === 'RAMP') stats.ramps++;
            }
            if (o.kind !== 'TRAIN' && o.kind !== 'RAMP') continue;
            const bit = 1 << (Math.round(o.x / 3.2) + 1), front = o.z + o.halfLen, back = o.z - o.halfLen;
            if (back > -100 && front < 0) ahead |= bit;
            if (back - 0.6 <= 0 && front + 0.6 >= 0) {
                top |= bit;
                if (o.kind === 'RAMP') { ramp |= bit; if (front < 5.6) rampLow |= bit; } // below 2.6m: can't step across
            }
            if (o.kind === 'TRAIN' && back <= 0 && front >= 0) free &= ~bit;
        }
        // A jumpable gap (<= 14m) between trains in one lane keeps you at roof level
        const cars = engine.obstacles.filter((o) => o.kind === 'TRAIN');
        for (const a of cars) {
            const aBack = a.z - a.halfLen;
            if (aBack < 0) continue; // the line must be behind this car's tail, i.e. in the gap after it
            if (cars.some((b) => b.x === a.x && b.relSpeed === a.relSpeed && b.z + b.halfLen <= 0 &&
                aBack - (b.z + b.halfLen) <= 14)) top |= 1 << (Math.round(a.x / 3.2) + 1);
        }
        let r = (roof | (ground & ramp)) & top, g = (ground | roof) & free;
        for (let k = 0; k < 2; k++) { g |= (adj(g) | adj(r)) & free; r |= (adj(r & ~rampLow) & top) | (adj(g) & ramp); }
        ground = g; roof = r;
        for (const t of new Set(movers.values())) t.atLine = false;
        for (const [o, t] of movers) {
            if (o.z - o.halfLen - 0.6 <= 0 && o.z + o.halfLen + 0.6 >= 0) t.atLine = t.atLine || (1 << (Math.round(o.x / 3.2) + 1));
            if (o.z - o.halfLen > 0) t.passed = true;
        }
        for (const t of new Set(movers.values())) {
            if (!t.atLine) continue;
            t.passing++;
            if (r & t.atLine) t.boarded++;
        }
        if (!(g | r)) { walls++; ground = free || 0b111; roof = top; }
        // Same element side by side in neighbouring lanes (the roof-hopping highway is exempt by design)
        const near = engine.obstacles.filter((o) => o.element && o.element !== 'hop' && o.z + o.halfLen > -150);
        // Hurdles and barriers are one family: never beside each other (within 11m), whatever the mix
        if (near.some((a) => near.some((b) => {
            const family = isBlock(a.element) && isBlock(b.element), m = family ? 11 : 0;
            return (a.element === b.element || family) && Math.abs(Math.abs(a.x - b.x) - 3.2) < 0.5 &&
                a.z - a.halfLen < b.z + b.halfLen + m && a.z + a.halfLen > b.z - b.halfLen - m;
        }))) clashes++;
        frames++;
        if (!ahead) emptyFrames++;
        if (ahead === 0b111) threeLaneFrames++;
        if (top & ~ramp) roofFrames++;
    }
    for (const c of engine.collectibles) if (c.baseY > 4) stats.roofCoins++;
    // Every oncoming train that carried roof coins must have been boardable while it passed
    // (70% here vs 80% at spawn: the live run drifts a little as the game speeds up)
    for (const t of trainsByKey.values()) {
        if (!t.coins || !t.passed) continue;
        stats.coinMovers++;
        if (t.boarded < 0.7 * t.passing) stats.unboardable++;
    }
}
const pct = (n) => `${(100 * n / frames).toFixed(1)}%`;
console.log(`trains ${stats.trains} (moving ${stats.moving}), ramps ${stats.ramps}; frames with no train in the next 100m: ${pct(emptyFrames)}, ` +
    `all 3 lanes have trains ahead: ${pct(threeLaneFrames)}, a train is alongside the runner: ${pct(roofFrames)}, walls: ${walls}, same-element neighbours: ${pct(clashes)}, ` +
    `oncoming coin trains ${stats.coinMovers} (unboardable ${stats.unboardable})`);
assert.equal(walls, 0, 'every moment must leave a reachable lane or roof');
assert.equal(clashes, 0, 'neighbouring lanes never hold the same element side by side');
assert.ok(emptyFrames / frames < 0.15, 'track should rarely be empty');
assert.ok(stats.moving > 0 && stats.ramps > 0, 'mix of oncoming trains and ramps');
assert.ok(stats.coinMovers > 0, 'some oncoming trains carry coins');
assert.equal(stats.unboardable, 0, 'roof coins on an oncoming train are always reachable');
console.log('PASS 12 seeded 4-minute runs: always a way through (ground or roofs), no identical neighbours, track stays busy');

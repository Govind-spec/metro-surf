// Run: node tests/runner-regression.cjs [optional-original-html]
// Uses real Three.js geometry and game methods. DOM/canvas/audio/network are
// stubs: this complements the browser preview; it does not test a physical camera.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const THREE = require('../assets/vendor/three-r128.min.js');
const file = path.join(__dirname, '..', 'endless_runner.html');
const noop = () => {};
function boot(filename) {
    const html = fs.readFileSync(filename, 'utf8');
    const source = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const elements = new Map(), events = {};
    const canvas = new Proxy({}, { get: (_, key) => (key === 'createLinearGradient' || key === 'createRadialGradient') ? () => ({ addColorStop: noop }) : noop, set: () => true });
    const element = () => ({ children: [], style: {}, classList: { add: noop, remove: noop, toggle: noop },
        getContext: () => canvas, addEventListener: noop, appendChild: noop, remove: noop,
        prepend(child) { this.children.unshift(child); }, removeChild() { this.children.pop(); } });
    const sandbox = { THREE, console, performance, setTimeout: noop, clearTimeout: noop,
        setInterval: noop, clearInterval: noop, localStorage: { getItem: () => 0, setItem: noop },
        document: { createElement: element, querySelectorAll: () => [], getElementById(id) {
            if (!elements.has(id)) elements.set(id, element()); return elements.get(id);
        } }, window: { addEventListener: (event, fn) => { events[event] = fn; } },
        WebSocket: class { close() { if (this.onclose) this.onclose(); } }
    };
    const context = vm.createContext(sandbox);
    const run = code => vm.runInContext(code, context);
    if (html.includes('assets/environment/mall-city.js')) {
        run(fs.readFileSync(path.join(__dirname, '../assets/environment/mall-city.js'), 'utf8'));
    }
    run(source);
    run(`Sound.muted = true;
        GameEngine = Object.assign(Object.create(MetroDashGameEngine.prototype), {
            state: 'PLAYING', scene: new THREE.Scene(), baseSpeed: 30, currentSpeed: 30,
            score: 0, distance: 0, combo: 1, orbs: 0, highScore: 0, speedTier: 1,
            trackEndZ: -Infinity, obstacles: [], collectibles: [], powerupItems: [], particles: [],
            powerups: { MAGNET: 0, SNEAKERS: 0, MULTIPLIER: 0 },
            spawnDustPuff() {}, spawnComicPopup() {}, showBanner() {}
        });
        GameEngine.player = new StylizedRunnerCharacter(GameEngine.scene);
        RIFTController = new RIFTInputController();`);
    const wiringStart = source.indexOf('            RIFTController.onAction((action) => {');
    const wiringEnd = source.indexOf('\n            });', wiringStart) + '\n            });'.length;
    run(source.slice(wiringStart, wiringEnd));
    return { run, events, source, context, player: run('GameEngine.player'), engine: run('GameEngine') };
}

const app = boot(file), p = app.player, engine = app.engine;
let meshes = 0, triangles = 0;
p.group.traverse(object => {
    if (!object.isMesh) return;
    meshes++; triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
    for (const name of ['position', 'normal']) {
        for (const value of object.geometry.attributes[name].array) assert.ok(Number.isFinite(value), `${name} must be finite`);
    }
});
assert.ok(meshes < 90, `rig uses ${meshes} draw meshes`);
console.log(`PASS geometry: ${meshes} meshes, ${triangles} triangles, finite positions/normals`);

const api = app.context.window.RIFT;
api.moveLeft(); assert.equal(p.currentLaneIndex, 0);
api.moveLeft(); assert.equal(p.currentLaneIndex, 0);
api.moveRight(); api.moveRight(); api.moveRight(); assert.equal(p.currentLaneIndex, 2);
api.restartGame(); api.jump(); assert.equal(p.isJumping, true);
for (let i = 0; i < 90; i++) p.update(1 / 120, 1);
assert.equal(p.isJumping, false); assert.equal(p.y, 0);
api.slide(); assert.equal(p.getHitbox().maxY, 0.85);
for (let i = 0; i < 90; i++) p.update(1 / 120, 1);
assert.equal(p.isSliding, false); assert.equal(p.getHitbox().maxY, 1.90);
api.pauseGame(); api.moveLeft(); assert.equal(p.currentLaneIndex, 1);
api.pauseGame(); app.events.message({ data: { type: 'RIFT_ACTION', action: 'LEFT' } });
assert.equal(p.currentLaneIndex, 0);
app.run(`RIFTController.connectWebSocket('ws://localhost:8765'); RIFTController.ws.onmessage({ data: '{"action":"RIGHT"}' });`);
assert.equal(p.currentLaneIndex, 1);
app.events.keydown({ key: 'ArrowUp', preventDefault: noop }); assert.equal(p.isJumping, true);
api.slide(); assert.equal(p.vy, -38);
api.restartGame();
console.log('PASS RIFT direct API, postMessage, simulated WebSocket, arrow input, pause, restart, jump and slide');

function collision(kind, y, sliding = false, roof = false, sneakers = 0) {
    p.reset(); p.y = y; p.isSliding = sliding; p.isOnTrainRoof = roof;
    engine.state = 'PLAYING'; engine.currentSpeed = 0; engine.trackEndZ = -Infinity;
    engine.powerups.SNEAKERS = sneakers;
    engine.obstacles = [{ kind, x: 0, z: 0, halfLen: 2, group: new THREE.Group(), passed: false }];
    let hit = false; const gameover = engine.triggerGameOver;
    engine.triggerGameOver = () => { hit = true; };
    engine.updateObstaclesAndOrbs(0);
    engine.triggerGameOver = gameover;
    return hit;
}
assert.equal(collision('HURDLE', 0), true);
assert.equal(collision('HURDLE', 1.2), false);
assert.equal(collision('HIGH_BARRIER', 0), true);
assert.equal(collision('HIGH_BARRIER', 0, true), false);
assert.equal(collision('TRAIN', 2.4), true);
assert.equal(collision('TRAIN', 3.65, false, true), false);
assert.equal(collision('HURDLE', 0, false, false, 10), false);
assert.equal(collision('TRAIN', 0, false, false, 10), true);
engine.obstacles = [{ kind: 'TRAIN', x: 0, z: 0, halfLen: 8, height: 3.65 }];
assert.equal(engine.getWalkableGroundHeight(0, 0, false), 0);
assert.equal(engine.getWalkableGroundHeight(0, 3.65, true), 3.65);
api.restartGame(); engine.currentSpeed = 0; engine.trackEndZ = -Infinity;
for (const type of ['MAGNET', 'SNEAKERS', 'MULTIPLIER']) {
    engine.powerupItems = [{ type, x: 0, z: 0, baseY: 1, phase: 0, mesh: new THREE.Group() }];
    engine.updateObstaclesAndOrbs(0); assert.equal(engine.powerups[type], 10);
}
engine.collectibles = [{ x: 0, z: 0, baseY: 0.95, phase: 0, mesh: new THREE.Group() }];
const scoreBefore = engine.score;
engine.updateObstaclesAndOrbs(0);
assert.equal(engine.orbs, 1); assert.equal(engine.score - scoreBefore, 330);
engine.collectibles = [{ x: 3.2, z: -10, baseY: 0.95, phase: 0, mesh: new THREE.Group() }];
engine.updateObstaclesAndOrbs(1 / 60); assert.ok(engine.collectibles[0].x < 3.2);
// Magnet-locked side-lane coin keeps flying in and is collected within a second
for (let f = 0; f < 60 && engine.collectibles.length; f++) engine.updateObstaclesAndOrbs(1 / 60);
assert.equal(engine.collectibles.length, 0); assert.equal(engine.orbs, 2);
console.log('PASS hurdle/barrier/train collisions, roof gating, sneakers, magnet, multiplier and pickup scoring');

// Run all visual states, then check that restart clears stale poses.
for (const state of ['run', 'jump', 'slide', 'lane']) {
    api.restartGame();
    if (state === 'jump') api.jump();
    if (state === 'slide') api.slide();
    if (state === 'lane') api.moveLeft();
    for (let i = 0; i < 120; i++) {
        p.update(1 / 60, 1); p.group.updateMatrixWorld(true);
        p.group.traverse(object => { for (const value of object.matrixWorld.elements) assert.ok(Number.isFinite(value)); });
    }
}
p.triggerBonk(); p.update(1 / 60, 0); api.restartGame();
assert.equal(p.bonkHalo.visible, false); assert.equal(p.isBonked, false);
assert.equal(p.squashGroup.scale.y, 1);
assert.ok(Math.abs(p.headGroup.rotation.z) < 0.03);
console.log('PASS finite animated transforms and clean restart after bonk');

p.isSliding = true;
p.poseRunner(0, 1, 0);
p.group.updateMatrixWorld(true);
for (const leg of [p.leftLeg, p.rightLeg]) {
    // Use actual vertices, not rotated bounding-box corners (which overestimate).
    let lowest = Infinity;
    const vertex = new THREE.Vector3();
    leg.ankle.traverse(mesh => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
            lowest = Math.min(lowest, vertex.y);
        }
    });
    assert.ok(lowest > -0.015, `slide sole penetrates ground: ${lowest}`);
}
api.restartGame();
console.log('PASS settled slide keeps both sneakers above ground');

if (require.main === module && process.argv[2]) {
    const original = boot(process.argv[2]);
    // Validate untouched world, collisions, scoring and the complete RIFT implementation.
    const outsideCharacter = source => source.replace(/class StylizedRunnerCharacter \{[\s\S]*?(?=        \/\*\*\n         \* ===[\s\S]*?4\. CORE)/, 'CHARACTER\n');
    assert.equal(outsideCharacter(app.source), outsideCharacter(original.source));
    const snapshot = runner => JSON.stringify({ x: runner.x, y: runner.y, vy: runner.vy,
        lane: runner.currentLaneIndex, target: runner.targetX, ground: runner.groundHeight,
        jump: runner.isJumping, slide: runner.isSliding, roof: runner.isOnTrainRoof, hitbox: runner.getHitbox() });
    for (const fps of [30, 60, 120]) {
        for (const instance of [app, original]) {
            instance.context.window.RIFT.restartGame();
            instance.engine.isPlayerOnRamp = () => false;
            instance.engine.getWalkableGroundHeight = () => 0;
        }
        for (let frame = 0; frame < fps * 8; frame++) {
            for (const instance of [app, original]) {
                const player = instance.player;
                if (frame === 5) player.moveLeft();
                if (frame === 15) player.jump();
                if (frame === 23) player.slide();
                if (frame === 50) player.moveRight();
                if (frame === 70) player.jump();
                if (frame === 90) player.slide();
                if (frame === 120) player.reset();
                if (frame === 125) { player.y = 3.65; player.groundHeight = 3.65; player.isOnTrainRoof = true; player.jump(); }
                player.update(1 / fps, 1);
            }
            assert.equal(snapshot(p), snapshot(original.player), `physics parity ${fps}fps frame ${frame}`);
        }
    }
    console.log('PASS original/new physics parity at 30/60/120fps; all non-character engine/input source unchanged');
}

module.exports = { boot };

// Jump arc: one well-timed jump over a hurdle collects the whole run-up/arc/landing coin line at any speed
const T = 2 * p.baseJumpForce / -p.gravity;
const step = (S) => { engine.currentSpeed = S; p.update(1 / 60, 1); engine.updateObstaclesAndOrbs(1 / 60); };
for (const S of [30, 50, 68]) {
    api.restartGame(); engine.trackEndZ = -Infinity; engine.obstacles = []; engine.collectibles = [];
    engine.createObstacle('HURDLE', 0, -70);
    engine.createCoinRun(0, -70 + 4 * 4.2, 9, 'HURDLE', -70);
    const hurdle = engine.obstacles[0], orbsBefore = engine.orbs;
    let jumped = false;
    for (let f = 0; f < 600 && engine.collectibles.length; f++) {
        if (!jumped && hurdle.z >= -S * T / 2) { p.jump(); jumped = true; }
        step(S);
    }
    assert.equal(engine.state, 'PLAYING', `cleared hurdle at speed ${S}`);
    assert.equal(engine.orbs - orbsBefore, 9, `collected every arc coin at speed ${S}`);
}
// Slide barrier: no coin overlaps the overhead beam
engine.collectibles = []; engine.createCoinRun(0, -40 + 4 * 4.2, 9, 'HIGH_BARRIER', -40);
assert.ok(engine.collectibles.every(o => Math.abs(o.z + 40) >= 1.4));
// Ramp: head-on at top speed and a late lane switch onto the ramp both reach the roof safely
engine.trainLiveries = app.run('CartoonArtFactory.createTrainLiveryTextures()');
for (const [S, lane, switchAt] of [[68, 0, null], [40, 0, null], [40, 3.2, -1.5]]) {
    api.restartGame(); engine.trackEndZ = -Infinity; engine.obstacles = []; engine.collectibles = [];
    engine.spawnTrainConvoy(lane, -80 - 11.4, 2, false, 0, true);
    const ramp = engine.obstacles.find(o => o.kind === 'RAMP');
    let switched = false, maxY = 0;
    for (let f = 0; f < 300 && engine.state === 'PLAYING'; f++) {
        if (switchAt !== null && !switched && ramp.z >= switchAt) { api.moveRight(); switched = true; }
        step(S); maxY = Math.max(maxY, p.y);
    }
    assert.equal(engine.state, 'PLAYING', `survived ramp at speed ${S}, lane ${lane}`);
    assert.ok(maxY > 3.5, 'climbed onto the train roof');
}
console.log('PASS jump-arc coin runs at 30/50/68, slide-barrier coin gap, ramp climb at top speed and from a lane switch');
// Coin train timed against a ramp: run up the ramp, step across onto the oncoming train, grab every roof coin
for (const S of [30, 44, 56]) {
    api.restartGame(); engine.trackEndZ = -Infinity; engine.obstacles = []; engine.collectibles = []; engine.coinTrains = [];
    engine.currentSpeed = S;
    engine.parkTrain(1, -200, 3, true);
    const rel = Math.round(S * 0.36);
    engine.runTrain(2, (-200 - 7.8 - 11) * (S + rel) / S, 2, false, true);
    const roofCoins = engine.collectibles.filter((c) => c.relSpeed);
    assert.ok(roofCoins.length > 0, `coin train spawned with roof coins at speed ${S}`);
    const mover = engine.obstacles.find((o) => o.relSpeed > 0);
    let stepped = false;
    for (let f = 0; f < 900 && engine.state === 'PLAYING' && mover.z - mover.halfLen < 30; f++) {
        if (!stepped && p.isOnTrainRoof && mover.z + mover.halfLen > -3) { api.moveRight(); stepped = true; }
        step(S);
    }
    assert.equal(engine.state, 'PLAYING', `survived boarding the coin train at speed ${S}`);
    // Collected coins are removed near the player; missed ones only once they scroll past z = 14
    const collected = roofCoins.filter((c) => !engine.collectibles.includes(c) && c.z < 14).length;
    assert.equal(collected, roofCoins.length, `collected all ${roofCoins.length} roof coins at speed ${S}`);
}
console.log('PASS ramp-timed coin train: climb, step across, collect every roof coin at 30/44/56');
// Train-to-train jump: ramp up, run the roof, jump a 12m gap onto the next train, grab every coin incl. the arc
for (const S of [30, 44, 56]) {
    api.restartGame(); engine.trackEndZ = -Infinity; engine.obstacles = []; engine.collectibles = []; engine.coinTrains = [];
    engine.currentSpeed = S;
    const back1 = engine.parkTrain(1, -150, 2, true);
    const back2 = engine.parkTrain(1, back1 - 12, 2);
    engine.rampCoins(1, -150, back2 + 4, [back1 - 6]);
    const coins = engine.collectibles.slice(), lead = engine.obstacles.find((o) => o.ramped);
    const T_ROOF = 2 * 17.2 / -p.gravity, gapOffset = back1 - 6 - lead.z; // gap centre rides along with the parked train
    let jumped = false;
    for (let f = 0; f < 900 && engine.state === 'PLAYING' && engine.collectibles.length; f++) {
        const gapCentre = lead.z + gapOffset;
        if (!jumped && p.isOnTrainRoof && gapCentre >= -S * T_ROOF / 2) { api.jump(); jumped = true; }
        step(S);
    }
    assert.equal(engine.state, 'PLAYING', `jumped the gap between trains at speed ${S}`);
    const collected = coins.filter((c) => !engine.collectibles.includes(c) && c.z < 14).length;
    assert.equal(collected, coins.length, `collected all ${coins.length} coins up the ramp, over the gap and on at speed ${S}`);
}
console.log('PASS train-to-train gap jump: survive and collect every coin (ramp, roof, arc) at 30/44/56');

// node tests/environment-regression.cjs [HTML saved before the environment update]
const { boot } = require('./runner-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('../assets/vendor/three-r128.min.js');
const filename = path.join(__dirname, '..', 'endless_runner.html');
const app = boot(filename), e = app.engine;
e.clearEntities();
Object.assign(e, {
    trackChunks: [], viaductTrains: [], midgroundBuildings: [], distantSkyline: [],
    clouds: [], animatedSigns: [], rotatingProps: [], worldTime: 0,
    currentZoneIndex: 0, chunkSpawnCounter: 0,
    zoneNames: ['SUNNY YARD', 'SKY MALL', 'ROOFTOP GARDENS', 'BAYVIEW PROMENADE'],
    trainLiveries: app.run('CartoonArtFactory.createTrainLiveryTextures()')
});
e.buildEnvironment();
assert.deepEqual(Array.from(e.trackCenters), [-3.2, 0, 3.2]);
assert.equal(e.trackChunks.length, 16);
assert.equal(e.chunkLength, 20);
assert.equal(e.obstacles.length + e.collectibles.length + e.powerupItems.length, 0, 'scenery must not create gameplay entities');
assert.equal(e.viaductTrains.length, 2);
assert.equal(e.midgroundBuildings.length, 28);
assert.equal(e.clouds.length, 12);

const uniqueGeometry = new Set();
e.scene.traverse(o => { if (o.isMesh) uniqueGeometry.add(o.geometry); });
for (const geometry of uniqueGeometry) {
    for (const key of ['position', 'normal', 'uv']) {
        if (!geometry.attributes[key]) continue;
        for (const value of geometry.attributes[key].array) assert.ok(Number.isFinite(value), `finite ${key}`);
    }
}
const zones = ['yardGroup', 'stationGroup', 'tunnelGroup', 'viaductGroup'];
const sample = e.trackChunks[2]; // This chunk's transform is at the runner origin.
for (let zone = 0; zone < 4; zone++) {
    e.configureTrackChunkZone(sample, zone);
    assert.equal(zones.filter(key => sample[key].visible).length, 1);
    const group = sample[zones[zone]];
    group.updateMatrixWorld(true);
    for (const x of [-3.66, -3.2, -2.74, -.46, 0, .46, 2.74, 3.2, 3.66]) {
        for (let z = -9; z <= 9; z += 2) {
            const hits = new THREE.Raycaster(new THREE.Vector3(x, .25, z), new THREE.Vector3(0, 1, 0)).intersectObject(group, true);
            assert.ok(hits.every(hit => hit.point.y > 8.0), `${zones[zone]} intrudes into the running corridor at ${x}, ${z}`);
        }
    }
}
console.log('PASS all four scenery zones: finite geometry, one active zone, and 360 lane-clearance raycasts');

const initialChildren = e.scene.children.length;
const counters = { min: Infinity, max: -Infinity, zones: new Set() };
// Ten minutes at the game's top normal speed, including every zone transition.
for (let frame = 0; frame < 600 * 60; frame++) {
    e.updateEnvironmentScroll(1 / 60, 68);
    counters.zones.add(e.currentZoneIndex);
    for (const train of e.viaductTrains) assert.equal(train.environmentDeck.position.z, train.z);
}
assert.equal(counters.zones.size, 4);
assert.equal(e.scene.children.length, initialChildren, 'scrolling must recycle scenery instead of adding objects');
const finalGeometry = new Set();
e.scene.traverse(o => { if (o.isMesh) finalGeometry.add(o.geometry); });
assert.equal(finalGeometry.size, uniqueGeometry.size);
const positions = e.trackChunks.map(chunk => chunk.group.position.z).sort((a, b) => a - b);
for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - 20) < 1e-6, 'chunk seams must stay 20m apart');
assert.ok(positions[0] >= -280.001 && positions.at(-1) <= 40.001);
e.scene.traverse(o => { for (const value of [...o.position.toArray(), ...o.scale.toArray()]) assert.ok(Number.isFinite(value)); });
console.log('PASS ten-minute scroll: all zones, seamless recycling, stable geometry count and attached elevated rail decks');

if (process.argv[2]) {
    const stripEnvironment = input => {
        let s = input.replace('    <script src="assets/environment/mall-city.js"></script>\n', '');
        s = s.replace(/this\.zoneNames = \[[\s\S]*?\];/, 'this.zoneNames = ENVIRONMENT_LABELS;');
        let a = s.indexOf('            buildEnvironment() {');
        let b = s.indexOf('            buildViaductTrains() {', a);
        s = s.slice(0, a) + 'ENVIRONMENT_BUILDERS\n' + s.slice(b);
        a = s.indexOf('            buildMidgroundCityLayer() {');
        b = s.indexOf('            /**\n             * ============================================================================\n             * 3-LANE TRAIN & OBSTACLE SPAWNER', a);
        s = s.slice(0, a) + 'PARALLAX_ART\n' + s.slice(b);
        return s.replace('                    if (vTrain.environmentDeck) vTrain.environmentDeck.position.z = vTrain.z;\n', '');
    };
    assert.equal(stripEnvironment(fs.readFileSync(filename, 'utf8')), stripEnvironment(fs.readFileSync(process.argv[2], 'utf8')));
    console.log('PASS runner, trains, camera, lighting setup, physics, spawning, scoring, power-ups and RIFT source unchanged');
}
const report = { passed: true, zones: 4, laneRays: 360, simulatedSeconds: 600, chunks: 16, uniqueGeometries: uniqueGeometry.size, geometryGrowth: 0 };
fs.mkdirSync(path.join(__dirname, 'artifacts', 'environment'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'artifacts', 'environment', 'regression-results.json'), JSON.stringify(report, null, 2));

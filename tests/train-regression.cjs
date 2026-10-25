// node tests/train-regression.cjs [HTML saved before the train update]
const { boot } = require('./runner-regression.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const THREE = require('../assets/vendor/three-r128.min.js');
const filename = path.join(__dirname, '..', 'endless_runner.html');
const app = boot(filename);
const factory = app.run('CartoonArtFactory');
const liveries = factory.createTrainLiveryTextures();
assert.equal(liveries.length, 5);
const report = [];
for (const livery of liveries) {
    for (const lead of [true, false]) {
        const train = factory.buildCartoonTrainCar(livery, lead);
        const another = factory.buildCartoonTrainCar(livery, lead);
        assert.notEqual(train, another);
        assert.equal(train.children[0].geometry, another.children[0].geometry);
        train.position.x = 10;
        assert.equal(another.position.x, 0);
        train.position.x = 0;
        train.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(train);
        assert.ok(bounds.min.y > -0.00001);
        assert.ok(bounds.max.y <= 3.65001, 'roof details must not obstruct the roof-run route');
        assert.ok(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) <= 1.48);
        assert.ok(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) <= 7.23);
        assert.ok(train.children.length < 25, 'static details must stay batched');
        let triangles = 0;
        train.traverse(mesh => {
            if (!mesh.isMesh) return;
            triangles += mesh.geometry.attributes.position.count / 3;
            for (const key of ['position', 'normal', 'uv']) {
                for (const value of mesh.geometry.attributes[key].array) assert.ok(Number.isFinite(value));
            }
        });
        // Real geometry must support the game's unchanged 3.65m roof height.
        for (const x of [-0.6, 0, 0.6]) {
            for (const z of [-6.8, -3, 0, 3, 6.8]) {
                const ray = new THREE.Raycaster(new THREE.Vector3(x, 6, z), new THREE.Vector3(0, -1, 0));
                const hits = ray.intersectObject(train, true);
                assert.ok(hits.length);
                assert.ok(Math.abs(hits[0].point.y - 3.65) < 0.005, `${livery.style} roof at ${x}, ${z}`);
            }
        }
        report.push({ style: livery.style, lead, meshes: train.children.length, triangles });
    }
}
console.log('PASS five reference liveries, lead/trailer meshes, shared assets, finite geometry and original train envelope');
console.log('PASS 150 roof raycasts: uninterrupted walkable surface at 3.65m');

const game = app.engine;
game.trainLiveries = liveries;
game.redWhiteStripeTex = factory.createHazardStripeTexture();
game.yellowOrangeStripeTex = factory.createHazardStripeTexture('#ff7a00', '#ffd100');
game.viaductTrains = [];
game.buildViaductTrains();
assert.equal(game.viaductTrains.length, 2);
assert.equal(game.viaductTrains[0].group.children.length, 4);
assert.equal(game.viaductTrains[0].group.children[3].userData.isLeadCar, true);
assert.equal(game.viaductTrains[1].group.children[0].userData.isLeadCar, true);
game.clearEntities();
assert.equal(game.spawnTrainConvoy(0, -150, 2, false, 4, true), true);
const ramp = game.obstacles.find(o => o.kind === 'RAMP');
const cars = game.obstacles.filter(o => o.kind === 'TRAIN');
assert.equal(cars.length, 2);
assert.equal(cars[0].height, 3.65);
assert.equal(cars[0].halfLen, 7.2);
assert.ok(Math.abs(cars[0].z - cars[1].z - 15.2) < 1e-8);
assert.equal(cars[0].relSpeed, ramp.relSpeed);
assert.equal(game.spawnTrainConvoy(0, -150, 2, true, 0), false, 'overlapping convoy must be rejected');
game.clearEntities();
assert.equal(game.spawnTrainConvoy(-3.2, -150, 2, true, 2), true);
assert.equal(game.obstacles[0].relSpeed, Math.round(game.currentSpeed * 0.36));
console.log('PASS elevated consists, lead direction, convoy spacing, ramp attachment, lane safety and oncoming speed');

if (process.argv[2]) {
    const removeArt = html => {
        const start = html.indexOf('            static createTrainLiveryTextures() {');
        const end = html.indexOf('\n        }\n\n        /**', start);
        html = html.slice(0, start) + 'TRAIN_ART' + html.slice(end);
        const a = html.indexOf('            buildViaductTrains() {');
        const b = html.indexOf('            buildMidgroundCityLayer() {', a);
        return html.slice(0, a) + 'DISTANT_TRAIN_ART\n' + html.slice(b);
    };
    assert.equal(removeArt(fs.readFileSync(filename, 'utf8')), removeArt(fs.readFileSync(process.argv[2], 'utf8')));
    console.log('PASS all production source outside the two train-art sections is byte-for-byte unchanged');
}
fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'artifacts', 'train-geometry.json'), JSON.stringify(report, null, 2));
console.table(report);

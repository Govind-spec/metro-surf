// Optional browser QA: requires Playwright and a localhost server on port 8025.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const artifacts = path.join(__dirname, 'artifacts');
fs.mkdirSync(artifacts, { recursive: true });
(async () => {
    const browser = await chromium.launch({ headless: true,
        executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
        await page.goto('http://127.0.0.1:8025/endless_runner.html');
        await page.waitForFunction(() => window.RIFT && typeof GameEngine !== 'undefined' && GameEngine.player);
        await page.click('#btn-start-game');
        await page.waitForFunction(() => GameEngine.score > 2);
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => GameEngine.player.x < -2.5);
        await page.evaluate(() => window.RIFT.moveRight());
        await page.waitForFunction(() => Math.abs(GameEngine.player.x) < 0.2);
        await page.evaluate(() => window.RIFT.jump());
        await page.waitForFunction(() => GameEngine.player.y > 0.5);
        await page.evaluate(() => window.RIFT.slide());
        await page.waitForFunction(() => GameEngine.player.isSliding && GameEngine.player.y < 0.1);
        await page.evaluate(() => window.RIFT.pauseGame());
        const pausedScore = await page.evaluate(() => GameEngine.score);
        await page.waitForTimeout(120);
        assert.equal(await page.evaluate(() => GameEngine.score), pausedScore);
        await page.evaluate(() => { window.RIFT.restartGame(); window.postMessage({ type: 'RIFT_ACTION', action: 'RIGHT' }, '*'); });
        await page.waitForFunction(() => GameEngine.player.currentLaneIndex === 2);
        await page.evaluate(() => {
            window.RIFT.restartGame();
            GameEngine.state = 'INSPECT';
            GameEngine.player.runCycleTime = 1.0;
            GameEngine.player.poseRunner(0, 1, 0);
            GameEngine.camera.position.set(0, 4.5, 8);
            GameEngine.camera.lookAt(0, 1.5, -15);
        });
        await page.screenshot({ path: path.join(artifacts, 'live-gameplay.png') });
        console.log('PASS real browser startup, keyboard lanes, RIFT jump/slide, pause, restart and postMessage');

        await page.goto('http://127.0.0.1:8025/tests/runner-preview.html');
        await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('draws'));
        for (const view of ['Rear', 'Front', 'Side', 'Gameplay']) {
            await page.selectOption('#view', view);
            await page.evaluate(() => { frozen = true; runner.runCycleTime = 1.0; runner.poseRunner(0, 1, 0); });
            await page.waitForTimeout(100);
            await page.screenshot({ path: path.join(artifacts, view.toLowerCase() + '.png') });
        }
        await page.selectOption('#view', 'Side');
        for (const pose of ['Jump', 'Slide', 'Lane left', 'Lane right', 'Bonk']) {
            await page.selectOption('#pose', pose);
            await page.evaluate(() => { frozen = false; });
            await page.waitForTimeout(250);
            await page.evaluate(() => { frozen = true; });
            await page.screenshot({ path: path.join(artifacts, pose.toLowerCase().replaceAll(' ', '-') + '.png') });
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(artifacts, 'browser-results.json'), JSON.stringify({ passed: true, errors, views: ['Gameplay', 'Rear', 'Front', 'Side'], poses: ['Run', 'Jump', 'Slide', 'Lane left', 'Lane right', 'Bonk'] }, null, 2));
        console.log('PASS WebGL materials compile without errors; captured gameplay, turnaround and all action poses');

        const trainArtifacts = path.join(artifacts, 'trains');
        fs.mkdirSync(trainArtifacts, { recursive: true });
        await page.goto('http://127.0.0.1:8025/tests/train-preview.html');
        await page.waitForFunction(() => typeof ready !== 'undefined' && ready);
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(trainArtifacts, 'fleet.png') });
        for (const [index, style] of ['default', 'city', 'neon', 'graffiti', 'premium'].entries()) {
            await page.selectOption('#train', String(index));
            for (const view of ['Front', 'Three-quarter', 'Side']) {
                await page.selectOption('#view', view);
                await page.waitForTimeout(100);
                await page.screenshot({ path: path.join(trainArtifacts, style + '-' + view.toLowerCase() + '.png') });
            }
        }
        await page.selectOption('#view', 'Gameplay');
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(trainArtifacts, 'gameplay.png') });
        await page.selectOption('#view', 'Roof');
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(trainArtifacts, 'roof.png') });

        await page.goto('http://127.0.0.1:8025/endless_runner.html');
        await page.waitForFunction(() => window.RIFT && typeof GameEngine !== 'undefined' && GameEngine.player);
        await page.click('#btn-start-game');
        await page.evaluate(() => {
            GameEngine.clearEntities(); GameEngine.trackEndZ = -Infinity;
            GameEngine.createPlayableTrain(0, -7.4, true, 2);
        });
        await page.waitForFunction(() => GameEngine.state === 'GAMEOVER');
        await page.evaluate(() => {
            window.RIFT.restartGame(); GameEngine.clearEntities(); GameEngine.trackEndZ = -Infinity;
            GameEngine.createBoardingRamp(0, -3.9);
            GameEngine.createPlayableTrain(0, -15.3, false, 4);
        });
        await page.waitForFunction(() => GameEngine.state === 'PLAYING' && GameEngine.player.isOnTrainRoof && GameEngine.player.y > 3.4);
        await page.evaluate(() => { GameEngine.state = 'INSPECT'; });
        await page.screenshot({ path: path.join(trainArtifacts, 'roof-running.png') });
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(trainArtifacts, 'browser-results.json'), JSON.stringify({
            passed: true, errors, styles: ['default', 'city', 'neon', 'graffiti', 'premium'],
            gameplayChecks: ['oncoming train collision', 'boarding ramp ascent', 'premium roof running'],
            screenshots: ['fleet', 'fronts', 'sides', 'three-quarter views', 'gameplay', 'roof', 'roof-running']
        }, null, 2));
        console.log('PASS all five train designs compile and render; live train collision, ramp ascent and roof running');

        const envArtifacts = path.join(artifacts, 'environment');
        fs.mkdirSync(envArtifacts, { recursive: true });
        await page.goto('http://127.0.0.1:8025/tests/environment-preview.html');
        await page.waitForFunction(() => typeof ready !== 'undefined' && ready);
        const environmentStats = [];
        for (const [index, name] of ['city', 'mall', 'gardens', 'waterfront'].entries()) {
            await page.selectOption('#zone', String(index));
            for (const view of ['Gameplay', 'Balcony']) {
                await page.selectOption('#view', view); await page.waitForTimeout(150);
                await page.screenshot({ path: path.join(envArtifacts, name + '-' + view.toLowerCase() + '.png') });
                environmentStats.push(await page.evaluate(() => ({ zone: engine.zoneNames[Number(document.querySelector('#zone').value)], view: document.querySelector('#view').value, calls: engine.renderer.info.render.calls, triangles: engine.renderer.info.render.triangles })));
            }
        }
        await page.selectOption('#zone', '0'); await page.selectOption('#view', 'Street');
        await page.screenshot({ path: path.join(envArtifacts, 'shop-detail.png') });
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(envArtifacts, 'browser-results.json'), JSON.stringify({ passed: true, errors, environmentStats }, null, 2));
        console.log('PASS all four environment zones render without WebGL errors; saved gameplay, balcony and shop views');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

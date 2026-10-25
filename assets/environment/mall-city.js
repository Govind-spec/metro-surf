/* Local, procedural scenery for the supplied mall-city concept sheet.
 * No gameplay entities or collision surfaces are created by this file.
 * All props stay outside the three track lanes or above the running envelope.
 */
class MetroMallEnvironment {
    constructor(engine) {
        this.engine = engine;
        this.materials = new Map();
        this.geometries = new Map();
        this.templates = new Map();
        this.textures = new Map();
        this.colors = {
            cream: 0xffecda, white: 0xfff9ef, peach: 0xffc29f,
            pink: 0xfa62a8, rose: 0xff95c3, yellow: 0xffda59,
            cyan: 0x36c9e8, teal: 0x179eb7, blue: 0x66baf0,
            mint: 0x8ce0bc, lavender: 0xbba4e6, ink: 0x353747,
            leaf: 0x65ba4b, lime: 0xa3d65a, forest: 0x2d8f57,
            wood: 0xc78b53, rail: 0xc7cbd4, paving: 0xe5d4d4
        };
    }

    material(color, glow = false) {
        const hex = this.colors[color] === undefined ? color : this.colors[color];
        const key = hex + ':' + glow;
        if (!this.materials.has(key)) {
            const mat = glow ? new THREE.MeshBasicMaterial({ color: hex, toneMapped: false }) :
                new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).convertSRGBToLinear(), roughness: 0.62, metalness: 0.03, toneMapped: false });
            if (!glow) {
                mat.onBeforeCompile = shader => {
                    shader.fragmentShader = shader.fragmentShader.replace('#include <encodings_fragment>', `
                        float mallLight = dot(outgoingLight, vec3(.2126,.7152,.0722))
                            / max(.001, dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)));
                        gl_FragColor.rgb = LinearTosRGB(vec4(diffuseColor.rgb,1.)).rgb
                            * clamp(.70 + .20 * mallLight, .60, 1.06);
                    `);
                };
                mat.customProgramCacheKey = () => 'metro-mall-palette-v1';
            }
            this.materials.set(key, mat);
        }
        return this.materials.get(key);
    }

    geometry(key, build) {
        if (!this.geometries.has(key)) this.geometries.set(key, build());
        return this.geometries.get(key);
    }

    mesh(parent, geometry, material, x, y, z, cast = true, receive = false) {
        const mesh = new THREE.Mesh(geometry, typeof material === 'object' ? material : this.material(material));
        mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = receive;
        parent.add(mesh); return mesh;
    }

    box(parent, w, h, d, color, x, y, z, receive = false) {
        return this.mesh(parent, this.geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1)), color, x, y, z, true, receive).scale.set(w, h, d);
    }

    orb(parent, sx, sy, sz, color, x, y, z) {
        const m = this.mesh(parent, this.geometry('orb', () => new THREE.SphereGeometry(1, 10, 8)), color, x, y, z);
        m.scale.set(sx, sy, sz); return m;
    }

    cylinder(parent, top, bottom, height, color, x, y, z) {
        return this.mesh(parent, this.geometry(`cyl:${top}:${bottom}:${height}`, () => new THREE.CylinderGeometry(top, bottom, height, 10)), color, x, y, z);
    }

    palmFrond() {
        return this.geometry('curved-palm-frond', () => {
            const positions = [], uv = [], indices = [], rows = 9;
            for (let layer = 0; layer < 2; layer++) for (let i = 0; i < rows; i++) {
                const t = i / (rows - 1), width = Math.sin(Math.PI * t) * .36;
                for (let j = -1; j <= 1; j++) {
                    positions.push(j * width, Math.sin(Math.PI * t) * (.58 + (j === 0 ? .11 : 0)) - t * t * .66 - layer * .025, t * 2.3);
                    uv.push((j + 1) / 2, t);
                }
            }
            for (let layer = 0; layer < 2; layer++) for (let i = 0; i < rows - 1; i++) for (let j = 0; j < 2; j++) {
                const a = layer * rows * 3 + i * 3 + j, b = a + 3, c = a + 1, d = b + 1;
                indices.push(...(layer === 0 ? [a,b,c,b,d,c] : [a,c,b,b,c,d]));
            }
            const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
            geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
        });
    }

    beam(parent, from, to, width, color) {
        const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
        const mesh = this.mesh(parent, this.geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1)), color, ...(a.clone().add(b).multiplyScalar(.5).toArray()));
        mesh.scale.set(width, delta.length(), width);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return mesh;
    }

    // Merge only static scenery, preserving shadow flags and local coordinates.
    // Templates share the resulting buffers/materials across recycled chunks.
    batch(group) {
        group.updateMatrixWorld(true);
        const inverse = new THREE.Matrix4().copy(group.matrixWorld).invert(), buckets = new Map();
        group.traverse(mesh => {
            if (!mesh.isMesh) return;
            const key = mesh.material.uuid + ':' + mesh.castShadow + ':' + mesh.receiveShadow;
            if (!buckets.has(key)) buckets.set(key, { material: mesh.material, cast: mesh.castShadow, receive: mesh.receiveShadow, parts: [] });
            const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
            geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
            buckets.get(key).parts.push(geo);
        });
        group.clear();
        for (const bucket of buckets.values()) {
            const count = bucket.parts.reduce((n, geo) => n + geo.attributes.position.count, 0), merged = new THREE.BufferGeometry();
            for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
                const data = new Float32Array(count * size); let offset = 0;
                for (const geo of bucket.parts) { if (geo.attributes[name]) data.set(geo.attributes[name].array, offset); offset += geo.attributes.position.count * size; }
                merged.setAttribute(name, new THREE.BufferAttribute(data, size));
            }
            merged.computeBoundingBox(); merged.computeBoundingSphere();
            this.mesh(group, merged, bucket.material, 0, 0, 0, bucket.cast, bucket.receive);
            bucket.parts.forEach(geo => geo.dispose());
        }
        return group;
    }

    texture(kind) {
        if (this.textures.has(kind)) return this.textures.get(kind);
        const canvas = document.createElement('canvas');
        const banner = kind.startsWith('banner'), poster = kind === 'good-run' || kind === 'play-more';
        canvas.width = banner ? 256 : poster ? 512 : 1024; canvas.height = banner || poster ? 768 : 320;
        const c = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
        const rect = (x, y, bw, bh, r) => {
            c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + bw - r, y); c.quadraticCurveTo(x + bw, y, x + bw, y + r);
            c.lineTo(x + bw, y + bh - r); c.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh); c.lineTo(x + r, y + bh);
            c.quadraticCurveTo(x, y + bh, x, y + bh - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
        };
        const bunny = (x, y, size) => {
            c.save(); c.translate(x, y); c.scale(size, size);
            c.fillStyle = '#fff4ec';
            for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * .23, -.52, .16, .47, s * .13, 0, Math.PI * 2); c.fill(); }
            c.beginPath(); c.ellipse(0, .03, .56, .47, 0, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ff98bd';
            for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * .23, -.53, .08, .31, s * .13, 0, Math.PI * 2); c.fill(); }
            c.fillStyle = '#353747';
            for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * .20, .01, .065, .092, 0, 0, Math.PI * 2); c.fill(); }
            c.beginPath(); c.ellipse(0, .17, .10, .09, 0, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#ff91bc';
            for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * .35, .16, .08, .05, 0, 0, Math.PI * 2); c.fill(); }
            c.restore();
        };
        const smile = (x, y, size, color = '#353747') => {
            c.save(); c.translate(x, y); c.scale(size, size); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = .075;
            c.beginPath(); c.arc(0, 0, .45, 0, Math.PI * 2); c.stroke();
            for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * .16, -.08, .045, .07, 0, 0, Math.PI * 2); c.fill(); }
            c.beginPath(); c.arc(0, .03, .23, .12 * Math.PI, .88 * Math.PI); c.stroke(); c.restore();
        };
        const text = (label, x, y, size, fill = '#fff8ee', outline = true) => {
            c.font = `900 ${size}px 'Arial Rounded MT Bold', 'Trebuchet MS', sans-serif`;
            c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
            c.lineWidth = size * .17; c.strokeStyle = '#353747';
            if (outline) c.strokeText(label, x, y); c.fillStyle = fill; c.fillText(label, x, y);
        };
        if (kind === 'glass' || kind === 'shop-glass') {
            const gradient = c.createLinearGradient(0, 0, w, h);
            gradient.addColorStop(0, kind === 'glass' ? '#70cff5' : '#fff4b5');
            gradient.addColorStop(.48, kind === 'glass' ? '#3599d4' : '#ffc66b');
            gradient.addColorStop(1, kind === 'glass' ? '#85dcf5' : '#c77757');
            c.fillStyle = gradient; c.fillRect(0, 0, w, h);
            if (kind === 'shop-glass') {
                c.fillStyle = '#a76a60'; c.fillRect(0, h * .72, w, 14);
                for (let i = 0; i < 8; i++) {
                    c.fillStyle = ['#ff85b8', '#ffe39a', '#91e6d9', '#e1baed'][i % 4];
                    rect(40 + i * 130, 145 - i % 2 * 30, 78, 85 + i % 2 * 30, 12); c.fill();
                    c.strokeStyle = '#fff3dc'; c.lineWidth = 8; c.beginPath(); c.arc(79 + i * 130, 145 - i % 2 * 30, 19, Math.PI, 0); c.stroke();
                }
            }
            c.fillStyle = 'rgba(230,255,255,.24)';
            for (let x = -200; x < w; x += 450) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 170, 0); c.lineTo(x + 410, h); c.lineTo(x + 240, h); c.closePath(); c.fill(); }
        } else {
            const pink = kind === 'jet-shop' || kind === 'play-more' || kind === 'banner-bunny';
            const gradient = c.createLinearGradient(0, 0, w, h);
            gradient.addColorStop(0, pink ? '#ff8ac0' : '#fff187'); gradient.addColorStop(1, pink ? '#ec468e' : '#ffcb4e');
            c.fillStyle = gradient; c.fillRect(0, 0, w, h);
            if (banner || poster) {
                c.fillStyle = '#39cbe8'; c.beginPath(); c.moveTo(0, h * .83); c.lineTo(w * .55, h * .67); c.lineTo(w, h * .87); c.lineTo(w, h); c.lineTo(0, h); c.fill();
                c.fillStyle = '#ffe25e'; c.beginPath(); c.arc(w * .17, h * .13, w * .19, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#ff8ac0'; c.beginPath(); c.arc(w * .83, h * .90, w * .22, 0, Math.PI * 2); c.fill();
            }
            if (kind === 'jet-shop') { text('JET SHOP', 437, 165, 145); bunny(890, 187, 135); }
            else if (kind === 'sunny-yard') { text('SUNNY YARD', 430, 168, 113); smile(890, 158, 225); }
            else if (kind === 'good-run') { bunny(w * .5, h * .40, w * .56); text('GOOD', w / 2, h * .70, 106); text('RUN!', w / 2, h * .84, 110); }
            else if (kind === 'play-more') { bunny(w * .5, h * .44, w * .51); text('PLAY MORE', w / 2, h * .74, 67); text('EVERY DAY', w / 2, h * .86, 61); }
            else if (kind === 'banner-bunny') bunny(w / 2, h * .46, w * .68);
            else if (kind === 'banner-smile') smile(w / 2, h * .40, w * .79, '#26b2ce');
            else { text('SKY MALL', w / 2, h * .52, 125); }
            c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 10; rect(12, 12, w - 24, h - 24, 16); c.stroke();
        }
        const tex = new THREE.CanvasTexture(canvas); tex.anisotropy = 4;
        const material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        this.textures.set(kind, material); return material;
    }

    panel(parent, width, height, kind, x, y, z, turn = 0, frame = 'ink') {
        const group = new THREE.Group(); group.position.set(x, y, z); group.rotation.y = turn; parent.add(group);
        this.box(group, width + .18, height + .18, .18, frame, 0, 0, -.075);
        this.mesh(group, this.geometry(`panel:${width}:${height}`, () => new THREE.PlaneGeometry(width, height)), this.texture(kind), 0, 0, .025, false, false);
        return group;
    }

    planter(parent, x, y, z, width = 1.5, length = 2.3, color = 'cream', trailing = false) {
        this.box(parent, width, .72, length, color, x, y + .36, z);
        this.box(parent, width + .12, .12, length + .12, color, x, y + .72, z);
        this.box(parent, width * .82, .04, length * .88, 'forest', x, y + .79, z);
        for (let i = 0; i < 10; i++) {
            const angle = i * 2.4, radius = .28 + i % 3 * .11;
            const leaf = this.orb(parent, .22, .49, .16, ['leaf', 'lime', 'forest'][i % 3], x + Math.cos(angle) * width * radius, y + .91 + i % 3 * .08, z + Math.sin(angle) * length * .36);
            leaf.rotation.z = Math.cos(angle) * .6; leaf.rotation.x = Math.sin(angle) * .6;
        }
        const petal = this.geometry('flower-petal', () => new THREE.SphereGeometry(1, 6, 4));
        for (let i = 0; i < 2; i++) {
            const fx = x + (i ? .24 : -.24), fz = z + length * (i ? .25 : -.25), fy = y + 1.29;
            for (let p = 0; p < 5; p++) {
                const a = p / 5 * Math.PI * 2;
                const mesh = this.mesh(parent, petal, i ? 'white' : 'yellow', fx + Math.cos(a) * .14, fy + Math.sin(a) * .11, fz);
                mesh.scale.set(.11, .10, .08);
            }
            this.mesh(parent, petal, 'yellow', fx, fy, fz + .05).scale.set(.07, .07, .06);
        }
        if (trailing) for (let i = 0; i < 7; i++) {
            this.orb(parent, .18, .28, .15, i % 2 ? 'leaf' : 'lime', x - Math.sign(x) * width * .55, y + .65 - i * .19, z + Math.sin(i * 1.8) * .23);
        }
    }

    tree(parent, x, y, z, palm = false, scale = 1) {
        const group = new THREE.Group(); group.position.set(x, y, z); group.scale.setScalar(scale); parent.add(group);
        this.cylinder(group, .13, .22, palm ? 4.1 : 2.3, 'wood', 0, palm ? 2.05 : 1.15, 0);
        if (palm) {
            for (let i = 0; i < 9; i++) {
                const leaf = this.mesh(group, this.palmFrond(), i % 3 ? 'leaf' : 'lime', 0, 4.1, 0);
                leaf.rotation.y = i / 9 * Math.PI * 2; leaf.rotation.x = (i % 3 - 1) * .13;
                leaf.scale.setScalar(.88 + i % 3 * .10);
            }
            for (let i = 0; i < 3; i++) this.orb(group, .21, .24, .21, 'wood', Math.sin(i * 2.1) * .25, 3.86, Math.cos(i * 2.1) * .25);
        } else {
            for (let i = 0; i < 6; i++) {
                const angle = i * 2.4;
                this.orb(group, .80, .92, .79, i % 3 ? 'leaf' : 'lime', Math.cos(angle) * .55, 2.9 + (i % 3) * .32, Math.sin(angle) * .55);
            }
        }
    }

    bench(parent, x, z, side) {
        for (const dz of [-.85, .85]) this.box(parent, .75, .55, .10, 'ink', x, .58, z + dz);
        for (let i = 0; i < 4; i++) this.box(parent, .15, .10, 2.4, 'cyan', x - .3 + i * .20, .86, z);
        for (let i = 0; i < 3; i++) this.box(parent, .10, .15, 2.4, 'cyan', x + side * .43, 1.08 + i * .20, z);
    }

    lamp(parent, x, z, side) {
        this.cylinder(parent, .09, .13, 4.0, 'ink', x, 2.2, z);
        this.cylinder(parent, .22, .30, .28, 'ink', x, .45, z);
        this.beam(parent, [x, 4.20, z], [x - side * .7, 4.48, z], .12, 'ink');
        this.box(parent, .52, .14, .46, 'ink', x - side * .7, 4.45, z);
        this.box(parent, .33, .32, .28, this.material('yellow', true), x - side * .7, 4.21, z);
    }

    balcony(parent, side, y, z, length, plants = true) {
        this.box(parent, 4.7, .42, length, 'cream', side * 9.4, y, z, true);
        this.box(parent, .17, .16, length, 'white', side * 7.10, y + 1.08, z);
        this.box(parent, .12, .14, length, 'yellow', side * 7.10, y + .32, z);
        for (let k = 0; k <= 5; k++) this.box(parent, .10, .87, .10, 'white', side * 7.10, y + .64, z - length / 2 + k * length / 5);
        const glass = this.panel(parent, length - .3, .65, 'glass', side * 7.16, y + .66, z, -side * Math.PI / 2, 'cyan');
        // Slim, opaque tinted balcony glass avoids sorting artifacts across chunks.
        if (plants) for (const dz of [-length * .35, 0, length * .33]) this.planter(parent, side * 7.65, y + .23, z + dz, .95, 1.8, 'cream', true);
    }

    escalator(parent, side, z) {
        const x = side * 7.85, low = .36, rise = 5.80, run = 8.0;
        for (let i = 0; i < 23; i++) {
            const treadY = low + (i + .5) / 23 * rise, treadZ = z - i / 23 * run;
            this.box(parent, 1.35, rise / 23 + .02, run / 23 + .03, 'ink', x, treadY, treadZ);
            this.box(parent, 1.31, .025, .055, 'rail', x, treadY + rise / 46 + .02, treadZ + run / 46);
        }
        for (const dx of [-.84, .84]) {
            this.beam(parent, [x + dx, low + .05, z + .3], [x + dx, low + rise + .05, z - run], .30, 'white');
            this.beam(parent, [x + dx, low + .65, z + .3], [x + dx, low + rise + .65, z - run], .26, 'cyan');
            this.beam(parent, [x + dx, low + 1.0, z + .3], [x + dx, low + rise + 1.0, z - run], .12, 'ink');
        }
    }

    shopSide(parent, side, variant, type) {
        const mall = type === 1;
        const primary = (variant + (side > 0 ? 1 : 0)) % 2 ? 'peach' : 'yellow';
        this.box(parent, 6.0, 6.6, 19.9, primary, side * 12.35, 3.3, 0, true);
        this.box(parent, .28, 6.5, .45, 'pink', side * 9.20, 3.3, -9.5);
        this.box(parent, .28, 6.5, .45, 'pink', side * 9.20, 3.3, 9.5);
        for (const z of [-5.0, 4.6]) {
            this.panel(parent, 6.9, 3.35, 'shop-glass', side * 9.31, 2.23, z, -side * Math.PI / 2, 'cream');
            for (const dz of [-2.15, 0, 2.15]) this.box(parent, .16, 3.4, .10, 'yellow', side * 9.13, 2.23, z + dz);
            this.box(parent, .70, .18, 7.3, 'cream', side * 9.12, .52, z);
            this.box(parent, 1.2, .16, 7.5, 'yellow', side * 8.86, 4.01, z);
        }
        // The shop lettering, framed advertisements and balcony greenery are the
        // reference's main near-field landmarks, rather than full-height murals.
        this.panel(parent, 10.5, 1.95, side < 0 ? 'jet-shop' : 'sunny-yard', side * 9.05, 5.20, -2.5, -side * Math.PI / 2, 'pink');
        this.panel(parent, 2.15, 3.05, side < 0 ? 'good-run' : 'play-more', side * 8.96, 2.42, -6.4, -side * Math.PI / 2, 'ink');
        this.balcony(parent, side, 6.62, 0, 19.9);
        if (type > 0 || (variant + (side < 0 ? 0 : 1)) % 2 === 1) {
            this.box(parent, 4.7, 5.9, 19.9, mall ? 'peach' : variant % 2 ? 'pink' : 'cream', side * 13.1, 9.7, 0, true);
            for (const z of [-6, 0, 6]) {
                this.panel(parent, 4.9, 3.5, 'glass', side * 10.70, 9.3, z, -side * Math.PI / 2, 'cream');
                this.box(parent, .13, 3.65, .10, 'white', side * 10.53, 9.3, z);
            }
            this.balcony(parent, side, 12.55, 0, 19.9, variant % 2 === 0);
        } else {
            this.tree(parent, side * 11.2, 6.85, -3.5, true, .95);
        }
        for (const z of [-6.5, 6.4]) {
            this.planter(parent, side * 6.30, .32, z, 1.5, 2.4, z < 0 ? 'cyan' : 'cream');
            if (z < 0) this.tree(parent, side * 6.35, 1.08, z, mall, mall ? .82 : .85);
        }
        this.bench(parent, side * 7.6, .5, side);
        if (variant % 2 === (side < 0 ? 0 : 1)) this.escalator(parent, side, -.5);
        if (mall) {
            this.tree(parent, side * 8.2, 6.85, -4, true, .85);
            for (const z of [-7, 1, 7]) this.box(parent, 1.2, .07, .6, this.material('yellow', true), side * 8.6, 6.36, z);
        }
    }

    baseChunk(variant) {
        const key = 'base:' + variant % 2;
        if (this.templates.has(key)) return this.templates.get(key).clone(true);
        const g = new THREE.Group(); g.name = 'MallCity.TrackAndGantry';
        for (let i = 0; i < 10; i++) for (const x of [-3.2, 0, 3.2]) {
            const z = -9 + i * 2;
            this.box(g, 2.38, .09, .43, 'wood', x, -.015, z, true);
            for (const side of [-1, 1]) {
                this.box(g, .37, .045, .35, 'yellow', x + side * .74, .055, z);
                this.box(g, .075, .06, .075, 'ink', x + side * 1.01, .075, z);
            }
        }
        // The low pavement leaves every lane and the original curb clear.
        for (const side of [-1, 1]) {
            this.box(g, 5.5, .28, 20, 'paving', side * 7.95, .14, 0, true);
            this.box(g, .35, .31, 20, 'yellow', side * 5.04, .155, 0);
            for (const z of [-6.65, 0, 6.65]) this.box(g, 5.4, .012, .035, 'white', side * 7.94, .287, z);
        }
        this.batch(g); this.templates.set(key, g); return g.clone(true);
    }

    gantry(variant) {
        const key = 'gantry:' + variant % 2;
        if (this.templates.has(key)) return this.templates.get(key).clone(true);
        const g = new THREE.Group(); g.name = 'MallCity.CyanPortal';
        for (const side of [-1, 1]) {
            this.box(g, .38, 9.0, .42, 'cyan', side * 6.1, 4.5, -7);
            this.box(g, .58, .25, .60, 'teal', side * 6.1, .40, -7);
            this.box(g, .07, .90, .07, 'ink', side * 4.8, 8.40, -7);
            this.panel(g, .98, 2.45, (variant + (side > 0 ? 1 : 0)) % 2 ? 'banner-bunny' : 'banner-smile', side * 4.8, 6.65, -6.94, 0, 'yellow');
        }
        this.box(g, 12.9, .45, .5, 'cyan', 0, 8.94, -7);
        for (const x of [-3.2, 0, 3.2]) {
            this.cylinder(g, .12, .15, .54, 'yellow', x, 8.51, -7);
            this.box(g, .12, .10, .38, 'ink', x, 8.23, -7);
        }
        this.batch(g); this.templates.set(key, g); return g.clone(true);
    }

    zone(type, variant) {
        variant %= 2;
        const key = 'zone:' + type + ':' + variant;
        if (this.templates.has(key)) return this.templates.get(key).clone(true);
        const g = new THREE.Group(); g.name = ['MallCity.Shops', 'MallCity.Galleria', 'MallCity.SkyGarden', 'MallCity.Waterfront'][type];
        for (const side of [-1, 1]) {
            if (type < 3) this.shopSide(g, side, variant, type);
            else {
                this.box(g, .22, .26, 20, 'cyan', side * 9.2, 1.55, 0);
                this.box(g, .18, .18, 20, 'yellow', side * 9.2, .65, 0);
                for (let z = -8; z <= 8; z += 4) this.box(g, .22, 1.4, .22, z % 8 === 0 ? 'pink' : 'yellow', side * 9.2, .92, z);
                this.planter(g, side * 7.7, .28, -6, 1.5, 2.3, 'cream');
                this.tree(g, side * 7.7, 1.02, -6, true);
                this.bench(g, side * 7.4, 2.5, side); this.lamp(g, side * 8.6, 6.5, side);
                this.box(g, 1.1, 1.2, 1.0, 'pink', side * 6.8, .88, 6.7);
                this.panel(g, .63, .80, 'banner-bunny', side * 6.8, 1.0, 7.22);
                this.box(g, 3.4, .26, 3.4, 'cyan', side * 7.7, 4.5, .3);
                this.box(g, 3.45, .18, 1.2, 'yellow', side * 7.7, 4.68, .3);
                for (const z of [-1.1, 1.7]) this.box(g, .12, 4.0, .12, 'teal', side * 8.8, 2.4, z);
            }
        }
        if (type === 1 || (type === 2 && variant === 0)) {
            // Walkway bridges and skylight ribs stay above train/runner clearance.
            this.box(g, 22, .52, 2.8, 'cream', 0, 11.75, -6);
            for (const z of [-7.35, -4.65]) {
                this.box(g, 22, .14, .14, 'yellow', 0, 12.94, z);
                for (let x = -10; x <= 10; x += 2) this.box(g, .12, 1.08, .12, 'white', x, 12.35, z);
            }
            this.panel(g, 2.6, .85, 'sky-mall', 0, 12.34, -4.55, 0, 'cyan');
        }
        if (type === 2) for (const side of [-1, 1]) {
            for (const z of [-4, 4]) this.tree(g, side * 8.3, 12.8, z, true, .9);
            this.planter(g, side * 8.0, 12.8, 0, 1.2, 4.0, 'mint', true);
        }
        if (type === 1 && variant === 1) {
            let previous = null;
            for (let i = 0; i <= 14; i++) {
                const t = i / 14, point = [-10.8 + 21.6 * t, 13.0 + Math.sin(Math.PI * t) * 5.1, 1.2];
                if (previous) this.beam(g, previous, point, .24, 'cyan');
                previous = point;
            }
            for (const x of [-8.5, 8.5]) this.box(g, .22, .22, 20, 'pink', x, 16.0, 0);
        }
        this.batch(g); this.templates.set(key, g); return g.clone(true);
    }

    roofMascot() {
        const key = 'roof-mascot';
        if (this.templates.has(key)) return this.templates.get(key).clone(true);
        const g = new THREE.Group(); g.name = 'MallCity.RooftopBunny';
        this.orb(g, 1.35, 1.6, 1.05, 'white', 0, 8.35, 0);
        this.orb(g, 1.85, 1.60, 1.35, 'white', 0, 10.65, 0);
        for (const s of [-1, 1]) {
            this.orb(g, .58, 1.50, .48, 'white', s * .68, 12.9, 0).rotation.z = -s * .14;
            this.orb(g, .28, 1.05, .11, 'rose', s * .68, 13.0, .43).rotation.z = -s * .14;
            this.orb(g, .18, .25, .10, 'ink', s * .55, 10.8, 1.28);
            this.orb(g, .30, .17, .10, 'pink', s * .99, 10.35, 1.16);
            this.orb(g, .60, .37, .70, 'white', s * .75, 7.05, .42);
        }
        this.orb(g, .16, .12, .11, 'pink', 0, 10.4, 1.38);
        this.orb(g, 1.38, .24, 1.09, 'yellow', 0, 9.2, .04);
        g.children.forEach(part => part.position.y += 1.6);
        this.box(g, 3.4, 1.4, 2.7, 'yellow', 0, 7.55, 0);
        this.box(g, 4.4, .35, 3.0, 'cream', 0, 6.75, 0);
        this.batch(g); g.position.x = 7.7; this.templates.set(key, g); return g.clone(true);
    }

    buildWorld() {
        const e = this.engine, ground = new THREE.Group(); ground.name = 'MallCity.RailCorridor';
        this.box(ground, 10.0, .10, 360, 0xd6cbd0, 0, -.10, -135, true);
        for (const x of e.trackCenters) {
            this.box(ground, 2.62, .035, 360, 0xb8abb5, x, -.05, -135, true);
            for (const side of [-1, 1]) {
                this.box(ground, .22, .075, 360, 'ink', x + side * .74, .055, -135);
                this.box(ground, .105, .10, 360, 'rail', x + side * .74, .12, -135);
            }
            this.box(ground, .038, .038, 360, 'ink', x, 8.23, -135);
        }
        this.batch(ground); e.scene.add(ground);
        // A shader sky retains the reference's clean blue instead of applying
        // the game's ACES transform a second time to a background bitmap.
        e.scene.background = new THREE.Color(0x89ddff);
        const sky = new THREE.Mesh(new THREE.SphereGeometry(325, 24, 16), new THREE.ShaderMaterial({
            side: THREE.BackSide, depthWrite: false, toneMapped: false,
            uniforms: { topColor: { value: new THREE.Color(0x22adfa) }, horizonColor: { value: new THREE.Color(0xc9f0ff) } },
            vertexShader: 'varying vec3 vSky; void main(){vSky=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
            fragmentShader: 'varying vec3 vSky; uniform vec3 topColor; uniform vec3 horizonColor; void main(){float h=smoothstep(-.06,.48,normalize(vSky).y);gl_FragColor=vec4(mix(horizonColor,topColor,h),1.);}'
        }));
        sky.name = 'MallCity.BlueSky'; sky.renderOrder = -100; sky.frustumCulled = false; e.scene.add(sky);
        e.scene.fog = new THREE.Fog(0xc4eafb, 80, 300);
        // A low, distant waterfront visible in the open-air sections.
        const water = new THREE.Group(); water.name = 'MallCity.Water';
        this.box(water, 230, .1, 330, 0x39c5e7, 0, -2.5, -150);
        for (let i = 0; i < 36; i++) {
            const side = i % 2 ? -1 : 1;
            this.box(water, 4 + i % 4 * 2, .012, .15, 0x95ebef, side * (14 + i % 9 * 9), -2.43, -8 - i * 8.5);
        }
        this.batch(water); e.scene.add(water);
        for (let i = 0; i < 12; i++) {
            const group = new THREE.Group(); group.name = 'MallCity.Cloud';
            for (let j = 0; j < 5; j++) this.orb(group, 2.2 + j % 2, 1.1 + j % 3 * .4, 1.5, 'white', j * 2.2 - 4, Math.sin(j * 2) * .55, j % 2);
            this.batch(group); group.position.set((i % 2 ? -1 : 1) * (11 + i % 4 * 12), 24 + i % 3 * 8, -30 - i * 24);
            e.scene.add(group); e.clouds.push({ group, speed: .55 + i % 3 * .15 });
        }
    }

    tower(index, distant = false) {
        const g = new THREE.Group(), side = index % 2 ? 1 : -1;
        const width = distant ? 10 + index % 3 * 3 : 6.5 + index % 3;
        const height = distant ? 26 + index * 7 % 25 : 15 + index * 7 % 13;
        const depth = distant ? 11 : 9.3;
        const color = ['pink', 'peach', 'blue', 'lavender'][index % 4];
        this.box(g, width, height, depth, color, 0, height / 2, 0);
        this.box(g, width + .3, .35, depth + .3, 'cream', 0, height, 0);
        const floorGap = distant ? 4.5 : 3.3;
        for (let y = 3; y < height - 1; y += floorGap) {
            this.panel(g, depth - .7, floorGap - .55, 'glass', -side * (width / 2 + .02), y, 0, -side * Math.PI / 2, 'cream');
            this.panel(g, width - .65, floorGap - .55, 'glass', 0, y, depth / 2 + .02, 0, 'cream');
        }
        for (let z = -depth / 2 + 2; z < depth / 2; z += 2.8) this.box(g, .08, height, .09, 'cream', -side * (width / 2 + .15), height / 2, z);
        for (let x = -width / 2 + 2; x < width / 2; x += 2.6) this.box(g, .08, height, .10, 'cream', x, height / 2, depth / 2 + .15);
        if (!distant && index % 7 === 3) {
            this.orb(g, 1.8, 1.55, 1.4, 'white', 0, height + 2.0, 0);
            for (const s of [-1, 1]) {
                const ear = this.orb(g, .46, 1.45, .45, 'white', s * .65, height + 3.8, 0); ear.rotation.z = -s * .16;
                const inner = this.orb(g, .22, 1.0, .13, 'rose', s * .65, height + 3.9, .4); inner.rotation.z = -s * .16;
                this.orb(g, .18, .24, .12, 'ink', s * .53, height + 2.15, 1.33);
                this.orb(g, .29, .15, .10, 'pink', s * .94, height + 1.81, 1.16);
            }
        }
        this.box(g, width + 1.1, 3.0, depth + 1.1, 'cream', 0, -1.5, 0);
        this.box(g, width + 1.5, .20, depth + 1.5, 'mint', 0, .05, 0);
        this.batch(g); return g;
    }

    ferrisWheel() {
        const g = new THREE.Group(); g.name = 'MallCity.FerrisWheel';
        for (const side of [-1, 1]) this.beam(g, [side * 4.3, 0, 0], [0, 12, 0], .45, 'cream');
        const ringGeo = this.geometry('ferris-rim', () => new THREE.TorusGeometry(8.8, .18, 6, 56));
        this.mesh(g, ringGeo, 'pink', 0, 12, 0);
        for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2, x = Math.cos(a) * 8.8, y = 12 + Math.sin(a) * 8.8;
            this.beam(g, [0, 12, 0], [x, y, 0], .09, 'white');
            this.box(g, 1.3, 1.1, 1.1, i % 2 ? 'cyan' : 'pink', x, y - .65, 0);
            this.box(g, 1.0, .64, .03, 'cream', x, y - .4, .58);
        }
        this.orb(g, .70, .70, .35, 'yellow', 0, 12, .2);
        this.box(g, 12, 4.0, 4.5, 'cream', 0, -2.0, 0);
        this.box(g, 12.3, .16, 4.8, 'mint', 0, .03, 0);
        this.batch(g); g.position.set(22, 1.5, -85); return g;
    }

    buildCrossingDecks() {
        for (const train of this.engine.viaductTrains) {
            const deck = new THREE.Group(); deck.name = 'MallCity.ElevatedRailDeck';
            this.box(deck, 260, .38, 3.0, 'cream', 0, 12.58, 0, true);
            for (const z of [-1.5, 1.5]) this.box(deck, 260, .22, .18, 'cyan', 0, 12.69, z);
            for (const z of [-.57, .57]) this.box(deck, 260, .07, .10, 'rail', 0, 12.81, z);
            for (const x of [-17, 17]) this.box(deck, 1.0, 12.4, 2.5, 'cream', x, 6.2, 0);
            this.batch(deck); deck.position.z = train.z; this.engine.scene.add(deck); train.environmentDeck = deck;
        }
    }
}

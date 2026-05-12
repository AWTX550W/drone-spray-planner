/**
 * visualizer.js - Three.js 3D 场景（v2.1 视觉增强版）
 * 地形起伏、农田纹理、环境装饰、云朵太阳、雾效
 */
const Visualizer = (function () {
    'use strict';

    let scene, camera, renderer, controls;
    let clock;
    let dynamicObjects = []; // 需要清理的动态对象
    let environmentObjects = []; // 环境装饰对象

    // 无人机相关
    let droneGroup = null;
    let currentPath = [];
    let pathSegments = [];  // 预计算的路径段
    let totalPathLen = 0;
    let animating = false;
    let animProgress = 0;
    let animSpeed = 1;

    // HUD 元素
    let hudEl = null;

    // 地面相关
    let groundMesh = null;
    let groundSize = 400;
    let groundSegments = 80;

    // ── 简易噪声函数（用于地形生成）──
    function simpleNoise(x, y) {
        const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return n - Math.floor(n);
    }

    function smoothNoise(x, y) {
        const ix = Math.floor(x), iy = Math.floor(y);
        const fx = x - ix, fy = y - iy;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const n00 = simpleNoise(ix, iy);
        const n10 = simpleNoise(ix + 1, iy);
        const n01 = simpleNoise(ix, iy + 1);
        const n11 = simpleNoise(ix + 1, iy + 1);
        return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
    }

    function fbmNoise(x, y, octaves) {
        let val = 0, amp = 1, freq = 1, max = 0;
        for (let i = 0; i < octaves; i++) {
            val += smoothNoise(x * freq, y * freq) * amp;
            max += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return val / max;
    }

    // 获取地面某点的高度（用于对齐物体到地面）
    function getGroundHeight(x, z) {
        if (!groundMesh) return 0;
        const geom = groundMesh.geometry;
        const pos = geom.attributes.position;
        const halfSize = groundSize / 2;
        const segSize = groundSize / groundSegments;
        const gx = (x + halfSize) / segSize;
        const gz = (z + halfSize) / segSize;
        const ix = Math.round(gx);
        const iz = Math.round(gz);
        const idx = iz * (groundSegments + 1) + ix;
        if (idx >= 0 && idx < pos.count) {
            return pos.getZ(idx);
        }
        return 0;
    }

    // ── 云朵生成 ──
    function createClouds() {
        const cloudMat = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.85,
        });

        const cloudConfigs = [
            { x: -80, y: 90, z: -100, scale: 1.2 },
            { x: 60, y: 100, z: -120, scale: 1.5 },
            { x: -30, y: 85, z: -60, scale: 0.8 },
            { x: 120, y: 95, z: -50, scale: 1.0 },
            { x: -120, y: 105, z: -80, scale: 1.3 },
            { x: 30, y: 110, z: -150, scale: 1.1 },
            { x: -60, y: 88, z: 80, scale: 0.9 },
            { x: 90, y: 92, z: 60, scale: 1.0 },
            { x: 0, y: 115, z: -180, scale: 1.4 },
            { x: -150, y: 98, z: 30, scale: 0.7 },
            { x: 150, y: 108, z: -110, scale: 1.2 },
            { x: -100, y: 82, z: 120, scale: 0.6 },
        ];

        for (const cfg of cloudConfigs) {
            const cloud = new THREE.Group();
            const blobCount = 3 + Math.floor(simpleNoise(cfg.x, cfg.z) * 4);
            for (let j = 0; j < blobCount; j++) {
                const blobGeom = new THREE.SphereGeometry(
                    4 + simpleNoise(j * 3.7, cfg.x) * 6, 8, 6
                );
                const blob = new THREE.Mesh(blobGeom, cloudMat);
                blob.position.set(
                    (simpleNoise(j * 2.1, cfg.y) - 0.5) * 12,
                    (simpleNoise(j * 1.3, cfg.z) - 0.5) * 2,
                    (simpleNoise(j * 4.7, cfg.x) - 0.5) * 6
                );
                blob.scale.y = 0.4 + simpleNoise(j, cfg.z) * 0.3;
                cloud.add(blob);
            }
            cloud.position.set(cfg.x, cfg.y, cfg.z);
            cloud.scale.setScalar(cfg.scale);
            scene.add(cloud);
            environmentObjects.push(cloud);
        }
    }

    // ── 云朵缓慢飘动 ──
    function updateClouds(delta) {
        for (const obj of environmentObjects) {
            if (obj.children && obj.children.length > 1) {
                const firstChild = obj.children[0];
                if (firstChild && firstChild.geometry &&
                    firstChild.geometry.type === 'SphereGeometry' &&
                    firstChild.scale.y < 0.8) {
                    obj.position.x += delta * (0.3 + simpleNoise(obj.position.x, obj.position.z) * 0.5);
                    if (obj.position.x > 200) obj.position.x = -200;
                }
            }
        }
    }

    // 创建一棵低面数树
    function createTree() {
        const tree = new THREE.Group();
        const treeType = simpleNoise(Math.random() * 100, Math.random() * 100);

        const trunkH = 1.5 + treeType * 1.5;
        const trunkGeom = new THREE.CylinderGeometry(0.15, 0.25, trunkH, 5);
        const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5c3a1e });
        const trunk = new THREE.Mesh(trunkGeom, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        tree.add(trunk);

        if (treeType < 0.5) {
            const crownGeom = new THREE.SphereGeometry(1.2 + treeType * 1.0, 6, 5);
            const greenVar = 0.15 + treeType * 0.1;
            const crownMat = new THREE.MeshLambertMaterial({
                color: new THREE.Color(0.1 + greenVar * 0.3, 0.35 + greenVar, 0.08 + greenVar * 0.1),
            });
            const crown = new THREE.Mesh(crownGeom, crownMat);
            crown.position.y = trunkH + 0.6;
            crown.scale.y = 0.8;
            crown.castShadow = true;
            tree.add(crown);
        } else {
            const coneH = 2.5 + treeType * 1.5;
            const coneGeom = new THREE.ConeGeometry(1.0 + treeType * 0.5, coneH, 6);
            const coneMat = new THREE.MeshLambertMaterial({
                color: new THREE.Color(0.05, 0.25 + treeType * 0.15, 0.05),
            });
            const cone = new THREE.Mesh(coneGeom, coneMat);
            cone.position.y = trunkH + coneH / 2 - 0.3;
            cone.castShadow = true;
            tree.add(cone);
        }

        const s = 0.8 + treeType * 0.6;
        tree.scale.setScalar(s);
        return tree;
    }

    // 创建电线杆
    function createPowerPole() {
        const pole = new THREE.Group();
        const poleMat = new THREE.MeshLambertMaterial({ color: 0x6b5b4f });

        const mainGeom = new THREE.CylinderGeometry(0.12, 0.18, 9, 6);
        const main = new THREE.Mesh(mainGeom, poleMat);
        main.position.y = 4.5;
        main.castShadow = true;
        pole.add(main);

        const armGeom = new THREE.BoxGeometry(3, 0.1, 0.1);
        const arm1 = new THREE.Mesh(armGeom, poleMat);
        arm1.position.y = 8.5;
        pole.add(arm1);
        const arm2 = new THREE.Mesh(armGeom, poleMat);
        arm2.position.y = 7.5;
        pole.add(arm2);

        const insMat = new THREE.MeshLambertMaterial({ color: 0x8faaaa });
        for (const y of [7.5, 8.5]) {
            for (const xOff of [-1.3, 0, 1.3]) {
                const insGeom = new THREE.CylinderGeometry(0.04, 0.06, 0.3, 4);
                const ins = new THREE.Mesh(insGeom, insMat);
                ins.position.set(xOff, y + 0.2, 0);
                pole.add(ins);
            }
        }

        return pole;
    }

    // 添加电线（悬链线）
    function addPowerLine(p1, p2, height) {
        const x1 = p1.x, z1 = -p1.z, x2 = p2.x, z2 = -p2.z;
        const h1 = getGroundHeight(p1.x, -p1.z) + height;
        const h2 = getGroundHeight(p2.x, -p2.z) + height;
        const segments = 12;
        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const x = x1 + t * (x2 - x1);
            const z = z1 + t * (z2 - z1);
            const baseY = h1 + t * (h2 - h1);
            const sag = Math.sin(t * Math.PI) * 1.5;
            points.push(new THREE.Vector3(x, baseY - sag, z));
        }
        const lineGeom = new THREE.BufferGeometry().setFromPoints(points);
        const lineMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6 });
        const line = new THREE.Line(lineGeom, lineMat);
        scene.add(line);
        environmentObjects.push(line);
    }

    // 创建小房子
    function createHouse() {
        const house = new THREE.Group();

        const wallGeom = new THREE.BoxGeometry(4, 2.5, 3.5);
        const wallMat = new THREE.MeshLambertMaterial({ color: 0xd4c4a8 });
        const wall = new THREE.Mesh(wallGeom, wallMat);
        wall.position.y = 1.25;
        wall.castShadow = true;
        wall.receiveShadow = true;
        house.add(wall);

        const roofGeom = new THREE.ConeGeometry(3.2, 1.8, 4);
        const roofMat = new THREE.MeshLambertMaterial({ color: 0x8b4513 });
        const roof = new THREE.Mesh(roofGeom, roofMat);
        roof.position.y = 3.4;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        house.add(roof);

        const doorGeom = new THREE.BoxGeometry(0.7, 1.5, 0.05);
        const doorMat = new THREE.MeshLambertMaterial({ color: 0x4a3728 });
        const door = new THREE.Mesh(doorGeom, doorMat);
        door.position.set(0, 0.75, 1.78);
        house.add(door);

        const winMat = new THREE.MeshLambertMaterial({ color: 0x88ccff, emissive: 0x223344 });
        for (const xOff of [-1.1, 1.1]) {
            const winGeom = new THREE.BoxGeometry(0.5, 0.5, 0.05);
            const win = new THREE.Mesh(winGeom, winMat);
            win.position.set(xOff, 1.6, 1.78);
            house.add(win);
        }

        const chimGeom = new THREE.BoxGeometry(0.4, 1.2, 0.4);
        const chimMat = new THREE.MeshLambertMaterial({ color: 0x8b6b4a });
        const chimney = new THREE.Mesh(chimGeom, chimMat);
        chimney.position.set(1, 3.8, -0.5);
        chimney.castShadow = true;
        house.add(chimney);

        return house;
    }

    // ── 环境装饰 ──
    function createEnvironment() {
        // ── 树木 ──
        const treePositions = [];
        const treeSeeds = [
            { x: -55, z: -55 }, { x: 65, z: -45 }, { x: -45, z: 50 },
            { x: 70, z: 60 }, { x: -70, z: -20 }, { x: 55, z: -70 },
            { x: -60, z: 70 }, { x: 80, z: -10 }, { x: -80, z: -65 },
            { x: 45, z: 75 }, { x: -75, z: 40 }, { x: 85, z: 45 },
            { x: -50, z: -80 }, { x: 95, z: -60 }, { x: -90, z: 55 },
            { x: 30, z: -85 }, { x: -30, z: 85 },
            { x: 110, z: 20 }, { x: -120, z: -40 }, { x: 100, z: -90 },
            { x: -100, z: 100 }, { x: 130, z: -30 }, { x: -130, z: 80 },
        ];

        for (const seed of treeSeeds) {
            const count = 1 + Math.floor(simpleNoise(seed.x * 0.1, seed.z * 0.1) * 3);
            for (let i = 0; i < count; i++) {
                const tx = seed.x + (simpleNoise(seed.x + i, seed.z) - 0.5) * 15;
                const tz = seed.z + (simpleNoise(seed.x, seed.z + i) - 0.5) * 15;
                const dist = Math.sqrt(tx * tx + tz * tz);
                if (dist < 45) continue;
                treePositions.push({ x: tx, z: tz });
            }
        }

        for (const tp of treePositions) {
            const tree = createTree();
            const gh = getGroundHeight(tp.x, -tp.z);
            tree.position.set(tp.x, gh, -tp.z);
            scene.add(tree);
            environmentObjects.push(tree);
        }

        // ── 电线杆 ──
        const polePositions = [
            { x: -40, z: -55 }, { x: -20, z: -55 }, { x: 0, z: -55 }, { x: 20, z: -55 }, { x: 40, z: -55 },
            { x: -55, z: 55 }, { x: -35, z: 55 }, { x: -15, z: 55 }, { x: 5, z: 55 }, { x: 25, z: 55 }, { x: 45, z: 55 },
        ];

        for (let i = 0; i < polePositions.length; i++) {
            const pp = polePositions[i];
            const pole = createPowerPole();
            const gh = getGroundHeight(pp.x, -pp.z);
            pole.position.set(pp.x, gh, -pp.z);
            scene.add(pole);
            environmentObjects.push(pole);
        }

        // 第一排电线
        for (let i = 0; i < 4; i++) {
            const p1 = polePositions[i], p2 = polePositions[i + 1];
            addPowerLine(p1, p2, 8.5);
            addPowerLine(p1, p2, 7.5);
        }
        // 第二排电线
        for (let i = 5; i < 10; i++) {
            const p1 = polePositions[i], p2 = polePositions[i + 1];
            addPowerLine(p1, p2, 8.5);
            addPowerLine(p1, p2, 7.5);
        }

        // ── 小房子 ──
        const housePositions = [
            { x: 90, z: -80 }, { x: -95, z: 70 }, { x: 80, z: 85 },
        ];

        for (const hp of housePositions) {
            const house = createHouse();
            const gh = getGroundHeight(hp.x, -hp.z);
            house.position.set(hp.x, gh, -hp.z);
            house.rotation.y = simpleNoise(hp.x * 0.1, hp.z * 0.1) * Math.PI;
            scene.add(house);
            environmentObjects.push(house);
        }
    }

    // ──────────────────────────────────────────────────────────
    // init() — 入口，调用上面定义的所有模块级函数
    // ──────────────────────────────────────────────────────────
    function init() {
        const container = document.getElementById('three-container');
        clock = new THREE.Clock();

        // 场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x88bbdd);
        scene.fog = new THREE.FogExp2(0x9cc8e8, 0.0025);

        // 相机
        camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
        camera.position.set(40, 50, 60);

        // 渲染器
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        if (THREE.ACESFilmicToneMapping !== undefined) {
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.2;
        }
        container.appendChild(renderer.domElement);

        // 控制器
        if (typeof THREE.OrbitControls === 'undefined') {
            console.error('OrbitControls 未加载，请检查 js/OrbitControls.js');
            container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#e55;font-size:16px;">OrbitControls 加载失败，请刷新页面重试</div>';
            return;
        }
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI / 2.05;
        controls.minDistance = 5;
        controls.maxDistance = 300;

        // ── 灯光 ──
        const ambientLight = new THREE.AmbientLight(0x8899bb, 0.5);
        scene.add(ambientLight);

        const sunLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
        sunLight.position.set(40, 80, 30);
        sunLight.castShadow = true;
        sunLight.shadow.camera.near = 1;
        sunLight.shadow.camera.far = 250;
        sunLight.shadow.camera.left = -80;
        sunLight.shadow.camera.right = 80;
        sunLight.shadow.camera.top = 80;
        sunLight.shadow.camera.bottom = -80;
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        sunLight.shadow.bias = -0.0001;
        scene.add(sunLight);

        const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x3a5f0b, 0.4);
        scene.add(hemiLight);

        // ── 地面（带地形起伏 + 农田纹理色彩）──
        groundSegments = 80;
        const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments);
        const posAttr = groundGeom.attributes.position;
        const colors = new Float32Array(posAttr.count * 3);

        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const dist = Math.sqrt(x * x + y * y);

            let h = 0;
            h += (fbmNoise(x * 0.02 + 3.7, y * 0.02 + 1.2, 4) - 0.5) * 3.0;
            const ridge = Math.sin(y * 1.5) * 0.15;
            h += ridge * Math.max(0, 1 - dist / 100);
            if (dist > 120) {
                const edgeFade = Math.min(1, (dist - 120) / 80);
                h *= (1 - edgeFade);
            }

            posAttr.setZ(i, h);

            const cropNoise = fbmNoise(x * 0.008 + 10, y * 0.008 + 20, 3);
            const detailNoise = simpleNoise(x * 0.05, y * 0.05);
            let r, g, b;

            if (dist < 60) {
                if (cropNoise < 0.35) {
                    r = 0.18 + detailNoise * 0.05;
                    g = 0.42 + detailNoise * 0.08;
                    b = 0.15 + detailNoise * 0.03;
                } else if (cropNoise < 0.55) {
                    r = 0.30 + detailNoise * 0.06;
                    g = 0.52 + detailNoise * 0.06;
                    b = 0.18 + detailNoise * 0.04;
                } else if (cropNoise < 0.72) {
                    r = 0.58 + detailNoise * 0.08;
                    g = 0.55 + detailNoise * 0.06;
                    b = 0.20 + detailNoise * 0.04;
                } else {
                    r = 0.35 + detailNoise * 0.05;
                    g = 0.50 + detailNoise * 0.07;
                    b = 0.25 + detailNoise * 0.04;
                }
            } else if (dist < 120) {
                const t = (dist - 60) / 60;
                const grassNoise = fbmNoise(x * 0.015, y * 0.015, 2);
                r = 0.22 + grassNoise * 0.1 + t * 0.1;
                g = 0.40 + grassNoise * 0.1 - t * 0.05;
                b = 0.18 + grassNoise * 0.05 + t * 0.05;
            } else {
                const t = Math.min(1, (dist - 120) / 80);
                r = 0.35 + t * 0.15;
                g = 0.38 + t * 0.05;
                b = 0.22 + t * 0.08;
            }

            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        groundGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        groundGeom.computeVertexNormals();

        const groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
        groundMesh = new THREE.Mesh(groundGeom, groundMat);
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // 细网格（淡化）
        const grid = new THREE.GridHelper(groundSize, 80, 0x3a6a2f, 0x3a6a2f);
        grid.position.y = 0.02;
        grid.material.opacity = 0.08;
        grid.material.transparent = true;
        scene.add(grid);

        // ── 天空球（渐变大气） ──
        const skyGeom = new THREE.SphereGeometry(380, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x2255aa) },
                horizonColor: { value: new THREE.Color(0x88bbdd) },
                bottomColor: { value: new THREE.Color(0xddeeff) },
                offset: { value: 20 },
                exponent: { value: 0.5 },
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 horizonColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    vec3 col;
                    if (h > 0.0) {
                        col = mix(horizonColor, topColor, pow(h, exponent));
                    } else {
                        col = mix(horizonColor, bottomColor, pow(-h, 0.8));
                    }
                    gl_FragColor = vec4(col, 1.0);
                }
            `,
            side: THREE.BackSide,
        });
        const sky = new THREE.Mesh(skyGeom, skyMat);
        scene.add(sky);

        // ── 太阳 ──
        const sunGroup = new THREE.Group();
        const sunGeom = new THREE.SphereGeometry(5, 16, 16);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee88 });
        const sunSphere = new THREE.Mesh(sunGeom, sunMat);
        sunSphere.position.set(100, 120, -80);
        sunGroup.add(sunSphere);

        const glowGeom = new THREE.SphereGeometry(12, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0xffdd66, transparent: true, opacity: 0.15 });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        glow.position.copy(sunSphere.position);
        sunGroup.add(glow);

        const outerGlowGeom = new THREE.SphereGeometry(25, 16, 16);
        const outerGlowMat = new THREE.MeshBasicMaterial({ color: 0xffcc44, transparent: true, opacity: 0.06 });
        const outerGlow = new THREE.Mesh(outerGlowGeom, outerGlowMat);
        outerGlow.position.copy(sunSphere.position);
        sunGroup.add(outerGlow);
        scene.add(sunGroup);

        // ── 云朵 ──
        createClouds();

        // ── 无人机 ──
        droneGroup = DroneModel.create();
        droneGroup.visible = false;
        scene.add(droneGroup);

        // ── 创建环境装饰 ──
        createEnvironment();

        // ── HUD ──
        hudEl = document.createElement('div');
        hudEl.className = 'flight-hud hidden';
        hudEl.innerHTML = `
            <div class="hud-row"><span>高度</span><span class="hud-val" id="hud-alt">--</span></div>
            <div class="hud-row"><span>速度</span><span class="hud-val" id="hud-spd">--</span></div>
            <div class="hud-row"><span>进度</span><span class="hud-val" id="hud-prog">0%</span></div>
            <div class="hud-row"><span>航点</span><span class="hud-val" id="hud-wp">--</span></div>
        `;
        container.appendChild(hudEl);

        // 窗口适配
        onResize();
        window.addEventListener('resize', onResize);

        animate();
    }

    function onResize() {
        const container = document.getElementById('three-container');
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    // ─── 动画循环 ────────────────────────────────────────
    function animate() {
        requestAnimationFrame(animate);
        const delta = Math.min(clock.getDelta(), 0.05);
        controls.update();

        if (animating && currentPath.length > 1) {
            updateFlightAnimation(delta);
        }

        DroneModel.update(clock.getElapsedTime(), delta);
        updateClouds(delta);
        renderer.render(scene, camera);
    }

    // ─── 飞行动画 ────────────────────────────────────────
    function precomputePath() {
        pathSegments = [];
        totalPathLen = 0;
        for (let i = 1; i < currentPath.length; i++) {
            const dx = currentPath[i].x - currentPath[i - 1].x;
            const dy = currentPath[i].y - currentPath[i - 1].y;
            const len = Math.sqrt(dx * dx + dy * dy);
            pathSegments.push({ startIdx: i - 1, len });
            totalPathLen += len;
        }
    }

    function updateFlightAnimation(delta) {
        const height = parseFloat(document.getElementById('flight-height').value) || 3;
        const speed = parseFloat(document.getElementById('flight-speed').value) || 5;
        const movePerSec = speed * animSpeed;

        animProgress += (movePerSec * delta) / totalPathLen;

        if (animProgress >= 1) {
            animProgress = 0;
            DroneModel.clearTrail();
        }

        const targetDist = animProgress * totalPathLen;
        let accDist = 0;
        let currentSegIdx = 0;

        for (let i = 0; i < pathSegments.length; i++) {
            if (accDist + pathSegments[i].len >= targetDist) {
                currentSegIdx = i;
                break;
            }
            accDist += pathSegments[i].len;
            if (i === pathSegments.length - 1) currentSegIdx = i;
        }

        const seg = pathSegments[currentSegIdx];
        if (!seg) return;

        const segStartDist = pathSegments.slice(0, currentSegIdx).reduce((s, seg) => s + seg.len, 0);
        const t = Math.max(0, Math.min(1, (targetDist - segStartDist) / Math.max(seg.len, 0.01)));

        const prev = currentPath[seg.startIdx];
        const next = currentPath[seg.startIdx + 1];
        const x = prev.x + t * (next.x - prev.x);
        const y = prev.y + t * (next.y - prev.y);

        droneGroup.position.set(x, height, -y);

        const heading = Math.atan2(next.y - prev.y, next.x - prev.x);
        DroneModel.setHeading(heading);

        const isTurning = t < 0.05 || t > 0.95;
        DroneModel.setSpraying(!isTurning);

        DroneModel.addTrailPoint(droneGroup.position);

        if (hudEl) {
            hudEl.classList.remove('hidden');
            document.getElementById('hud-alt').textContent = height.toFixed(1) + ' m';
            document.getElementById('hud-spd').textContent = speed.toFixed(1) + ' m/s';
            document.getElementById('hud-prog').textContent = (animProgress * 100).toFixed(0) + '%';
            document.getElementById('hud-wp').textContent = (seg.startIdx + 1) + '/' + currentPath.length;
        }

        document.getElementById('stat-progress').textContent = (animProgress * 100).toFixed(0) + '%';
    }

    function startAnimation() {
        if (currentPath.length < 2) return;
        animating = true;
        animProgress = 0;
        droneGroup.visible = true;
        DroneModel.clearTrail();
        DroneModel.setSpraying(false);

        animSpeed = parseFloat(document.getElementById('anim-speed').value) || 1;
        precomputePath();

        const height = parseFloat(document.getElementById('flight-height').value) || 3;
        droneGroup.position.set(currentPath[0].x, height, -currentPath[0].y);

        if (currentPath.length > 1) {
            const heading = Math.atan2(
                currentPath[1].y - currentPath[0].y,
                currentPath[1].x - currentPath[0].x
            );
            DroneModel.setHeading(heading);
        }
    }

    function stopAnimation() {
        animating = false;
        DroneModel.setSpraying(false);
        if (hudEl) hudEl.classList.add('hidden');
    }

    function setAnimSpeed(v) { animSpeed = v; }

    function setPath(path) {
        currentPath = path;
        precomputePath();
    }

    // ─── 更新农田 ────────────────────────────────────────
    function updateFarmBoundary(polygon) {
        if (!polygon || polygon.length < 3) return;

        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x, -polygon[0].y);
        for (let i = 1; i < polygon.length; i++) {
            shape.lineTo(polygon[i].x, -polygon[i].y);
        }
        shape.closePath();

        const farmGeom = new THREE.ShapeGeometry(shape);
        const farmMat = new THREE.MeshLambertMaterial({
            color: 0x5a8f3a,
            transparent: true,
            opacity: 0.7,
        });
        const farmMesh = new THREE.Mesh(farmGeom, farmMat);
        farmMesh.rotation.x = -Math.PI / 2;
        farmMesh.position.y = 0.03;
        farmMesh.receiveShadow = true;
        scene.add(farmMesh);
        dynamicObjects.push(farmMesh);

        // 边界围栏
        const borderPts = [];
        for (const p of polygon) {
            borderPts.push(new THREE.Vector3(p.x, 0, -p.y));
        }
        borderPts.push(new THREE.Vector3(polygon[0].x, 0, -polygon[0].y));

        const borderCurve = new THREE.CatmullRomCurve3(borderPts, true);
        const borderGeom = new THREE.TubeGeometry(borderCurve, 64, 0.15, 6, true);
        const borderMat = new THREE.MeshPhongMaterial({ color: 0xffa726 });
        const border = new THREE.Mesh(borderGeom, borderMat);
        border.position.y = 0.1;
        scene.add(border);
        dynamicObjects.push(border);

        // 角点标记
        for (const p of polygon) {
            const markerGeom = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 6);
            const markerMat = new THREE.MeshPhongMaterial({ color: 0xff7043 });
            const marker = new THREE.Mesh(markerGeom, markerMat);
            marker.position.set(p.x, 0.4, -p.y);
            marker.castShadow = true;
            scene.add(marker);
            dynamicObjects.push(marker);
        }
    }

    // ─── 更新路径线 ────────────────────────────────────────
    function updatePath(path, height) {
        if (!path || path.length < 2) return;
        const h = height || 3;

        const pts = path.map(p => new THREE.Vector3(p.x, h, -p.y));
        const curve = new THREE.CatmullRomCurve3(pts, false);
        const tubeGeom = new THREE.TubeGeometry(curve, path.length * 2, 0.08, 4, false);
        const tubeMat = new THREE.MeshPhongMaterial({
            color: 0xff1744,
            emissive: 0x440000,
            transparent: true,
            opacity: 0.8,
        });
        const tube = new THREE.Mesh(tubeGeom, tubeMat);
        scene.add(tube);
        dynamicObjects.push(tube);

        const shadowPts = path.map(p => new THREE.Vector3(p.x, 0.05, -p.y));
        const shadowGeom = new THREE.BufferGeometry().setFromPoints(shadowPts);
        const shadowMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });
        const shadowLine = new THREE.Line(shadowGeom, shadowMat);
        scene.add(shadowLine);
        dynamicObjects.push(shadowLine);

        const arrowMat = new THREE.MeshPhongMaterial({ color: 0xff5252, emissive: 0x330000 });
        const arrowGeom = new THREE.ConeGeometry(0.25, 0.6, 4);
        let accDist = 0;

        for (let i = 1; i < path.length; i++) {
            const dx = path[i].x - path[i - 1].x;
            const dy = path[i].y - path[i - 1].y;
            accDist += Math.sqrt(dx * dx + dy * dy);

            if (accDist > 6) {
                const arrow = new THREE.Mesh(arrowGeom, arrowMat);
                arrow.position.set(path[i].x, h + 0.2, -path[i].y);
                const angle = Math.atan2(dy, dx);
                arrow.rotation.set(0, 0, 0);
                arrow.rotation.z = -Math.PI / 2;
                arrow.rotation.y = -angle;
                scene.add(arrow);
                dynamicObjects.push(arrow);
                accDist = 0;
            }
        }
    }

    // ─── 清理 ────────────────────────────────────────────
    function clearAll() {
        stopAnimation();
        droneGroup.visible = false;
        DroneModel.clearTrail();

        for (const obj of dynamicObjects) {
            scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }
        dynamicObjects = [];
        currentPath = [];
    }

    function getGroundSize() { return groundSize; }

    function resetCamera() {
        camera.position.set(40, 50, 60);
        controls.target.set(0, 0, 0);
        controls.update();
    }

    function getScene() { return scene; }

    return {
        init, clearAll,
        updateFarmBoundary, updatePath,
        startAnimation, stopAnimation,
        setPath, setAnimSpeed,
        resetCamera, getScene, getGroundSize,
    };
})();

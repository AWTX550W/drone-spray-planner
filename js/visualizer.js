/**
 * visualizer.js - Three.js 3D 场景（增强版）
 * 更精致的农田渲染、路径可视化、飞行动画
 */
const Visualizer = (function () {
    'use strict';

    let scene, camera, renderer, controls;
    let clock;
    let dynamicObjects = []; // 需要清理的动态对象

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

    function init() {
        const container = document.getElementById('three-container');
        clock = new THREE.Clock();

        // 场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87CEEB); // 天空蓝
        scene.fog = new THREE.FogExp2(0x87CEEB, 0.003);

        // 相机
        camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
        camera.position.set(40, 50, 60);

        // 渲染器
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;
        container.appendChild(renderer.domElement);

        // 控制器
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

        // ── 地面 ──
        const groundGeom = new THREE.PlaneGeometry(400, 400, 50, 50);
        // 给地面加一些高度变化
        const posAttr = groundGeom.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i);
            const y = posAttr.getY(i);
            const dist = Math.sqrt(x * x + y * y);
            if (dist > 60) {
                posAttr.setZ(i, Math.sin(x * 0.05) * Math.cos(y * 0.05) * 0.5);
            }
        }
        groundGeom.computeVertexNormals();
        const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a7c3f });
        const ground = new THREE.Mesh(groundGeom, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // 网格
        const grid = new THREE.GridHelper(400, 80, 0x3a6a2f, 0x3a6a2f);
        grid.position.y = 0.02;
        grid.material.opacity = 0.15;
        grid.material.transparent = true;
        scene.add(grid);

        // ── 天空球 ──
        const skyGeom = new THREE.SphereGeometry(300, 32, 16);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x4488cc) },
                bottomColor: { value: new THREE.Color(0xc8e0f0) },
                offset: { value: 20 },
                exponent: { value: 0.4 },
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
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide,
        });
        const sky = new THREE.Mesh(skyGeom, skyMat);
        scene.add(sky);

        // ── 无人机 ──
        droneGroup = DroneModel.create();
        droneGroup.visible = false;
        scene.add(droneGroup);

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
        const delta = Math.min(clock.getDelta(), 0.05); // 防止大跳帧
        controls.update();

        if (animating && currentPath.length > 1) {
            updateFlightAnimation(delta);
        }

        DroneModel.update(clock.getElapsedTime(), delta);
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

        // 朝向
        const heading = Math.atan2(next.y - prev.y, next.x - prev.x);
        DroneModel.setHeading(heading);

        // 喷洒（直线段中间喷，转弯不喷）
        const isTurning = t < 0.05 || t > 0.95;
        DroneModel.setSpraying(!isTurning);

        // 轨迹
        DroneModel.addTrailPoint(droneGroup.position);

        // 更新 HUD
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

        // 农田区域（带纹理感）
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

        // 边界围栏（3D管道效果）
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

        // 用 TubeGeometry 做出有粗度的路径
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

        // 路径投影到地面的阴影线
        const shadowPts = path.map(p => new THREE.Vector3(p.x, 0.05, -p.y));
        const shadowGeom = new THREE.BufferGeometry().setFromPoints(shadowPts);
        const shadowMat = new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 });
        const shadowLine = new THREE.Line(shadowGeom, shadowMat);
        scene.add(shadowLine);
        dynamicObjects.push(shadowLine);

        // 方向箭头
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
        resetCamera, getScene,
    };
})();

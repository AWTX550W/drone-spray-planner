/**
 * visualizer.js - Three.js 3D 场景渲染 + 飞行动画控制
 */
const Visualizer = (function () {
    'use strict';

    let scene, camera, renderer, controls;
    let groundMesh, boundaryLine, pathLine, drone;
    let currentPath = [];
    let animating = false;
    let animProgress = 0;
    let animSpeed = 1;
    let clock;

    function init() {
        const container = document.getElementById('three-container');
        clock = new THREE.Clock();

        // 场景
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a1628);
        scene.fog = new THREE.Fog(0x0a1628, 80, 200);

        // 相机
        camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
        camera.position.set(0, 60, 60);
        camera.lookAt(0, 0, 0);

        // 渲染器
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        container.appendChild(renderer.domElement);

        // 控制器
        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI / 2.1;
        controls.minDistance = 10;
        controls.maxDistance = 200;

        // 灯光
        const ambient = new THREE.AmbientLight(0x446688, 0.6);
        scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffeedd, 0.8);
        dirLight.position.set(30, 50, 30);
        dirLight.castShadow = true;
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 150;
        dirLight.shadow.camera.left = -60;
        dirLight.shadow.camera.right = 60;
        dirLight.shadow.camera.top = 60;
        dirLight.shadow.camera.bottom = -60;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        scene.add(dirLight);

        const hemi = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.3);
        scene.add(hemi);

        // 地面
        const groundGeom = new THREE.PlaneGeometry(200, 200);
        const groundMat = new THREE.MeshLambertMaterial({ color: 0x2d5a27 });
        groundMesh = new THREE.Mesh(groundGeom, groundMat);
        groundMesh.rotation.x = -Math.PI / 2;
        groundMesh.receiveShadow = true;
        scene.add(groundMesh);

        // 地面网格辅助线
        const gridHelper = new THREE.GridHelper(200, 40, 0x1a3a1a, 0x1a3a1a);
        gridHelper.position.y = 0.01;
        scene.add(gridHelper);

        // 无人机
        drone = DroneModel.create();
        drone.position.set(0, 10, 0);
        drone.visible = false;
        scene.add(drone);

        // 窗口大小适配
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

    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        controls.update();

        if (animating && currentPath.length > 1) {
            updateFlightAnimation(delta);
        }

        DroneModel.update(clock.getElapsedTime(), delta);
        renderer.render(scene, camera);
    }

    // ─── 更新农田边界 ───────────────────────────────────────
    function updateFarmBoundary(polygon) {
        // 移除旧边界
        if (boundaryLine) { scene.remove(boundaryLine); }

        if (!polygon || polygon.length < 3) return;

        // 3D 边界线（黄色围栏效果）
        const pts = [];
        for (const p of polygon) {
            pts.push(new THREE.Vector3(p.x, 0.3, -p.y));
        }
        pts.push(new THREE.Vector3(polygon[0].x, 0.3, -polygon[0].y));

        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0xffeb3b, linewidth: 2 });
        boundaryLine = new THREE.Line(geom, mat);
        scene.add(boundaryLine);

        // 农田地面（高亮区域）
        const shape = new THREE.Shape();
        shape.moveTo(polygon[0].x, -polygon[0].y);
        for (let i = 1; i < polygon.length; i++) {
            shape.lineTo(polygon[i].x, -polygon[i].y);
        }
        shape.closePath();

        const shapeGeom = new THREE.ShapeGeometry(shape);
        const shapeMat = new THREE.MeshLambertMaterial({
            color: 0x4caf50,
            transparent: true,
            opacity: 0.5,
        });
        const farmMesh = new THREE.Mesh(shapeGeom, shapeMat);
        farmMesh.rotation.x = -Math.PI / 2;
        farmMesh.position.y = 0.02;
        farmMesh.receiveShadow = true;
        scene.add(farmMesh);
    }

    // ─── 更新路径线 ─────────────────────────────────────────
    function updatePath(path, height) {
        // 移除旧路径
        if (pathLine) { scene.remove(pathLine); }

        if (!path || path.length < 2) return;

        const h = height || 3;
        const pts = path.map(p => new THREE.Vector3(p.x, h, -p.y));

        // 路径主线
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: 0xff4444, linewidth: 2 });
        pathLine = new THREE.Line(geom, mat);
        scene.add(pathLine);

        // 方向箭头（每隔一段距离放一个小锥体）
        const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff6666 });
        const arrowGeom = new THREE.ConeGeometry(0.3, 0.8, 4);
        let accDist = 0;
        for (let i = 1; i < path.length; i++) {
            accDist += Math.sqrt(
                (path[i].x - path[i - 1].x) ** 2 +
                (path[i].y - path[i - 1].y) ** 2
            );
            if (accDist > 8) { // 每8米一个箭头
                const arrow = new THREE.Mesh(arrowGeom, arrowMat);
                arrow.position.set(path[i].x, h, -path[i].y);
                // 朝向
                const dx = path[i].x - path[i - 1].x;
                const dy = path[i].y - path[i - 1].y;
                arrow.rotation.z = -Math.PI / 2;
                arrow.rotation.y = -Math.atan2(dy, dx);
                scene.add(arrow);
                accDist = 0;
            }
        }
    }

    // ─── 飞行动画 ───────────────────────────────────────────
    function updateFlightAnimation(delta) {
        if (currentPath.length < 2) return;

        // 计算总路径长度
        let totalLen = 0;
        const segLens = [];
        for (let i = 1; i < currentPath.length; i++) {
            const d = Math.sqrt(
                (currentPath[i].x - currentPath[i - 1].x) ** 2 +
                (currentPath[i].y - currentPath[i - 1].y) ** 2
            );
            segLens.push(d);
            totalLen += d;
        }

        animProgress += delta * animSpeed * 5; // 速度系数
        if (animProgress >= 1) {
            animProgress = 0;
            // 可以循环或停止
        }

        const targetDist = animProgress * totalLen;
        let accDist = 0;

        for (let i = 0; i < segLens.length; i++) {
            if (accDist + segLens[i] >= targetDist) {
                const t = (targetDist - accDist) / segLens[i];
                const prev = currentPath[i];
                const next = currentPath[i + 1];
                const x = prev.x + t * (next.x - prev.x);
                const y = prev.y + t * (next.y - prev.y);

                drone.position.set(x, drone.position.y, -y);
                DroneModel.lookAt({ x: next.x, y: next.y });

                // 喷洒
                DroneModel.setSpraying(t > 0.1 && t < 0.9);
                break;
            }
            accDist += segLens[i];
        }
    }

    function startAnimation() {
        if (currentPath.length < 2) return;
        animating = true;
        animProgress = 0;
        drone.visible = true;
        const height = parseFloat(document.getElementById('flight-height').value) || 3;
        drone.position.y = height;

        if (currentPath.length > 0) {
            drone.position.set(currentPath[0].x, height, -currentPath[0].y);
        }
    }

    function stopAnimation() {
        animating = false;
        DroneModel.setSpraying(false);
    }

    function setPath(path) {
        currentPath = path;
    }

    function clearAll() {
        // 清除所有动态对象
        stopAnimation();
        drone.visible = false;
        if (boundaryLine) { scene.remove(boundaryLine); boundaryLine = null; }
        if (pathLine) { scene.remove(pathLine); pathLine = null; }
        currentPath = [];

        // 清除箭头和其他辅助对象
        const toRemove = [];
        for (const obj of scene.children) {
            if (obj.type === 'Mesh' && obj.material && obj.material.color) {
                if (obj.material.color.getHex() === 0x4caf50 ||
                    obj.material.color.getHex() === 0xff6666) {
                    toRemove.push(obj);
                }
            }
        }
        toRemove.forEach(obj => scene.remove(obj));
    }

    function resetCamera() {
        camera.position.set(0, 60, 60);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
    }

    return { init, updateFarmBoundary, updatePath, startAnimation, stopAnimation, setPath, clearAll, resetCamera };
})();

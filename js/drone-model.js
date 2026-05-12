/**
 * drone-model.js - 无人机3D模型（精致版）
 * 四旋翼植保无人机 + 喷洒粒子系统
 */
const DroneModel = (function () {
    'use strict';

    let droneGroup = null;
    let propellers = [];
    let propBlur = [];
    let sprayParticles = null;
    let sprayDrops = [];
    let trailLine = null;
    let trailPoints = [];
    let isSpraying = false;
    let currentHeading = 0; // 弧度
    const SCALE = 1.5; // 无人机缩放

    function create() {
        droneGroup = new THREE.Group();
        droneGroup.scale.set(SCALE, SCALE, SCALE);

        // ── 机身（圆角矩形效果）──
        const bodyGeom = new THREE.BoxGeometry(0.5, 0.12, 0.35);
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e, shininess: 100 });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.castShadow = true;
        droneGroup.add(body);

        // 机身顶部盖板
        const topGeom = new THREE.BoxGeometry(0.35, 0.04, 0.2);
        const topMat = new THREE.MeshPhongMaterial({ color: 0x16213e, shininess: 120 });
        const top = new THREE.Mesh(topGeom, topMat);
        top.position.y = 0.08;
        droneGroup.add(top);

        // GPS/天线
        const gpsGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8);
        const gpsMat = new THREE.MeshPhongMaterial({ color: 0x222244 });
        const gps = new THREE.Mesh(gpsGeom, gpsMat);
        gps.position.set(0, 0.13, 0.08);
        droneGroup.add(gps);

        // 电池
        const batGeom = new THREE.BoxGeometry(0.28, 0.06, 0.18);
        const batMat = new THREE.MeshPhongMaterial({ color: 0x2d6a4f });
        const bat = new THREE.Mesh(batGeom, batMat);
        bat.position.y = -0.09;
        droneGroup.add(bat);

        // ── 四个机臂 + 电机 + 螺旋桨 ──
        const armPositions = [
            { x: -0.45, z: -0.3 },
            { x:  0.45, z: -0.3 },
            { x: -0.45, z:  0.3 },
            { x:  0.45, z:  0.3 },
        ];

        propellers = [];
        propBlur = [];

        for (let idx = 0; idx < armPositions.length; idx++) {
            const ap = armPositions[idx];
            const mid = { x: ap.x * 0.45, z: ap.z * 0.45 };

            // 机臂
            const armGeom = new THREE.BoxGeometry(0.06, 0.03, 0.04);
            const armMat = new THREE.MeshPhongMaterial({ color: 0x2a2a3e });
            const arm = new THREE.Mesh(armGeom, armMat);
            arm.position.set(mid.x, 0, mid.z);
            const angle = Math.atan2(ap.z, ap.x);
            arm.rotation.y = -angle;
            arm.castShadow = true;
            droneGroup.add(arm);

            // 电机座
            const motorGeom = new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8);
            const motorMat = new THREE.MeshPhongMaterial({ color: 0x333355 });
            const motor = new THREE.Mesh(motorGeom, motorMat);
            motor.position.set(ap.x, 0.02, ap.z);
            motor.castShadow = true;
            droneGroup.add(motor);

            // 螺旋桨（两片桨叶）
            const propGroup = new THREE.Group();
            propGroup.position.set(ap.x, 0.06, ap.z);

            const bladeGeom = new THREE.BoxGeometry(0.35, 0.008, 0.04);
            const bladeMat = new THREE.MeshPhongMaterial({
                color: 0x4488cc,
                transparent: true,
                opacity: 0.7,
                shininess: 140,
            });

            const blade1 = new THREE.Mesh(bladeGeom, bladeMat);
            propGroup.add(blade1);
            const blade2 = new THREE.Mesh(bladeGeom, bladeMat);
            blade2.rotation.y = Math.PI / 2;
            propGroup.add(blade2);

            droneGroup.add(propGroup);
            propellers.push(propGroup);

            // 旋翼模糊圆盘
            const discGeom = new THREE.CircleGeometry(0.18, 16);
            const discMat = new THREE.MeshBasicMaterial({
                color: 0x4488cc,
                transparent: true,
                opacity: 0.12,
                side: THREE.DoubleSide,
            });
            const disc = new THREE.Mesh(discGeom, discMat);
            disc.rotation.x = -Math.PI / 2;
            disc.position.set(ap.x, 0.07, ap.z);
            droneGroup.add(disc);
            propBlur.push(disc);
        }

        // ── 药箱 ──
        const tankGeom = new THREE.BoxGeometry(0.2, 0.15, 0.12);
        const tankMat = new THREE.MeshPhongMaterial({ color: 0x00796b, transparent: true, opacity: 0.8 });
        const tank = new THREE.Mesh(tankGeom, tankMat);
        tank.position.set(0, -0.16, 0);
        tank.castShadow = true;
        droneGroup.add(tank);

        // ── 喷杆 + 喷头 ──
        const sprayBarGeom = new THREE.CylinderGeometry(0.012, 0.012, 1.2, 6);
        const sprayBarMat = new THREE.MeshPhongMaterial({ color: 0x556677 });
        const sprayBar = new THREE.Mesh(sprayBarGeom, sprayBarMat);
        sprayBar.rotation.z = Math.PI / 2;
        sprayBar.position.set(0, -0.26, 0);
        droneGroup.add(sprayBar);

        for (let x = -0.5; x <= 0.5; x += 0.1) {
            const nozzleGeom = new THREE.CylinderGeometry(0.008, 0.015, 0.04, 6);
            const nozzleMat = new THREE.MeshPhongMaterial({ color: 0x8899aa });
            const nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
            nozzle.position.set(x, -0.3, 0);
            droneGroup.add(nozzle);
        }

        // ── 喷洒粒子系统 ──
        const particleCount = 400;
        const particleGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -100;
            positions[i * 3 + 2] = 0;
            colors[i * 3] = 0.2;
            colors[i * 3 + 1] = 0.6;
            colors[i * 3 + 2] = 0.9;
            sprayDrops.push(createDrop());
        }

        particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMat = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true,
        });
        sprayParticles = new THREE.Points(particleGeom, particleMat);
        droneGroup.add(sprayParticles);

        // ── 飞行轨迹线 ──
        const trailGeom = new THREE.BufferGeometry();
        const trailMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 });
        trailLine = new THREE.Line(trailGeom, trailMat);
        droneGroup.add(trailLine);

        return droneGroup;
    }

    function createDrop() {
        return {
            x: (Math.random() - 0.5) * 1.0,
            y: -0.3 - Math.random() * 0.1,
            z: (Math.random() - 0.5) * 0.2,
            vx: (Math.random() - 0.5) * 0.3,
            vy: -(Math.random() * 2 + 1.5),
            vz: (Math.random() - 0.5) * 0.3,
            life: Math.random() * 0.6,
            maxLife: Math.random() * 0.4 + 0.4,
        };
    }

    function update(time, delta) {
        if (!droneGroup) return;

        // 螺旋桨旋转
        const propSpeed = isSpraying ? 0.8 : 0.4;
        for (const prop of propellers) {
            prop.rotation.y += propSpeed;
        }

        // 旋翼模糊透明度
        const blurOpacity = isSpraying ? 0.2 : 0.08;
        for (const disc of propBlur) {
            disc.material.opacity = blurOpacity + Math.sin(time * 3) * 0.02;
        }

        // 粒子更新
        if (sprayParticles && isSpraying) {
            const positions = sprayParticles.geometry.attributes.position.array;
            const colors = sprayParticles.geometry.attributes.color.array;

            for (let i = 0; i < sprayDrops.length; i++) {
                const d = sprayDrops[i];
                d.life += delta;

                if (d.life > d.maxLife) {
                    const nd = createDrop();
                    Object.assign(d, nd);
                    d.life = 0;
                    positions[i * 3] = d.x;
                    positions[i * 3 + 1] = d.y;
                    positions[i * 3 + 2] = d.z;
                } else {
                    d.x += d.vx * delta;
                    d.y += d.vy * delta;
                    d.z += d.vz * delta;
                    d.vy -= 4 * delta; // 重力

                    positions[i * 3] = d.x;
                    positions[i * 3 + 1] = d.y;
                    positions[i * 3 + 2] = d.z;
                }

                const alpha = Math.max(0, 1 - d.life / d.maxLife);
                colors[i * 3] = 0.2 * alpha;
                colors[i * 3 + 1] = 0.7 * alpha;
                colors[i * 3 + 2] = 1.0 * alpha;
            }

            sprayParticles.geometry.attributes.position.needsUpdate = true;
            sprayParticles.geometry.attributes.color.needsUpdate = true;
        }

        // 轨迹更新
        if (trailLine && trailPoints.length > 1) {
            trailLine.geometry.dispose();
            trailLine.geometry = new THREE.BufferGeometry().setFromPoints(trailPoints);
        }
    }

    function addTrailPoint(pos) {
        if (!droneGroup) return;
        const local = droneGroup.worldToLocal(pos.clone());
        trailPoints.push(local);
        if (trailPoints.length > 500) trailPoints.shift();
    }

    function clearTrail() {
        trailPoints = [];
        if (trailLine) {
            trailLine.geometry.dispose();
            trailLine.geometry = new THREE.BufferGeometry();
        }
    }

    function setSpraying(active) {
        isSpraying = active;
        if (!active && sprayParticles) {
            const positions = sprayParticles.geometry.attributes.position.array;
            for (let i = 0; i < sprayDrops.length; i++) {
                positions[i * 3 + 1] = -100;
            }
            sprayParticles.geometry.attributes.position.needsUpdate = true;
        }
    }

    function setHeading(radians) {
        if (!droneGroup) return;
        currentHeading = radians;
        droneGroup.rotation.y = -radians + Math.PI / 2;
    }

    function getPosition() {
        return droneGroup ? droneGroup.position.clone() : null;
    }

    return { create, update, setSpraying, setHeading, getPosition, addTrailPoint, clearTrail };
})();

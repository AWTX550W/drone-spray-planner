/**
 * drone-model.js - Three.js 无人机模型 + 喷洒粒子
 */
const DroneModel = (function () {
    'use strict';

    let droneGroup = null;
    let propellers = [];
    let sprayParticles = null;
    let sprayDrops = [];
    let isSpraying = false;

    function create() {
        droneGroup = new THREE.Group();

        // 机身
        const bodyGeom = new THREE.BoxGeometry(0.6, 0.15, 0.6);
        const bodyMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 80 });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        droneGroup.add(body);

        // 中心电池
        const batteryGeom = new THREE.BoxGeometry(0.3, 0.1, 0.3);
        const batteryMat = new THREE.MeshPhongMaterial({ color: 0x00aa44 });
        const battery = new THREE.Mesh(batteryGeom, batteryMat);
        battery.position.y = -0.05;
        droneGroup.add(battery);

        // 四个机臂
        const armLen = 0.7;
        const armGeom = new THREE.CylinderGeometry(0.03, 0.03, armLen, 6);
        const armMat = new THREE.MeshPhongMaterial({ color: 0x555555 });

        const armPositions = [
            { x: -0.35, z: -0.35, ry: -Math.PI / 4 },
            { x: 0.35, z: -0.35, ry: Math.PI / 4 },
            { x: -0.35, z: 0.35, ry: Math.PI / 4 },
            { x: 0.35, z: 0.35, ry: -Math.PI / 4 },
        ];

        propellers = [];

        for (const ap of armPositions) {
            // 机臂
            const arm = new THREE.Mesh(armGeom, armMat);
            arm.rotation.z = Math.PI / 2;
            arm.rotation.y = ap.ry;
            arm.position.set(ap.x * 0.5, 0, ap.z * 0.5);
            droneGroup.add(arm);

            // 电机
            const motorGeom = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8);
            const motor = new THREE.Mesh(motorGeom, armMat);
            motor.position.set(ap.x, 0.05, ap.z);
            droneGroup.add(motor);

            // 螺旋桨
            const propGeom = new THREE.BoxGeometry(0.4, 0.01, 0.06);
            const propMat = new THREE.MeshPhongMaterial({ color: 0x88ccff, transparent: true, opacity: 0.6 });
            const prop = new THREE.Mesh(propGeom, propMat);
            prop.position.set(ap.x, 0.12, ap.z);
            droneGroup.add(prop);
            propellers.push(prop);
        }

        // 喷杆
        const sprayBarGeom = new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6);
        const sprayBarMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
        const sprayBar = new THREE.Mesh(sprayBarGeom, sprayBarMat);
        sprayBar.rotation.z = Math.PI / 2;
        sprayBar.position.y = -0.15;
        droneGroup.add(sprayBar);

        // 喷头
        for (let x = -0.4; x <= 0.4; x += 0.2) {
            const nozzleGeom = new THREE.ConeGeometry(0.02, 0.06, 6);
            const nozzleMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
            const nozzle = new THREE.Mesh(nozzleGeom, nozzleMat);
            nozzle.position.set(x, -0.2, 0);
            droneGroup.add(nozzle);
        }

        // 粒子系统
        const particleCount = 200;
        const particleGeom = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = 0;
            positions[i * 3 + 1] = -100; // 隐藏
            positions[i * 3 + 2] = 0;
            colors[i * 3] = 0.3;
            colors[i * 3 + 1] = 0.7;
            colors[i * 3 + 2] = 1.0;
            sizes[i] = Math.random() * 0.1 + 0.05;
            sprayDrops.push({
                vx: (Math.random() - 0.5) * 0.5,
                vy: -Math.random() * 2 - 1,
                vz: (Math.random() - 0.5) * 0.5,
                life: 0,
                maxLife: Math.random() * 0.5 + 0.3,
            });
        }

        particleGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particleGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const particleMat = new THREE.PointsMaterial({
            size: 0.12,
            vertexColors: true,
            transparent: true,
            opacity: 0.6,
            sizeAttenuation: true,
        });

        sprayParticles = new THREE.Points(particleGeom, particleMat);
        droneGroup.add(sprayParticles);

        return droneGroup;
    }

    function update(time, delta) {
        if (!droneGroup) return;

        // 螺旋桨旋转
        const propSpeed = isSpraying ? 0.5 : 0.3;
        for (const prop of propellers) {
            prop.rotation.y += propSpeed;
        }

        // 粒子更新
        if (sprayParticles && isSpraying) {
            const positions = sprayParticles.geometry.attributes.position.array;
            const colors = sprayParticles.geometry.attributes.color.array;

            for (let i = 0; i < sprayDrops.length; i++) {
                const drop = sprayDrops[i];
                drop.life += delta;

                if (drop.life > drop.maxLife) {
                    // 重生
                    drop.life = 0;
                    drop.maxLife = Math.random() * 0.5 + 0.3;
                    positions[i * 3] = (Math.random() - 0.5) * 0.8;
                    positions[i * 3 + 1] = -0.2;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
                    drop.vx = (Math.random() - 0.5) * 0.5;
                    drop.vy = -Math.random() * 3 - 2;
                    drop.vz = (Math.random() - 0.5) * 0.5;
                } else {
                    positions[i * 3] += drop.vx * delta;
                    positions[i * 3 + 1] += drop.vy * delta;
                    positions[i * 3 + 2] += drop.vz * delta;
                    // 重力
                    drop.vy -= 3 * delta;
                }

                // 颜色渐变
                const alpha = 1 - drop.life / drop.maxLife;
                colors[i * 3] = 0.3 * alpha;
                colors[i * 3 + 1] = 0.7 * alpha;
                colors[i * 3 + 2] = 1.0 * alpha;
            }

            sprayParticles.geometry.attributes.position.needsUpdate = true;
            sprayParticles.geometry.attributes.color.needsUpdate = true;
        }
    }

    function setSpraying(active) {
        isSpraying = active;
        if (!active && sprayParticles) {
            // 隐藏所有粒子
            const positions = sprayParticles.geometry.attributes.position.array;
            for (let i = 0; i < sprayDrops.length; i++) {
                positions[i * 3 + 1] = -100;
            }
            sprayParticles.geometry.attributes.position.needsUpdate = true;
        }
    }

    function getPosition() {
        return droneGroup ? droneGroup.position : null;
    }

    function lookAt(nextPoint) {
        if (!droneGroup || !nextPoint) return;
        droneGroup.lookAt(
            nextPoint.x,
            droneGroup.position.y,
            -nextPoint.y // Canvas Y -> Three.js Z
        );
    }

    return { create, update, setSpraying, getPosition, lookAt };
})();

/**
 * main.js - 入口文件，UI交互绑定
 */
(function () {
    'use strict';

    // ─── 参数面板实时更新 ────────────────────────────────────
    function bindSlider(id, valId) {
        const slider = document.getElementById(id);
        const valEl = document.getElementById(valId);
        if (!slider || !valEl) return;
        slider.addEventListener('input', () => { valEl.textContent = slider.value; });
    }

    bindSlider('swath-width', 'swath-width-val');
    bindSlider('flight-speed', 'flight-speed-val');
    bindSlider('flight-height', 'flight-height-val');
    bindSlider('overlap', 'overlap-val');

    // ─── 按钮事件 ───────────────────────────────────────────
    document.getElementById('btn-generate').addEventListener('click', generatePath);
    document.getElementById('btn-animate').addEventListener('click', () => Visualizer.startAnimation());
    document.getElementById('btn-stop').addEventListener('click', () => Visualizer.stopAnimation());
    document.getElementById('btn-reset-cam').addEventListener('click', () => Visualizer.resetCamera());

    function getParams() {
        return {
            swathWidth: parseFloat(document.getElementById('swath-width').value) || 5,
            flightSpeed: parseFloat(document.getElementById('flight-speed').value) || 5,
            flightHeight: parseFloat(document.getElementById('flight-height').value) || 3,
            tankCapacity: parseFloat(document.getElementById('tank-capacity').value) || 16,
            sprayRate: parseFloat(document.getElementById('spray-rate').value) || 1.5,
            overlap: parseFloat(document.getElementById('overlap').value) || 20,
            turnRadius: 2,
        };
    }

    function generatePath() {
        const polygon = FarmEditor.getPolygon();
        if (!polygon) {
            alert('请先绘制并闭合农田多边形');
            return;
        }

        const params = getParams();
        const result = PathPlanner.generatePath(polygon, params);

        if (result.path.length === 0) {
            alert('无法生成路径，请检查农田形状');
            return;
        }

        // 更新 3D 场景
        Visualizer.clearAll();
        Visualizer.updateFarmBoundary(polygon);
        Visualizer.updatePath(result.path, params.flightHeight);
        Visualizer.setPath(result.path);

        // 更新统计
        document.getElementById('stat-area').textContent = result.stats.area + ' 亩';
        document.getElementById('stat-distance').textContent = result.stats.distance + ' km';
        document.getElementById('stat-time').textContent = result.stats.time;
        document.getElementById('stat-turns').textContent = result.stats.turns;
        document.getElementById('stat-refills').textContent = result.stats.refills;
        document.getElementById('stat-points').textContent = result.stats.points;

        // 自动调整相机
        Visualizer.resetCamera();
    }

    // ─── 初始化 ─────────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', () => {
        FarmEditor.init();
        Visualizer.init();
    });
})();

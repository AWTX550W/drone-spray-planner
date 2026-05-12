/**
 * main.js - 入口，UI 交互绑定
 */
(function () {
    'use strict';

    let lastResult = null; // 保存最近一次规划结果

    // ─── 滑块绑定 ─────────────────────────────────────────
    function bindSlider(id, valId) {
        const s = document.getElementById(id);
        const v = document.getElementById(valId);
        if (!s || !v) return;
        s.addEventListener('input', () => { v.textContent = s.value; });
    }

    bindSlider('swath-width', 'swath-width-val');
    bindSlider('flight-speed', 'flight-speed-val');
    bindSlider('flight-height', 'flight-height-val');
    bindSlider('overlap', 'overlap-val');

    // 动画速度
    const animSpeedSlider = document.getElementById('anim-speed');
    const animSpeedVal = document.getElementById('anim-speed-val');
    if (animSpeedSlider) {
        animSpeedSlider.addEventListener('input', () => {
            const v = parseFloat(animSpeedSlider.value);
            animSpeedVal.textContent = v.toFixed(1) + 'x';
            Visualizer.setAnimSpeed(v);
        });
    }

    // ─── 获取参数 ─────────────────────────────────────────
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

    // ─── 生成路径 ─────────────────────────────────────────
    function generatePath() {
        const polygon = FarmEditor.getPolygon();
        if (!polygon) {
            showToast('请先绘制并闭合农田多边形');
            return;
        }

        const params = getParams();
        const result = PathPlanner.generatePath(polygon, params);

        if (result.path.length < 2) {
            showToast('无法生成有效路径，请检查农田形状');
            return;
        }

        lastResult = result;

        // 3D 场景
        Visualizer.clearAll();
        Visualizer.updateFarmBoundary(polygon);
        Visualizer.updatePath(result.path, params.flightHeight);
        Visualizer.setPath(result.path);

        // 统计
        document.getElementById('stat-area').textContent = result.stats.area + ' 亩';
        document.getElementById('stat-distance').textContent = result.stats.distance + ' km';
        document.getElementById('stat-time').textContent = result.stats.time;
        document.getElementById('stat-turns').textContent = result.stats.turns;
        document.getElementById('stat-refills').textContent = result.stats.refills;
        document.getElementById('stat-points').textContent = result.stats.points;
        document.getElementById('stat-progress').textContent = '--';

        // 设置飞控任务数据
        FCInterface.setMission({ path: result.path, polygon, stats: result.stats });

        // 自动调整相机
        Visualizer.resetCamera();
        showToast('路径生成完成，' + result.stats.points + ' 个航点');
    }

    // ─── 飞控接口 ─────────────────────────────────────────
    function initFCPanel() {
        const statusEl = document.getElementById('fc-status');
        const connDot = document.getElementById('conn-status');
        const connLabel = document.getElementById('conn-label');

        FCInterface.on('status', function (data) {
            if (data.connected) {
                statusEl.textContent = data.message || '已连接';
                statusEl.className = 'fc-status connected';
                connDot.className = 'status-dot connected';
                connLabel.textContent = data.message || '已连接';
            } else if (data.error) {
                statusEl.textContent = data.error;
                statusEl.className = 'fc-status error';
                connDot.className = 'status-dot';
                connDot.style.background = '#ff5252';
                connLabel.textContent = '连接失败';
            } else {
                statusEl.textContent = data.message || '未连接';
                statusEl.className = 'fc-status';
                connDot.className = 'status-dot';
                connDot.style.background = '#555';
                connLabel.textContent = data.message || '未连接';
            }
        });

        document.getElementById('btn-fc-connect').addEventListener('click', function () {
            const url = document.getElementById('fc-url').value.trim();
            const proto = document.getElementById('fc-protocol').value;
            FCInterface.connect(url, proto);
        });

        document.getElementById('btn-fc-upload').addEventListener('click', function () {
            if (!lastResult) { showToast('请先生成路径'); return; }
            const params = getParams();
            FCInterface.uploadMission(lastResult.path, params);
        });

        document.getElementById('btn-fc-export').addEventListener('click', function () {
            if (!lastResult) { showToast('请先生成路径'); return; }
            const params = getParams();
            const qgc = FCInterface.exportQGC(lastResult.path, params);
            downloadFile('mission.waypoints', qgc);
            showToast('已下载 .waypoints 文件');
        });
    }

    // ─── 任务面板 ─────────────────────────────────────────
    function initMissionPanel() {
        document.getElementById('btn-mission-panel').addEventListener('click', function () {
            if (lastResult) updateMissionInfo();
            document.getElementById('mission-panel').classList.remove('hidden');
        });

        document.getElementById('btn-close-mission').addEventListener('click', function () {
            document.getElementById('mission-panel').classList.add('hidden');
        });

        document.getElementById('btn-export-mavlink').addEventListener('click', function () {
            if (!lastResult) { showToast('无任务数据'); return; }
            const params = getParams();
            const qgc = FCInterface.exportQGC(lastResult.path, params);
            downloadFile('mission.waypoints', qgc);
            showToast('已下载 .mission 文件');
        });

        document.getElementById('btn-export-json').addEventListener('click', function () {
            if (!lastResult) { showToast('无任务数据'); return; }
            const params = getParams();
            const json = FCInterface.exportJSON(lastResult.path, params);
            downloadFile('mission.plan', json);
            showToast('已下载 .json 文件');
        });

        document.getElementById('btn-copy-ll').addEventListener('click', function () {
            if (!lastResult) { showToast('无任务数据'); return; }
            const text = lastResult.path.map((p, i) =>
                'WP' + i + ': ' + p.x.toFixed(6) + ', ' + p.y.toFixed(6)
            ).join('\n');
            navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板'));
        });
    }

    function updateMissionInfo() {
        if (!lastResult) return;
        const s = lastResult.stats;
        document.getElementById('mission-info').innerHTML =
            '航点数: ' + s.points + '<br>' +
            '覆盖面积: ' + s.area + ' 亩<br>' +
            '飞行距离: ' + s.distance + ' km<br>' +
            '预计时间: ' + s.time + '<br>' +
            '转弯次数: ' + s.turns + '<br>' +
            '加药次数: ' + s.refills;

        const params = getParams();
        const waypoints = FCInterface.buildWaypoints(lastResult.path, params);
        const cmdMap = { 22: 'TAKEOFF', 16: 'WAYPOINT', 20: 'RTL', 21: 'LAND' };
        document.getElementById('waypoint-list').textContent = waypoints.map(wp =>
            '#' + String(wp.index).padStart(3, '0') +
            ' CMD:' + (cmdMap[wp.command] || wp.command) +
            ' X:' + (wp.x || 0).toFixed(2) +
            ' Y:' + (wp.y || 0).toFixed(2) +
            ' ALT:' + wp.alt.toFixed(1) +
            (wp.param4 === 1 ? ' [SPRAY]' : '')
        ).join('\n');
    }

    // ─── 工具 ─────────────────────────────────────────────
    function downloadFile(name, content) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    function showToast(msg) {
        let toast = document.getElementById('toast-msg');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-msg';
            toast.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
                'background:#1a237e;color:#fff;padding:8px 20px;border-radius:6px;font-size:13px;' +
                'z-index:2000;opacity:0;transition:opacity 0.3s;pointer-events:none;box-shadow:0 4px 20px rgba(0,0,0,0.4);';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        setTimeout(() => { toast.style.opacity = '0'; }, 2500);
    }

    // ─── 按钮事件 ─────────────────────────────────────────
    document.getElementById('btn-generate').addEventListener('click', generatePath);
    document.getElementById('btn-animate').addEventListener('click', () => Visualizer.startAnimation());
    document.getElementById('btn-stop').addEventListener('click', () => Visualizer.stopAnimation());
    document.getElementById('btn-reset-cam').addEventListener('click', () => Visualizer.resetCamera());

    // ─── 初始化 ───────────────────────────────────────────
    window.addEventListener('DOMContentLoaded', function () {
        FarmEditor.init();
        Visualizer.init();
        initFCPanel();
        initMissionPanel();
    });
})();

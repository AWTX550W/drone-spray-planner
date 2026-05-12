/**
 * farm-editor.js - Canvas 2D 农田多边形绘制
 */
const FarmEditor = (function () {
    'use strict';

    let canvas, ctx;
    let points = [];     // 当前绘制的顶点
    let closed = false;  // 是否已闭合
    let gridScale = 10;  // 每格代表的米数
    let pixelsPerMeter;  // 像素/米 比例

    // 坐标转换
    function toPixel(coord) { return coord * pixelsPerMeter; }
    function toMeter(pixel) { return pixel / pixelsPerMeter; }

    function init() {
        canvas = document.getElementById('farm-canvas');
        ctx = canvas.getContext('2d');
        pixelsPerMeter = canvas.width / (gridScale * 10); // 320px -> 100m

        canvas.addEventListener('click', onCanvasClick);
        canvas.addEventListener('contextmenu', onRightClick);
        document.getElementById('btn-undo').addEventListener('click', undo);
        document.getElementById('btn-clear').addEventListener('click', clear);

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => loadPreset(btn.dataset.shape));
        });

        draw();
    }

    function onCanvasClick(e) {
        if (closed) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // 转为米制坐标（以画布中心为原点）
        const mx = toMeter(x - canvas.width / 2);
        const my = toMeter(canvas.height / 2 - y);

        points.push({ x: mx, y: my });
        draw();
        updateInfo();
    }

    function onRightClick(e) {
        e.preventDefault();
        if (points.length >= 3) {
            closed = true;
            draw();
            updateInfo();
        }
    }

    function undo() {
        if (closed) { closed = false; }
        else { points.pop(); }
        draw();
        updateInfo();
    }

    function clear() {
        points = [];
        closed = false;
        draw();
        updateInfo();
    }

    // 预设形状（米制坐标）
    const presets = {
        rect: [
            { x: -30, y: -20 }, { x: 30, y: -20 },
            { x: 30, y: 20 }, { x: -30, y: 20 },
        ],
        lshape: [
            { x: -30, y: -25 }, { x: 5, y: -25 },
            { x: 5, y: -5 }, { x: 30, y: -5 },
            { x: 30, y: 25 }, { x: -30, y: 25 },
        ],
        triangle: [
            { x: 0, y: 30 }, { x: -30, y: -20 }, { x: 30, y: -20 },
        ],
        concave: [
            { x: -30, y: -20 }, { x: -10, y: -20 },
            { x: -10, y: 0 }, { x: -20, y: 0 },
            { x: -20, y: 20 }, { x: 30, y: 20 },
            { x: 30, y: -20 }, { x: 0, y: -20 },
            { x: 0, y: 20 }, { x: -30, y: 20 },
        ],
        uav: [
            { x: -35, y: -15 }, { x: -15, y: -22 },
            { x: 5, y: -18 }, { x: 25, y: -25 },
            { x: 38, y: -10 }, { x: 30, y: 5 },
            { x: 40, y: 20 }, { x: 15, y: 22 },
            { x: -5, y: 18 }, { x: -20, y: 25 },
            { x: -38, y: 12 },
        ],
    };

    function loadPreset(name) {
        if (presets[name]) {
            points = presets[name].map(p => ({ ...p }));
            closed = true;
            draw();
            updateInfo();
        }
    }

    function draw() {
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        // 背景
        ctx.fillStyle = '#0d1520';
        ctx.fillRect(0, 0, w, h);

        // 网格
        ctx.strokeStyle = '#1a2535';
        ctx.lineWidth = 0.5;
        const step = pixelsPerMeter * 10; // 每10米一条线
        for (let x = w / 2 % step; x < w; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = h / 2 % step; y < h; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 中心十字
        ctx.strokeStyle = '#2a3a5a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
        ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
        ctx.stroke();

        if (points.length === 0) return;

        // 多边形填充
        if (closed) {
            ctx.fillStyle = 'rgba(76, 175, 80, 0.2)';
            ctx.beginPath();
            for (let i = 0; i < points.length; i++) {
                const px = toPixel(points[i].x) + w / 2;
                const py = -toPixel(points[i].y) + h / 2;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        }

        // 多边形边
        ctx.strokeStyle = '#4caf50';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const px = toPixel(points[i].x) + w / 2;
            const py = -toPixel(points[i].y) + h / 2;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        if (closed) ctx.closePath();
        ctx.stroke();

        // 顶点
        for (let i = 0; i < points.length; i++) {
            const px = toPixel(points[i].x) + w / 2;
            const py = -toPixel(points[i].y) + h / 2;
            ctx.fillStyle = '#ffeb3b';
            ctx.beginPath();
            ctx.arc(px, py, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '10px monospace';
            ctx.fillText(i + 1, px + 6, py - 6);
        }
    }

    function updateInfo() {
        const el = document.getElementById('farm-info');
        if (!closed || points.length < 3) {
            el.textContent = points.length + ' 个顶点';
            return;
        }
        const area = Math.abs(PathPlanner.polygonArea(points));
        const mu = (area / 666.67).toFixed(1);
        el.textContent = points.length + ' 个顶点 | 面积 ' + mu + ' 亩';
    }

    function getPolygon() {
        if (!closed || points.length < 3) return null;
        return points.slice();
    }

    return { init, getPolygon, clear, draw };
})();

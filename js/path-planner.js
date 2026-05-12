/**
 * path-planner.js - 路径规划算法
 * 核心：凸包分解 + 牛耕法覆盖
 */
const PathPlanner = (function () {
    'use strict';

    // ─── 几何工具 ──────────────────────────────────────────
    function dist(a, b) {
        return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    }

    function cross(o, a, b) {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }

    // 多边形面积（有符号，逆时针为正）
    function polygonArea(pts) {
        let area = 0;
        for (let i = 0, n = pts.length; i < n; i++) {
            const j = (i + 1) % n;
            area += pts[i].x * pts[j].y;
            area -= pts[j].x * pts[i].y;
        }
        return area / 2;
    }

    // 确保逆时针
    function ensureCCW(pts) {
        if (polygonArea(pts) < 0) pts.reverse();
    }

    // 点是否在多边形内（射线法）
    function pointInPolygon(p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if (((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    // 两线段交点
    function segIntersect(a1, a2, b1, b2) {
        const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
        const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
        const denom = d1x * d2y - d1y * d2x;
        if (Math.abs(denom) < 1e-10) return null;
        const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
        const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
            return { x: a1.x + t * d1x, y: a1.y + t * d1y };
        }
        return null;
    }

    // ─── 凸包分解 ──────────────────────────────────────────
    // 使用耳切法检测凹多边形的凹顶点，通过切割分解为凸子区域
    function decomposeConcave(polygon) {
        const pts = polygon.slice();
        ensureCCW(pts);
        const n = pts.length;
        if (n < 4) return [pts]; // 三角形已是凸的

        // 检查凹顶点
        function isConvexVertex(i) {
            const prev = pts[(i - 1 + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            return cross(prev, curr, next) > 0;
        }

        let concaveIdx = -1;
        for (let i = 0; i < n; i++) {
            if (!isConvexVertex(i)) { concaveIdx = i; break; }
        }
        if (concaveIdx === -1) return [pts]; // 已是凸多边形

        // 在凹顶点处切割：找到合适的对角线
        const ci = pts[concaveIdx];
        let bestSplit = -1;
        let bestDist = Infinity;

        for (let j = 0; j < n; j++) {
            if (j === concaveIdx || j === (concaveIdx + 1) % n || j === (concaveIdx - 1 + n) % n) continue;

            // 检查对角线是否在多边形内部且不与其他边相交
            const cj = pts[j];
            let valid = true;

            for (let k = 0; k < n; k++) {
                const k2 = (k + 1) % n;
                // 跳过共享端点的边
                if (k === concaveIdx || k === j || k2 === concaveIdx || k2 === j) continue;
                if (segIntersect(ci, cj, pts[k], pts[k2])) {
                    valid = false;
                    break;
                }
            }

            if (valid) {
                const d = dist(ci, cj);
                if (d < bestDist) { bestDist = d; bestSplit = j; }
            }
        }

        if (bestSplit === -1) return [pts]; // 无法分解，当凸处理

        // 分割成两个多边形
        const poly1 = [], poly2 = [];
        let i = concaveIdx;
        while (true) {
            poly1.push(pts[i]);
            if (i === bestSplit) break;
            i = (i + 1) % n;
        }
        i = bestSplit;
        while (true) {
            poly2.push(pts[i]);
            if (i === concaveIdx) break;
            i = (i + 1) % n;
        }

        // 递归分解
        const result = [];
        const decomp1 = decomposeConcave(poly1);
        const decomp2 = decomposeConcave(poly2);
        return result.concat(decomp1, decomp2);
    }

    // ─── 内缩多边形 ─────────────────────────────────────────
    // 将多边形向内缩进 offset 距离
    function shrinkPolygon(pts, offset) {
        if (pts.length < 3 || offset <= 0) return pts.slice();

        const result = [];
        const n = pts.length;

        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];

            // 边方向向量
            const d1x = curr.x - prev.x, d1y = curr.y - prev.y;
            const d2x = next.x - curr.x, d2y = next.y - curr.y;

            // 法线（向内）
            const len1 = Math.sqrt(d1x * d1x + d1y * d1y);
            const len2 = Math.sqrt(d2x * d2x + d2y * d2y);
            if (len1 < 1e-6 || len2 < 1e-6) { result.push({ x: curr.x, y: curr.y }); continue; }

            const n1x = -d1y / len1, n1y = d1x / len1;
            const n2x = -d2y / len2, n2y = d2x / len2;

            // 内缩点
            const ix = curr.x + offset * n1x;
            const iy = curr.y + offset * n1y;
            const jx = curr.x + offset * n2x;
            const jy = curr.y + offset * n2y;

            // 两条内缩边的交点
            const dx = jx - ix, dy = jy - iy;
            const ex = ix - curr.x + offset * n2x, ey = iy - curr.y + offset * n2y;
            const denom = n1x * (-n2y) - n1y * (-n2x);

            if (Math.abs(denom) < 1e-10) {
                result.push({ x: (ix + jx) / 2, y: (iy + jy) / 2 });
            } else {
                const t = (n2x * (curr.y - iy) - n2y * (curr.x - ix)) / denom;
                // 简化：直接用两个内缩点的平均
                result.push({ x: (ix + jx) / 2, y: (iy + jy) / 2 });
            }
        }
        return result;
    }

    // ─── 牛耕法路径生成 ─────────────────────────────────────
    function boustrophedonPath(polygon, swathWidth) {
        ensureCCW(polygon);
        const shrunk = shrinkPolygon(polygon, -swathWidth / 2);
        if (shrunk.length < 3) return [];

        // 获取包围盒
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of shrunk) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }

        // 按Y轴方向平行扫描
        const step = swathWidth * (1 - 0.2); // 考虑重叠率，hardcode 20% 先
        const path = [];
        let leftToRight = true;

        for (let y = minY + step / 2; y <= maxY - step / 2; y += step) {
            // 计算扫描线与多边形的交点
            const intersections = [];
            const n = shrunk.length;
            for (let i = 0; i < n; i++) {
                const j = (i + 1) % n;
                const y1 = shrunk[i].y, y2 = shrunk[j].y;
                if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
                    const t = (y - y1) / (y2 - y1);
                    intersections.push(shrunk[i].x + t * (shrunk[j].x - shrunk[i].x));
                }
            }
            intersections.sort((a, b) => a - b);

            // 成对取交点作为线段
            for (let k = 0; k + 1 < intersections.length; k += 2) {
                const x1 = intersections[k], x2 = intersections[k + 1];
                if (x2 - x1 < 0.5) continue; // 忽略过短线段

                if (leftToRight) {
                    path.push({ x: x1, y: y });
                    path.push({ x: x2, y: y });
                } else {
                    path.push({ x: x2, y: y });
                    path.push({ x: x1, y: y });
                }
            }
            leftToRight = !leftToRight;
        }

        return path;
    }

    // ─── 平滑路径（端点间加入圆弧转弯） ─────────────────────
    function smoothPath(points, turnRadius) {
        if (points.length < 4) return points;
        const result = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            // 在转弯处插入中间点使路径更平滑
            const prev = points[i - 1], curr = points[i], next = points[i + 1];
            const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
            const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
            const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

            if (len1 > turnRadius * 2 && len2 > turnRadius * 2) {
                // 插入转弯弧的起止点
                const t = turnRadius / len1;
                result.push({ x: curr.x - dx1 * t, y: curr.y - dy1 * t });
                result.push(curr);
                const t2 = turnRadius / len2;
                result.push({ x: curr.x + dx2 * t2, y: curr.y + dy2 * t2 });
            } else {
                result.push(curr);
            }
        }
        result.push(points[points.length - 1]);
        return result;
    }

    // ─── 主接口：生成完整路径 ───────────────────────────────
    function generatePath(polygon, params) {
        const swathWidth = params.swathWidth || 5;
        const turnRadius = params.turnRadius || 2;
        const overlap = (params.overlap || 20) / 100;

        if (polygon.length < 3) return { path: [], stats: {} };

        // 1. 凸包分解
        const regions = decomposeConcave(polygon);

        // 2. 每个区域生成牛耕法路径
        const regionPaths = [];
        for (const region of regions) {
            const rp = boustrophedonPath(region, swathWidth * (1 - overlap));
            if (rp.length > 0) regionPaths.push(rp);
        }

        // 如果只有一个区域，直接返回
        if (regionPaths.length <= 1) {
            const raw = regionPaths.length > 0 ? regionPaths[0] : [];
            const smoothed = smoothPath(raw, turnRadius);
            return buildResult(smoothed, polygon, params);
        }

        // 3. 多区域连接：贪心最近邻
        const connected = greedyConnect(regionPaths);
        const smoothed = smoothPath(connected, turnRadius);
        return buildResult(smoothed, polygon, params);
    }

    // 贪心最近邻连接多条路径
    function greedyConnect(paths) {
        if (paths.length === 0) return [];
        const result = paths[0].slice();
        const used = new Set([0]);

        while (used.size < paths.length) {
            const lastPt = result[result.length - 1];
            let bestIdx = -1, bestDist = Infinity;
            for (let i = 0; i < paths.length; i++) {
                if (used.has(i)) continue;
                const d = dist(lastPt, paths[i][0]);
                if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx === -1) break;
            result.push(...paths[bestIdx]);
            used.add(bestIdx);
        }
        return result;
    }

    // 统计
    function buildResult(path, polygon, params) {
        let totalDist = 0;
        let turns = 0;
        for (let i = 1; i < path.length; i++) {
            totalDist += dist(path[i - 1], path[i]);
            // 检测方向变化（转弯）
            if (i >= 2) {
                const dx1 = path[i - 1].x - path[i - 2].x;
                const dy1 = path[i - 1].y - path[i - 2].y;
                const dx2 = path[i].x - path[i - 1].x;
                const dy2 = path[i].y - path[i - 1].y;
                const dot = dx1 * dx2 + dy1 * dy2;
                const m1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                const m2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                if (m1 > 0.1 && m2 > 0.1) {
                    const cos = dot / (m1 * m2);
                    if (cos < 0.7) turns++;
                }
            }
        }

        const area = Math.abs(polygonArea(polygon));
        const speed = params.flightSpeed || 5;
        const tankCap = params.tankCapacity || 16;
        const sprayRate = params.sprayRate || 1.5;
        const flightTime = totalDist / speed;
        const refills = Math.ceil((totalDist / 1000 * sprayRate * 60) / tankCap); // 粗算

        return {
            path,
            stats: {
                area: (area / 10000).toFixed(2),    // 亩（1亩≈666.7m²）
                distance: (totalDist / 1000).toFixed(2),  // km
                time: formatTime(flightTime),
                turns,
                refills: Math.max(0, refills),
                points: path.length,
            }
        };
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m > 0 ? m + '分' + s + '秒' : s + '秒';
    }

    return { generatePath, decomposeConcave, boustrophedonPath, polygonArea };
})();

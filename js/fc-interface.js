/**
 * fc-interface.js - 飞控接口层
 * 支持 MAVLink WebSocket、DJI MSDK、自定义 WebSocket 协议
 * 将路径规划结果转换为真实无人机可执行的任务
 */
const FCInterface = (function () {
    'use strict';

    let ws = null;
    let connected = false;
    let protocol = 'mavlink';
    let missionData = null;
    const listeners = {};

    // ─── 事件系统 ─────────────────────────────────────────
    function on(event, fn) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(fn);
    }
    function emit(event, data) {
        (listeners[event] || []).forEach(fn => fn(data));
    }

    // ─── 连接 ────────────────────────────────────────────
    function connect(url, proto) {
        disconnect();
        protocol = proto || 'mavlink';

        if (!url) {
            emit('status', { connected: false, error: '请输入连接地址' });
            return;
        }

        try {
            ws = new WebSocket(url);
            emit('status', { connected: false, message: '连接中...' });

            ws.onopen = function () {
                connected = true;
                emit('status', { connected: true, message: '已连接' });
            };

            ws.onmessage = function (e) {
                try {
                    const msg = JSON.parse(e.data);
                    emit('message', msg);
                } catch (_) {
                    emit('raw', e.data);
                }
            };

            ws.onerror = function () {
                connected = false;
                emit('status', { connected: false, error: '连接失败' });
            };

            ws.onclose = function () {
                connected = false;
                emit('status', { connected: false, message: '已断开' });
            };
        } catch (e) {
            emit('status', { connected: false, error: e.message });
        }
    }

    function disconnect() {
        if (ws) {
            ws.close();
            ws = null;
        }
        connected = false;
        emit('status', { connected: false, message: '未连接' });
    }

    function isConnected() { return connected; }

    // ─── 上传任务 ────────────────────────────────────────
    function uploadMission(pathPoints, params) {
        if (!missionData) return false;

        const waypoints = buildWaypoints(missionData.path, params);

        if (connected && ws) {
            const msg = {
                type: 'MISSION_UPLOAD',
                protocol: protocol,
                waypoints: waypoints,
                total: waypoints.length,
            };
            ws.send(JSON.stringify(msg));
            emit('status', { connected: true, message: '任务已上传 (' + waypoints.length + ' 个航点)' });
            return true;
        }
        emit('status', { connected: false, error: '未连接，无法上传' });
        return false;
    }

    // ─── 构建航点 ────────────────────────────────────────
    function buildWaypoints(path, params) {
        const height = (params && params.flightHeight) || 3;
        const speed = (params && params.flightSpeed) || 5;
        const waypoints = [];

        // 起始点（起飞）
        waypoints.push({
            index: 0,
            command: 22, // MAV_CMD_NAV_TAKEOFF
            lat: 0, lng: 0, alt: height,
            param1: 0, param2: 0, param3: 0, param4: 0,
            autocontinue: true,
        });

        // 作业航点
        for (let i = 0; i < path.length; i++) {
            const p = path[i];
            waypoints.push({
                index: i + 1,
                command: 16, // MAV_CMD_NAV_WAYPOINT
                x: p.x, y: p.y, alt: height,
                param1: 0,     // 保持时间
                param2: speed, // 接受半径
                param3: 0,     // 通过航向
                param4: 1,     // 1=喷洒
                autocontinue: true,
            });
        }

        // 返航
        waypoints.push({
            index: path.length + 1,
            command: 20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
            lat: 0, lng: 0, alt: height,
            param1: 0, param2: 0, param3: 0, param4: 0,
            autocontinue: true,
        });

        // 降落
        waypoints.push({
            index: path.length + 2,
            command: 21, // MAV_CMD_NAV_LAND
            lat: 0, lng: 0, alt: 0,
            param1: 0, param2: 0, param3: 0, param4: 0,
            autocontinue: false,
        });

        return waypoints;
    }

    // ─── 设置任务数据 ────────────────────────────────────
    function setMission(data) {
        missionData = data;
    }

    // ─── 导出 QGroundControl .mission 格式 ───────────────
    function exportQGC(path, params) {
        const waypoints = buildWaypoints(path, params);
        const lines = [
            'QGC WPL 110',
        ];
        for (const wp of waypoints) {
            lines.push([
                wp.index, wp.current || 0, wp.frame || 0, wp.command,
                (wp.param1 || 0).toFixed(2),
                (wp.param2 || 0).toFixed(2),
                (wp.param3 || 0).toFixed(2),
                (wp.param4 || 0).toFixed(2),
                (wp.x || 0).toFixed(8),
                (wp.y || 0).toFixed(8),
                (wp.alt || 0).toFixed(2),
                wp.autocontinue ? 1 : 0,
            ].join('\t'));
        }
        return lines.join('\n');
    }

    // ─── 导出 JSON ───────────────────────────────────────
    function exportJSON(path, params) {
        const waypoints = buildWaypoints(path, params);
        return JSON.stringify({
            fileType: 'Plan',
            groundStation: 'QGroundControl',
            version: 1,
            mission: {
                items: waypoints.map(wp => ({
                    type: 'MissionItem',
                    command: wp.command,
                    params: [wp.param1, wp.param2, wp.param3, wp.param4],
                    coordinate: [wp.x, wp.y],
                    alt: wp.alt,
                    autoContinue: wp.autocontinue,
                })),
            },
            // 飞行边界
            fence: {
                type: 'Inclusion',
                points: path,
            },
        }, null, 2);
    }

    // ─── MAVLink 封装 ────────────────────────────────────
    function buildMAVLinkMissionItem(wp) {
        // MAVLink MISSION_ITEM_INT 封装（简化版）
        // 实际使用时需要接入 mavlink.js 库
        const target_system = 1;
        const target_component = 1;
        const seq = wp.index;
        const frame = 0; // MAV_FRAME_GLOBAL_RELATIVE_ALT
        return { target_system, target_component, seq, frame, command: wp.command, ...wp };
    }

    function sendMAVLinkHeartbeat() {
        if (!connected || !ws) return;
        const hb = {
            type: 'MAVLINK',
            msg_name: 'HEARTBEAT',
            target_system: 1,
            target_component: 1,
            data: { type: 6, autopilot: 3, base_mode: 0, custom_mode: 0, system_status: 4 },
        };
        ws.send(JSON.stringify(hb));
    }

    function requestMissionAck() {
        if (!connected || !ws) return;
        const req = {
            type: 'MAVLINK',
            msg_name: 'MISSION_REQUEST_LIST',
            target_system: 1,
            target_component: 1,
        };
        ws.send(JSON.stringify(req));
    }

    return {
        connect, disconnect, isConnected,
        on, off: function (event) { delete listeners[event]; },
        uploadMission, setMission,
        exportQGC, exportJSON,
        buildWaypoints, buildMAVLinkMissionItem,
        sendMAVLinkHeartbeat, requestMissionAck,
    };
})();

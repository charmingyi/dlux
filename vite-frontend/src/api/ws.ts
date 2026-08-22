import axios from "axios";

/**
 * 面板推送 WebSocket 单例。
 * 消息格式: { id: nodeId, type: 'status'|'latency'|'info'|'probes', data }
 *  - status: 1上线 / 0离线
 *  - latency: 面板到节点延迟(ms)
 *  - info: 节点系统信息(cpu/内存/流量/uptime)
 *  - probes: 探测延迟结果
 */

export interface PanelWsMessage {
  id?: number;
  type: string;
  data: any;
}

type Handler = (msg: PanelWsMessage) => void;

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
const handlers = new Set<Handler>();

const buildUrl = (): string => {
  const baseUrl =
    axios.defaults.baseURL ||
    (import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api/v1/` : "/api/v1/");
  return (
    baseUrl.replace(/^http/, "ws").replace(/\/api\/v1\/$/, "") +
    `/relay/ws?type=0&secret=${localStorage.getItem("token") ?? ""}`
  );
};

const connect = () => {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    ws = new WebSocket(buildUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectAttempt = 0;
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as PanelWsMessage;
      handlers.forEach((h) => h(msg));
    } catch {
      // 忽略无法解析的消息
    }
  };
  ws.onclose = () => {
    ws = null;
    if (handlers.size > 0) scheduleReconnect();
  };
};

const scheduleReconnect = () => {
  if (reconnectTimer != null) return;
  reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000 * reconnectAttempt);
};

/** 订阅面板推送, 返回取消订阅函数 */
export const subscribePanelWs = (handler: Handler): (() => void) => {
  handlers.add(handler);
  if (!ws) {
    reconnectAttempt = 0;
    connect();
  }
  return () => {
    handlers.delete(handler);
  };
};

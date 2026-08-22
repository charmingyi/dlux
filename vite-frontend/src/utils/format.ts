/** 流量格式化: B/KB/MB/GB/TB */
export const formatBytes = (bytes?: number | null, digits = 1): string => {
  const v = Number(bytes);
  if (!v || v <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(v) / Math.log(1024)), units.length - 1);
  const val = v / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : val >= 100 ? 0 : digits)} ${units[i]}`;
};

/** 速率格式化: B/s -> KB/s ... */
export const formatSpeed = (bytesPerSec?: number | null): string => {
  const v = Number(bytesPerSec);
  if (!v || v <= 0) return "0 B/s";
  return `${formatBytes(v)}/s`;
};

/** 毫秒时间戳 -> 本地时间字符串 */
export const formatTime = (ts?: number | null): string => {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 相对时间: x分钟前 */
export const formatRelative = (ts?: number | null): string => {
  if (!ts) return "-";
  const diff = Date.now() - ts;
  if (diff < 0) return formatTime(ts);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return formatTime(ts);
};

/** 秒 -> 时长 1d2h3m / 2h3m / 3m20s */
export const formatUptime = (seconds?: number | null): string => {
  const s = Math.floor(Number(seconds) || 0);
  if (s <= 0) return "-";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天${h}时`;
  if (h > 0) return `${h}时${m}分`;
  return `${m}分${s % 60}秒`;
};

/** 延迟 ms 显示 */
export const formatLatency = (ms?: number | null): string => {
  if (ms == null || ms < 0) return "-";
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`;
};

/** 延迟对应色调 */
export const latencyTone = (ms?: number | null): "success" | "warning" | "danger" | "neutral" => {
  if (ms == null || ms < 0) return "neutral";
  if (ms < 120) return "success";
  if (ms < 300) return "warning";
  return "danger";
};

/** 秒 -> 30s/5m/1h 文本(用于 failTimeout 等) */
export const formatDurationText = (text?: string | null): string => text || "-";

/** 策略显示名 */
export const strategyLabel: Record<string, string> = {
  round: "轮询",
  random: "随机",
  fifo: "顺序",
  hash: "哈希",
  latency: "最低延迟",
};

export const transportLabel: Record<string, string> = {
  wg: "WireGuard",
  tls: "TLS",
  tcp: "TCP",
};

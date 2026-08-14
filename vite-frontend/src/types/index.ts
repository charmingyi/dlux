import { SVGProps } from "react";

export type IconSvgProps = SVGProps<SVGSVGElement> & {
  size?: number;
};

// 节点
export interface Node {
  id: number;
  name: string;
  ip: string;
  serverIp: string;
  portSta: number;
  portEnd: number;
  version?: string;
  http?: number;
  tls?: number;
  socks?: number;
  status: number; // 1: 在线, 0: 离线
  latency?: number; // 面板到节点延迟(ms)
  createdTime?: number;
}

// WireGuard组网
export interface WgMember {
  id: number;
  nodeId: number;
  nodeName: string;
  nodeServerIp: string;
  nodeStatus: number;
  ip: string;
  hub: number;
  publicKey?: string;
  applied?: number;
  latencies?: Record<string, { key: string; addr: string; ms: number; up: boolean; ts: number }>;
}

export interface WgNetwork {
  id: number;
  name: string;
  subnet: string;
  mode: 'mesh' | 'hub';
  listenPort: number;
  mtu: number;
  status: number;
  createdTime: number;
  members: WgMember[];
}

export interface WgPeerRuntime {
  publicKey: string;
  endpoint: string;
  allowedIps: string[];
  latestHandshake: number;
  rxBytes: number;
  txBytes: number;
  persistentKeepalive: number;
}

export interface WgInterfaceRuntime {
  interface: string;
  exists: boolean;
  up: boolean;
  publicKey: string;
  listenPort: number;
  mtu: number;
  addresses: string[];
  peers: WgPeerRuntime[];
}

export interface WgMemberRuntime {
  memberId: number;
  nodeId: number;
  nodeName: string;
  overlayIp: string;
  hub: boolean;
  nodeOnline: boolean;
  ok: boolean;
  error?: string;
  runtime?: WgInterfaceRuntime;
}

export interface WgNetworkRuntime {
  networkId: number;
  mode: 'mesh' | 'hub';
  expectedMembers: number;
  timestamp: number;
  members: WgMemberRuntime[];
}

// 线路
export interface LinkItem {
  id: number;
  name: string;
  wgNetworkId?: number | null;
  wgNetworkName?: string;
  transport: 'wg' | 'tls' | 'tcp';
  entryNodeId: number;
  entryNodeName?: string;
  /** 入口节点在线状态 */
  entryNodeStatus?: number;
  /** 入口节点在该组网内的IP */
  entryWgIp?: string;
  exitNodeId: number;
  exitNodeName?: string;
  exitNodeStatus?: number;
  hopNodeIds?: string;
  hopNodeNames?: string;
  nodeCount?: number;
  status: number;
  createdTime?: number;
  latencies?: Record<string, { key: string; addr: string; ms: number; up: boolean; ts: number }>;
}

// 负载均衡组
export interface GroupItem {
  id: number;
  name: string;
  strategy: 'round' | 'random' | 'fifo' | 'hash' | 'latency';
  maxFails: number;
  failTimeout: string;
  status: number;
  linkCount: number;
  forwardCount: number;
  links: Array<{
    linkId: number;
    linkName: string;
    entryNodeId: number;
    exitNodeId: number;
    transport: string;
    weight: number;
  }>;
}

// 转发
export interface ForwardItem {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  groupStrategy: string;
  linkCount: number;
  inPort: number;
  remoteAddr: string;
  targetStrategy: string;
  speedId?: number | null;
  speedName?: string;
  interfaceName?: string;
  status: number;
  inFlow: number;
  outFlow: number;
  createdTime: number;
  updatedTime: number;
  entryNodeId: number;
  entryNodeName: string;
  entryNodeStatus: number;
  targetLatencies?: Array<{
    key: string;
    addr: string;
    ms: number;
    up: boolean;
    exitNodeId: number;
    linkId: number;
  }>;
}

// 限速规则
export interface SpeedLimit {
  id: number;
  name: string;
  speed: number; // Mbps
  status: number;
  createdTime?: number;
}

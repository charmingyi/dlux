import Network from './network';

// 登陆相关接口
export interface LoginData {
  username: string;
  password: string;
  captchaId: string;
}

export interface LoginResponse {
  token: string;
  role_id: number;
  name: string;
  requirePasswordChange?: boolean;
}

export const login = (data: LoginData) => Network.post<LoginResponse>("/user/login", data);

// 账号与概览
export const updatePassword = (data: any) => Network.post("/user/updatePassword", data);
export const getPanelOverview = () => Network.post("/user/overview");

// 节点CRUD操作 - 全部使用POST请求
export const createNode = (data: any) => Network.post("/node/create", data);
export const getNodeList = () => Network.post("/node/list");
export const updateNode = (data: any) => Network.post("/node/update", data);
export const deleteNode = (id: number) => Network.post("/node/delete", { id });
export const getNodeInstallCommand = (id: number) => Network.post("/node/install", { id });
export const updateNodeAgent = (id: number) => Network.post("/node/update-agent", { id });

// WireGuard组网
export const createWgNetwork = (data: any) => Network.post("/wg/create", data);
export const getWgNetworkList = () => Network.post("/wg/list");
export const updateWgNetwork = (data: any) => Network.post("/wg/update", data);
export const deleteWgNetwork = (id: number) => Network.post("/wg/delete", { id });
export const syncWgNetwork = (id: number) => Network.post("/wg/sync", { id });
export const getWgNetworkStatus = (id: number) => Network.post("/wg/status", { id });

// 线路CRUD
export const createLink = (data: any) => Network.post("/link/create", data);
export const getLinkList = () => Network.post("/link/list");
export const updateLink = (data: any) => Network.post("/link/update", data);
export const deleteLink = (id: number) => Network.post("/link/delete", { id });
export const redeployLink = (id: number) => Network.post("/link/redeploy", { id });

// 负载均衡组CRUD
export const createGroup = (data: any) => Network.post("/group/create", data);
export const getGroupList = () => Network.post("/group/list");
export const updateGroup = (data: any) => Network.post("/group/update", data);
export const deleteGroup = (id: number) => Network.post("/group/delete", { id });

// 转发CRUD操作
export const createForward = (data: any) => Network.post("/forward/create", data);
export const createForwardPlan = (data: any) => Network.post("/forward/create-plan", data);
export const quickCreateForward = (data: any) => Network.post("/forward/quick-create", data);
export const getForwardList = () => Network.post("/forward/list");
export const updateForward = (data: any) => Network.post("/forward/update", data);
export const deleteForward = (id: number) => Network.post("/forward/delete", { id });
export const forceDeleteForward = (id: number) => Network.post("/forward/force-delete", { id });
export const pauseForwardService = (forwardId: number) => Network.post("/forward/pause", { id: forwardId });
export const resumeForwardService = (forwardId: number) => Network.post("/forward/resume", { id: forwardId });
export const diagnoseForward = (forwardId: number) => Network.post("/forward/diagnose", { forwardId });
export const updateForwardOrder = (data: { forwards: Array<{ id: number; inx: number }> }) => Network.post("/forward/update-order", data);
export const cloneForward = (id: number) => Network.post("/forward/clone", { id });
export const batchForward = (action: "pause" | "resume" | "delete", ids: number[]) =>
  Network.post("/forward/batch", { action, ids });
export const exportForwards = () => Network.post("/forward/export");
export const importForwards = (forwards: any[], overwrite = false) =>
  Network.post("/forward/import", { forwards, overwrite });
export const redeployForward = (id: number) => Network.post("/forward/redeploy", { id });

// 限速规则CRUD
export const createSpeedLimit = (data: any) => Network.post("/speed-limit/create", data);
export const getSpeedLimitList = () => Network.post("/speed-limit/list");
export const updateSpeedLimit = (data: any) => Network.post("/speed-limit/update", data);
export const deleteSpeedLimit = (id: number) => Network.post("/speed-limit/delete", { id });

// 网站配置相关接口
export const getConfigs = () => Network.post("/config/list");
export const getConfigByName = (name: string) => Network.post("/config/get", { name });
export const updateConfigs = (configMap: Record<string, string>) => Network.post("/config/update", configMap);
export const updateConfig = (name: string, value: string) => Network.post("/config/update-single", { name, value });

// 验证码相关接口
export const checkCaptcha = () => Network.post("/captcha/check");
export const generateCaptcha = () => Network.post(`/captcha/generate`);
export const verifyCaptcha = (data: { captchaId: string; trackData: string }) => Network.post("/captcha/verify", data); 

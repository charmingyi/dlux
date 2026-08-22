import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { Button, Input, Select, Card, PageLoading, PageHeader, Switch } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { updateConfigs } from "@/api";
import { isAdmin } from "@/utils/auth";
import { getCachedConfigs, clearConfigCache, updateSiteConfig } from "@/config/site";

interface ConfigItem {
  key: string;
  label: string;
  placeholder?: string;
  description?: string;
  type: "input" | "switch" | "select";
  options?: { label: string; value: string; description?: string }[];
  dependsOn?: string;
  dependsValue?: string;
}

const CONFIG_ITEMS: ConfigItem[] = [
  {
    key: "ip",
    label: "面板后端地址",
    placeholder: "请输入面板后端IP:PORT",
    description:
      "格式 ip:port，用于节点 Agent 回连面板；ip 是面板服务器的公网 IP，端口是后端端口。不要套 CDN，通讯数据有加密",
    type: "input",
  },
  {
    key: "app_name",
    label: "应用名称",
    placeholder: "请输入应用名称",
    description: "在浏览器标签页和导航栏显示的应用名称",
    type: "input",
  },
  {
    key: "captcha_enabled",
    label: "启用验证码",
    description: "开启后，登录时需要完成滑块验证",
    type: "switch",
  },
  {
    key: "captcha_type",
    label: "验证码类型",
    description: "不同类型有不同的安全级别",
    type: "select",
    dependsOn: "captcha_enabled",
    dependsValue: "true",
    options: [
      { label: "随机类型", value: "RANDOM", description: "系统随机选择验证码类型" },
      { label: "滑块验证码", value: "SLIDER", description: "拖动滑块完成拼图验证" },
      { label: "文字点选验证码", value: "WORD_IMAGE_CLICK", description: "按顺序点击指定文字" },
      { label: "旋转验证码", value: "ROTATE", description: "旋转图片到正确角度" },
      { label: "拼图验证码", value: "CONCAT", description: "拖动滑块完成图片拼接" },
    ],
  },
];

const getInitialConfigs = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  const configKeys = ["app_name", "captcha_enabled", "captcha_type", "ip"];
  const initialConfigs: Record<string, string> = {};
  try {
    configKeys.forEach((key) => {
      const cachedValue = localStorage.getItem("vite_config_" + key);
      if (cachedValue) initialConfigs[key] = cachedValue;
    });
  } catch {
    // 忽略
  }
  return initialConfigs;
};

export default function ConfigPage() {
  const navigate = useNavigate();
  const initialConfigs = getInitialConfigs();
  const [configs, setConfigs] = useState<Record<string, string>>(initialConfigs);
  const [loading, setLoading] = useState(Object.keys(initialConfigs).length === 0);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalConfigs, setOriginalConfigs] = useState<Record<string, string>>(initialConfigs);

  useEffect(() => {
    if (!isAdmin()) {
      toast.error("权限不足，只有管理员可以访问此页面");
      navigate("/dashboard", { replace: true });
    }
  }, [navigate]);

  const loadConfigs = async (currentConfigs?: Record<string, string>) => {
    const configsToCompare = currentConfigs || configs;
    const hasInitialData = Object.keys(configsToCompare).length > 0;
    if (!hasInitialData) setLoading(true);
    try {
      const configData = await getCachedConfigs();
      if (JSON.stringify(configData) !== JSON.stringify(configsToCompare)) {
        setConfigs(configData);
        setOriginalConfigs({ ...configData });
        setHasChanges(false);
      }
    } catch {
      if (!hasInitialData) toast.error("加载配置出错，请重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => loadConfigs(initialConfigs), 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfigChange = (key: string, value: string) => {
    const newConfigs = { ...configs, [key]: value };
    if (key === "captcha_enabled" && value === "true" && !newConfigs.captcha_type) {
      newConfigs.captcha_type = "RANDOM";
    }
    setConfigs(newConfigs);
    const changed =
      Object.keys(newConfigs).some((k) => newConfigs[k] !== originalConfigs[k]) ||
      Object.keys(originalConfigs).some((k) => originalConfigs[k] !== newConfigs[k]);
    setHasChanges(changed);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await updateConfigs(configs);
      if (response.code === 0) {
        toast.success("配置保存成功");
        clearConfigCache();
        const changedKeys = Object.keys(configs).filter((key) => configs[key] !== originalConfigs[key]);
        setOriginalConfigs({ ...configs });
        setHasChanges(false);
        if (changedKeys.includes("app_name")) await updateSiteConfig();
        window.dispatchEvent(new CustomEvent("configUpdated", { detail: { changedKeys } }));
      } else {
        toast.error("保存配置失败: " + response.msg);
      }
    } catch {
      toast.error("保存配置出错，请重试");
    } finally {
      setSaving(false);
    }
  };

  const shouldShowItem = (item: ConfigItem) => {
    if (!item.dependsOn || !item.dependsValue) return true;
    return configs[item.dependsOn] === item.dependsValue;
  };

  if (loading) return <PageLoading label="加载配置中..." />;

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto">
      <PageHeader title="网站配置" description="管理面板的基本信息和显示设置">
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={!hasChanges}>
          <IconCheck size={14} /> {saving ? "保存中..." : "保存配置"}
        </Button>
      </PageHeader>

      <Card className="divide-y divide-line">
        {CONFIG_ITEMS.filter(shouldShowItem).map((item) => {
          const changed = configs[item.key] !== originalConfigs[item.key];
          return (
            <div key={item.key} className="px-5 py-4 lg:px-6 lg:py-5">
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 max-w-md">
                  <label className="text-[14px] font-medium text-fg flex items-center gap-2">
                    {item.label}
                    {changed && <span className="text-[10px] text-warning">已修改</span>}
                  </label>
                  {item.description && <p className="mt-1 text-xs text-faint leading-relaxed">{item.description}</p>}
                </div>
                <div className="shrink-0 w-64">
                  {item.type === "input" && (
                    <Input
                      value={configs[item.key] || ""}
                      onChange={(e) => handleConfigChange(item.key, e.target.value)}
                      placeholder={item.placeholder}
                      className={changed ? "border-warning" : ""}
                    />
                  )}
                  {item.type === "switch" && (
                    <div className="flex items-center justify-end gap-2.5 h-9.5">
                      <span className="text-xs text-faint">{configs[item.key] === "true" ? "已启用" : "已禁用"}</span>
                      <Switch
                        checked={configs[item.key] === "true"}
                        onChange={(checked) => handleConfigChange(item.key, checked ? "true" : "false")}
                      />
                    </div>
                  )}
                  {item.type === "select" && (
                    <Select
                      value={configs[item.key] || ""}
                      onChange={(e) => handleConfigChange(item.key, e.target.value)}
                    >
                      <option value="">请选择验证码类型</option>
                      {item.options?.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label} - {option.description}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </Card>

      {hasChanges && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
          <span className="h-2 w-2 rounded-full bg-warning animate-pulse" />
          检测到配置变更，请记得保存您的修改
        </div>
      )}
    </div>
  );
}

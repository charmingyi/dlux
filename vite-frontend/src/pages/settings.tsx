import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { Button, Input, Card, PageHeader, Badge } from "@/components/ui";
import { IconPlus, IconTrash, IconCheck } from "@/components/icons";
import { reinitializeBaseURL } from "@/api/network";
import {
  getPanelAddresses,
  savePanelAddress,
  setCurrentPanelAddress,
  deletePanelAddress,
  validatePanelAddress,
} from "@/utils/panel";

interface PanelAddress {
  name: string;
  address: string;
  inx: boolean;
}

export const SettingsPage = () => {
  const navigate = useNavigate();
  const [panelAddresses, setPanelAddresses] = useState<PanelAddress[]>([]);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");

  const setPanelAddressesFunc = (newAddr: PanelAddress[]) => {
    setPanelAddresses(newAddr);
  };

  const loadPanelAddresses = async () => {
    (window as any).setPanelAddresses = setPanelAddressesFunc;
    getPanelAddresses();
  };

  const addPanelAddress = async () => {
    if (!newName.trim() || !newAddress.trim()) {
      toast.error("请输入名称和地址");
      return;
    }
    if (!validatePanelAddress(newAddress.trim())) {
      toast.error("地址格式不正确，必须以 http:// 或 https:// 开头，示例：http://192.168.1.100:3000");
      return;
    }
    (window as any).setPanelAddresses = setPanelAddressesFunc;
    savePanelAddress(newName.trim(), newAddress.trim());
    setNewName("");
    setNewAddress("");
    toast.success("添加成功");
  };

  const setCurrentPanel = async (name: string) => {
    (window as any).setPanelAddresses = setPanelAddressesFunc;
    setCurrentPanelAddress(name);
    reinitializeBaseURL();
  };

  const handleDeletePanelAddress = async (name: string) => {
    (window as any).setPanelAddresses = setPanelAddressesFunc;
    deletePanelAddress(name);
    reinitializeBaseURL();
    toast.success("删除成功");
  };

  useEffect(() => {
    loadPanelAddresses();
  }, []);

  return (
    <div className="min-h-screen bg-bg p-4 max-w-lg mx-auto">
      <PageHeader title="面板地址" description="WebView 模式下管理面板连接地址" />

      <Card className="space-y-3">
        {panelAddresses.length === 0 && <div className="text-center text-faint py-6 text-xs">暂无面板地址</div>}
        {panelAddresses.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-3 bg-surface-2 rounded-xl px-3.5 h-12"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-fg truncate">{item.name}</span>
                {item.inx && (
                  <Badge tone="success">
                    <IconCheck size={10} /> 当前
                  </Badge>
                )}
              </div>
              <div className="text-[11px] text-faint font-mono truncate">{item.address}</div>
            </div>
            {!item.inx && (
              <Button size="xs" onClick={() => setCurrentPanel(item.name)}>
                使用
              </Button>
            )}
            <Button size="xs" variant="danger" onClick={() => handleDeletePanelAddress(item.name)}>
              <IconTrash size={12} />
            </Button>
          </div>
        ))}
      </Card>

      <Card className="mt-4 space-y-3">
        <div className="text-[13px] font-medium text-fg">添加面板地址</div>
        <Input placeholder="名称" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Input
          placeholder="http://ip:port"
          value={newAddress}
          onChange={(e) => setNewAddress(e.target.value)}
          mono
        />
        <Button variant="primary" onClick={addPanelAddress} className="w-full">
          <IconPlus size={14} /> 添加
        </Button>
      </Card>

      <div className="mt-4 text-center">
        <Button
          onClick={() => {
            reinitializeBaseURL();
            navigate("/dashboard");
          }}
        >
          返回
        </Button>
      </div>
    </div>
  );
};

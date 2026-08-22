import { Button, Input } from "@/components/ui";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import axios from "axios";
import { isWebViewFunc } from "@/utils/panel";
import { siteConfig } from "@/config/site";
import DefaultLayout from "@/layouts/default";
import { login, LoginData, checkCaptcha } from "@/api";
import "@/utils/tac.css";
import "@/utils/tac.min.js";
import bgImage from "@/images/bg.jpg";

interface LoginForm {
  username: string;
  password: string;
  captchaId: string;
}

interface CaptchaConfig {
  requestCaptchaDataUrl: string;
  validCaptchaUrl: string;
  bindEl: string;
  validSuccess: (res: any, captcha: any, tac: any) => void;
  validFail?: (res: any, captcha: any, tac: any) => void;
  btnCloseFun?: (event: any, tac: any) => void;
  btnRefreshFun?: (event: any, tac: any) => void;
}

interface CaptchaStyle {
  btnUrl?: string;
  bgUrl?: string;
  logoUrl?: string | null;
  moveTrackMaskBgColor?: string;
  moveTrackMaskBorderColor?: string;
}

export default function IndexPage() {
  const [form, setForm] = useState<LoginForm>({
    username: "",
    password: "",
    captchaId: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<LoginForm>>({});
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const tacInstanceRef = useRef<any>(null);
  const captchaContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (tacInstanceRef.current) {
        tacInstanceRef.current.destroyWindow();
        tacInstanceRef.current = null;
      }
    };
  }, []);

  const validateForm = (): boolean => {
    const newErrors: Partial<LoginForm> = {};
    if (!form.username.trim()) newErrors.username = "请输入用户名";
    if (!form.password.trim()) {
      newErrors.password = "请输入密码";
    } else if (form.password.length < 6) {
      newErrors.password = "密码长度至少6位";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const initCaptcha = async () => {
    if (!(window as any).TAC || !captchaContainerRef.current) return;

    try {
      if (tacInstanceRef.current) {
        tacInstanceRef.current.destroyWindow();
        tacInstanceRef.current = null;
      }

      const baseURL =
        axios.defaults.baseURL ||
        (import.meta.env.VITE_API_BASE ? `${import.meta.env.VITE_API_BASE}/api/v1/` : "/api/v1/");

      const config: CaptchaConfig = {
        requestCaptchaDataUrl: `${baseURL}captcha/generate`,
        validCaptchaUrl: `${baseURL}captcha/verify`,
        bindEl: "#captcha-container",
        validSuccess: (res: any, _: any, tac: any) => {
          form.captchaId = res.data.validToken;
          setShowCaptcha(false);
          tac.destroyWindow();
          performLogin();
        },
        validFail: (_: any, _captcha: any, tac: any) => {
          tac.reloadCaptcha();
        },
        btnCloseFun: (_event: any, tac: any) => {
          setShowCaptcha(false);
          tac.destroyWindow();
          setLoading(false);
        },
        btnRefreshFun: (_event: any, tac: any) => {
          tac.reloadCaptcha();
        },
      };

      const isDarkMode =
        document.documentElement.classList.contains("dark") ||
        document.documentElement.getAttribute("data-theme") === "dark" ||
        window.matchMedia("(prefers-color-scheme: dark)").matches;

      const trackColor = isDarkMode ? "#4a5568" : "#7db0be";

      const style: CaptchaStyle = {
        bgUrl: bgImage,
        logoUrl: null,
        moveTrackMaskBgColor: trackColor,
        moveTrackMaskBorderColor: trackColor,
      };

      tacInstanceRef.current = new (window as any).TAC(config, style);
      tacInstanceRef.current.init();
    } catch (error) {
      toast.error("验证码初始化失败，请刷新页面重试");
      setShowCaptcha(false);
      setLoading(false);
    }
  };

  const performLogin = async () => {
    try {
      const loginData: LoginData = {
        username: form.username.trim(),
        password: form.password,
        captchaId: form.captchaId,
      };
      const response = await login(loginData);

      if (response.code !== 0) {
        toast.error(response.msg || "登录失败");
        return;
      }

      localStorage.setItem("token", response.data.token);
      localStorage.setItem("role_id", response.data.role_id.toString());
      localStorage.setItem("name", response.data.name);
      localStorage.setItem("admin", (response.data.role_id === 0).toString());

      if (response.data.requirePasswordChange) {
        toast.success("检测到默认密码，即将跳转到修改密码页面");
        navigate("/change-password");
        return;
      }

      toast.success("登录成功");
      navigate("/dashboard");
    } catch (error) {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!validateForm()) return;
    setLoading(true);

    try {
      const checkResponse = await checkCaptcha();
      if (checkResponse.code !== 0) {
        toast.error("检查验证码状态失败，请重试 " + checkResponse.msg);
        setLoading(false);
        return;
      }

      if (checkResponse.data === 0) {
        await performLogin();
      } else {
        setShowCaptcha(true);
        setTimeout(() => {
          initCaptcha();
        }, 100);
      }
    } catch (error) {
      toast.error("网络错误，请稍后重试");
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !loading) handleLogin();
  };

  return (
    <DefaultLayout>
      <section className="relative flex flex-col items-center justify-center gap-4 py-10 min-h-screen px-4">
        {/* 背景装饰 */}
        <div aria-hidden className="fixed inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-20 blur-3xl"
            style={{ background: "var(--accent)" }}
          />
          <div
            className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-15 blur-3xl"
            style={{ background: "#8b5cf6" }}
          />
        </div>

        <div className="relative w-full max-w-sm">
          <div className="flex flex-col items-center mb-6">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-white font-bold text-2xl shadow-pop"
              style={{ background: "linear-gradient(135deg, var(--accent), #8b5cf6)" }}
            >
              D
            </div>
            <h1 className="mt-4 text-xl font-bold text-fg">{siteConfig.name}</h1>
            <p className="mt-1 text-[13px] text-muted">中转转发管理面板</p>
          </div>

          <div className="bg-surface border border-line rounded-2xl shadow-card p-6">
            <div className="flex flex-col gap-4">
              <Input
                label="用户名"
                placeholder="请输入用户名"
                value={form.username}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, username: e.target.value }));
                  if (errors.username) setErrors((prev) => ({ ...prev, username: undefined }));
                }}
                onKeyDown={handleKeyPress}
                disabled={loading}
                error={errors.username}
                autoComplete="username"
              />

              <div className="relative">
                <Input
                  label="密码"
                  placeholder="请输入密码"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => {
                    setForm((prev) => ({ ...prev, password: e.target.value }));
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  onKeyDown={handleKeyPress}
                  disabled={loading}
                  error={errors.password}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-[34px] text-faint hover:text-muted transition-colors"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <path d="m2 2 20 20" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>

              <Button
                variant="primary"
                size="md"
                className="w-full mt-1"
                onClick={handleLogin}
                loading={loading}
                disabled={loading}
              >
                {loading ? (showCaptcha ? "验证中..." : "登录中...") : "登 录"}
              </Button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-faint">
            dlux relay panel · v{isWebViewFunc() ? siteConfig.app_version : siteConfig.version}
          </p>
        </div>

        {/* 验证码弹层 */}
        {showCaptcha && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="mb-4 relative">
              <div
                id="captcha-container"
                ref={captchaContainerRef}
                className="w-full flex justify-center"
                style={{
                  filter: document.documentElement.classList.contains("dark") ? "brightness(0.8) contrast(0.9)" : "none",
                }}
              />
            </div>
          </div>
        )}
      </section>
    </DefaultLayout>
  );
}

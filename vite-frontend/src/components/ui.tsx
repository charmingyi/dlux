import * as React from "react";
import ReactDOM from "react-dom";
import clsx from "clsx";
import { IconX, IconCopy, IconCheck, IconAlert } from "@/components/icons";

/* ============================ Button ============================ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "xs" | "sm" | "md";

const btnVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover border border-transparent shadow-sm",
  secondary:
    "bg-surface text-fg border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "bg-transparent text-muted hover:text-fg hover:bg-surface-2 border border-transparent",
  danger: "bg-danger text-white hover:opacity-90 border border-transparent shadow-sm",
  success: "bg-success text-white hover:opacity-90 border border-transparent shadow-sm",
};

const btnSizes: Record<ButtonSize, string> = {
  xs: "h-7 px-2 text-xs rounded-md gap-1",
  sm: "h-8 px-3 text-[13px] rounded-lg gap-1.5",
  md: "h-9.5 px-4 text-sm rounded-lg gap-2",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "secondary",
  size = "sm",
  loading = false,
  className,
  children,
  disabled,
  ...props
}) => (
  <button
    className={clsx(
      "inline-flex items-center justify-center font-medium transition-colors select-none",
      "disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
      btnVariants[variant],
      btnSizes[size],
      className
    )}
    disabled={disabled || loading}
    {...props}
  >
    {loading && <Spinner size={size === "md" ? 14 : 12} className="mr-1" />}
    {children}
  </button>
);

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  title?: string;
}

export const IconButton: React.FC<IconButtonProps> = ({
  variant = "ghost",
  size = "sm",
  className,
  children,
  ...props
}) => (
  <button
    className={clsx(
      "inline-flex items-center justify-center transition-colors select-none",
      "disabled:opacity-50 disabled:pointer-events-none",
      variant === "ghost" ? "text-muted hover:text-fg hover:bg-surface-2" : btnVariants[variant],
      size === "xs" ? "h-7 w-7 rounded-md" : "h-8 w-8 rounded-lg",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

/* ============================ Spinner ============================ */

export const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
  <svg
    className={clsx("animate-spin", className)}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-label="加载中"
  >
    <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
    <path
      className="opacity-90"
      d="M12 2a10 10 0 0 1 10 10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
    />
  </svg>
);

export const PageLoading: React.FC<{ label?: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center gap-3 py-24 text-faint">
    <Spinner size={26} />
    <span className="text-xs">{label ?? "加载中..."}</span>
  </div>
);

/* ============================ Input ============================ */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  mono?: boolean;
}

export const Input: React.FC<InputProps> = ({ label, error, hint, mono, className, id, ...props }) => {
  const inputId = id ?? (label ? `inp-${label}` : undefined);
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={clsx(
          "w-full h-9.5 px-3 text-sm rounded-lg bg-surface border transition-colors",
          "placeholder:text-faint",
          mono && "font-mono tnum",
          error
            ? "border-danger focus:border-danger"
            : "border-line focus:border-accent hover:border-line-strong",
          "outline-none",
          className
        )}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {!error && hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
};

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Textarea: React.FC<TextareaProps> = ({ label, error, hint, className, ...props }) => (
  <div className="w-full">
    {label && <label className="mb-1.5 block text-[13px] font-medium text-fg">{label}</label>}
    <textarea
      className={clsx(
        "w-full px-3 py-2 text-sm rounded-lg bg-surface border transition-colors min-h-20",
        "placeholder:text-faint outline-none font-mono",
        error ? "border-danger" : "border-line focus:border-accent hover:border-line-strong",
        className
      )}
      {...props}
    />
    {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    {!error && hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
  </div>
);

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}

export const Select: React.FC<SelectProps> = ({ label, error, className, children, id, ...props }) => {
  const selectId = id ?? (label ? `sel-${label}` : undefined);
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="mb-1.5 block text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={clsx(
            "w-full h-9.5 pl-3 pr-8 text-sm rounded-lg bg-surface border",
            "outline-none appearance-none cursor-pointer",
            error ? "border-danger focus:border-danger" : "border-line hover:border-line-strong focus:border-accent",
            className
          )}
          {...props}
        >
          {children}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
};

/* ============================ Switch / Checkbox ============================ */

export const Switch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
}> = ({ checked, onChange, disabled, size = "md" }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      "relative inline-flex shrink-0 items-center rounded-full transition-colors",
      "disabled:opacity-50 disabled:pointer-events-none",
      size === "sm" ? "h-4.5 w-8" : "h-5.5 w-10",
      checked ? "bg-accent" : "bg-line-strong"
    )}
  >
    <span
      className={clsx(
        "absolute left-0.5 rounded-full bg-white shadow transition-transform",
        size === "sm" ? "h-3.5 w-3.5" : "h-4.5 w-4.5",
        checked && (size === "sm" ? "translate-x-3.5" : "translate-x-4.5")
      )}
    />
  </button>
);

export const Checkbox: React.FC<{
  checked: boolean | "indeterminate";
  onChange: (v: boolean) => void;
  className?: string;
}> = ({ checked, onChange, className }) => (
  <button
    type="button"
    role="checkbox"
    aria-checked={checked === "indeterminate" ? "mixed" : checked}
    onClick={() => onChange(checked !== true)}
    className={clsx(
      "inline-flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors",
      checked ? "bg-accent border-accent text-white" : "border-line-strong hover:border-accent bg-surface",
      className
    )}
  >
    {checked === "indeterminate" ? (
      <span className="h-0.5 w-2 rounded bg-white" />
    ) : checked ? (
      <IconCheck size={11} strokeWidth={3} />
    ) : null}
  </button>
);

/* ============================ Badge / Status ============================ */

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const toneClasses: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutral: "bg-surface-3 text-muted",
  accent: "bg-accent-soft text-accent",
};

export const Badge: React.FC<{
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = "neutral", className, children }) => (
  <span
    className={clsx(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium leading-4 whitespace-nowrap",
      toneClasses[tone],
      className
    )}
  >
    {children}
  </span>
);

export const StatusDot: React.FC<{ tone: Tone; pulse?: boolean; className?: string }> = ({
  tone,
  pulse,
  className,
}) => (
  <span className={clsx("relative inline-flex h-2 w-2 shrink-0", className)}>
    {pulse && (
      <span
        className={clsx("absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping", toneDot[tone])}
      />
    )}
    <span className={clsx("relative inline-flex h-2 w-2 rounded-full", toneDot[tone])} />
  </span>
);

const toneDot: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-faint",
  accent: "bg-accent",
};

export const OnlineBadge: React.FC<{ online?: boolean | number }> = ({ online }) => (
  <Badge tone={online === 1 || online === true ? "success" : "danger"}>
    <StatusDot tone={online === 1 || online === true ? "success" : "danger"} />
    {online === 1 || online === true ? "在线" : "离线"}
  </Badge>
);

/* ============================ Card ============================ */

export const Card: React.FC<{
  className?: string;
  padded?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}> = ({ className, padded = true, children, onClick }) => (
  <div
    onClick={onClick}
    className={clsx(
      "bg-surface border border-line rounded-xl shadow-card",
      padded && "p-4 lg:p-5",
      className
    )}
  >
    {children}
  </div>
);

export const CardTitle: React.FC<{
  title: React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}> = ({ title, extra, className }) => (
  <div className={clsx("flex items-center justify-between mb-4", className)}>
    <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
    {extra}
  </div>
);

/* ============================ Modal ============================ */

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}> = ({ open, onClose, title, children, footer, width = "max-w-lg" }) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-[2px] animate-fade-in"
        onClick={onClose}
      />
      <div
        className={clsx(
          "relative z-10 w-full my-auto bg-surface border border-line rounded-2xl shadow-pop animate-scale-in",
          width
        )}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h2 className="text-base font-semibold text-fg">{title}</h2>
            <IconButton size="xs" onClick={onClose} aria-label="关闭">
              <IconX size={15} />
            </IconButton>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">{footer}</div>}
      </div>
    </div>
  );
};

export const ConfirmModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: React.ReactNode;
  danger?: boolean;
  loading?: boolean;
  confirmText?: string;
}> = ({ open, onClose, onConfirm, title = "确认操作", message, danger = true, loading, confirmText = "确认" }) => (
  <Modal
    open={open}
    onClose={onClose}
    title={title}
    width="max-w-sm"
    footer={
      <>
        <Button onClick={onClose} disabled={loading}>
          取消
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {confirmText}
        </Button>
      </>
    }
  >
    <div className="flex items-start gap-3">
      <div
        className={clsx(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          danger ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"
        )}
      >
        <IconAlert size={17} />
      </div>
      <div className="text-sm text-muted leading-relaxed pt-1.5">{message}</div>
    </div>
  </Modal>
);

/* ============================ Dropdown ============================ */

/**
 * 下拉菜单: 菜单通过 portal 渲染到 body 并使用 fixed 定位,
 * 避免被表格的 overflow-hidden / overflow-x-auto 容器裁剪。
 */
export const Dropdown: React.FC<{
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: string;
}> = ({ trigger, children, align = "right", width = "w-44" }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);

  const openMenu = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    // 预估菜单宽度(w-44=176), 打开后按真实尺寸再校正
    const estW = 176;
    let left = align === "right" ? rect.right - estW : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - estW - 8));
    let top = rect.bottom + 6;
    if (top > window.innerHeight - 160) {
      // 靠近底部时向上弹出
      top = Math.max(8, rect.top - 170);
    }
    setPos({ top, left });
    setOpen(true);
  };

  // 打开后按菜单真实宽度校正水平位置
  React.useEffect(() => {
    if (!open || !pos || !menuRef.current) return;
    const mw = menuRef.current.offsetWidth;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    let left = align === "right" ? rect.right - mw : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    setPos({ top: pos.top, left });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
      >
        {trigger}
      </div>
      {open &&
        pos &&
        ReactDOM.createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              ref={menuRef}
              className={clsx("fixed z-50 py-1 bg-surface border border-line rounded-xl shadow-pop animate-scale-in", width)}
              style={{ top: pos.top, left: pos.left }}
              onClick={() => setOpen(false)}
            >
              {children}
            </div>
          </>,
          document.body
        )}
    </div>
  );
};

export const DropdownItem: React.FC<{
  onClick?: (e: React.MouseEvent) => void;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, danger, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      "w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors",
      "disabled:opacity-50 disabled:pointer-events-none",
      danger ? "text-danger hover:bg-danger-soft" : "text-fg hover:bg-surface-2"
    )}
  >
    {children}
  </button>
);

export const DropdownDivider: React.FC = () => <div className="my-1 h-px bg-line" />;

/* ============================ SegmentedControl ============================ */

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode }>;
  size?: "xs" | "sm";
}) {
  return (
    <div className="inline-flex items-center p-0.5 bg-surface-2 border border-line rounded-lg gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={clsx(
            "rounded-md font-medium transition-colors whitespace-nowrap",
            size === "xs" ? "px-2 h-6 text-[11px]" : "px-2.5 h-7 text-xs",
            value === opt.value
              ? "bg-surface text-fg shadow-sm border border-line"
              : "text-muted hover:text-fg"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ============================ Table ============================ */

export const TableWrap: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div className={clsx("w-full overflow-x-auto", className)}>
    <table className="w-full text-sm border-collapse">{children}</table>
  </div>
);

export const Th: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className, children }) => (
  <th
    className={clsx(
      "px-3 py-2.5 text-left text-xs font-medium text-faint border-b border-line whitespace-nowrap bg-surface-2/60",
      className
    )}
  >
    {children}
  </th>
);

export const Td: React.FC<{ className?: string; colSpan?: number; children?: React.ReactNode }> = ({
  className,
  colSpan,
  children,
}) => (
  <td colSpan={colSpan} className={clsx("px-3 py-3 border-b border-line/60 align-middle", className)}>
    {children}
  </td>
);

/* ============================ Empty ============================ */

export const EmptyState: React.FC<{
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title = "暂无数据", description, action, icon }) => (
  <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-faint">
      {icon ?? (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
    <p className="text-sm font-medium text-fg">{title}</p>
    {description && <p className="text-xs text-faint max-w-xs leading-relaxed">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);

/* ============================ CopyButton ============================ */

export const CopyButton: React.FC<{ text: string; className?: string; label?: string }> = ({
  text,
  className,
  label,
}) => {
  const [copied, setCopied] = React.useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      title="复制"
      className={clsx(
        "inline-flex items-center gap-1 text-xs text-muted hover:text-accent transition-colors",
        className
      )}
    >
      {copied ? <IconCheck size={13} className="text-success" /> : <IconCopy size={13} />}
      {label && <span>{copied ? "已复制" : label}</span>}
    </button>
  );
};

/* ============================ PageHeader ============================ */

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  children?: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
    <div>
      <h1 className="text-xl font-bold text-fg">{title}</h1>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
    </div>
    {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
  </div>
);

/* ============================ KV / Meta ============================ */

export const MetaItem: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <div className={clsx("min-w-0", className)}>
    <div className="text-[11px] text-faint mb-0.5">{label}</div>
    <div className="text-[13px] text-fg truncate">{children}</div>
  </div>
);

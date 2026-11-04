import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/** 实际生效的主题 */
export type Theme = "light" | "dark";
/** 用户偏好：显式指定，或跟随系统 */
export type ThemePreference = Theme | "system";

export const THEME_STORAGE_KEY = "theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemTheme(): Theme | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // 隐私模式 / 配额 / 非浏览器环境：按「没有记忆」处理
  }
  return "system";
}

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // 让原生控件（滚动条 / 日期选择器 / 下拉箭头）与主题一致
  root.style.colorScheme = theme;
}

interface ThemeContextType {
  /** 已解析的实际主题（永远是 light / dark，不会是 system） */
  theme: Theme;
  /** 用户偏好，可能是 "system" */
  preference: ThemePreference;
  /** 当前是否跟随系统 */
  isSystem: boolean;
  setPreference: (preference: ThemePreference) => void;
  /** 在日间 / 暗夜之间切换（跟随系统时，以当前实际主题取反并转为显式偏好） */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  /** 无本地记忆且读不到系统偏好时的兜底主题 */
  defaultTheme?: Theme;
}

/**
 * 主题来源与优先级：
 *   1. localStorage 里用户显式选择过的 light / dark；
 *   2. 否则跟随操作系统（prefers-color-scheme），并持续监听其变化；
 *   3. 都读不到时用 defaultTheme。
 *
 * 首屏防闪白由 `client/index.html` 里的内联脚本负责（早于 React 挂载设置 .dark 类），
 * 本 Provider 只负责后续状态与切换，两者读取同一份 localStorage 键。
 */
export function ThemeProvider({ children, defaultTheme = "light" }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference());
  const [system, setSystem] = useState<Theme | null>(() => systemTheme());

  // 跟随系统时，实时响应系统主题切换
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    setSystem(mql.matches ? "dark" : "light");
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = preference === "system" ? system ?? defaultTheme : preference;

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // 写不进去只影响「记住选择」，不影响本次生效
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setPreference(theme === "light" ? "dark" : "light");
  }, [theme, setPreference]);

  const value = useMemo<ThemeContextType>(
    () => ({ theme, preference, isSystem: preference === "system", setPreference, toggleTheme }),
    [theme, preference, setPreference, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

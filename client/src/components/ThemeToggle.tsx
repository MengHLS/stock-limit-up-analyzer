import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * 日间 / 暗夜 主题切换按钮。
 *
 * 显示的是「点击后会切到的模式」：日间下显示月亮（点了进暗夜），暗夜下显示太阳。
 * 不带下拉菜单 —— 需求就是一个二态开关；若以后要「跟随系统」，用 useTheme().setPreference("system") 即可。
 */
export function ThemeToggle() {
  const { theme, isSystem, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label = isDark ? "切换到日间模式" : "切换到暗夜模式";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={isSystem ? `${label}（当前跟随系统）` : label}
      aria-label={label}
      aria-pressed={isDark}
      data-theme-toggle
      data-theme={theme}
      className="relative shrink-0"
    >
      <Sun
        className={`h-5 w-5 transition-all duration-300 ${
          isDark ? "rotate-0 scale-100" : "-rotate-90 scale-0"
        }`}
      />
      <Moon
        className={`absolute h-5 w-5 transition-all duration-300 ${
          isDark ? "rotate-90 scale-0" : "rotate-0 scale-100"
        }`}
      />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

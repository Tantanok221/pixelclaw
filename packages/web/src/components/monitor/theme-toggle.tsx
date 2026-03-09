import { Moon, Sun } from "lucide-react";
import { Button } from "../ui/button.js";
import type { MonitorTheme } from "../../hooks/use-monitor-theme.js";

interface ThemeToggleProps {
  theme: MonitorTheme;
  onToggle: () => void;
}

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 gap-2 px-2.5"
      onClick={onToggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="sr-only">{isDark ? "Switch to light mode" : "Switch to dark mode"}</span>
    </Button>
  );
}

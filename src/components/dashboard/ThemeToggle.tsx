import { Moon, Sun } from "lucide-react";
import { useThemeValue } from "./use-theme";

export function ThemeToggle() {
  const { isDark, toggle } = useThemeValue();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mode terang" : "Mode gelap"}
      className="grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

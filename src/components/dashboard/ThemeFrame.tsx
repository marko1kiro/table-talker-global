import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeContext, useTheme } from "./use-theme";

export function ThemeFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <div
        className={cn(
          "min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900 dark:bg-ta-gray-900 dark:text-ta-gray-100",
          theme.isDark && "dark",
        )}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

"use client";

import SwitchButton from "@/components/kokonutui/switch-button";
import { THEME_STORAGE_KEY } from "./theme-key";

/** Sun/moon button in the landlord and tenant top bars. Flips .dark on <html> and remembers the choice. */
export function ThemeToggle() {
  return (
    <SwitchButton
      size="lg"
      showLabel={false}
      aria-label="Dark theme"
      onThemeChange={(theme) => {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
          // Private mode or blocked storage: the switch still works for this visit.
        }
        // The button pins color-scheme inline; let globals.css decide it, so pages outside the apps stay light.
        document.documentElement.style.colorScheme = "";
      }}
    />
  );
}

import { createSignal, onCleanup, onMount } from "solid-js";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "weft.theme";

/** Is the OS currently in dark mode? (false when matchMedia is unavailable) */
function osPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * Apply a theme preference to the document and persist it. Mirrors the
 * inline THEME_INIT script in entry-server.tsx — keep the two in sync.
 */
export function applyTheme(pref: ThemePref) {
  try {
    if (pref === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage may be unavailable (private mode) — theme still applies.
  }
  const dark = pref === "dark" || (pref === "system" && osPrefersDark());
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function storedTheme(): ThemePref {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** Tri-state theme picker: follow the OS, or force light/dark. */
export default function ThemeToggle() {
  const [pref, setPref] = createSignal<ThemePref>("system");

  onMount(() => {
    setPref(storedTheme());
    // Track OS changes live while in system mode.
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (pref() === "system") applyTheme("system");
    };
    media.addEventListener("change", onChange);
    onCleanup(() => media.removeEventListener("change", onChange));
  });

  return (
    <select
      aria-label="Theme"
      class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      value={pref()}
      onChange={(e) => {
        const next = e.currentTarget.value as ThemePref;
        setPref(next);
        applyTheme(next);
      }}
    >
      <option value="system">System theme</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}

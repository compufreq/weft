import { render, screen, fireEvent } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ThemeToggle, { applyTheme, storedTheme } from "./ThemeToggle";

// This jsdom setup exposes no window.localStorage — give it an in-memory one.
const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  },
});

function mockMatchMedia(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  mockMatchMedia(false);
});

describe("applyTheme", () => {
  it("forces dark: adds the class, sets color-scheme, persists", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("weft.theme")).toBe("dark");
  });

  it("forces light even when the OS prefers dark", () => {
    mockMatchMedia(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem("weft.theme")).toBe("light");
  });

  it("system follows the OS and clears the stored preference", () => {
    window.localStorage.setItem("weft.theme", "dark");
    mockMatchMedia(true);
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("weft.theme")).toBeNull();

    mockMatchMedia(false);
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("storedTheme maps missing/garbage values to system", () => {
    expect(storedTheme()).toBe("system");
    window.localStorage.setItem("weft.theme", "purple");
    expect(storedTheme()).toBe("system");
    window.localStorage.setItem("weft.theme", "light");
    expect(storedTheme()).toBe("light");
  });
});

describe("ThemeToggle", () => {
  it("initializes from the stored preference", () => {
    window.localStorage.setItem("weft.theme", "dark");
    render(() => <ThemeToggle />);
    expect(screen.getByLabelText("Theme")).toHaveValue("dark");
  });

  it("switches theme on selection", () => {
    render(() => <ThemeToggle />);
    const select = screen.getByLabelText("Theme");
    expect(select).toHaveValue("system");
    fireEvent.change(select, { target: { value: "dark" } });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("weft.theme")).toBe("dark");
    fireEvent.change(select, { target: { value: "light" } });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("weft.theme")).toBe("light");
  });
});

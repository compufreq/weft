// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

/**
 * Runs before first paint (no FOUC): applies the stored theme preference,
 * falling back to the OS `prefers-color-scheme`. Mirrors applyTheme() in
 * components/ThemeToggle.tsx — keep the two in sync.
 */
const THEME_INIT = `(function () {
  try {
    var pref = localStorage.getItem("weft.theme");
    var dark =
      pref === "dark" ||
      (pref !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();`;

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en" class="h-full">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta
            name="description"
            content="Weft — the missing UI for Weaviate. Browse and manage self-hosted Weaviate instances."
          />
          <title>Weft</title>
          {/* eslint-disable-next-line solid/no-innerhtml -- THEME_INIT is a
              static compile-time constant, never user input */}
          <script innerHTML={THEME_INIT} />
          {assets}
        </head>
        <body class="h-full bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
          <div id="app" class="min-h-full">
            {children}
          </div>
          {scripts}
        </body>
      </html>
    )}
  />
));

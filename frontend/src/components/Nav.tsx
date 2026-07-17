import { A } from "@solidjs/router";
import LogoutButton from "./LogoutButton";
import ThemeToggle from "./ThemeToggle";

export default function Nav() {
  return (
    <header class="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <nav
        aria-label="Main"
        class="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6"
      >
        <A href="/" class="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden="true" class="text-weft-500">
            ◆
          </span>
          Weft
        </A>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">the missing UI for Weaviate</span>
        <span class="ml-auto flex items-center gap-3">
          <ThemeToggle />
          <LogoutButton />
        </span>
      </nav>
    </header>
  );
}

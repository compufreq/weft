import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js";
import Nav from "~/components/Nav";
import "./app.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <div class="flex min-h-screen flex-col">
          <Nav />
          <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
            <Suspense
              fallback={<p class="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
            >
              {props.children}
            </Suspense>
          </main>
        </div>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

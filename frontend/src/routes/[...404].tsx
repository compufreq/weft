import { A } from "@solidjs/router";
import { HttpStatusCode } from "@solidjs/start";

export default function NotFound() {
  return (
    <section class="py-16 text-center">
      <HttpStatusCode code={404} />
      <h1 class="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        The page you're looking for doesn't exist.
      </p>
      <A
        href="/"
        class="mt-6 inline-block rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700"
      >
        Back to instances
      </A>
    </section>
  );
}

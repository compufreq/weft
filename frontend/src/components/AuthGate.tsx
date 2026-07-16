import { createSignal, onMount, Show, type JSX } from "solid-js";

interface AuthStatus {
  auth_required: boolean;
  authorized: boolean;
  read_only: boolean;
}

/**
 * Client-side gate: when the deployment has WEFT_AUTH_TOKEN set and the
 * browser has no valid session cookie yet, overlay a token prompt.
 * Also surfaces the read-only banner.
 */
export default function AuthGate(props: { children: JSX.Element }) {
  const [status, setStatus] = createSignal<AuthStatus | null>(null);
  const [token, setToken] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/auth");
        setStatus((await res.json()) as AuthStatus);
      } catch {
        // Backend unreachable — let the pages surface their own errors.
        setStatus({ auth_required: false, authorized: true, read_only: false });
      }
    })();
  });

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token() }),
      });
      if (!res.ok) {
        setError("Invalid token.");
        return;
      }
      // Cookie is set — reload so every data fetch picks it up.
      location.reload();
    } catch {
      setError("Could not reach the Weft backend.");
    } finally {
      setBusy(false);
    }
  };

  const needsToken = () => {
    const s = status();
    return s !== null && s.auth_required && !s.authorized;
  };

  return (
    <>
      <Show when={status()?.read_only}>
        <div
          role="status"
          class="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-center text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          Read-only mode — changes are disabled on this deployment.
        </div>
      </Show>

      <Show when={!needsToken()} fallback={<TokenPrompt />}>
        {props.children}
      </Show>
    </>
  );

  function TokenPrompt() {
    return (
      <div class="flex min-h-[60vh] items-center justify-center px-4">
        <form
          onSubmit={submit}
          aria-label="Authentication required"
          class="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h1 class="text-lg font-semibold tracking-tight">Authentication required</h1>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            This Weft deployment is protected. Enter the access token
            (<code class="text-xs">WEFT_AUTH_TOKEN</code>).
          </p>
          <label class="mt-4 block text-sm">
            <span class="block text-xs font-medium">Token</span>
            <input
              type="password"
              required
              autocomplete="off"
              class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              value={token()}
              onInput={(e) => setToken(e.currentTarget.value)}
            />
          </label>
          <Show when={error()}>
            <p role="alert" class="mt-3 text-sm text-red-700 dark:text-red-300">
              {error()}
            </p>
          </Show>
          <button
            type="submit"
            disabled={busy()}
            class="mt-4 w-full rounded-lg bg-weft-600 px-4 py-2 text-sm font-medium text-white hover:bg-weft-700 disabled:opacity-50"
          >
            {busy() ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    );
  }
}

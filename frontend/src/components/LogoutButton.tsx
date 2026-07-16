import { Show } from "solid-js";
import { useAuth } from "./AuthGate";

/**
 * Nav logout button — rendered only when the deployment requires a token AND
 * the browser holds a valid session (i.e. there is something to log out of).
 */
export default function LogoutButton() {
  const auth = useAuth();
  const visible = () => {
    const s = auth?.status();
    return s !== null && s !== undefined && s.auth_required && s.authorized;
  };
  return (
    <Show when={visible()}>
      <button
        type="button"
        onClick={() => void auth?.logout()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Log out
      </button>
    </Show>
  );
}

import { createMemo, For, Show } from "solid-js";
import { project2d } from "~/lib/pca";

export interface MapPoint {
  id: string;
  vector: number[];
  label: string;
  /** Optional facet value — points sharing a group share a color. */
  group?: string;
}

const COLORS = [
  "var(--color-weft-500, #8b5cf6)",
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

/**
 * 2D PCA projection of object vectors as an SVG scatter plot — Qdrant-style
 * "get a feel for your embedding space" view, no external libraries.
 */
export default function VectorMap(props: {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  const projected = createMemo(() => {
    const coords = project2d(props.points.map((p) => p.vector));
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    // 5% padding inside a 100×100 viewBox.
    return props.points.map((p, i) => ({
      ...p,
      x: 5 + ((coords[i][0] - minX) / spanX) * 90,
      y: 5 + ((coords[i][1] - minY) / spanY) * 90,
    }));
  });

  const groups = createMemo(() => {
    const seen: string[] = [];
    for (const p of props.points) {
      const g = p.group ?? "";
      if (g && !seen.includes(g)) seen.push(g);
    }
    return seen;
  });
  const colorFor = (group?: string) => {
    if (!group) return COLORS[0];
    const i = groups().indexOf(group);
    return COLORS[(i >= 0 ? i : 0) % COLORS.length];
  };

  return (
    <figure class="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <figcaption class="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {props.points.length} vectors, PCA-projected to 2D — proximity ≈ similarity
        </span>
        <Show when={groups().length > 1}>
          <span class="flex flex-wrap gap-2" aria-label="Group legend">
            <For each={groups()}>
              {(g) => (
                <span class="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    class="inline-block h-2 w-2 rounded-full"
                    style={{ background: colorFor(g) }}
                  />
                  {g}
                </span>
              )}
            </For>
          </span>
        </Show>
      </figcaption>
      {/* role=group (not img): the points inside are interactive */}
      <svg
        viewBox="0 0 100 100"
        role="group"
        aria-label="Vector space map"
        class="mt-2 aspect-square w-full"
      >
        <For each={projected()}>
          {(p) => (
            <circle
              cx={p.x}
              cy={p.y}
              r={props.selectedId === p.id ? 2.2 : 1.4}
              fill={colorFor(p.group)}
              fill-opacity={props.selectedId === p.id ? 1 : 0.65}
              stroke={props.selectedId === p.id ? "currentColor" : "none"}
              stroke-width="0.4"
              class="cursor-pointer"
              tabindex="0"
              role="button"
              aria-label={`Object ${p.label}`}
              onClick={() => props.onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") props.onSelect(p.id);
              }}
            >
              <title>{p.label}</title>
            </circle>
          )}
        </For>
      </svg>
    </figure>
  );
}

// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// Deployed to GitHub Pages at https://compufreq.github.io/weft
export default defineConfig({
  site: "https://compufreq.github.io",
  base: "/weft",
  integrations: [
    starlight({
      title: "Weft",
      description:
        "The missing UI for Weaviate — zero-config, self-hosted web interface for browsing and managing Weaviate instances.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/compufreq/weft",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Getting started", slug: "getting-started" },
            { label: "Configuration", slug: "configuration" },
          ],
        },
        {
          label: "Walkthroughs",
          items: [
            { label: "v0.1 — Walking skeleton", slug: "walkthroughs/phase-0-walking-skeleton" },
            {
              label: "v0.2 — Schema & connections",
              slug: "walkthroughs/phase-1-schema-connections",
            },
            {
              label: "v0.3 — Data explorer",
              slug: "walkthroughs/phase-2-data-explorer",
            },
          ],
        },
      ],
      editLink: {
        baseUrl: "https://github.com/compufreq/weft/edit/main/docs/",
      },
    }),
  ],
});

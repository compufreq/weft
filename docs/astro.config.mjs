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
      // Code-block wrapping lives in ec.config.mjs (defaultProps there is
      // reliably picked up by astro-expressive-code).
      head: [
        {
          // Progressive enhancement: Starlight tables overflow-x on narrow
          // viewports; give actually-scrollable ones keyboard focus.
          tag: "script",
          content: `document.addEventListener("DOMContentLoaded",()=>{for(const t of document.querySelectorAll(".sl-markdown-content table")){if(t.scrollWidth>t.clientWidth&&!t.hasAttribute("tabindex")){t.setAttribute("tabindex","0");t.setAttribute("role","region");t.setAttribute("aria-label","Scrollable table");}}});`,
        },
      ],
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
            { label: "Upgrading", slug: "upgrading" },
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
            {
              label: "v0.4 — Multi-tenancy",
              slug: "walkthroughs/phase-3-multi-tenancy",
            },
            {
              label: "v0.5 — Ops dashboard",
              slug: "walkthroughs/phase-4-ops-dashboard",
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

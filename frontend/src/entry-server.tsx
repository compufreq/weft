// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

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

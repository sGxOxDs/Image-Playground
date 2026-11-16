import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "import.meta.env.VITE_WORKSPACE_BASE": JSON.stringify(process.env.IMAGE_STUDIO_STATIC_BUILD === "true" ? "/Image-Playground/" : "/"),
  },
  plugins: [tailwindcss(), reactRouter()],
  server: {
    watch: { ignored: /(?:^|[/\\])\.local(?:[/\\]|$)/ },
  },
  resolve: {
    tsconfigPaths: true,
  },
});

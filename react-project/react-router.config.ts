import type { Config } from "@react-router/dev/config";

const staticBuild = process.env.IMAGE_STUDIO_STATIC_BUILD === "true";

export default {
  buildDirectory: staticBuild ? "build-static" : "build",
  prerender: staticBuild ? ["/"] : undefined,
  ssr: true,
} satisfies Config;

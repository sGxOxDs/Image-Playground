import type { Config } from "@react-router/dev/config";

const staticBuild = process.env.IMAGE_STUDIO_STATIC_BUILD === "true";

export default {
  buildDirectory: staticBuild ? "build-static" : "build",
  prerender: staticBuild ? ["/"] : undefined,
  ssr: true,
  // GitHub Pages 部署到子路徑 https://sgxoxds.github.io/Image-Playground/
  // 靜態建置用相對 base "./"，讓資產直接輸出到 client/（避免多出一層子目錄）
  // vite.base 在 @react-router/dev 的 Config 型別中未公開欄位，故以型別斷言透過
  vite: { base: staticBuild ? "./" : "/" },
} as unknown as Config;

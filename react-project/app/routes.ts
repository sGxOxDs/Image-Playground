import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route(".well-known/appspecific/com.chrome.devtools.json", "routes/chrome-devtools.ts"),
  route("api/plugin-manifest", "routes/api.plugin-manifest.ts"),
  route("api/plugin-auth", "routes/api.plugin-auth.ts"),
  route("api/session", "routes/api.session.ts"),
  route("api/gateway/*", "routes/api.gateway.ts"),
] satisfies RouteConfig;

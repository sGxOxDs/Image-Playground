import type { Route } from "./+types/home";
import { WorkspaceEntry } from "../components/workspace/WorkspaceEntry";
import { frameAncestors, parentOrigins } from "../lib/plugin-origins.server";

export function loader() {
  const authUrl = process.env.IMAGE_STUDIO_PLUGIN_AUTH_URL
    || (process.env.IMAGE_STUDIO_STATIC_BUILD === "true" ? "http://127.0.0.1:3000/api/plugin-auth" : "/api/plugin-auth");
  return { origins: parentOrigins(), authUrl };
}

export function headers() {
  return { "Content-Security-Policy": frameAncestors() };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Image Studio — 圖片工作台" },
    { name: "description", content: "以會話管理圖片生成、編輯與版本的本機工作台。" },
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const handshakeSrc = import.meta.env.VITE_WORKSPACE_BASE + "workspace/plugin-handshake.js";
  return <>
    <script src={handshakeSrc} data-parent-origins={JSON.stringify(loaderData.origins)} />
    <WorkspaceEntry origins={loaderData.origins} authUrl={loaderData.authUrl} />
  </>;
}

import { readFileSync, writeFileSync } from "node:fs";

// 預渲染的 index.html 會寫入絕對路徑（/assets/…、/workspace/…）。
// 當 vite.base = "./" 時，將 "/…" 絕對前綴換成 "./…" 相對前綴，
// 確保部署到 GitHub Pages 子路徑（如 /Image-Playground/）時資產仍可被瀏覽器解析。
const htmlPath = new URL("../build-static/client/index.html", import.meta.url);
const html = readFileSync(htmlPath, "utf8");

// 只處理 assets 與 workspace 兩組資產前綴，避免誤傷其他 / 開頭的內容（如 JSON 中的 authUrl 屬 URL 字串，不應被換）。
const out = html
  .replace(/((?:src|href)=")\/(assets|workspace)\/([^"]*)"/g, '$1./$2/$3"')
  .replace(/(import \* as route\d+ from ")\/(assets)\/([^"]+)"/g, (m, p1, dir, file) => {
    const route = m.match(/as (route\d+)/)[1];
    return `${p1}./${dir}/${file}"`;
  })
  .replace(/("(module|url)": ")\/(assets)\/([^"]+)"/g, '$1./$2/$3"');

writeFileSync(htmlPath, out, "utf8");
console.log(html === out ? "post-process base: no absolute asset/workspace paths found" : "post-process base: rewrote index.html absolute asset/workspace paths to ./ …");

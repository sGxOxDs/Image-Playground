## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## GitHub Pages 發布流程

在 `react-project` 執行以下命令，腳本會建置靜態網站、更新 gh-pages 工作樹、提交並推送至 `origin/gh-pages`：

- **功能測試版**：執行 `npm run devlop`，自最近的正式版 `X.Y.Z` 產生 `web-X.Y.Z-dev+N`。`N` 從該正式版之後的最近 dev 發布編號遞增；正式版更新後從 1 重新計算。
- **正式版**：執行 `npm run publish:pages -- X.Y.Z`，版號須大於目前正式版。標題格式為 `web-X.Y.Z`；主、次、修補版號依不相容變更、相容功能、一般更新／修補遞增。
- **正式版摘要**：commit 內文列出上次正式版以來的更新。首次使用新流程時，比對上一個 gh-pages 正式版快照與目前原始碼，列出原始碼差異檔案；之後以該正式版內文的 `Source-Commit` SHA 為起點，列出來源 commit 標題和差異檔案。發布後會在內文保存目前來源 SHA。
- 正式版發布前，來源工作目錄必須乾淨；測試版可用目前工作目錄建置。發布使用隔離的 gh-pages 工作樹，不切換目前分支。
- 腳本沿用 `npm run build:static`，將 `react-project/build-static/client` 內容複製到 gh-pages 根目錄並確保有 `.nojekyll`；GitHub Pages source 維持 `gh-pages` 分支。

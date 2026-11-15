## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## GitHub Pages 發布 commit 規範（web 語意版本）

向 `gh-pages` 分支發布靜態網站時，commit 標題必須採語意版本格式：`web-<主>.<次>.<修補>`。

- **標題**：`web-X.Y.Z`（例：`web-0.0.1`、`web-0.1.0`）
- **內文**：列出本次更新內容（bullet list），與**上次發布 commit** 比對變更
- **版本規則**（比較基準 = 當前 `gh-pages` 分支上一個發布 commit，目前基線 = `web-0.0.1`）：
  - 主版本：不兼容變更時 +1，其他歸零
  - 次版本：兼容新功能時 +1，修補歸零
  - 修補：一般更新／修補時 +1
- 發布流程與 Personal-React 的 `gh_page` 一致：本地 `npm run build:static`，將 `react-project/build-static/client` 放到 `gh-pages` 分支根目錄（含 `.nojekyll`），commit 並 push，再設定 GitHub Pages source 為 `gh-pages` 分支

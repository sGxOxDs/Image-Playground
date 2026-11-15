# Git Commit Rules

Generate commit messages in this exact format:

<type>(<scope>): <summary>

Allowed types:

- feat
- fix
- refactor
- perf
- docs
- test
- chore
- build
- ci
- style

Rules:

- 使用繁體中文
- summary 不超過 50 個字
- description 使用條列式列出修改內容
- 不使用 emoji
- 不使用句號
- 不要寫完整句子
- 不要描述沒有出現在 diff 中的內容
- 不要使用模糊詞彙
- scope 使用實際修改的模組名稱
- 優先描述使用者可感知的變更
- 如果是 bug 修正，type 必須是 fix
- 如果是新功能，type 必須是 feat
- 如果是純重構，type 必須是 refactor
- 如果無法判斷 scope，省略 scope

Examples:

feat(auth): 新增 Telegram 登入驗證
fix(api): 修正使用者資料查詢錯誤
refactor(ui): 重構設定頁面元件
perf(image): 優化圖片載入速度
docs(readme): 更新安裝說明
chore(deps): 更新相依套件版本

## graphify

For any question about this repo's architecture, structure, components, or how to add/modify/find
code, your first action should be `graphify query "<question>"` when `graphify-out/graph.json`
exists. Use `graphify path "<A>" "<B>"` for relationship questions and `graphify explain "<concept>"`
for focused-concept questions. These return a scoped subgraph, usually much smaller than the full
report or raw grep output.

Triggers: "how do I…", "where is…", "what does … do", "add/modify a <component>",
"explain the architecture", or anything that depends on how files or classes relate.

If `graphify-out/wiki/index.md` exists, use it for broad navigation. Read `graphify-out/GRAPH_REPORT.md`
only for broad architecture review or when query/path/explain do not surface enough context. Only read
source files when (a) modifying/debugging specific code, (b) the graph lacks the needed detail, or
(c) the graph is missing or stale.

Type `/graphify` in Copilot Chat to build or update the graph.

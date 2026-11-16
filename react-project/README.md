# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

### 本機 Provider

從首頁的「本機示範」進入 Provider 設定。新增具備圖片端點的 OpenAI-compatible Profile，輸入 Base URL 與所需的 API Key，再按「測試連線並偵測模型」。選取偵測到的模型或手動填寫模型 ID，再儲存 Profile。啟用「送出尺寸」或 Seed 欄位前，請核對該模型的輸入格式。本機 HTTP 可使用 localhost 或 loopback 位址，遠端 Provider 使用 HTTPS。

瀏覽器直接呼叫 Provider。Provider 須允許工作台來源、請求方法與 Authorization 標頭的 CORS。回傳圖片網址時，圖片主機也須允許瀏覽器讀取。支援 Base64 回傳的模型可在 Extra Body 使用 {"response_format":"b64_json"}。Request Preview 由瀏覽器產生。

Extra Body 分別保存生成與編輯的 JSON，在支援的模型上可覆寫尺寸與批次張數。

支援 OpenAI Images SSE 且已啟用能力的 Provider，可在單張生成或編輯時顯示收到的中間預覽數。可在 Profile 設定 1–3 個串流預覽；預設關閉。Provider 任務的「中止接收」會中斷請求並停止本機保存。 [OpenAI Images 串流格式](https://developers.openai.com/api/reference/resources/images/methods/generate)

支援 Responses 背景工作的模型可在「模型能力」啟用背景工作與取消。工作台會輪詢上游狀態，並在 Provider 回覆取消後更新任務。背景任務識別碼保存在執行工作的分頁。 [OpenAI Responses 背景模式](https://developers.openai.com/api/docs/guides/background)

本機資料在各自的 IndexedDB 資料空間保存。舊版工作台資料會在首次成功寫入時自動移轉至新版資料表。新生成與上傳的圖片會另外儲存最長邊 320 px 的縮圖。下載與編輯仍使用原圖，完整備份同時保留兩者。

工作台開啟時與執行期間會清理過期會話，預設從最後一則對話起算 30 天。從「設定 → 會話保留天數」調整，0 天代表停用。仍在處理中的會話會保留。

單獨匯出會話時，備份會帶上該會話使用的參考圖和上游版本，含來自其他會話的圖片。

在支援 Web Locks 的瀏覽器中，同一資料空間由一個分頁編輯並執行佇列。後開的分頁會在原分頁關閉後自動接手，並重新讀取最新紀錄。不同 LiteLLM 身分使用獨立資料空間。

工作台依是否附加圖片，在生成與編輯間自動切換。首次使用的 Seed 為隨機，Images API 的 PE 預設使用 enhance_prompt，送出字串 true。後續會記住 PE、尺寸、Seed、批次與 Extra Body 設定，新會話也會沿用最後選擇的 Provider。

Standalone 與 LiteLLM 模式皆可從功能列的「設定」調整外觀、查看快捷鍵與管理本機資料。手機可從 Header 的「更多功能」開啟設定。LiteLLM 的授權模型與連線狀態在「LiteLLM Gateway」顯示。

工作台快捷鍵使用 `Alt+Shift+N` 新建會話、`Alt+Shift+P` 聚焦提示詞、`Alt+Shift+T` 開啟生成任務。可在「設定」的「鍵盤快捷鍵」關閉。畫面有輸入欄位焦點或已開啟浮層時，工作台快捷鍵暫停。

「圖片端點與模型能力」可以為 Profile 設定是否支援生成、編輯、多圖與遮罩，以及固定尺寸、對齊倍數、邊長、像素、長寬比與 Seed 範圍。工作台會依能力顯示控制項，送出前會依設定檢查請求。遮罩是與第一張來源圖尺寸相同、帶透明通道的 PNG，透明區域為可編輯範圍。使用遮罩的 Responses 編輯會直接上傳第一張來源圖。

填入「Responses 主模型」即可使用 Responses API，原本的模型 ID 會成為圖片工具模型。此模式要求 Provider 保留上游回應。編輯具有上游上下文的版本時，可以沿用該回應，或取消勾選並直接上傳來源圖。若 Provider 明確回報找不到原回應，工作台會改用本機來源圖。

「提示詞增強文字模型」使用 Provider 的 Chat Completions 端點，回傳的候選可以修改、複製或改用原文。Image API 的 Provider Native 增強須配置上游支援的欄位與啟用值格式。若上游需要 `{"enhance_prompt":"true"}`，在 Provider 設定填入 `enhance_prompt`、選擇字串 `"true"` 並儲存，再從 Composer 的 PE 選擇 Provider Native。已配置的欄位由 PE 開關控制，可在 Extra Body 的請求預覽確認送出值。「請求資訊」會顯示 Provider 有回傳的改寫。 [Responses 圖片工具](https://developers.openai.com/api/docs/guides/tools-image-generation) · [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)

圖片檢視器會分別顯示送出的 Seed、Provider 回傳的圖片或批次 Seed，以及 Provider 改寫的提示詞。各值依該次請求與回應記錄，尺寸以圖片本身為準。

「任務」可查看跨會話的佇列與等待順位、取消等待中或正在處理的任務，以及用原始參數重試。Image API 與本機示範可從 Composer 的「批次」選擇 1 至 4 張。佇列由開啟中的工作台執行，重新整理後未完成的任務會保留為中斷紀錄，由使用者決定是否重試。處理中的取消會中止工作台請求，Provider 端的停止與計費行為由服務決定。

Provider Profile 與 API Key 保存在此瀏覽器的 LocalStorage，依資料空間和 Provider 區分。可在 Provider 設定中移除憑證。舊版伺服器的 Profile 須在新版重建。

### 在本機以 http-server 託管前端

在 `react-project` 執行 `npm run build:static` 與 `npm run start:static`，再開啟 `http://127.0.0.1:8080`。Standalone 的模型請求由瀏覽器直連 Provider。

### LiteLLM Plugin

GitHub Pages 靜態版內嵌在 LiteLLM Dashboard 時直接開啟 Standalone 工作台，不需要額外登入或身分驗證服務。在 LiteLLM 註冊插件並設定工作台網址後，於工作台新增 Provider Profile，填入 Gateway 網址與使用者自己的 Virtual Key；Gateway 必須允許工作台來源的 CORS。

靜態版不驗證 LiteLLM 身分，也不限制只有登入使用者才能開啟；同一瀏覽器的獨立工作台資料與 Provider 憑證不依 LiteLLM 帳號隔離。瀏覽器可能依頂層網站分區儲存資料。需要身分驗證及帳號隔離時，請使用下方的伺服器部署。

以 `npm run start:static` 託管時，需在服務啟動前設定 `LITELLM_PARENT_ORIGINS` 為允許內嵌的 Dashboard 來源；未設定時服務會禁止內嵌。

#### 有身分驗證的伺服器部署

建議使用 Docker 部署含身分驗證的外掛版。可由原始碼建置或使用預建映像。 [Docker 啟動方式](#docker)

1. 在 Image Studio 服務設定 `LITELLM_PARENT_ORIGINS` 為 LiteLLM Dashboard 的來源，並設定依 LiteLLM 文件由 Gateway Salt 衍生的 `PLUGIN_AUTH_KEY`。使用 Docker 時，請將這些值以執行時環境變數傳入容器。直接在主機執行時，可使用 `npm run build` 與 `npm run start`。
2. 在 LiteLLM 登記插件、Image Studio 服務網址與專用 `plugin_key`。若插件名稱不是 `image-studio`，服務需設定相同的 `LITELLM_PLUGIN_NAME`。
3. 預設使用個人 Virtual Key：將工作台來源加入 Gateway 的 `LITELLM_CORS_ORIGINS`，開啟插件後在「LiteLLM Gateway」輸入 Key、測試連線並選擇模型。若改用下方的共用 Key 模式，請設定 `LITELLM_SHARED_API_KEY` 和 `LITELLM_API_BASE`；工作台透過後端代理連線，不需要使用者輸入 Key 或為此設定 Gateway CORS。

Gateway 預設採用 Dashboard 來源。驗證服務可設定 `LITELLM_BROWSER_API_BASE` 指定瀏覽器可達的 Gateway Base URL。為保留原有的 LiteLLM 資料空間，可沿用已設定的 `LITELLM_GATEWAY_ID` 或 `LITELLM_API_BASE` 作為識別。Virtual Key 的路由與模型權限由 Gateway 管理。 [LiteLLM Plugins](https://docs.litellm.ai/docs/proxy/plugins) · [LiteLLM Virtual Key 權限](https://docs.litellm.ai/docs/proxy/virtual_keys)

#### Docker

從本 repository 建置映像的指令請見 [根目錄的 LiteLLM 外掛部署](../readme.md#litellm-外掛部署)。下方另提供預建映像的啟動方式。

建置使用 BuildKit 的 npm 快取。只修改原始碼時，可用 `docker build --progress=plain` 確認兩個依賴安裝步驟命中快取。執行時由 Node 直接啟動服務並接收容器停止訊號。

容器包含工作台和身分驗證後端，監聽 3000 埠。從容器外透過 HTTPS 反向代理公開服務，並設定以下執行時環境變數：

- `LITELLM_PARENT_ORIGINS`：允許內嵌的 LiteLLM Dashboard 來源，多個來源以逗號分隔
- `LITELLM_PLUGIN_NAME`：LiteLLM 註冊的插件名稱，例如 `image-playground-plugin`
- `PLUGIN_AUTH_KEY`：依 LiteLLM 文件以 Gateway Salt 和插件名稱衍生的 Fernet 金鑰；不要放入映像或版本控制
- `IMAGE_STUDIO_PLUGIN_ORIGIN`：瀏覽器開啟 Image Studio 的公開來源，例如 `https://studio.example.com`
- `LITELLM_BROWSER_API_BASE`：瀏覽器可連線的 Gateway 網址；不設定時使用 Dashboard 來源
- `LITELLM_DEFAULT_MODEL`：選用的預設圖片模型 ID，例如 `LITELLM_DEFAULT_MODEL=my-image-model`。它會帶入新 Gateway Profile；尚未儲存 Profile 時，共用 Key 模式可直接使用此模型，個人 Key 模式仍需輸入 Key 並儲存。自動配置的 Profile 會以 `seed` 欄位傳送 Seed，新的工作台預設使用隨機值。模型不接受 `seed` 時，可在 Profile 的「Seed 欄位」改選「由模型決定」並儲存。
- `LITELLM_SHARED_API_KEY`：選用的共用 LiteLLM Virtual Key，只保存在後端；設定後插件使用後端代理，不需每位使用者輸入 Key
- `LITELLM_API_BASE`：啟用共用 Key 時必填，指向容器可連線的 LiteLLM Gateway，例如 `http://litellm:4000`
- `LITELLM_PROXY_UPLOAD_BUDGET_MIB`：共用 Key 代理每程序的在途上傳預算，預設 `512`。每筆預留 body 大小的 4 倍，最低 64 KiB。缺少 Content-Length 時按 128 MiB 上限預留。調低預算會降低可受理的單筆大小與併發量。超出單筆上限回傳 `413`，預算暫滿回傳 `503` 和 `Retry-After: 2`。
- `LITELLM_PROXY_UPLOAD_TIMEOUT_MS`：共用代理讀取請求內容的期限，預設 `60000`。逾時回傳 `408`。
- `LITELLM_PROXY_UPSTREAM_TIMEOUT_MS`：共用代理等待上游回應標頭的期限，預設 `300000`。逾時回傳 `504`，收到標頭後可繼續讀取串流。

上傳預算用於限制代理同時處理的資料量。設定容器記憶體配額時，另需留出 Node、GC、回應與連線的使用空間。目前含身分驗證的部署以單副本運行，登入、一次性身分聲明和背景工作歸屬由該程序管理。

本機 A/B 壓測可使用 `scripts/gateway-benchmark.mjs`。在測試網路執行 `node scripts/gateway-benchmark.mjs mock` 啟動 4000 埠的假 Gateway；用 `MOCK_DELAY_MS` 模擬上游等待時間。待測 Image Studio 的 `LITELLM_API_BASE` 指向假 Gateway，`LITELLM_SHARED_API_KEY` 使用任意測試值，`LITELLM_PARENT_ORIGINS` 設為 `https://dashboard.example.test`，`PLUGIN_AUTH_KEY` 使用 `Buffer.alloc(32, 7).toString("base64url")` 產出的測試值。

`node scripts/gateway-benchmark.mjs normal <Studio URL>` 執行固定頻率的正常負載，`run <Studio URL>` 執行完整負載矩陣，`soak <Studio URL> 1800` 執行 30 分鐘的高負載測試。把腳本掛載到待測容器內，設定 `PERF_TELEMETRY=1` 和 `NODE_OPTIONS=--import=/容器內腳本路徑`，可同步取得程序 RSS、heap、external、CPU 和 event loop delay。

將環境變數放在安全保管的 `image-studio.env`，再執行：

```bash
docker login ghcr.io
docker pull ghcr.io/sgxoxds/image-playground:latest
docker run -d --name image-studio --restart unless-stopped \
  --env-file image-studio.env -p 127.0.0.1:3000:3000 \
  ghcr.io/sgxoxds/image-playground:latest
```

```powershell
python -c 'import base64,getpass,hashlib,hmac; s=getpass.getpass(); n=input(); print(base64.urlsafe_b64encode(hmac.new(s.encode(),n.encode(),hashlib.sha256).digest()).decode())'
```

GHCR 私人映像需要使用具有套件讀取權限的帳號登入。

將 LiteLLM 插件 URL 設為 Image Studio 的公開 HTTPS 網址，不是 GitHub Pages 網址。`plugin_key` 是 LiteLLM 轉送至插件後端時使用的憑證，不會自動變成 Gateway Virtual Key。Image Studio Session 和已使用的聲明記錄僅存在容器記憶體；重啟後需重新連線，請使用單一容器實例。

共用 Key 模式下，Gateway 的模型權限、額度與費用由該 Key 決定。後端在圖片生成、編輯、文字增強和 Responses 建立請求的 `user` 欄位寫入已驗證的 LiteLLM 使用者 ID，覆蓋瀏覽器提供的值；LiteLLM 聲明不包含使用者名稱。模型查詢與背景工作查詢沒有請求本文。Responses 的存取權記錄保存在容器記憶體 24 小時，重啟或過期後無法繼續查詢、取消或沿用先前回應。共用模式只代理支援的 Gateway 端點，並拒絕覆寫憑證、上游網址或追蹤 metadata 的欄位。

## Building for Production

Create a production build:

```bash
npm run build
```

### 安裝及離線使用

`npm run build` 會為正式版建立 Service Worker。執行 `npm run start` 後，從支援安裝的瀏覽器選單安裝 Image Studio。瀏覽器提供安裝提示時，Standalone 設定也會顯示「安裝 Image Studio」。正式部署需使用 HTTPS，本機可使用 localhost。

首次連線完成工作台快取後，可離線重載、查看 IndexedDB 中的會話與草稿、管理備份，並以本機示範產生圖片。Provider 及 LiteLLM 仍需要連線，相關 API 回應不會加入離線快取。 [PWA 安裝條件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.

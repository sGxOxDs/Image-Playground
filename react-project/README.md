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

以下以 Dashboard `http://127.0.0.1:4000`、靜態前端 `http://127.0.0.1:8080`、身分驗證服務 `http://127.0.0.1:3000` 為例。

1. 在靜態前端終端設定 `$env:LITELLM_PARENT_ORIGINS = 'http://127.0.0.1:4000'`，再執行 `npm run build:static` 與 `npm run start:static`。
2. 在身分驗證服務終端設定相同的 `LITELLM_PARENT_ORIGINS`、`$env:IMAGE_STUDIO_PLUGIN_ORIGIN = 'http://127.0.0.1:8080'`，以及依 LiteLLM 文件由 Gateway Salt 衍生的 `PLUGIN_AUTH_KEY`，再執行 `npm run start:api`。可在建置時用 `IMAGE_STUDIO_PLUGIN_AUTH_URL` 覆寫預設的驗證端點 `http://127.0.0.1:3000/api/plugin-auth`。
3. 在 LiteLLM 登記插件 `image-studio`、工作台 URL `http://127.0.0.1:8080` 與專用 `plugin_key`。若自訂插件名稱，建置與驗證服務都要設定相同的 `LITELLM_PLUGIN_NAME`。Dashboard 與 LiteLLM 程序均須能存取插件 URL。
4. Gateway 的 `LITELLM_CORS_ORIGINS` 加入工作台來源 `http://127.0.0.1:8080`，並保留部署所需的其他來源。開啟插件後，在「LiteLLM Gateway」輸入使用者自己的 Virtual Key，測試連線並選擇模型。

Gateway 預設採用 Dashboard 來源。驗證服務可設定 `LITELLM_BROWSER_API_BASE` 指定瀏覽器可達的 Gateway Base URL。為保留原有的 LiteLLM 資料空間，可沿用已設定的 `LITELLM_GATEWAY_ID` 或 `LITELLM_API_BASE` 作為識別。Virtual Key 的路由與模型權限由 Gateway 管理。 [LiteLLM Plugins](https://docs.litellm.ai/docs/proxy/plugins) · [LiteLLM Virtual Key 權限](https://docs.litellm.ai/docs/proxy/virtual_keys)

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

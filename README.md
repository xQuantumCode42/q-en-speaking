# Speaking Studio

以 Electron、React、TypeScript 與 SQLite 製作的 Windows 英文口說練習 App。介面使用繁體中文，AI 使用英文對話並提供繁中輔助。

## 功能

- 日常閒聊，或在開始前選擇旅行、職場、美食等預設主題，也可輸入自訂主題。
- 使用 Chromium 收音，可選擇麥克風並查看音量條；每段最多 60 秒，錄音時持續顯示本機 Whisper 的暫定文字，停止後確認完整內容再送出。不顯示音量偏低或已收到聲音等提示。
- ChatGPT 延續對話，對本次英文提供文法修正及更生活化的說法。文法正確時顯示肯定提示。
- 收藏文法修正、自然說法或對話回覆，可搜尋、加入標籤與筆記、取消收藏。
- SQLite 保存對話與收藏。重開後可繼續，刪除對話時保留已收藏的內容。
- 可選擇繁中輔助、明暗模式。新的 AI 英文回覆預設自動朗讀，可停止、重播，或在設定中關閉；重開舊對話不會自動播放。
- 回覆失敗時保留英文訊息，支援取消、重試與修改後重送。

## 開始使用

目前 Windows 安裝檔位於 `release/1.0.1/Speaking Studio Setup 1.0.1.exe`，解壓版入口為 `release/1.0.1/win-unpacked/Speaking Studio.exe`。打包指令會依 `package.json` 的版本號，自動輸出至 `release/<版本號>/`。

發行檔依版本分類如下；每個版本保留安裝檔、對應的 `.blockmap` 與 `win-unpacked/` 解壓版。

| 版本 | 資料夾 | 主要內容 |
| --- | --- | --- |
| 1.0.0 | `release/1.0.0/` | 初版：口說轉文字、AI 對話、文法建議、收藏與主題練習 |
| 1.0.1 | `release/1.0.1/` | 自動朗讀、朗讀開關、本機 Whisper 辨識、麥克風選擇與音量指示 |

`release/_build-temp/` 僅收納先前打包留下的暫存檔，不是可安裝版本。各版本使用相同的本機資料目錄，不會各自建立獨立的對話與收藏資料。

目前持續修改 1.0.1；切換版本號前須先取得使用者確認。`release/1.0.1/archive/` 保留同版本較早的發行檔，便於回復。

1. 開啟「設定」，按 **Continue with ChatGPT**，在瀏覽器登入並允許這個 App 使用訂閱。
2. 確認顯示「已啟用 · 使用 ChatGPT 訂閱」，可選擇帳戶提供的模型。
3. 按「開始新對話」，選擇日常閒聊或主題對話。
4. 選擇麥克風，按「開始說話」，錄音時可查看「即時辨識」區域的暫定文字。說完後按「停止並確認文字」，確認輸入框內的完整文字，再按「送出」。也能直接輸入英文。
5. 在右側查看文法與自然說法，按星號收藏需要練習的內容。

此為獨立 App，需在這個 App 內完成自己的登入授權。用量可由「管理 ChatGPT 用量」開啟官方設定查看。

## 語音與環境需求

支援 Windows x64。收音使用 Electron 的 Chromium `getUserMedia` 與 AudioWorklet，辨識使用本機 whisper.cpp v1.8.2 與 Whisper `small.en` Q5_1 英文模型。安裝包已包含模型，安裝後不需另外下載、不需要語音 API Key。

累積約 1.2 秒語音後開始嘗試即時辨識，之後每約 0.4 秒檢查是否有新的語音，一次只執行一個辨識請求，不堆積工作。更新頻率受實際辨識速度限制，暫定文字會隨語境修訂，不是每個字零延遲顯示。停止錄音時會取消尚未完成的預覽並確認完整內容，只加入輸入框一次。離開頁面或取消會忽略舊結果。

加速包優先使用 NVIDIA CUDA，仍使用相同的 `small.en` 模型及解碼設定；若顯示卡、驅動程式或加速元件無法使用，會改用 CPU，當次 App 工作階段不再反覆嘗試失敗的 GPU。設定頁重新檢查語音元件後，可查看實際加速方式與最近一次轉錄耗時。

App 啟動時會以記憶體中的靜音片段在背景預熱 GPU，不開啟麥克風，也不呼叫 ChatGPT。首次使用、更新驅動或清除驅動快取後，CUDA 初始化可能較久；完成後的辨識速度才代表一般使用延遲。實際速度取決於顯示卡、驅動與錄音長度。

錄音在記憶體內轉為單聲道 16kHz PCM，經受限制的 IPC 交給主程序，再透過 stdin 傳給本機辨識程序，不寫入音訊檔、不上傳。失敗時可重試這段記憶體中的錄音；離開對話或關閉程式即釋放。只有確認後按送出的文字及近期對話才會送往 ChatGPT，建議針對文字，不評估發音。

預設使用系統麥克風，可在輸入框旁改選其他裝置。錄音時只顯示音量條，不提示音量大小，每段最多 60 秒。裝置不存在或權限遭拒時顯示錯誤；完全沒有語音的錄音只在停止確認後提示沒有辨識到英文。請允許 Windows 桌面應用程式存取麥克風。英文朗讀仍使用 Windows 本機聲音；若朗讀未就緒，請安裝 Windows 英文語音元件。

Whisper 仍可能誤辨或補上原本沒說出的字，尤其在噪音、長段靜音或很短的片段中；請確認原句，以免把辨識錯誤當作文法問題。新模型的個人實際準確率須使用實體麥克風驗收。

## 開發

需要 Node.js 24+ 與 npm。於專案根目錄執行以下指令。

```powershell
code .
npm ci
npm run setup:speech
npm run dev
```

開發伺服器使用 `127.0.0.1:5174`。修改主程序或 preload 後需重新啟動，React 畫面可即時更新。也可透過 PowerShell 輔助指令選擇 PATH 中的 Node 24+。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1 dev
```

其他指令如下。

```powershell
npm run typecheck
npm test
npm run test:desktop
npm run build
npm start
npm run pack:win
npm run pack:dir
```

`setup:speech` 從官方 whisper.cpp Release 與其模型儲存庫下載固定版本並驗證 SHA-256，包含 CPU 元件、CUDA 元件與模型，約需下載 621 MiB；二進位檔與模型不加入 Git。CUDA 套件使安裝包與安裝後的體積增加。打包前會驗證必要檔案與模型雜湊，避免產生缺少辨識元件的安裝包。

只開發 CPU 模式時，可執行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-speech.ps1 -SkipGpu` 略過 CUDA 下載。此參數不會刪除先前已下載的 CUDA 元件。

正式版為 Electron 桌面程式，無須啟動開發伺服器。`native/` 隨 Windows 打包放入 resources。Whisper 與 Windows 朗讀程序均隱藏終端機視窗；第三方授權文字位於 `native/licenses/`。

## 資料與安全

資料位於 Electron 的 `app.getPath('userData')`，Windows 一般為 `%APPDATA%\Speaking Studio`。設定頁可查看實際位置。

- `speaking-studio.sqlite` 保存對話、完整回覆、收藏、筆記與設定。
- `chatgpt-session.encrypted` 以作業系統安全機制加密保存登入憑證。登入、JWT 驗證、更新憑證與 AI 請求均由主程序處理。
- renderer 啟用 `contextIsolation` 與 `sandbox`，停用 `nodeIntegration`。preload 提供固定 IPC 方法，主程序驗證來源與資料。
- 只有按送出或重試才會呼叫 AI。取得完整串流並通過結構及原句驗證後，才保存建議。
- 回覆有完整的 90 秒期限，取消後的結果不會寫入。上次關閉時未完成的訊息會顯示可重試狀態。
- 麥克風只在按下開始說話後開啟，停止錄音、離開練習頁或關閉程式會釋放收音裝置。音訊權限限於 App 主頁與音訊輸入，不允許攝影機。朗讀與錄音互斥。
- 本機轉錄接受有長度限制且通過 PCM 格式驗證的音訊；不開放任意檔案路徑或命令。轉錄可取消，最多等待兩分鐘。

## 驗證與限制

驗證指令包含型別檢查、正式建置及核心測試。核心測試涵蓋 OAuth／PKCE／JWT、SQLite 重開、主題與建議驗證、串流取消、音訊格式驗證、實際 Whisper 轉錄與取消，並以不可啟動的 GPU 元件驗證 CPU 備援。語音測試使用固定英文音檔，不開啟實體麥克風或喇叭。

桌面整合測試以隔離帳戶與 HTTP 回應驗證登入、文字送出、回覆、糾正、收藏、筆記、主題、取消重試、自動朗讀開關與重開保存。收音測試使用 Chromium 虛擬裝置播放固定英文音檔，實際經過 AudioWorklet PCM 收音與本機 Whisper，確認停止錄音前已顯示英文文字，且沒有音量提示，最後再確認可編輯結果。實體麥克風準確度、實際喇叭播放及個人帳戶對話仍須於 App 內驗收。

Windows 安裝檔尚未簽章，安裝／解除安裝與其他電腦部署尚未驗證。麥克風與朗讀實作目前支援 Windows。

技術參考包括 [ChatGPT 登入與訂閱授權](https://developers.openai.com/siwc/token-sharing-open-source)、[訂閱推論](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[whisper.cpp](https://github.com/ggml-org/whisper.cpp/tree/v1.8.2)，以及 [Whisper 模型](https://huggingface.co/ggerganov/whisper.cpp)。

# 台股小鎮 StockTown Asset Kit (以下是AI撰寫)

用 3D 方塊小鎮呈現台股每日收盤：**每檔股票或 ETF 一間店**，成交金額越大，街上人潮與車流越多；門口右邊的隊伍是三大法人買進、左邊是賣出。

這個 repo 同時是一套**可重複使用的素材包**：店面、街道物件、方塊小人、介面元件，全部用 Three.js 的基本幾何與 Canvas 貼圖產生，**沒有任何外部模型或圖片檔**。

> 目前附的是**示範資料**（數字為程式隨機產生，不是真實行情）。換成真實資料請見〔資料〕。

操作：← → 換一家、空白鍵暫停、1–4 切換速度、− = 調時間、E 快門、N 日夜循環、P 前往公園、C 重設視角；左鍵旋轉、中鍵平移、滾輪縮放；手機單指旋轉、雙指平移與縮放。

## 特色

- 11 間店、公園與預留空地，街區可自行調整（見 `docs/street-objects.md`）
- 人流與車流模擬：排隊、叫號進店、路人過街、車子禮讓行人
- 日夜時間、車燈快門光軌、移軸景深
- 街角電子招牌顯示名稱、市值、收盤價
- 手機版優化（單列橫幅導覽、預設 10× 速度）
- 紅漲綠跌，招牌只放文字，不放公司 logo

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 小鎮頁面與介面，讀取 `data/stocks.json` |
| `town-kit.js` | 素材包：街景、方塊小人、九種店面、店面零件、欄杆、日夜切換 |
| `town-sim.js` | 人流與車流模擬 |
| `stocks.config.json` | 股票清單：代號、名稱、類型、店面樣式、代表色 |
| `data/stocks.json` | 資料（目前是示範資料） |
| `.github/workflows/update.yml` | 自動更新的工作流程（排程預設關閉） |

## 給開發者與 AI 的說明文件

想修改或擴充風格，可以把下面的文件連同對應的程式一起交給 AI：

| 文件 | 內容 |
|---|---|
| [`docs/shops.md`](docs/shops.md) | 店面：座標約定、積木函式、最小範例 |
| [`docs/street-objects.md`](docs/street-objects.md) | 街道物件：街區、小物、排隊欄杆、日夜與模擬 |
| [`docs/people.md`](docs/people.md) | 人物：方塊小人的造型、姿勢與生成 |
| [`docs/ui.md`](docs/ui.md) | 介面：視覺 token、版面、手機版規則 |

每份文件都附有「規則」與「提示詞範本」。

## 資料

資料來源由你自己與AI溝通，可自己串公開資料


## 授權

本專案以 **CC0 1.0 Universal** 釋出，詳見 [`LICENSE`](LICENSE)：你可以自由複製、修改、散布與商用，不需要事先取得許可。

**一個請求（非授權條件）：若要用於商業用途，歡迎先在這個 repo 開一個 Issue 告知作者。**

### 第三方

- [Three.js](https://threejs.org/)（MIT）：由 CDN 載入，未包含在本 repo
- [Outfit](https://fonts.google.com/specimen/Outfit)、[JetBrains Mono](https://www.jetbrains.com/lp/mono/)（SIL Open Font License 1.1）：由 Google Fonts 載入，未包含在本 repo


## 免責聲明

本專案僅供學習與展示，**資料僅供參考，不構成投資建議**。畫面上出現的公司名稱僅為示範，與任何公司無關，也不代表其背書。作者不對使用本專案所產生的任何結果負責。

## 作者

kendevchen

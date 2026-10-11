# 店面（Shops）

給開發者與 AI 讀的說明：怎麼在 `town-kit.js` 裡新增或修改一種店面樣式。

## 一句話
一種店面＝一個函式 `樣式名(g, info, o)`，用「方塊 B、平面 P、面板 panel」三種積木，把一間店拼進群組 `g`。

## 座標與尺寸約定（單位：公尺）
| 常數 | 值 | 意思 |
|---|---|---|
| `DIM.pitch` | 40 | 街廓中心間距 |
| `DIM.block` | 30 | 街廓邊長 |
| `DIM.lot` | 24 | 店面地塊邊長 |
| `DIM.curbY` | 0.2 | 人行道高度 |
| `DIM.frontZ` | 3 | 店面正面的位置（從地塊中心往 +z） |

- 群組原點＝地塊中心；`y = 0` 是人行道頂面。
- **正面朝 +z**（`z = DIM.frontZ`），**門在 `x = 0`**。
- 建築本體通常寬 11～13、深 9～10，往 −z 延伸：`cz = F - d / 2`，其中 `F = DIM.frontZ`。
- 前方 z 從 3 到 14 留給廣場、排隊欄杆與小物，建築不要往前突出超過 `F + 1.5`。

## 積木與材質（都從 `town-kit.js` 匯出）
| 函式 | 用途 |
|---|---|
| `B(g, w, h, d, mat, x, y, z, shadow=true)` | 方塊，中心在 (x, y, z) |
| `P(g, w, h, mat, x, y, z)` | 朝 +z 的平面（貼圖、窗戶、招牌） |
| `panel(g, w, h, mat, x, y, z, ry)` | 可繞 y 軸旋轉的平面，貼在側牆用 |
| `std(color, rough, metal)` | 一般材質（快取） |
| `glow(color, k, dayK)` | 發光材質，會隨日夜切換變亮／變暗 |
| `texMat(tex, k, dayK, opts)` | 貼圖材質（會發光、隨日夜切換） |
| `canvasTex(w, h, draw)`、`fitText(ctx, text, maxW, size, weight)` | 用 Canvas 畫貼圖與文字 |
| `brickBox`、`awning`、`hangingSign`、`bladeSign`、`pergola`、`waterTank`、`acUnit`、`ventPipe` | 現成的店面零件 |
| `menuTexture(info, 'dark'｜'light'｜'chalk')`、`ledTexture(info)`、`interiorTexture(kind, accent)` | 文字貼圖：價目板、LED 看板、室內 |

## `info`：店面吃進來的資料
由 `shopInfo({...})` 補齊預設值，常用欄位：
`name`（店名）、`title`（招牌全名）、`color`（代表色）、`rows`（`[[名稱, 值], …]` 資料列）、`big`／`bigLabel`（大數字與標籤）、`ledHeader`、`banner`、`ticker`（跑馬燈文字）。
店面函式只讀 `info`，**不要在樣式函式裡寫死任何資料**。

## 最小範例（把它整個貼給 AI 當樣板）
```js
// 在 SHOP_STYLES 裡新增：一間紅磚小店
bakery(g, info, o) {
  const w = 11, d = 9, F = DIM.frontZ, cz = F - d / 2, h = 7, acc = info.color;
  const cream = std('#efe6d2', 0.7);
  brickBox(g, w, h, d, 0, h / 2, cz);                                   // 牆
  B(g, w + 0.5, 0.45, d + 0.5, cream, 0, h + 0.22, cz);                 // 女兒牆
  B(g, 1.9, 3.0, 0.12, std('#1f4a3a', 0.6), 0, 1.5, F + 0.06, false);   // 門
  P(g, 0.9, 1.3, glow('#ffe3b8', 1.3), 0, 2.0, F + 0.13);               // 門上發光窗
  awning(g, -3.5, 4.0, F, 3.0, 1.35, acc);                              // 遮雨棚
  hangingSign(g, info.title, 0, 3.55, F + 1.05, acc);                   // 吊牌（只放文字）
  panel(g, 2.2, 2.8, texMat(menuTexture(info, 'chalk'), 1.0, 0.95), w / 2 + 0.03, 1.9, F - 2.2, Math.PI / 2); // 側牆價目板
  if (o.props) plazaProps(g, info);                                     // 廣場小物（路燈、長椅…）
},
```
註冊後在 `STYLE_NAMES` 加一個中文名稱；用 `createShop('bakery', { name: '…', color: '#…' })` 建立。

## 規則（請 AI 遵守）
1. 只用 Three.js 基本幾何與 Canvas 貼圖，**不載入外部模型或圖片檔**。
2. 招牌與標誌**只放文字名稱，不放公司 logo**。
3. 會發光的東西（窗、招牌、LED）一律用 `glow` 或 `texMat`，這樣日夜切換才會自動變化。
4. 重複的幾何與材質要共用（`std`、`glow` 已有快取），不要每間店各建一份。
5. 正面朝 +z、門在 x = 0；不要改 `DIM`。
6. 完成後確認：`createShop` 回傳的群組能被 `mergeStatic` 合併、不報錯；日夜切換 `setDayNight(0/1)` 外觀正常。

## 提示詞範本
> 請閱讀 `docs/shops.md` 與 `town-kit.js` 的 `bookshop` 樣式。依相同的積木與座標約定，新增一種店面樣式 `〔名稱〕`：〔外觀描述：例如兩層樓、圓拱門、屋頂有花園〕。主色用 `info.color`。只用 B／P／panel 與現有零件函式，招牌只放文字。輸出：要加進 `SHOP_STYLES` 的函式、要加進 `STYLE_NAMES` 的一行，以及一段 5 行以內的建立範例。

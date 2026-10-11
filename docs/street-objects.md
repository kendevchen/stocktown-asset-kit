# 街道物件（Street objects）

給開發者與 AI 讀的說明：街區、道路、路燈、行道樹、廣場小物、排隊欄杆，以及它們怎麼接到日夜與模擬。

## 街區：`createStreet`
```js
const street = createStreet({ cols: 5, rows: 3, ring: 1, seed: 5, parks: [[2, 1]] });
scene.add(street.group);
// street.blocks：所有街廓 { c, r, x, z, inner, park }
// street.lots：可放店面的地塊（inner 且不是公園）
// street.parks：被指定成公園的街廓
```
| 參數 | 意思 |
|---|---|
| `cols`、`rows` | 中間店面地塊的欄數與列數；`r` 越大越靠近前方（+z） |
| `ring` | 外圍配景街廓的圈數（只放大樓、樹、路燈，不放店面） |
| `seed` | 配景隨機種子，同一個 seed 結果固定 |
| `shopLots` | 中間地塊是否預留店面位置（左右後側放配景建築） |
| `parks` | `[[c, r], …]`：指定哪幾格改成公園（整塊留空、有草地與樹） |

- 街廓以 `DIM.pitch = 40` 為間距，邊長 30，內部地塊 24。
- 前方與右側的外圍配景大樓刻意壓低，避免擋住店面。
- 想要「正中心」的位置：欄數與列數都用奇數（例如 5×3）。
- 同一個 `seed` 會產生同樣的外圍建築，改 seed 可換一個街景。

## 廣場小物：`addProp`、`plazaProps`
```js
addProp(g, 'bench', x, z, ry);      // kind：lamp | bench | planter | bin | hydrant
addPool(g, x, z, size, strength);   // 地面光暈（夜間才亮）
plazaProps(g, info);                // 店面前方整組預設小物
finalize(scene);                    // 所有 addProp／addPool 之後呼叫一次，才會真正建立
```
- 小物都是**共用的實例化網格**：同一種 kind 只建一份幾何，再放很多個位置。
- 新增 kind：在 `propKinds()` 裡加一項 `[[幾何, 材質, 是否投影], …]`，名字就是 kind。

## 排隊欄杆：`createQueueMaze`
```js
const buy = createQueueMaze({ color: '#ff4d4f', inner: 1.1 });  // 右邊
const sell = createQueueMaze({ color: '#22b35e', inner: 1.1 }); // 左邊
buy.group.position.copy(shop.position);
sell.group.position.copy(shop.position); sell.group.scale.x = -1; // 鏡像
```
`inner` 是排隊區離店門中線的距離；兩邊都有隊伍時設大一點（例如 1.1），中間留出店門走道。

## 日夜與動畫
- `setDayNight(n)`：`n = 1` 夜晚、`0` 白天。所有用 `glow()`、`texMat()` 建的材質、窗戶、路燈、光暈都會一起變化。
- `animate(t)`：每幀呼叫，更新跑馬燈與閃爍燈。
- `resetScene()`：重建場景前呼叫，清空登記表。

## 與人流／車流的連接（`town-sim.js`）
```js
const sim = createTownSim({ blocks: street.blocks, shops: [{ lot, accent, interval, walkers, cars, queues: [...] }] });
scene.add(sim.group);
sim.prewarm(15);                     // 預熱，開場就是流動中的樣子
// 每幀：sim.step(simDt); sim.update(dt);
// 其他：setNight(n)、setDetail(level)、setShutter(sec)、setView(camera, target)
```
街廓座標決定人行道路網與車道，所以**店面的 `lot` 必須取自 `street.lots`**。

## 規則（請 AI 遵守）
1. 新物件優先用實例化網格（`InstancedMesh`），同種物件共用幾何與材質。
2. 路燈、窗戶、招牌這類會發光的東西，用 `glow()` 或 `texMat()`，不要直接用 `MeshBasicMaterial`。
3. 物件座標用群組內座標（相對於地塊中心），不要寫世界座標。
4. 不改 `DIM`；新物件高度不超過路燈（約 4.3 m），以免遮住店面。
5. 不載入外部模型、圖片或字型檔。

## 提示詞範本
> 請閱讀 `docs/street-objects.md` 與 `town-kit.js` 的 `propKinds()`。新增一種廣場小物 `〔名稱〕`（例如：自行車架、公車站牌、噴水池），用實例化網格與共用材質，高度不超過 2 m。輸出：要加進 `propKinds()` 的項目，以及在 `plazaProps` 或自訂位置放置的範例程式。

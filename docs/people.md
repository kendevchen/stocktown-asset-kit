# 人物（People）

給開發者與 AI 讀的說明：方塊小人的造型、動作，以及怎麼大量生成。

## 造型
每個小人由 7 個部位組成，**每個部位是一個實例化網格**（同一個部位的所有小人共用一份幾何）：

| 部位 | 尺寸（寬×高×深） | 顏色來源 | 關節 |
|---|---|---|---|
| 左／右腿 `legL` `legR` | 0.17 × 0.78 × 0.19 | `pants` | 髖（±0.10, 0.78） |
| 身體 `torso` | 0.44 × 0.58 × 0.25 | `shirt` | — |
| 左／右手 `armL` `armR` | 0.13 × 0.56 × 0.15 | `shirt` | 肩（±0.29, 1.34） |
| 頭 `head` | 0.34 × 0.34 × 0.34 | `skin` | — |
| 頭髮 `hair` | 頂部 0.36×0.10×0.36 ＋ 後腦 0.36×0.22×0.07 | `hair` | — |

- 身高約 1.74 m，腳底在 y = 0，**臉朝 +z**。
- 不使用貼圖，只用單色；外觀差異全靠 4 種顏色（衣、褲、膚、髮）。

## 外觀：`PALETTE`、`randomLook`
```js
const look = randomLook(rand, accent);   // { shirt, pants, skin, hair }
people.setLook(i, look);
```
- 色盤在 `PALETTE`（衣 14 色、褲 7 色、膚 6 色、髮 8 色）。
- `accent` 是店家代表色：約 30% 的人會穿這個顏色。
- `rand` 傳入有種子的隨機函式（`rng(seed)`），結果才可重現。

## 生成與擺姿勢：`createVoxelPeople`
```js
const people = createVoxelPeople(count);          // 一次建好 count 個
scene.add(people.group);
people.setLook(i, randomLook(rand));
people.setPose(i, { x, y, z, yaw, scale, swing, bob, roll, sit, hidden });
people.commit();                                  // 姿勢或顏色改完後呼叫一次
people.setDetail(level);                          // 2＝低畫質：隱藏手與頭髮
```
| 姿勢參數 | 意思 |
|---|---|
| `x, y, z` | 腳底位置 |
| `yaw` | 面向（繞 y 軸，弧度） |
| `scale` | 整體縮放 |
| `swing` | 手腳擺動角度（走路用，左右反向） |
| `bob` | 上下起伏 |
| `roll` | 左右傾斜（繞 z 軸）；設 `Math.PI / 2` 就是側躺 |
| `sit` | 坐姿：兩腿一起往前抬（弧度，約 1.45）；同時把 `y` 設成約 −0.7，讓髖部貼地 |
| `hidden` | 不顯示 |

- 走路與站立的動作用 `walkPose(phase, moving, t, seed)` 產生 `swing／bob／roll／look`。
- 側躺：`roll: Math.PI/2`，並把腳點往身體中心偏移約 0.87 m，人才會躺在目標位置正中央。
- 坐姿與躺姿是靜態的，不需要每幀更新，`commit()` 一次即可。

## 路徑：`makePath`、`pathAt`
排隊或固定路線用：
```js
const path = makePath([[x0, z0], [x1, z1], …]);
pathAt(path, distance, out);   // out = { x, z, yaw }
```

## 規則（請 AI 遵守）
1. 維持 7 個部位與尺寸；要換造型（戴帽、背包）時**新增部位**，不要改現有部位的尺寸。
2. 新部位也要用實例化網格，並在 `setPose` 裡跟著同一個矩陣移動。
3. 不用貼圖、不載入外部模型；顏色只來自 `look`。
4. 新動作用新的姿勢參數表示（預設值要等於「不影響現有動作」，例如 `sit = 0`）。
5. 大量人物時優先 `setDetail(2)`，行動裝置用低畫質。

## 提示詞範本
> 請閱讀 `docs/people.md` 與 `town-kit.js` 的 `createVoxelPeople`。新增一個姿勢參數 `〔名稱〕`（例如：揮手、蹲下、拿手機），預設值為 0 時完全不影響現有動作。輸出：修改後的 `setPose` 程式、一段把 10 個小人擺成這個姿勢的範例。

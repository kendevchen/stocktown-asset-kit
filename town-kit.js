// =====================================================================
// town-kit.js：3D 迷你街景素材包 v1.0
// 內容：街景（街廓、道路、斑馬線、路燈、行道樹、配景建築）、方塊小人、
//       九種店面、店面零件（牆面文字、屋頂設備、遮雨棚、招牌）、廣場小物、
//       蛇形排隊欄杆、日夜切換、移軸模糊。
// 需求：Three.js r170，由 importmap 提供 'three' 與 'three/addons/'。
// 使用說明見 README.md。模型與貼圖全部用程式產生，沒有外部檔案。
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const KIT_VERSION = '1.0.0';

// 尺寸約定（公尺）：街廓間距、街廓邊長、內部地塊、人行道高度、店面正面位置（地塊中心往 +z）
export const DIM = { pitch: 40, block: 30, lot: 24, curbY: 0.2, frontZ: 3 };
export const FONT = '"Outfit","PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
export const MONO = '"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace';

// ---------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------
export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lerp = (a, b, t) => a + (b - a) * t;
export const mixHex = (a, b, t) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

// ---------------------------------------------------------------------
// 登記簿：夜間發光材質、光暈、燈泡、小物、動畫。finalize() 會把登記的東西一次建好
// ---------------------------------------------------------------------
const REG = { glow: [], fillers: [], poolMats: [], pools: [], bulbs: [], props: [], tickers: [], blinkers: [] };
// 重建整個場景前呼叫，清掉上一次登記的東西
export function resetScene() {
  for (let i = REG.glow.length - 1; i >= 0; i--) if (!REG.glow[i].userData.cached) REG.glow.splice(i, 1);
  for (const k of ['fillers', 'poolMats', 'pools', 'bulbs', 'props', 'tickers', 'blinkers']) REG[k].length = 0;
}

// ---------------------------------------------------------------------
// 材質
// ---------------------------------------------------------------------
const matCache = new Map();
export function std(color, rough = 0.85, metal = 0) {
  const key = `s|${color}|${rough}|${metal}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
  return matCache.get(key);
}
// 自發光材質：dayK＝白天亮度比例（1 不變、0 完全熄滅）
export function trackGlow(m, dayK = 0.7, cached = false) {
  m.userData.base = m.color.clone();
  m.userData.dayK = dayK;
  m.userData.cached = cached;
  REG.glow.push(m);
  return m;
}
export function glow(color, k = 1.5, dayK = 0.7) {
  const key = `g|${color}|${k}|${dayK}`;
  if (!matCache.has(key)) matCache.set(key, trackGlow(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }), dayK, true));
  return matCache.get(key);
}
// n：1＝夜晚（全亮）、0＝白天
export function setDayNight(n) {
  for (const m of REG.glow) m.color.copy(m.userData.base).multiplyScalar(lerp(m.userData.dayK, 1, n));
  for (const m of REG.fillers) m.emissiveIntensity = lerp(0.1, 1.05, n);
  for (const m of REG.poolMats) m.opacity = n;
}
export function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export function fitText(g, text, maxW, size, weight = 700, family = FONT) {
  g.font = `${weight} ${size}px ${family}`;
  const w = g.measureText(text).width;
  if (w > maxW) { size = Math.floor((size * maxW) / w); g.font = `${weight} ${size}px ${family}`; }
  return size;
}
export const texMat = (tex, k = 1.2, dayK = 0.8, opts = {}) => trackGlow(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(k, k, k), ...opts }), dayK);

// 基本積木：B＝方塊、P＝朝 +z 的平面、panel＝可旋轉的平面
export function B(g, w, h, d, mat, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  g.add(m);
  return m;
}
export function P(g, w, h, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
export function panel(g, w, h, mat, x, y, z, ry = 0) {
  const m = P(g, w, h, mat, x, y, z);
  m.rotation.y = ry;
  return m;
}

// ---------------------------------------------------------------------
// 店家資料（牆面文字全部從這裡讀）
// ---------------------------------------------------------------------
export function shopInfo(o = {}) {
  const rank = o.rank ?? 1, name = o.name ?? '小店', title = o.title ?? name, rows = o.rows ?? [], tags = o.tags ?? [];
  return {
    name, color: o.color ?? '#5ED3EF', title, rows, tags, rank,
    big: o.big ?? '', bigLabel: o.bigLabel ?? '', delta: o.delta ?? null, deltaLabel: o.deltaLabel ?? '較上週',
    upColor: o.upColor ?? '#5ED3EF', downColor: o.downColor ?? '#F5A445', // LED 看板的漲跌顏色（台股可設紅漲綠跌）
    series: o.series ?? null,
    menuHeader: o.menuHeader ?? '本店供應',
    footer: o.footer ?? (tags.length ? (o.tagLabel ?? '可輸入：') + tags.join('、') : ''),
    ledHeader: o.ledHeader ?? `第 ${rank} 名　${name}`,
    banner: o.banner ?? `第${rank}名`,
    promo: o.promo ?? '今日推薦',
    code: o.code ?? `No.${rank}`,
    ticker: o.ticker ?? [title, ...rows.map(([k, v]) => `${k} ${v}`)].join('　') + '　　',
  };
}
const tagText = info => info.tags.join('・');

// ---------------------------------------------------------------------
// 牆面文字貼圖
// ---------------------------------------------------------------------
export function signTexture(text, color, aspect, variant = 'dark') {
  const W = 1024, H = Math.max(96, Math.round(W / aspect));
  return canvasTex(W, H, g => {
    if (variant === 'accent') { g.fillStyle = color; g.fillRect(0, 0, W, H); g.fillStyle = '#0e1319'; }
    else {
      g.fillStyle = '#10151c'; g.fillRect(0, 0, W, H);
      const bar = Math.max(6, Math.round(H * 0.07));
      g.fillStyle = color; g.fillRect(0, H - bar, W, bar);
      g.fillStyle = '#ffffff';
    }
    fitText(g, text, W * 0.84, Math.round(H * 0.6), 800);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, H * (variant === 'accent' ? 0.53 : 0.47));
  });
}
export const signMat = (info, aspect, variant = 'dark', k = 1.5) => texMat(signTexture(info.name, info.color, aspect, variant), k, 0.8);
function sign(g, info, w, h, x, y, z, variant, k) { return P(g, w, h, signMat(info, w / h, variant, k), x, y, z); }

// 價目板：style＝'dark'（深色發光）、'light'（白底）、'chalk'（黑板）
export function menuTexture(info, style = 'dark') {
  const bg = style === 'chalk' ? '#1f2a24' : style === 'light' ? '#f4f1ea' : '#10151c';
  const fg = style === 'light' ? '#1a1f26' : '#f2f5f7';
  const dim = style === 'light' ? '#5b636d' : style === 'chalk' ? '#c3d1c6' : '#9fb0bd';
  return canvasTex(512, 640, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (style === 'chalk') { g.strokeStyle = '#8b6a45'; g.lineWidth = 22; g.strokeRect(11, 11, W - 22, H - 22); }
    else { g.fillStyle = info.color; g.fillRect(0, 0, W, 16); }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = dim; g.font = `600 30px ${FONT}`; g.fillText(info.menuHeader, 44, 86);
    g.fillStyle = fg; fitText(g, info.title, W - 88, 56, 800); g.fillText(info.title, 44, 150);
    info.rows.slice(0, 4).forEach(([k, v], i) => {
      const y = 246 + i * 84;
      g.textAlign = 'left'; g.fillStyle = dim; g.font = `500 32px ${FONT}`; g.fillText(k, 44, y);
      g.textAlign = 'right'; g.fillStyle = fg; fitText(g, String(v), W * 0.5, 40, 600, MONO); g.fillText(v, W - 44, y);
      g.fillStyle = style === 'light' ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.14)'; g.fillRect(44, y + 24, W - 88, 2);
    });
    if (info.footer) { g.textAlign = 'left'; g.fillStyle = dim; fitText(g, info.footer, W - 88, 28, 500); g.fillText(info.footer, 44, H - 50); }
  });
}
// LED 看板：標題列、大數字、變化百分比、長條走勢
export function ledTexture(info) {
  return canvasTex(1024, 384, (g, W, H) => {
    g.fillStyle = '#05080c'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.035)';
    for (let x = 0; x < W; x += 8) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = '#9fb0bd'; fitText(g, info.ledHeader, W - 104, 40, 600); g.fillText(info.ledHeader, 52, 78);
    const big = info.big || info.title;
    g.fillStyle = '#ffffff'; fitText(g, big, W * 0.55, 176, 600, MONO); g.fillText(big, 48, 250);
    const x2 = 70 + g.measureText(big).width;
    if (info.bigLabel) { g.fillStyle = '#9fb0bd'; fitText(g, info.bigLabel, W - x2 - 30, 38, 500); g.fillText(info.bigLabel, x2, 176); }
    if (info.delta !== null) {
      const t = `${info.delta >= 0 ? '▲' : '▼'} ${Math.abs(info.delta * 100).toFixed(1)}% ${info.deltaLabel}`;
      g.fillStyle = info.delta >= 0 ? info.upColor : info.downColor; fitText(g, t, W - x2 - 30, 48, 600, MONO); g.fillText(t, x2, 244);
    }
    const s = info.series;
    if (s && s.length) {
      const n = s.length, max = Math.max(...s), bw = (W - 104) / n;
      for (let i = 0; i < n; i++) { const h = (s[i] / max) * 70; g.fillStyle = i >= n - 7 ? info.color : 'rgba(255,255,255,.28)'; g.fillRect(52 + i * bw + 2, 356 - h, bw - 4, h); }
    }
  });
}
// 直式布條：文字逐字直排
export function bannerTexture(text, bg, fg = '#ffffff') {
  return canvasTex(256, 896, (g, W) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, 896);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const chars = [...text], size = Math.min(112, Math.floor(720 / Math.max(1, chars.length) / 1.14));
    g.font = `800 ${size}px ${FONT}`;
    let y = 96;
    for (const ch of chars) { g.fillText(ch, W / 2, y); y += size * 1.14; }
  });
}
// 透明底的窗貼或噴漆字
export function decalMat(text, color = '#ffffff', aspect = 8) {
  const tex = canvasTex(1024, Math.max(32, Math.round(1024 / aspect)), (g, W, H) => {
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, text, W * 0.94, H * 0.66, 700); g.fillText(text, W / 2, H / 2);
  });
  return texMat(tex, 1.1, 0.9, { transparent: true, depthWrite: false });
}
export function roundMenuTexture(info) {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = '#10151c'; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = info.color; g.lineWidth = 10; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 8, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    fitText(g, info.title, W * 0.7, 28, 800); g.fillText(info.title, W / 2, H * 0.37);
    g.fillStyle = '#cfe9e2';
    info.rows.slice(0, 2).forEach(([k, v], i) => { const t = `${k} ${v}`; fitText(g, t, W * 0.74, 24, 600, MONO); g.fillText(t, W / 2, H * (0.56 + i * 0.13)); });
  });
}
// 店內景：kind＝'show' 展示店、'book' 書店、'cafe' 咖啡館、'hangar' 機庫
export function paintInterior(g, kind, accent, W, H) {
  const r = rng(hashStr(kind + accent)), warm = kind !== 'show';
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, warm ? '#ffe4b5' : '#f2f8ff'); grd.addColorStop(1, warm ? '#c98f52' : '#a9bfd3');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  if (kind === 'book') {
    for (let row = 0; row < 3; row++) {
      const y0 = H * (0.12 + row * 0.27);
      g.fillStyle = '#5a3a22'; g.fillRect(0, y0 + H * 0.22, W, H * 0.03);
      for (let x = 2; x < W - 8;) {
        const bw = W * (0.016 + r() * 0.022), bh = H * (0.13 + r() * 0.08);
        g.fillStyle = `hsl(${Math.floor(r() * 360)},${35 + r() * 35}%,${32 + r() * 26}%)`;
        g.fillRect(x, y0 + H * 0.22 - bh, bw - 2, bh);
        x += bw;
      }
    }
  } else if (kind === 'cafe') {
    for (let i = 0; i < 6; i++) {
      const x = W * (0.08 + i * 0.17);
      g.fillStyle = '#3b2b20'; g.fillRect(x - 1, 0, 2, H * 0.18);
      g.fillStyle = '#fff4d6'; g.beginPath(); g.arc(x, H * 0.22, W * 0.03, Math.PI, 0); g.fill();
      g.fillStyle = '#6b4a33'; g.fillRect(x - W * 0.05, H * 0.72, W * 0.1, H * 0.03); g.fillRect(x - 3, H * 0.75, 6, H * 0.16);
    }
    g.fillStyle = accent; g.fillRect(0, H * 0.9, W, H * 0.1);
  } else if (kind === 'hangar') {
    g.fillStyle = 'rgba(40,52,64,.5)'; for (let x = 0; x < W; x += W / 8) g.fillRect(x, 0, W * 0.012, H);
    g.fillStyle = '#1b2530'; g.fillRect(W * 0.28, H * 0.18, W * 0.44, H * 0.5);
    g.fillStyle = accent; g.fillRect(W * 0.3, H * 0.21, W * 0.4, H * 0.44);
    g.fillStyle = '#e8f4ff'; g.fillRect(0, H * 0.93, W, H * 0.015);
  } else {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = '#1f2d3d'; g.fillRect(W * (0.06 + i * 0.24), H * 0.15, W * 0.18, H * 0.22);
      g.fillStyle = accent; g.fillRect(W * (0.068 + i * 0.24), H * 0.165, W * 0.164, H * 0.19);
    }
    g.fillStyle = '#ffffff'; g.fillRect(W * 0.12, H * 0.68, W * 0.76, H * 0.1);
    g.fillStyle = '#d7dee6'; g.fillRect(W * 0.12, H * 0.78, W * 0.76, H * 0.16);
  }
  for (let i = 0; i < 7; i++) {
    const x = W * (0.05 + r() * 0.9), h = H * (0.22 + r() * 0.12);
    g.fillStyle = 'rgba(40,30,25,.32)';
    g.fillRect(x - W * 0.016, H - h - H * 0.03, W * 0.032, h);
    g.beginPath(); g.arc(x, H - h - H * 0.07, W * 0.02, 0, Math.PI * 2); g.fill();
  }
}
export function interiorTexture(kind, accent, repeatX = 1) {
  const t = canvasTex(512, 256, (g, W, H) => paintInterior(g, kind, accent, W, H), repeatX !== 1);
  if (repeatX !== 1) t.repeat.set(repeatX, 1);
  return t;
}
export function archWindowTexture(text) {
  return canvasTex(256, 384, (g, W, H) => {
    g.save();
    g.beginPath(); g.moveTo(0, H); g.lineTo(0, W / 2); g.arc(W / 2, W / 2, W / 2, Math.PI, 0); g.lineTo(W, H); g.closePath(); g.clip();
    paintInterior(g, 'book', '#b5533b', W, H);
    g.restore();
    g.strokeStyle = '#efe6d2'; g.lineWidth = 14;
    g.beginPath(); g.moveTo(7, H); g.lineTo(7, W / 2); g.arc(W / 2, W / 2, W / 2 - 7, Math.PI, 0); g.lineTo(W - 7, H); g.stroke();
    if (text) { g.fillStyle = '#e8c56a'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, text, W * 0.8, 24, 600); g.fillText(text, W / 2, H - 34); }
  });
}
export function curtainTexture() {
  return canvasTex(128, 192, (g, W, H) => {
    g.fillStyle = '#ffd9a0'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#8c3b2a'; g.fillRect(0, 0, W * 0.24, H); g.fillRect(W * 0.76, 0, W * 0.24, H);
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, W, 8); g.fillRect(0, H - 8, W, 8); g.fillRect(0, 0, 8, H); g.fillRect(W - 8, 0, 8, H); g.fillRect(W / 2 - 3, 0, 6, H);
  });
}

// ---------------------------------------------------------------------
// 建材
// ---------------------------------------------------------------------
let brickTex_ = null, scallopTex_ = null, fanTex_ = null, glassMat_ = null, solarMat_ = null, wireMat_ = null, beamMat_ = null;
export const glassMat = () => glassMat_ || (glassMat_ = new THREE.MeshStandardMaterial({ color: '#cfe6ff', roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.45 }));
const wireMat = () => wireMat_ || (wireMat_ = new THREE.LineBasicMaterial({ color: '#1d1d1d' }));
export function brickBox(g, w, h, d, x, y, z) {
  if (!brickTex_) brickTex_ = canvasTex(256, 256, (c, W, H) => {
    c.fillStyle = '#d6c7b3'; c.fillRect(0, 0, W, H);
    const r = rng(77);
    for (let row = 0; row < 16; row++) for (let col = -1; col < 9; col++) {
      c.fillStyle = `hsl(${8 + r() * 12},${42 + r() * 16}%,${28 + r() * 11}%)`;
      c.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14);
    }
  }, true);
  const mk = (rx, ry) => { const t = brickTex_.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 }); };
  const side = mk(d / 2, h / 2), front = mk(w / 2, h / 2), top = std('#6d5a4d', 0.9);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, top, top, front, front]);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}
export function corrugatedMat(c1, c2, rx, ry, horizontal = false) {
  const t = canvasTex(64, 64, (g, W, H) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? c1 : c2; if (horizontal) g.fillRect(0, (i * H) / 8, W, H / 8); else g.fillRect((i * W) / 8, 0, W / 8, H); }
  }, true);
  t.repeat.set(rx, ry);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.45 });
}
export function scallopTexture() {
  if (!scallopTex_) scallopTex_ = canvasTex(256, 64, (g, W, H) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H * 0.45);
    for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(W / 16 + (i * W) / 8, H * 0.45, W / 16, 0, Math.PI); g.fill(); }
  }, true);
  return scallopTex_;
}
export function solarMat() {
  if (!solarMat_) solarMat_ = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5, map: canvasTex(128, 64, (g, W, H) => {
    g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#6d85b3'; g.lineWidth = 2;
    for (let x = 0; x <= W; x += W / 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += H / 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }) });
  return solarMat_;
}

// ---------------------------------------------------------------------
// 立面與屋頂零件
// ---------------------------------------------------------------------
export function acUnit(g, x, y, z, ry = 0) {
  if (!fanTex_) fanTex_ = canvasTex(128, 128, (c, W) => {
    c.fillStyle = '#c9ced4'; c.fillRect(0, 0, W, W);
    c.fillStyle = '#2b3036'; c.beginPath(); c.arc(W / 2, W / 2, W * 0.42, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#8d949c'; c.lineWidth = 3;
    for (let r = 10; r < W * 0.42; r += 9) { c.beginPath(); c.arc(W / 2, W / 2, r, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = '#5b6168';
    for (let k = 0; k < 3; k++) { c.save(); c.translate(W / 2, W / 2); c.rotate((k * Math.PI * 2) / 3); c.beginPath(); c.ellipse(0, -18, 9, 20, 0.4, 0, Math.PI * 2); c.fill(); c.restore(); }
  });
  const u = new THREE.Group();
  B(u, 1.3, 0.85, 0.62, std('#c9ced4', 0.6, 0.2), 0, 0.43, 0);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66), new THREE.MeshStandardMaterial({ map: fanTex_, roughness: 0.6 }));
  f.position.set(-0.22, 0.45, 0.315);
  u.add(f);
  B(u, 0.34, 0.5, 0.02, std('#9aa1a9', 0.7), 0.4, 0.45, 0.32, false);
  u.position.set(x, y, z);
  u.rotation.y = ry;
  g.add(u);
  return u;
}
export function waterTank(g, x, y, z) {
  for (const [dx, dz] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) B(g, 0.08, 0.6, 0.08, std('#555c63', 0.6, 0.5), x + dx, y + 0.3, z + dz, false);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 16), std('#d7dce1', 0.3, 0.8));
  t.position.set(x, y + 1.35, z); t.castShadow = true; g.add(t);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.35, 16), std('#c4cad0', 0.3, 0.8));
  cap.position.set(x, y + 2.27, z); g.add(cap);
}
export function ventPipe(g, x, y, z) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 8), std('#9aa1a9', 0.5, 0.6));
  p.position.set(x, y + 0.45, z); g.add(p);
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.18, 8), std('#9aa1a9', 0.5, 0.6));
  c.position.set(x, y + 0.98, z); g.add(c);
}
// 投射燈：燈具＋加法混合光錐（白天自動熄滅）
export function spotlight(g, x, y, z, tx, ty, tz) {
  if (!beamMat_) {
    const tex = canvasTex(8, 128, (c, W, H) => { const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, W, H); });
    beamMat_ = trackGlow(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color('#fff0d6').multiplyScalar(0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }), 0, true);
  }
  B(g, 0.2, 0.2, 0.28, std('#2a3038', 0.5, 0.5), x, y, z, false);
  const dir = new THREE.Vector3(tx - x, ty - y, tz - z), len = dir.length();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(len * 0.3, len, 16, 1, true), beamMat_);
  cone.position.set((x + tx) / 2, (y + ty) / 2, (z + tz) / 2);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize().negate());
  g.add(cone);
}
// 燈串：a、b 為群組內座標 [x,y,z]；燈泡在 finalize() 時統一建立
export function stringLights(g, a, b, n = 12, sag = 0.35) {
  const at = t => [lerp(a[0], b[0], t), lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag, lerp(a[2], b[2], t)];
  for (let i = 0; i <= n; i++) { const [x, y, z] = at(i / n); REG.bulbs.push({ g, x, y: y - 0.06, z }); }
  const pts = [];
  for (let i = 0; i <= 20; i++) pts.push(new THREE.Vector3(...at(i / 20)));
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat()));
}
// 立體發光字：同一張字形貼圖疊好幾層，後面幾層暗色當厚度
export function layeredText(g, text, w, h, x, y, z, frontHex, frontK = 1.8, sideHex = '#20262e', depth = 0.35, layers = 6) {
  const tex = canvasTex(1024, Math.max(64, Math.round((1024 * h) / w)), (c, W, H) => {
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitText(c, text, W * 0.96, H * 0.84, 800); c.fillText(text, W / 2, H * 0.53);
  });
  const geo = new THREE.PlaneGeometry(w, h);
  const side = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.45, color: sideHex, side: THREE.DoubleSide });
  const front = trackGlow(new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.45, color: new THREE.Color(frontHex).multiplyScalar(frontK) }), 0.75);
  for (let i = 0; i < layers; i++) {
    const m = new THREE.Mesh(geo, i === layers - 1 ? front : side);
    m.position.set(x, y, z - depth + (depth * i) / (layers - 1));
    g.add(m);
  }
}
// 帆布遮雨棚：斜面＋波浪邊垂簾
const awningMats = new Map();
export function awning(g, x, y, z, w, depth, color, tilt = 0.4) {
  if (!awningMats.has(color)) awningMats.set(color, { top: std(color, 0.85), val: new THREE.MeshStandardMaterial({ color, map: scallopTexture(), alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide }) });
  const M = awningMats.get(color);
  B(g, w, 0.06, depth, M.top, x, y, z + depth / 2).rotation.x = tilt;
  const vg = new THREE.PlaneGeometry(w, 0.38), uv = vg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (w / 2.4));
  const v = new THREE.Mesh(vg, M.val);
  v.position.set(x, y - (Math.sin(tilt) * depth) / 2 - 0.19, z + depth / 2 + (Math.cos(tilt) * depth) / 2);
  g.add(v);
}
export function hangingSign(g, text, x, y, z, color) {
  B(g, 0.06, 0.06, 1.2, std('#2a2a2a', 0.5, 0.6), x, y + 0.42, z - 0.55, false);
  const tex = canvasTex(512, 256, (c, W, H) => {
    c.fillStyle = color; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#efe6d2'; c.lineWidth = 12; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = '#fff8ec'; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitText(c, text, W * 0.84, H * 0.36, 700); c.fillText(text, W / 2, H / 2);
  });
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 1.3), texMat(tex, 1.05, 0.9));
  s.position.set(x, y, z - 0.35);
  g.add(s);
}
// 直立招牌：從右側牆（x）往外伸出，四周一圈燈泡
export function bladeSign(g, text, x, y, z, color, H = 4.2) {
  const iron = std('#2a2a2a', 0.5, 0.6);
  for (const dy of [H / 2 - 0.35, -H / 2 + 0.35]) B(g, 0.9, 0.08, 0.08, iron, x + 0.2, y + dy, z, false);
  const tex = canvasTex(256, 1024, (c, W, Hh) => {
    c.fillStyle = '#f6efe2'; c.fillRect(0, 0, W, Hh);
    c.strokeStyle = color; c.lineWidth = 18; c.strokeRect(9, 9, W - 18, Hh - 18);
    c.save(); c.translate(W / 2, Hh / 2); c.rotate(Math.PI / 2);
    c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle';
    fitText(c, text, Hh * 0.8, W * 0.52, 800); c.fillText(text, 0, 0);
    c.restore();
  });
  const s = new THREE.Mesh(new THREE.BoxGeometry(1.0, H, 0.22), texMat(tex, 0.82, 0.95));
  s.position.set(x + 0.75, y, z);
  g.add(s);
  for (let i = 0; i <= 9; i++) for (const dx of [0.3, 1.2]) REG.bulbs.push({ g, x: x + dx, y: y - H / 2 + 0.15 + (i * (H - 0.3)) / 9, z: z + 0.14 });
}
export function pergola(g, x, y, z, w, d) {
  const wood = std('#8a5a3b', 0.8);
  for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) B(g, 0.14, 2.3, 0.14, wood, x + dx, y + 1.15, z + dz);
  for (const dz of [-d / 2, d / 2]) B(g, w + 0.4, 0.14, 0.16, wood, x, y + 2.3, z + dz);
  for (let i = 0; i <= 6; i++) B(g, 0.09, 0.1, d + 0.4, wood, x - w / 2 + (w * i) / 6, y + 2.42, z, false);
  stringLights(g, [x - w / 2, y + 2.2, z - d / 2], [x + w / 2, y + 2.2, z + d / 2], 12, 0.4);
  stringLights(g, [x - w / 2, y + 2.2, z + d / 2], [x + w / 2, y + 2.2, z - d / 2], 12, 0.4);
  B(g, 1.2, 0.05, 0.7, wood, x, y + 0.75, z, false);
  B(g, 0.08, 0.72, 0.08, wood, x, y + 0.37, z, false);
  for (const [dx, dz] of [[-w / 2 + 0.4, d / 2 - 0.4], [w / 2 - 0.4, d / 2 - 0.4]]) {
    B(g, 0.5, 0.45, 0.5, std('#9c5b3a', 0.8), x + dx, y + 0.22, z + dz);
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), std('#3f7a47', 0.85));
    b.position.set(x + dx, y + 0.72, z + dz);
    g.add(b);
  }
}
export function sandwichBoard(g, info, x, z) {
  const tex = canvasTex(256, 320, (c, W) => {
    c.fillStyle = '#1d2621'; c.fillRect(0, 0, W, 320);
    c.strokeStyle = '#7b5a3a'; c.lineWidth = 16; c.strokeRect(8, 8, W - 16, 304);
    c.fillStyle = '#e8efe9'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    fitText(c, info.promo, W * 0.8, 30, 700); c.fillText(info.promo, W / 2, 64);
    c.fillStyle = info.color; fitText(c, info.title, W * 0.8, 34, 800); c.fillText(info.title, W / 2, 128);
    c.fillStyle = '#e8efe9';
    info.rows.slice(0, 2).forEach(([k, v], i) => { const t = `${k} ${v}`; fitText(c, t, W * 0.82, 26, 600, MONO); c.fillText(t, W / 2, 196 + i * 44); });
  });
  const holder = new THREE.Group();
  holder.position.set(x, 0, z);
  holder.rotation.y = 0.6;
  g.add(holder);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.04), texMat(tex, 0.95, 0.95));
  front.position.set(0, 0.52, 0.18); front.rotation.x = -0.28; holder.add(front);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.05, 0.04), std('#3b2b20', 0.8));
  back.position.set(0, 0.52, -0.18); back.rotation.x = 0.28; holder.add(back);
}
export function tickerMat(info, fg = '#e9fff9', bg = '#0b0f14') {
  const tex = canvasTex(2048, 96, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.textBaseline = 'middle'; g.font = `600 56px ${FONT}`;
    const tw = Math.max(200, g.measureText(info.ticker).width);
    for (let x = 0; x < W; x += tw) g.fillText(info.ticker, x, H / 2);
  }, true);
  REG.tickers.push(tex);
  return texMat(tex, 1.35, 0.8);
}
export function blinkMat() { const m = new THREE.MeshBasicMaterial({ color: '#ff2a1a' }); REG.blinkers.push(m); return m; }
// 單獨放一個廣場小物（kind：lamp、bench、planter、bin、hydrant、rack），群組內座標；finalize() 統一建立
export function addProp(g, kind, x, z, ry = 0) { REG.props.push({ kind, g, x, z, ry }); }
// 地面光暈（群組內座標）；finalize() 統一建立
export function addPool(g, x, z, s = 7, k = 1) { REG.pools.push({ g, x, y: g ? 0.03 : DIM.curbY + 0.03, z, s, k }); }

// ---------------------------------------------------------------------
// 廣場小物：店面前方廣場左半部（右半部留給排隊區，門左側 x = −2.6 是出店動線）
// ---------------------------------------------------------------------
export function plazaProps(g, info) {
  const put = (kind, x, z, ry = 0) => REG.props.push({ kind, g, x, z, ry });
  for (const [x, z] of [[-11.2, 3.8], [-11.2, 11.3], [11.2, 11.3], [11.2, 3.8]]) { put('lamp', x, z); addPool(g, x, z, 7, 1.1); }
  put('bench', -8.6, 10.9); put('bench', -5.7, 10.9);
  put('planter', -11, 7.4); put('planter', -6.9, 6.1); put('planter', -4.4, 4.3);
  put('bin', -3.9, 11.5);
  put('hydrant', -10.6, 14.3);
  put('rack', -9.8, 8.6, Math.PI / 2);
  sandwichBoard(g, info, -4.6, 8.2);
}
function propKinds() {
  const dark = std('#1f2a26', 0.6, 0.4), wood = std('#8a5a3b', 0.8), concrete = std('#a8a39a', 0.9), metal = std('#9aa3ad', 0.4, 0.7);
  return {
    lamp: [
      [mergeGeometries([new THREE.CylinderGeometry(0.07, 0.1, 3.4, 8).translate(0, 1.7, 0), new THREE.CylinderGeometry(0.2, 0.24, 0.12, 8).translate(0, 0.06, 0), new THREE.ConeGeometry(0.3, 0.25, 8).translate(0, 3.98, 0)]), dark, true],
      [new THREE.BoxGeometry(0.34, 0.46, 0.34).translate(0, 3.65, 0), glow('#ffdca8', 2.8, 0.12), false],
    ],
    bench: [[mergeGeometries([new THREE.BoxGeometry(1.6, 0.07, 0.45).translate(0, 0.45, 0), new THREE.BoxGeometry(1.6, 0.4, 0.06).translate(0, 0.72, -0.2), ...[-0.7, 0.7].map(x => new THREE.BoxGeometry(0.07, 0.45, 0.4).translate(x, 0.225, 0))]), wood, true]],
    planter: [
      [new THREE.BoxGeometry(0.9, 0.6, 0.9).translate(0, 0.3, 0), concrete, true],
      [new THREE.IcosahedronGeometry(0.55, 0).translate(0, 0.95, 0), std('#3b6b3f', 0.85), true],
    ],
    bin: [[new THREE.CylinderGeometry(0.26, 0.24, 0.9, 10).translate(0, 0.45, 0), std('#2f4a3a', 0.6, 0.3), true]],
    hydrant: [[mergeGeometries([new THREE.CylinderGeometry(0.14, 0.16, 0.6, 10).translate(0, 0.3, 0), new THREE.SphereGeometry(0.15, 10, 6).translate(0, 0.62, 0), new THREE.CylinderGeometry(0.05, 0.05, 0.36, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0)]), std('#c0392b', 0.5, 0.2), true]],
    rack: [[mergeGeometries([0, 1, 2].flatMap(i => [new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(-0.3, 0.375, i * 0.7 - 0.7), new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(0.3, 0.375, i * 0.7 - 0.7), new THREE.BoxGeometry(0.65, 0.05, 0.05).translate(0, 0.75, i * 0.7 - 0.7)])), metal, true]],
  };
}

// ---------------------------------------------------------------------
// 蛇形排隊區（地塊座標）：店門右側 lanes 條通道，滿了延伸到右側人行道
// ---------------------------------------------------------------------
// inner：排隊區內側離店門中線的距離（預設 0.1；兩邊都有排隊區時設大一點，中間留走道）
export function mazeLayout(lanes = 5, inner = 0.1) {
  const F = DIM.frontZ, xa = inner + 0.5, xb = 9.6, px = Array.from({ length: 7 }, (_, i) => inner + ((10.3 - inner) * i) / 6), last = px.length - 1;
  const lz = k => F + 1.4 + 1.2 * k, bz = j => F + 0.8 + 1.2 * j;
  const segs = [];
  for (let j = 0; j <= lanes; j++) {
    let from = 0, to = last;
    if (j === 0) from = 1;
    else if (j < lanes) { if (j % 2) to = last - 1; else from = 1; }
    for (let i = from; i < to; i++) segs.push([px[i], bz(j), px[i + 1], bz(j)]);
  }
  for (let j = 1; j < lanes; j++) segs.push([px[0], bz(j), px[0], bz(j + 1)]);
  for (let j = 0; j < lanes - 1; j++) segs.push([px[last], bz(j), px[last], bz(j + 1)]);
  const pts = [[xa, lz(0)]];
  for (let k = 0; k < lanes; k++) {
    const endX = k % 2 ? xa : xb;
    pts.push([endX, lz(k)]);
    if (k < lanes - 1) pts.push([endX, lz(k + 1)]);
  }
  const e = DIM.block / 2 - 2.3;
  pts.push([e, lz(lanes - 1)], [e, -e]);
  return { segs, pts, exitX: px[last] + 0.9, exitZ: lz(lanes - 1) };
}
export function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
// 沿路線距離 d 的位置；yaw 為面向隊伍前方
export function pathAt(path, d, out = {}) {
  d = Math.max(0, Math.min(path.len, d));
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < d) i++;
  const a = path.pts[i - 1], b = path.pts[i], L = path.cum[i] - path.cum[i - 1] || 1, f = (d - path.cum[i - 1]) / L;
  out.x = a[0] + (b[0] - a[0]) * f;
  out.z = a[1] + (b[1] - a[1]) * f;
  out.yaw = Math.atan2(a[0] - b[0], a[1] - b[1]);
  return out;
}
export function createQueueMaze({ color = '#5ED3EF', lanes = 5, inner = 0.1 } = {}) {
  const layout = mazeLayout(lanes, inner), group = new THREE.Group(), posts = [], seen = new Set();
  for (const [x1, z1, x2, z2] of layout.segs) for (const [x, z] of [[x1, z1], [x2, z2]]) { const k = `${x},${z}`; if (!seen.has(k)) { seen.add(k); posts.push([x, z]); } }
  const postGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.15, 0.17, 0.05, 12).translate(0, 0.025, 0),
    new THREE.CylinderGeometry(0.028, 0.028, 0.95, 8).translate(0, 0.5, 0),
    new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.98, 0),
  ]);
  const pm = new THREE.InstancedMesh(postGeo, std('#c9ced4', 0.3, 0.85), posts.length);
  const rm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.05, 1).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), layout.segs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  posts.forEach(([x, z], i) => pm.setMatrixAt(i, m.makeTranslation(x, 0, z)));
  layout.segs.forEach(([x1, z1, x2, z2], i) => rm.setMatrixAt(i, m.compose(p.set((x1 + x2) / 2, 0, (z1 + z2) / 2), q.setFromAxisAngle(up, x1 === x2 ? 0 : Math.PI / 2), s.set(1, 1, Math.hypot(x2 - x1, z2 - z1)))));
  for (const o of [pm, rm]) { o.castShadow = o.receiveShadow = true; group.add(o); }
  const path = makePath(layout.pts);
  return { group, layout, path, pathAt: (d, out) => pathAt(path, d, out), gap: 0.78 };
}

// ---------------------------------------------------------------------
// 店面：九種樣式。群組原點＝地塊中心、y 0＝人行道頂面；正面朝 +z（z = DIM.frontZ），門在 x = 0
// ---------------------------------------------------------------------
export const STYLE_NAMES = {
  showroom: '玻璃展示店', bookshop: '紅磚書店', hangar: '拱頂機庫', cafe: '圓形咖啡館',
  glass: '玻璃店面', brick: '兩層街屋', sawtooth: '鋸齒屋頂工坊', rotunda: '圓廳', tower: '細高樓',
};
export const SHOP_STYLES = {
  // 兩層玻璃展示店：二樓 LED 大螢幕、玻璃雨遮加燈條、屋頂立體字與投射燈、屋頂花園、太陽能板
  showroom(g, info, o) {
    const w = 13, d = 9, F = DIM.frontZ, cz = F - d / 2, h1 = 4.1, h2 = 8.2, acc = info.color;
    const white = std('#eef1f4', 0.55), frame = std('#d3d9df', 0.45, 0.3);
    B(g, w, h2, d, std('#dfe4ea', 0.7), 0, h2 / 2, cz);
    B(g, w + 0.4, 0.4, d + 0.4, white, 0, h2 + 0.2, cz);
    B(g, w + 0.2, 0.3, d + 0.2, white, 0, h1, cz);
    for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) for (const z of [F - 0.2, F - d + 0.2]) B(g, 0.42, h2, 0.42, frame, x, h2 / 2, z);
    P(g, w - 0.8, h1 - 0.35, texMat(interiorTexture('show', acc), 1.12, 0.85), 0, (h1 - 0.35) / 2 + 0.05, F + 0.02);
    for (const x of [-4.4, -1.4, 1.4, 4.4]) B(g, 0.09, h1 - 0.3, 0.1, frame, x, (h1 - 0.3) / 2, F + 0.06, false);
    B(g, 2.1, 2.9, 0.1, std('#26313d', 0.4, 0.4), 0, 1.45, F + 0.09, false);
    P(g, 1.8, 2.7, glow('#f3f8ff', 1.5), 0, 1.4, F + 0.15);
    P(g, w - 1.0, 3.3, texMat(ledTexture(info), 1.4, 0.95), 0, h1 + 2.0, F + 0.02);
    panel(g, d - 1.2, h1 - 0.5, texMat(interiorTexture('show', acc), 1.02, 0.85), w / 2 + 0.02, (h1 - 0.5) / 2 + 0.1, cz, Math.PI / 2);
    if (info.tags.length) panel(g, d - 1.6, 0.46, decalMat(tagText(info), '#ffffff', (d - 1.6) / 0.46), w / 2 + 0.04, 3.0, cz, Math.PI / 2);
    panel(g, 2.6, 3.25, texMat(menuTexture(info, 'light'), 1.02, 0.95), w / 2 + 0.04, h1 + 2.0, cz - 1.6, Math.PI / 2);
    B(g, w + 0.6, 0.08, 2.1, glassMat(), 0, h1 - 0.14, F + 1.05, false);
    B(g, w + 0.6, 0.08, 0.08, glow(acc, 2.4, 0.3), 0, h1 - 0.14, F + 2.1, false);
    for (const x of [-w / 2, w / 2]) B(g, 0.05, 0.05, 2.1, std('#9aa3ad', 0.4, 0.8), x, h1 - 0.06, F + 1.05, false);
    B(g, 0.06, 0.06, 1.1, frame, w / 2 - 0.3, h1 + 3.55, F + 0.55, false);
    panel(g, 0.95, 3.1, texMat(bannerTexture(info.banner, acc), 1.05, 0.9), w / 2 - 0.3, h1 + 1.95, F + 0.6, Math.PI / 2);
    for (const x of [-3.9, 3.9]) B(g, 0.12, 1.0, 0.12, frame, x, h2 + 0.9, F - 1.1, false);
    layeredText(g, info.name, 8.4, 1.9, 0, h2 + 1.55, F - 0.9, '#ffffff', 1.9, '#27313b');
    for (const x of [-2.8, 0, 2.8]) spotlight(g, x, h2 + 0.55, F - 0.15, x, h2 + 1.9, F - 1.0);
    for (const [x, z] of [[-4.6, cz - 1.6], [-2.4, cz - 2.6], [-4.8, cz + 0.4]]) {
      B(g, 1.9, 0.5, 1.1, std('#6b5a4a', 0.85), x, h2 + 0.65, z);
      for (const dx of [-0.55, 0, 0.55]) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), std('#3f7a47', 0.85)); b.position.set(x + dx, h2 + 1.05, z); b.castShadow = true; g.add(b); }
    }
    for (const x of [1.2, 3.2]) { B(g, 1.8, 0.06, 1.2, solarMat(), x, h2 + 0.95, cz - 2.4, false).rotation.x = -0.45; B(g, 0.06, 0.6, 0.06, frame, x, h2 + 0.7, cz - 2.0, false); }
    acUnit(g, 4.6, h2 + 0.4, cz + 0.6, -Math.PI / 2);
    acUnit(g, 4.6, h2 + 0.4, cz - 0.9, -Math.PI / 2);
    ventPipe(g, 1.8, h2 + 0.4, cz + 1.2);
    if (o.props) plazaProps(g, info);
  },
  // 兩層紅磚書店：拱窗書架、波浪邊帆布棚、門口吊牌、黑板菜單、轉角直立招牌、屋頂木棚架燈串
  bookshop(g, info, o) {
    const w = 12, d = 9, F = DIM.frontZ, cz = F - d / 2, h = 8.4, acc = info.color;
    const cream = std('#efe6d2', 0.7);
    brickBox(g, w, h, d, 0, h / 2, cz);
    B(g, w + 0.5, 0.45, d + 0.5, cream, 0, h + 0.22, cz);
    for (const [pw, pd, px, pz] of [[w + 0.5, 0.25, 0, F + 0.12], [w + 0.5, 0.25, 0, F - d - 0.12], [0.25, d + 0.5, w / 2 + 0.12, cz], [0.25, d + 0.5, -w / 2 - 0.12, cz]]) B(g, pw, 0.7, pd, cream, px, h + 0.8, pz);
    B(g, w + 0.2, 0.26, 0.3, cream, 0, 4.3, F + 0.1);
    for (const x of [-3.5, 3.5]) {
      P(g, 2.6, 3.5, texMat(archWindowTexture(tagText(info)), 1.08, 0.85, { transparent: true, alphaTest: 0.5 }), x, 1.95, F + 0.02);
      awning(g, x, 4.0, F, 3.0, 1.35, acc);
    }
    B(g, 1.9, 3.0, 0.12, std('#1f4a3a', 0.6), 0, 1.5, F + 0.06, false);
    P(g, 0.9, 1.3, glow('#ffe3b8', 1.3), 0, 2.0, F + 0.13);
    B(g, 2.3, 0.12, 0.3, cream, 0, 3.08, F + 0.12, false);
    hangingSign(g, info.title, 0, 3.55, F + 1.05, acc);
    for (const x of [-3.9, 0, 3.9]) { B(g, 1.9, 2.5, 0.12, cream, x, 6.15, F + 0.03, false); P(g, 1.6, 2.2, texMat(curtainTexture(), 0.95, 0.6), x, 6.15, F + 0.1); }
    panel(g, 2.2, 2.8, texMat(menuTexture(info, 'chalk'), 1.0, 0.95), w / 2 + 0.03, 1.9, F - 2.2, Math.PI / 2);
    for (const z of [F - 5.2, F - 7.4]) panel(g, 1.3, 1.9, texMat(curtainTexture(), 0.95, 0.6), w / 2 + 0.03, 6.1, z, Math.PI / 2);
    bladeSign(g, info.name, w / 2, 6.1, F - 0.8, acc);
    pergola(g, -1.8, h + 0.45, cz + 1.2, 6.2, 4.2);
    waterTank(g, 3.9, h + 0.45, cz - 2.7);
    acUnit(g, 4.3, h + 0.45, cz + 0.4, -Math.PI / 2);
    acUnit(g, 4.3, h + 0.45, cz + 1.9, -Math.PI / 2);
    ventPipe(g, 1.5, h + 0.45, cz - 3.2);
    if (o.props) plazaProps(g, info);
  },
  // 拱頂機庫：大捲門、鋼構雨遮與嵌燈、側牆噴漆字與看板、屋頂雷達、閃燈天線、桁架發光字
  hangar(g, info, o) {
    const w = 14, d = 10, F = DIM.frontZ, cz = F - d / 2, hw = 4.2, R = w / 2, rh = 3.3;
    const steel = std('#3a4048', 0.55, 0.5), silver = std('#aab3bd', 0.35, 0.75), dark = std('#23282e', 0.6, 0.4);
    const roofY = x => hw + rh * Math.sqrt(Math.max(0, 1 - (x / R) ** 2));
    B(g, w, hw, d, corrugatedMat('#3b424a', '#474f58', w / 1.2, 1), 0, hw / 2, cz);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(R, R, d + 0.6, 40, 1, true, Math.PI / 2, Math.PI), corrugatedMat('#58616b', '#6b7580', 1, 10, true));
    roof.rotation.x = Math.PI / 2;
    roof.scale.set(1, 1, rh / R);
    roof.position.set(0, hw, cz);
    roof.castShadow = roof.receiveShadow = true;
    g.add(roof);
    const gable = new THREE.Shape();
    gable.moveTo(R, 0); gable.absellipse(0, 0, R, rh, 0, Math.PI, false); gable.lineTo(R, 0);
    const gGeo = new THREE.ShapeGeometry(gable, 24);
    for (const [z, ry] of [[F + 0.31, 0], [F - d - 0.31, Math.PI]]) { const m = new THREE.Mesh(gGeo, steel); m.position.set(0, hw, z); m.rotation.y = ry; g.add(m); }
    const vent = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), glow('#cfeaff', 1.2));
    vent.position.set(0, hw + 1.6, F + 0.33);
    g.add(vent);
    P(g, w - 4, 3.8, texMat(interiorTexture('hangar', '#9fd8ff'), 1.15, 0.85), 0, 2.0, F + 0.02);
    B(g, w - 3.4, 0.55, 0.6, dark, 0, 4.05, F + 0.3);
    for (const x of [-(w - 4) / 2 - 0.3, (w - 4) / 2 + 0.3]) B(g, 0.6, 4.0, 0.5, dark, x, 2.0, F + 0.25);
    P(g, 1.2, 1.6, texMat(menuTexture(info, 'dark'), 1.05, 0.95), -w / 2 + 0.7, 1.6, F + 0.03);
    B(g, w - 2, 0.16, 2.6, steel, 0, 4.72, F + 1.3);
    for (const x of [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5]) {
      const dl = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), glow('#eaf6ff', 3.0, 0.2));
      dl.rotation.x = Math.PI / 2;
      dl.position.set(x, 4.63, F + 1.9);
      g.add(dl);
      addPool(g, x, F + 1.9, 3.4, 1.0);
    }
    panel(g, 6.4, 1.3, decalMat(info.code, '#dfe6ee', 6.4 / 1.3), w / 2 + 0.03, 3.3, F - 6.8, Math.PI / 2);
    panel(g, 5.8, 1.1, decalMat(info.title, '#9fd8ff', 5.8 / 1.1), w / 2 + 0.03, 1.8, F - 6.9, Math.PI / 2);
    panel(g, 3.2, 1.5, texMat(ledTexture(info), 1.3, 0.95), w / 2 + 0.03, 2.5, F - 1.9, Math.PI / 2);
    const tz = F - 1.4, ty = hw + rh + 0.35;
    for (const dy of [0, 1.9]) B(g, 7.4, 0.12, 0.12, silver, 0, ty + dy, tz, false);
    for (let i = 0; i <= 8; i++) {
      const x = -3.7 + (7.4 * i) / 8;
      B(g, 0.09, 1.9, 0.09, silver, x, ty + 0.95, tz, false);
      if (i < 8) B(g, 0.07, 2.1, 0.07, silver, x + 0.46, ty + 0.95, tz, false).rotation.z = (i % 2 ? 1 : -1) * 0.45;
    }
    for (const x of [-3.2, 3.2]) { const sy = roofY(x); B(g, 0.14, ty - sy + 0.1, 0.14, silver, x, (ty + sy) / 2, tz, false); }
    layeredText(g, info.name, 5.2, 1.6, 0, ty + 0.95, tz + 0.35, '#e8f6ff', 2.0, '#1d232a', 0.3, 5);
    const rx = -3.6, rz = cz - 2.2, top = roofY(rx) + 1.2;
    B(g, 0.2, 1.2, 0.2, dark, rx, top - 0.6, rz);
    const tilt = -2.3, pole = new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt));
    const dish = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 8, 0, Math.PI * 2, 0, 0.9), new THREE.MeshStandardMaterial({ color: '#e6e9ed', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
    dish.rotation.x = tilt;
    dish.position.set(rx, top, rz).addScaledVector(pole, -1.2);
    dish.castShadow = true;
    g.add(dish);
    const ax = 3.8, az = cz - 3.0, ay = roofY(ax);
    B(g, 0.08, 3.4, 0.08, silver, ax, ay + 1.7, az, false);
    for (const [yy, ww] of [[1.2, 1.0], [2.2, 0.7], [3.0, 0.45]]) B(g, ww, 0.05, 0.05, silver, ax, ay + yy, az, false);
    const bl = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), blinkMat());
    bl.position.set(ax, ay + 3.5, az);
    bl.userData.keep = true;
    g.add(bl);
    B(g, 3.2, 0.2, 1.6, dark, 0, hw + rh + 0.1, cz - 1.0);
    acUnit(g, 0.8, hw + rh + 0.2, cz - 1.0, -Math.PI / 2);
    acUnit(g, -0.8, hw + rh + 0.2, cz - 1.0, -Math.PI / 2);
    if (o.props) plazaProps(g, info);
  },
  // 兩層圓形咖啡館：環形落地窗、環形波浪邊帆布棚、圓形菜單板、跑馬燈、弧形發光招牌、銅色圓頂與燈亭
  cafe(g, info, o) {
    const r = 5.0, F = DIM.frontZ, cz = F - r, h1 = 4.0, h2 = 3.0, acc = info.color;
    const white = std('#f1f3f2', 0.6), frame = std('#d8dcd9', 0.5, 0.3);
    const cyl = (rt, rb, hh, mat, y, open = false, t0 = 0, tl = Math.PI * 2, seg = 48) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, hh, seg, 1, open, t0, tl), mat);
      m.position.set(0, y, cz);
      m.castShadow = m.receiveShadow = !mat.isMeshBasicMaterial;
      g.add(m);
      return m;
    };
    cyl(r + 0.3, r + 0.35, 0.3, std('#b9b4aa', 0.9), 0.15);
    cyl(r - 0.05, r - 0.05, h1, white, h1 / 2 + 0.3);
    cyl(r + 0.02, r + 0.02, h1 - 0.6, texMat(interiorTexture('cafe', acc, 3), 1.08, 0.85), 2.1, true, -2.3, 4.6);
    for (let i = 0; i <= 12; i++) { const a = -2.3 + (4.6 * i) / 12; B(g, 0.1, h1 - 0.5, 0.1, frame, Math.sin(a) * (r + 0.06), 2.1, cz + Math.cos(a) * (r + 0.06), false); }
    B(g, 1.9, 2.8, 0.14, std('#2b3a35', 0.5, 0.3), 0, 1.7, F + 0.06, false);
    P(g, 1.6, 2.6, glow('#fff0d2', 1.5), 0, 1.65, F + 0.14);
    for (const a of [-1.25, 1.25]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32), texMat(roundMenuTexture(info), 1.05, 0.95));
      disc.position.set(Math.sin(a) * (r + 0.12), 2.3, cz + Math.cos(a) * (r + 0.12));
      disc.rotation.y = a;
      g.add(disc);
    }
    cyl(r + 0.05, r + 1.5, 0.8, new THREE.MeshStandardMaterial({ color: acc, roughness: 0.85, side: THREE.DoubleSide }), h1 + 0.35, true);
    const vGeo = new THREE.CylinderGeometry(r + 1.5, r + 1.5, 0.38, 64, 1, true), vuv = vGeo.attributes.uv;
    for (let i = 0; i < vuv.count; i++) vuv.setX(i, vuv.getX(i) * ((2 * Math.PI * (r + 1.5)) / 2.4));
    const val = new THREE.Mesh(vGeo, new THREE.MeshStandardMaterial({ color: acc, map: scallopTexture(), alphaTest: 0.5, roughness: 0.85, side: THREE.DoubleSide }));
    val.position.set(0, h1 - 0.24, cz);
    g.add(val);
    cyl(r - 0.35, r - 0.35, h2, white, h1 + 0.3 + h2 / 2);
    for (let i = 0; i < 7; i++) {
      const a = -1.5 + i * 0.5, wdw = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20), glow('#ffe0a8', 1.05));
      wdw.position.set(Math.sin(a) * (r - 0.33), h1 + 1.9, cz + Math.cos(a) * (r - 0.33));
      wdw.rotation.y = a;
      g.add(wdw);
    }
    const tm = tickerMat(info);
    tm.map.repeat.set(5, 1);
    cyl(r - 0.32, r - 0.32, 0.5, tm, h1 + 1.0, true);
    cyl(r - 0.3, r - 0.3, 0.9, signMat(info, ((r - 0.3) * 2.0) / 0.9, 'dark', 1.6), h1 + 0.3 + h2 - 0.6, true, -1.0, 2.0);
    cyl(r - 0.2, r - 0.2, 0.25, frame, h1 + 0.3 + h2 + 0.12);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r - 0.3, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), std('#b87333', 0.35, 0.6));
    dome.scale.y = 0.62;
    dome.position.set(0, h1 + 0.3 + h2 + 0.24, cz);
    dome.castShadow = true;
    g.add(dome);
    const topY = h1 + 0.3 + h2 + 0.24 + (r - 0.3) * 0.62;
    cyl(0.55, 0.55, 0.9, glow('#fff1d0', 0.75), topY + 0.45, false, 0, Math.PI * 2, 16);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; B(g, 0.08, 0.95, 0.08, frame, Math.sin(a) * 0.56, topY + 0.45, cz + Math.cos(a) * 0.56, false); }
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.6, 16), std('#b87333', 0.35, 0.6));
    cap.position.set(0, topY + 1.2, cz);
    g.add(cap);
    B(g, 2.4, 0.3, 3.0, std('#8d8f8a', 0.9), 6.2, 0.15, cz - 1.9);
    acUnit(g, 6.2, 0.3, cz - 1.2, -Math.PI / 2);
    acUnit(g, 6.2, 0.3, cz - 2.7, -Math.PI / 2);
    if (o.props) plazaProps(g, info);
  },
  // 玻璃店面：平屋頂、雨遮、屋頂招牌
  glass(g, info) {
    const w = 12, h = 6.4, d = 9, F = DIM.frontZ, cz = F - d / 2;
    B(g, w, h, d, std('#e2e5e9', 0.7), 0, h / 2, cz);
    B(g, w + 0.3, 0.35, d + 0.3, std('#98a0a8', 0.8), 0, h + 0.17, cz);
    P(g, w - 1.4, 3.3, glow('#ffd29a', 1.2), 0, 1.95, F + 0.02);
    for (const i of [-2, -1, 1, 2]) B(g, 0.12, 3.4, 0.12, std('#2a3038', 0.6), i * 2.2, 1.95, F + 0.08, false);
    B(g, 1.9, 2.7, 0.1, std('#2b3139', 0.5), 0, 1.35, F + 0.1, false);
    P(g, 1.6, 2.5, glow('#fff1d6', 1.5), 0, 1.3, F + 0.16);
    B(g, w + 0.8, 0.22, 1.9, std(info.color, 0.55), 0, 3.85, F + 0.95);
    P(g, w - 1.4, 1.2, glow('#bcd6ff', 0.55), 0, 5.15, F + 0.02);
    for (const x of [-3.2, 3.2]) B(g, 0.14, 1.4, 0.14, std('#2a3038', 0.6), x, h + 0.9, F - 1.2, false);
    B(g, 8.4, 1.9, 0.35, std('#1a1f26', 0.7), 0, h + 2.4, F - 1.2);
    sign(g, info, 8.1, 1.65, 0, h + 2.4, F - 1.2 + 0.18, 'dark', 1.5);
  },
  // 兩層街屋：橫向招牌、素色遮陽棚
  brick(g, info) {
    const w = 11, h = 8.2, d = 9, F = DIM.frontZ, cz = F - d / 2;
    B(g, w, h, d, std(mixHex('#d8c6ad', info.color, 0.18), 0.9), 0, h / 2, cz);
    B(g, w + 0.5, 0.45, d + 0.5, std('#574b42', 0.8), 0, h + 0.22, cz);
    B(g, w + 0.2, 0.25, 0.3, std('#574b42', 0.8), 0, 4.1, F + 0.1);
    for (const x of [-3.3, 3.3]) {
      P(g, 3.0, 2.5, glow('#ffc98a', 1.15), x, 1.85, F + 0.02);
      B(g, 3.4, 0.08, 1.3, std(info.color, 0.7), x, 3.35, F + 0.55).rotation.x = 0.38;
    }
    B(g, 1.9, 2.8, 0.12, std('#3a2f28', 0.6), 0, 1.4, F + 0.06, false);
    P(g, 1.55, 2.5, glow('#ffe3b8', 1.35), 0, 1.3, F + 0.13);
    sign(g, info, w - 1.6, 1.05, 0, 4.78, F + 0.03, 'accent', 1.15);
    const r = rng(hashStr(info.name + ':w'));
    for (const x of [-3.6, -1.2, 1.2, 3.6]) P(g, 1.3, 1.7, r() < 0.7 ? glow('#ffd9a8', 0.9) : std('#1b2330', 0.3), x, 6.4, F + 0.02);
  },
  // 鋸齒屋頂工坊：大捲門、天窗發光
  sawtooth(g, info) {
    const w = 13, h = 5, d = 9, F = DIM.frontZ, cz = F - d / 2;
    B(g, w, h, d, std('#cdd2d7', 0.85), 0, h / 2, cz);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(3, 0); shape.lineTo(0, 1.7);
    const tooth = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    tooth.rotateY(Math.PI / 2);
    const roof = std(mixHex('#5d656e', info.color, 0.28), 0.7);
    for (let k = 0; k < 3; k++) {
      const z0 = F - k * 3, m = new THREE.Mesh(tooth, roof);
      m.position.set(-w / 2, h, z0);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      P(g, w - 0.6, 1.45, glow('#cfe3ff', 0.75), 0, h + 0.8, z0 + 0.02);
    }
    P(g, 5.2, 3.3, glow('#ffcf8f', 1.25), 0, 1.75, F + 0.02);
    B(g, 5.6, 0.25, 0.3, std(info.color, 0.6), 0, 3.55, F + 0.12);
    for (const x of [-4.6, 4.6]) P(g, 1.8, 1.6, glow('#ffd7a0', 0.95), x, 2.2, F + 0.02);
    sign(g, info, 8.6, 0.95, 0, 4.3, F + 0.03, 'dark', 1.5);
  },
  // 圓廳：環形櫥窗、弧形招牌、圓頂
  rotunda(g, info) {
    const r = 5.0, h = 5.6, F = DIM.frontZ, cz = F - r;
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
    add(new THREE.CylinderGeometry(r, r, h, 40), std('#e8e3da', 0.75), 0, h / 2, cz).castShadow = true;
    add(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 2.3, 40, 1, true, -1.35, 2.7), glow('#ffd49c', 1.1), 0, 1.9, cz);
    add(new THREE.CylinderGeometry(r + 0.3, r + 0.3, 0.32, 40), std('#8d857a', 0.8), 0, h, cz);
    const dome = add(new THREE.SphereGeometry(r * 1.02, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), std(info.color, 0.45, 0.25), 0, h + 0.16, cz);
    dome.scale.y = 0.6;
    add(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 1.15, 40, 1, true, -0.95, 1.9), signMat(info, (r * 1.9) / 1.15, 'dark', 1.5), 0, 4.25, cz);
    B(g, 3.8, 0.2, 2.2, std(info.color, 0.6), 0, 3.4, F + 0.8);
    for (const x of [-1.7, 1.7]) B(g, 0.12, 3.3, 0.12, std('#2a3038', 0.6), x, 1.65, F + 1.75);
    P(g, 1.6, 2.5, glow('#fff0d2', 1.5), 0, 1.3, F + 0.12);
  },
  // 細高樓：轉角燈條、屋頂看板
  tower(g, info) {
    const w = 9, h = 12.5, d = 8, F = DIM.frontZ, cz = F - d / 2;
    B(g, w, h, d, std('#c6cbd2', 0.7), 0, h / 2, cz);
    P(g, w - 1.2, 3.1, glow('#ffd49a', 1.2), 0, 1.8, F + 0.02);
    B(g, w + 0.4, 0.25, 1.4, std('#39414b', 0.6), 0, 3.55, F + 0.7);
    [5.2, 7.5, 9.8].forEach((y, i) => P(g, w - 1.6, 1.0, glow('#bfd4ff', 0.45 + i * 0.12), 0, y, F + 0.02));
    B(g, 0.32, h - 1.2, 0.32, glow(info.color, 1.6), w / 2 - 0.1, h / 2 + 0.3, F + 0.1, false);
    B(g, 1.9, 2.7, 0.1, std('#2b3139', 0.5), 0, 1.35, F + 0.1, false);
    P(g, 1.6, 2.5, glow('#fff1d6', 1.5), 0, 1.3, F + 0.16);
    for (const x of [-2.6, 2.6]) B(g, 0.16, 1.8, 0.16, std('#2a3038', 0.6), x, h + 0.9, cz, false);
    B(g, 7.4, 2.4, 0.3, std('#1a1f26', 0.7), 0, h + 2.9, cz);
    sign(g, info, 7.1, 2.1, 0, h + 2.9, cz + 0.16, 'accent', 1.1);
  },
};

// 靜態零件依材質合併（細節再多，繪製次數也少）
export function mergeStatic(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), rel = new THREE.Matrix4();
  const buckets = new Map(), done = [];
  g.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!buckets.has(o.material)) buckets.set(o.material, { geos: [], cast: false });
    const bk = buckets.get(o.material);
    bk.geos.push(geo);
    bk.cast = bk.cast || o.castShadow;
    done.push(o);
  });
  for (const o of done) o.parent.remove(o);
  for (const [mat, { geos, cast }] of buckets) {
    const merged = mergeGeometries(geos, false);
    geos.forEach(x => x.dispose());
    if (!merged) continue;
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = cast;
    m.receiveShadow = !mat.isMeshBasicMaterial;
    g.add(m);
  }
  return g;
}
// 建立一間店。info 見 shopInfo()；opts.props＝是否附廣場小物（新四款才有）、opts.merge＝是否合併網格
export function createShop(style, info = {}, { props = true, merge = true } = {}) {
  const g = new THREE.Group(), inf = shopInfo(info);
  (SHOP_STYLES[style] || SHOP_STYLES.glass)(g, inf, { props });
  if (merge) mergeStatic(g);
  addPool(g, 0, DIM.frontZ + 3, 12, 1.35);
  g.userData = { style, info: inf };
  return g;
}

// ---------------------------------------------------------------------
// 方塊小人
// ---------------------------------------------------------------------
export const PALETTE = {
  shirt: ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#8ab17d', '#6d6875', '#b5838d', '#457b9d', '#e5e5e5', '#1d3557', '#cdb4db', '#3d405b', '#f2cc8f'],
  pants: ['#2b3a55', '#1f2328', '#4a4f57', '#6b5b45', '#39465a', '#5a3b2e', '#20304a'],
  skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d8a07a'],
  hair: ['#1b1512', '#2e211a', '#4a3322', '#6b4a2b', '#c9a15a', '#8c8c8c', '#101010', '#7a3b22'],
};
// 隨機外觀；accent 為店家代表色時，約三成的人穿這個顏色
export function randomLook(rand = Math.random, accent = null) {
  const pick = a => a[Math.floor(rand() * a.length)];
  return { shirt: accent && rand() < 0.3 ? accent : pick(PALETTE.shirt), pants: pick(PALETTE.pants), skin: pick(PALETTE.skin), hair: pick(PALETTE.hair) };
}
// 走路／站立的動作參數：moving 時手腳擺動，站著時輕微晃動、轉頭
export function walkPose(phase, moving, t = 0, seed = 0) {
  return moving
    ? { swing: Math.sin(phase) * 0.55, bob: Math.abs(Math.cos(phase)) * 0.035, roll: 0, look: 0 }
    : { swing: Math.sin(t * 1.3 + seed) * 0.04, bob: 0, roll: Math.sin(t * 0.9 + seed) * 0.025, look: Math.sin(t * 0.45 + seed) * 0.3 };
}
export function createVoxelPeople(count, { material } = {}) {
  const mat = material || new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 });
  const limbGeo = (w, h, d) => new THREE.BoxGeometry(w, h, d).translate(0, -h / 2, 0);
  const defs = {
    legL: [limbGeo(0.17, 0.78, 0.19), 'pants', [0.1, 0.78]],
    legR: [limbGeo(0.17, 0.78, 0.19), 'pants', [-0.1, 0.78]],
    torso: [new THREE.BoxGeometry(0.44, 0.58, 0.25).translate(0, 1.07, 0), 'shirt', null],
    armL: [limbGeo(0.13, 0.56, 0.15), 'shirt', [0.29, 1.34]],
    armR: [limbGeo(0.13, 0.56, 0.15), 'shirt', [-0.29, 1.34]],
    head: [new THREE.BoxGeometry(0.34, 0.34, 0.34).translate(0, 1.55, 0), 'skin', null],
    hair: [mergeGeometries([new THREE.BoxGeometry(0.36, 0.1, 0.36).translate(0, 1.74, 0), new THREE.BoxGeometry(0.36, 0.22, 0.07).translate(0, 1.62, -0.155)]), 'hair', null],
  };
  const group = new THREE.Group(), parts = {};
  for (const [name, [geo, key, joint]] of Object.entries(defs)) {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.userData = { key, joint };
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    group.add(m);
    parts[name] = m;
  }
  const list = Object.values(parts), col = new THREE.Color();
  const _B = new THREE.Matrix4(), _J = new THREE.Matrix4(), _W = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const sign = { legL: 1, legR: -1, armL: -0.8, armR: 0.8 };
  return {
    group, parts, count,
    setLook(i, look) { for (const m of list) m.setColorAt(i, col.set(look[m.userData.key])); },
    // pose：x y z、yaw（面向）、scale、swing（手腳擺動角度）、bob（上下起伏）、roll（左右傾）、hidden
    // sit：坐姿（兩腿一起往前抬，單位弧度，預設 0＝不影響原本動作）
    setPose(i, { x = 0, y = 0, z = 0, yaw = 0, scale = 1, swing = 0, bob = 0, roll = 0, sit = 0, hidden = false } = {}) {
      if (hidden) { for (const m of list) m.setMatrixAt(i, ZERO); return; }
      _e.set(0, yaw, roll);
      _B.compose(_p.set(x, y + bob, z), _q.setFromEuler(_e), _s.setScalar(scale));
      for (const [name, m] of Object.entries(parts)) {
        const j = m.userData.joint;
        if (!j) { m.setMatrixAt(i, _B); continue; }
        _J.makeRotationX(sit && (name === 'legL' || name === 'legR') ? -sit : swing * sign[name]).setPosition(j[0], j[1], 0);
        m.setMatrixAt(i, _W.multiplyMatrices(_B, _J));
      }
    },
    commit() { for (const m of list) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } },
    // level 2（低畫質）時隱藏手與頭髮
    setDetail(level) { parts.hair.visible = parts.armL.visible = parts.armR.visible = level < 2; },
  };
}

// ---------------------------------------------------------------------
// 街景：街廓、道路標線、路燈、行道樹、配景建築
// ---------------------------------------------------------------------
function radialTexture() {
  return canvasTex(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  });
}
function windowTextures() {
  const N = 8, S = 64, W = N * S;
  const c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
  c1.width = c1.height = c2.width = c2.height = W;
  const g1 = c1.getContext('2d'), g2 = c2.getContext('2d');
  g1.fillStyle = '#8b9098'; g1.fillRect(0, 0, W, W);
  g2.fillStyle = '#000'; g2.fillRect(0, 0, W, W);
  const r = rng(1234);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * S + 10, y = j * S + 14, w = S - 20, h = S - 26, lit = r() < 0.36;
    g1.fillStyle = lit ? '#d9c9a8' : '#1c2531'; g1.fillRect(x, y, w, h);
    if (lit) {
      const warm = r() < 0.8, a = 0.55 + r() * 0.45;
      g2.fillStyle = warm ? `rgba(255,${(205 + r() * 30) | 0},${(140 + r() * 40) | 0},${a})` : `rgba(175,205,255,${a})`;
      g2.fillRect(x, y, w, h);
      if (r() < 0.3) { g2.fillStyle = 'rgba(0,0,0,0.65)'; g2.fillRect(x, y, w, h * (0.3 + r() * 0.4)); }
    }
    g1.fillStyle = '#6f747b'; g1.fillRect(x - 3, y + h, w + 6, 3);
  }
  const mk = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; };
  return { map: mk(c1), emissive: mk(c2) };
}
const TINTS = ['#9aa1ab', '#a59a8c', '#8f9aa6', '#a3a69c', '#b3a792', '#8c8f99', '#a08f86', '#979fa0'];
// opts：cols×rows 為中間的店面地塊；ring＝外圍配景街廓圈數；shopLots＝中間地塊是否預留店面位置
// parks：[[c, r], …]，指定哪幾個店面街廓改成公園（不放店面、不放配景建築，也不會出現在回傳的 lots）
export function createStreet({ cols = 4, rows = 3, ring = 2, seed = 7, shopLots = true, parks = [] } = {}) {
  const { pitch, block, lot, curbY } = DIM, root = new THREE.Group();
  const blocks = [];
  for (let r = -ring; r < rows + ring; r++) for (let c = -ring; c < cols + ring; c++) {
    blocks.push({ c, r, x: (c - (cols - 1) / 2) * pitch, z: (r - (rows - 1) / 2) * pitch, inner: c >= 0 && c < cols && r >= 0 && r < rows, park: parks.some(([pc, pr]) => pc === c && pr === r) });
  }
  // 配景建築規劃（店面地塊只在後方與兩側放；鏡頭前方與右側的外圍壓低，免得擋住店面）
  const fill = [];
  for (const b of blocks) {
    const rr = rng(hashStr(`blk${b.c},${b.r},${seed}`));
    const add = (dx, dz, w, d, h) => fill.push({ x: b.x + dx, z: b.z + dz, w, d, h, tint: TINTS[Math.floor(rr() * TINTS.length)], u: rr(), v: rr() });
    const H = (lo, hi) => lo + Math.pow(rr(), 1.4) * (hi - lo);
    if (b.park && b.inner) continue; // 指定的公園：整塊留空
    if (b.inner && shopLots) {
      add(-6, -9.6, 11.2, 4.6, H(8, 16)); add(6, -9.6, 11.2, 4.6, H(8, 16));
      add(-9.9, -2.2, 3.8, 9.6, H(5, 10)); add(9.9, -2.2, 3.8, 9.6, H(4, 8));
      continue;
    }
    const low = b.r >= rows || b.c >= cols, lo = low ? 4 : 7, hi = low ? 10 : 24, pattern = Math.floor(rr() * 5);
    if (pattern === 0) { add(-5.9, 0, 11, 22.8, H(lo, hi)); add(5.9, 0, 11, 22.8, H(lo, hi)); }
    else if (pattern === 1) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(sx * 5.9, sz * 5.9, 11, 11, H(lo, hi)); }
    else if (pattern === 2) { add(-3.6, 0, 16, 22.8, H(lo, hi)); add(8.2, -5.9, 6.4, 11, H(lo, hi * 0.7)); add(8.2, 5.9, 6.4, 11, H(lo, hi * 0.7)); }
    else if (pattern === 3) { add(0, -6, 22.8, 11, H(lo, hi)); add(-6, 6, 11, 11, H(lo, hi * 0.8)); add(6, 6, 11, 11, H(lo, hi * 0.8)); }
    else { b.park = true; add(0, -8.6, 20, 5, H(lo, hi * 0.6)); }
  }
  // 地面、街廓、地塊
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), std('#1b1f26', 0.95));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; root.add(ground);
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(block, curbY, block).translate(0, curbY / 2, 0), std('#686e76', 0.9), blocks.length);
  const lots = new THREE.InstancedMesh(new THREE.PlaneGeometry(lot, lot).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }), blocks.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  blocks.forEach((b, i) => {
    slabs.setMatrixAt(i, m.makeTranslation(b.x, 0, b.z));
    lots.setMatrixAt(i, m.makeTranslation(b.x, curbY + 0.01, b.z));
    lots.setColorAt(i, col.set(b.park ? '#2d4431' : b.inner ? '#5e636a' : '#52575e'));
  });
  for (const o of [slabs, lots]) { o.receiveShadow = true; o.frustumCulled = false; root.add(o); }
  // 道路標線與斑馬線
  const xs = [], zs = [];
  for (let c = -ring; c <= cols + ring; c++) xs.push((c - (cols - 1) / 2 - 0.5) * pitch);
  for (let r = -ring; r <= rows + ring; r++) zs.push((r - (rows - 1) / 2 - 0.5) * pitch);
  const marks = [];
  for (const z of zs) for (let x = xs[0] - 8; x <= xs[xs.length - 1] + 8; x += 4) if (!xs.some(v => Math.abs(x - v) < 10)) marks.push([x, z, 2, 0.14]);
  for (const x of xs) for (let z = zs[0] - 8; z <= zs[zs.length - 1] + 8; z += 4) if (!zs.some(v => Math.abs(z - v) < 10)) marks.push([x, z, 0.14, 2]);
  for (const z of zs) for (const x of xs) for (const sg of [-1, 1]) for (let k = -4; k <= 4; k++) { marks.push([x + sg * 7.2, z + k, 2.6, 0.5]); marks.push([x + k, z + sg * 7.2, 0.5, 2.6]); }
  const mk = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), std('#aeb3b9', 0.8), marks.length);
  marks.forEach(([x, z, sx, sz], i) => mk.setMatrixAt(i, m.makeScale(sx, 1, sz).setPosition(x, 0.012, z)));
  mk.receiveShadow = true; mk.frustumCulled = false; root.add(mk);
  // 路燈與行道樹
  const rr = rng(seed), lamps = [], trees = [], e = block / 2 - 0.8;
  for (const b of blocks) {
    for (const [dx, dz] of [[e, e], [-e, e], [e, -e], [-e, -e], [0, e], [0, -e], [e, 0], [-e, 0]]) {
      const ox = Math.sign(dx), oz = Math.sign(dz), len = Math.hypot(ox, oz);
      lamps.push({ x: b.x + dx, z: b.z + dz, yaw: Math.atan2(ox, oz) });
      addPool(null, b.x + dx + (ox / len), b.z + dz + (oz / len), 9, 1);
    }
    for (const [dx, dz] of [[7, e], [-7, e], [7, -e], [-7, -e], [e, 7], [e, -7], [-e, 7], [-e, -7]]) trees.push({ x: b.x + dx, z: b.z + dz, s: 0.8 + rr() * 0.4 });
    if (b.park) for (let i = -1; i <= 1; i++) for (let j = 0; j <= 2; j++) trees.push({ x: b.x + i * 7 + (rr() - 0.5) * 2, z: b.z - 1 + j * 5 + (rr() - 0.5) * 2, s: 1 + rr() * 0.5 });
  }
  const poles = new THREE.InstancedMesh(mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.1, 4.3, 6).translate(0, curbY + 2.15, 0),
    new THREE.BoxGeometry(0.07, 0.07, 1.1).translate(0, curbY + 4.25, 0.5),
  ]), std('#2a3038', 0.6, 0.4), lamps.length);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.12, 0.5).translate(0, curbY + 4.2, 1.0), glow('#ffd9a6', 3.2, 0.12), lamps.length);
  lamps.forEach((L, i) => { m.compose(p.set(L.x, 0, L.z), q.setFromAxisAngle(up, L.yaw), s.set(1, 1, 1)); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m); });
  poles.castShadow = true;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.15, 2.5, 5).translate(0, 1.25, 0), std('#4a3a2e', 0.9), trees.length);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 0).translate(0, 3.55, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true }), trees.length);
  const greens = ['#2f5d3a', '#3b6b3f', '#2a5232', '#46704a', '#355e45'];
  trees.forEach((T, i) => {
    m.compose(p.set(T.x, curbY, T.z), q.setFromAxisAngle(up, rr() * Math.PI * 2), s.set(T.s, T.s, T.s));
    trunks.setMatrixAt(i, m); leaves.setMatrixAt(i, m); leaves.setColorAt(i, col.set(greens[i % greens.length]));
  });
  trunks.castShadow = leaves.castShadow = leaves.receiveShadow = true;
  for (const o of [poles, heads, trunks, leaves]) { o.frustumCulled = false; root.add(o); }
  // 配景建築：合併成一個網格，窗戶依世界尺寸貼圖
  const { map, emissive } = windowTextures(), RU = 4 / 512, RV = 1 - 4 / 512, geos = [];
  for (const f of fill) {
    const gg = new THREE.BoxGeometry(f.w, f.h, f.d), uv = gg.attributes.uv;
    const ou = Math.floor(f.u * 8) / 8, ov = Math.floor(f.v * 8) / 8, fw = [f.d, f.d, f.w, f.w, f.w, f.w], fh = [f.h, f.h, f.d, f.d, f.h, f.h];
    for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      if (face === 2 || face === 3) uv.setXY(i, RU, RV);
      else uv.setXY(i, ou + (uv.getX(i) * fw[face]) / 24, ov + (uv.getY(i) * fh[face]) / 25.6);
    }
    col.set(f.tint);
    const n = gg.attributes.position.count, cols3 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const k = i >= 8 && i < 16 ? 0.5 : 1; cols3[i * 3] = col.r * k; cols3[i * 3 + 1] = col.g * k; cols3[i * 3 + 2] = col.b * k; }
    gg.setAttribute('color', new THREE.BufferAttribute(cols3, 3));
    gg.translate(f.x, curbY + f.h / 2, f.z);
    geos.push(gg);
  }
  const fillerMat = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 1.05, vertexColors: true, roughness: 0.85 });
  REG.fillers.push(fillerMat);
  const fillers = new THREE.Mesh(mergeGeometries(geos), fillerMat);
  fillers.castShadow = fillers.receiveShadow = true;
  root.add(fillers);
  geos.forEach(x => x.dispose());
  return { group: root, blocks, lots: blocks.filter(b => b.inner && !b.park), parks: blocks.filter(b => b.inner && b.park) };
}

// ---------------------------------------------------------------------
// 收尾：把登記的小物、燈泡、光暈一次建好（所有店面擺好位置後呼叫）
// ---------------------------------------------------------------------
export function finalize(root) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  out.name = 'town-kit-finalize';
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const world = (g, x, y, z) => (g ? g.localToWorld(v.set(x, y, z)) : v.set(x, y, z));
  for (const [kind, parts] of Object.entries(propKinds())) {
    const list = REG.props.filter(it => it.kind === kind);
    if (!list.length) continue;
    for (const [geo, mat, shadow] of parts) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { world(it.g, it.x, 0, it.z); mesh.setMatrixAt(i, m.compose(v, q.setFromAxisAngle(up, it.ry + (it.g ? it.g.rotation.y : 0)), s)); });
      mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false;
      out.add(mesh);
    }
  }
  if (REG.bulbs.length) {
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), glow('#ffd89a', 3.2, 0.15), REG.bulbs.length);
    REG.bulbs.forEach((b, i) => { world(b.g, b.x, b.y, b.z); bulbs.setMatrixAt(i, m.makeTranslation(v.x, v.y, v.z)); });
    bulbs.frustumCulled = false;
    out.add(bulbs);
  }
  if (REG.pools.length) {
    const poolMat = new THREE.MeshBasicMaterial({ map: radialTexture(), color: new THREE.Color('#ffc890'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    REG.poolMats.push(poolMat);
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, REG.pools.length), col = new THREE.Color();
    REG.pools.forEach((pl, i) => { world(pl.g, pl.x, pl.y, pl.z); pools.setMatrixAt(i, m.makeScale(pl.s, 1, pl.s).setPosition(v.x, v.y, v.z)); pools.setColorAt(i, col.setScalar(pl.k)); });
    pools.frustumCulled = false;
    pools.renderOrder = 2;
    out.add(pools);
  }
  root.add(out);
  return out;
}
// 每幀呼叫：跑馬燈捲動、航空警示燈閃爍（t 為秒）
export function animate(t) {
  for (const tex of REG.tickers) tex.offset.x = (t * 0.035) % 1;
  const on = t % 1.6 < 0.18;
  for (const mm of REG.blinkers) mm.color.setRGB(on ? 5 : 0.35, on ? 0.25 : 0.03, on ? 0.18 : 0.02);
}

// ---------------------------------------------------------------------
// 移軸模糊（ShaderPass 用，水平、垂直各一道）：dir 設為 (1/寬, 0) 與 (0, 1/高)
// ---------------------------------------------------------------------
export const TiltShiftShader = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() }, focus: { value: 0.5 }, band: { value: 0.15 }, amount: { value: 10 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 dir; uniform float focus; uniform float band; uniform float amount; varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - focus) - band);
      vec2 o = dir * amount * d;
      vec4 s = texture2D(tDiffuse, vUv) * 0.1633;
      s += (texture2D(tDiffuse, vUv + o) + texture2D(tDiffuse, vUv - o)) * 0.1531;
      s += (texture2D(tDiffuse, vUv + o * 2.0) + texture2D(tDiffuse, vUv - o * 2.0)) * 0.12245;
      s += (texture2D(tDiffuse, vUv + o * 3.0) + texture2D(tDiffuse, vUv - o * 3.0)) * 0.0918;
      s += (texture2D(tDiffuse, vUv + o * 4.0) + texture2D(tDiffuse, vUv - o * 4.0)) * 0.051;
      gl_FragColor = s;
    }`,
};

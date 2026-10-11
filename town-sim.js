// =====================================================================
// town-sim.js：town-kit 的街景模擬模組 v1.0（人流＋車流）
// 人流：路人沿人行道靠右走、偶爾走斑馬線過街；經過店門口轉角時加入隊伍；
//       店家叫號，排頭走進店裡，停留後從門口出來，再變回路人。
// 車流：每個街廓一條環狀路線，沿靠近街廓的車道右轉繞行；直線加速、彎前煞車、
//       行人走進自己的車道時停下讓行。
// 時間：step(秒) 推進模擬（內部每一小步最多 1/30 秒），縮時或暫停由呼叫端決定。
// 使用說明見 README.md 的「town-sim」章節。
// =====================================================================
import * as THREE from 'three';
import { DIM, rng, createVoxelPeople, randomLook, walkPose, makePath, pathAt } from './town-kit.js';

const WALK_L = DIM.block / 2 - 1.6; // 人行道步道線：距街廓中心 13.4 m
const GAP = 0.78;                   // 排隊間距
const CAR = { vmin: 7.5, vmax: 10.5, vturn: 3.6, acc: 2.4, brk: 3.2, len: 4.4, gap: 2.4, R: 4.5 };
const CAR_COLORS = ['#e8e8e8', '#20262e', '#9a1f2d', '#34506e', '#c7b089', '#4a4f57', '#f3f3f3', '#3d5c46', '#b5532f', '#7b8794', '#1f3b5a', '#d6d0c4'];
const cwKey = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

// 點 (x, z) 投影到路線上的距離
function projectDist(path, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 1; i < path.pts.length; i++) {
    const [ax, az] = path.pts[i - 1], [bx, bz] = path.pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = (ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2;
    if (d < bd) { bd = d; best = path.cum[i - 1] + t * Math.sqrt(L2); }
  }
  return best;
}

/**
 * 建立街景模擬。
 * blocks：createStreet() 回傳的 blocks
 * shops：[{ lot, accent, interval（叫號間隔秒）, walkers（這個街廓的路人數）, cars（這個街廓的車數）,
 *           exitX（出店走道 x，預設：兩邊都有隊伍時走中間 0，否則走門左側 −2.6）,
 *           queues: [{ maze（createQueueMaze 的回傳）, mirror（1 右邊、−1 左邊）, target（排隊人數）, color }] }]
 * range：模擬範圍（中間店面地塊外再多幾圈）；extraWalkers：非店面街廓的路人數
 */
export function createTownSim({ blocks, shops = [], range = 1, extraWalkers = 3, seed = 99, cars: withCars = true, carScale = 1 } = {}) {
  const prng = rng(seed), group = new THREE.Group(), _o = {};
  const inner = blocks.filter(b => b.inner);
  const cols = Math.max(...inner.map(b => b.c)) + 1, rows = Math.max(...inner.map(b => b.r)) + 1;
  const inRange = b => b.c >= -range && b.c < cols + range && b.r >= -range && b.r < rows + range;
  const simBlocks = blocks.filter(inRange);

  // ---- 人行道路網：每個街廓 4 個轉角，一圈互連，並經斑馬線連到前方與右側街廓 ----
  const nodes = [], ids = new Map(), key = (c, r, k) => `${c},${r},${k}`, OFF = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const b of simBlocks) {
    b._shop = null;
    b._nodes = OFF.map(([sx, sz], k) => { const id = nodes.length; nodes.push({ x: b.x + sx * WALK_L, z: b.z + sz * WALK_L, b, k, links: [] }); ids.set(key(b.c, b.r, k), id); return id; });
  }
  const link = (a, c, cross) => { if (a === undefined || c === undefined) return; nodes[a].links.push({ to: c, cross }); nodes[c].links.push({ to: a, cross }); };
  for (const b of simBlocks) {
    const n = b._nodes;
    link(n[0], n[1], false); link(n[1], n[2], false); link(n[2], n[3], false); link(n[3], n[0], false);
    link(n[0], ids.get(key(b.c, b.r + 1, 3)), true); link(n[1], ids.get(key(b.c, b.r + 1, 2)), true);
    link(n[0], ids.get(key(b.c + 1, b.r, 1)), true); link(n[3], ids.get(key(b.c + 1, b.r, 2)), true);
  }

  // ---- 店家與隊伍 ----
  const F = DIM.frontZ;
  const S = shops.map((sh, i) => {
    const lot = sh.lot, both = (sh.queues || []).some(q => (q.mirror || 1) < 0);
    const ex = sh.exitX ?? (both ? 0 : -2.6);
    const shop = {
      i, lot, cfg: sh, interval: sh.interval ?? 4, qs: [], door: { x: lot.x, z: lot.z + F + 0.25 },
      exitPath: ex === 0
        ? [[lot.x, lot.z + F + 1.2], [lot.x, lot.z + WALK_L - 0.3]]
        : [[lot.x + ex * 0.35, lot.z + F + 0.6], [lot.x + ex, lot.z + F + 1.6], [lot.x + ex, lot.z + WALK_L - 0.3]],
    };
    for (const q of sh.queues || []) {
      const m = q.mirror || 1, L = q.maze.layout;
      const path = makePath(q.maze.path.pts.map(([x, z]) => [lot.x + m * x, lot.z + z]));
      const entryX = lot.x + m * L.exitX, entryZ = lot.z + L.exitZ;
      shop.qs.push({
        shop, path, mirror: m, joinK: m > 0 ? 0 : 1, color: q.color, queue: [],
        target: Math.min(q.target ?? 20, Math.floor(path.len / GAP)),
        entryX, entryZ, entryD: projectDist(path, entryX, entryZ), timer: prng() * shop.interval,
      });
    }
    lot._shop = shop;
    return shop;
  });

  // ---- 人 ----
  const people = [], laneBusy = new Set(), crossBusy = new Map();
  const newPerson = accent => ({
    x: 0, y: DIM.curbY, z: 0, tx: 0, tz: 0, yaw: 0, yawT: 0,
    speed: 1.05 + prng() * 0.4, phase: prng() * Math.PI * 2, sc: 0.92 + prng() * 0.16,
    jx: (prng() - 0.5) * 0.22, jz: (prng() - 0.5) * 0.22, lane: 0.22 + prng() * 0.16,
    look: randomLook(prng, accent), mode: 'walk', moving: false, approach: false,
    delay: 0, timer: 0, pi: 0, pd: 0, shop: null, q: null, home: null, from: 0, to: 0, s: 0, cw: -1,
  });
  function walkerTarget(p) {
    const A = nodes[p.from], B = nodes[p.to], len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const ux = (B.x - A.x) / len, uz = (B.z - A.z) / len;
    p.tx = A.x + ux * p.s - uz * p.lane; // 靠右走
    p.tz = A.z + uz * p.s + ux * p.lane;
    p.yawT = Math.atan2(ux, uz);
  }
  function placeWalker(p, block) {
    const n = block._nodes, k = Math.floor(prng() * 4);
    p.mode = 'walk'; p.home = block; p.from = n[k]; p.to = n[(k + (prng() < 0.5 ? 1 : 3)) % 4];
    const A = nodes[p.from], B = nodes[p.to];
    p.s = prng() * Math.hypot(B.x - A.x, B.z - A.z);
    walkerTarget(p);
    p.x = p.tx; p.z = p.tz; p.yaw = p.yawT;
  }
  for (const shop of S) {
    const accent = shop.cfg.accent;
    let queued = 0;
    for (const q of shop.qs) {
      for (let k = 0; k < q.target; k++) {
        const p = newPerson(q.color || accent);
        pathAt(q.path, k * GAP, _o);
        Object.assign(p, { mode: 'queue', shop, q, home: shop.lot, pd: k * GAP, x: _o.x + p.jx, z: _o.z + p.jz, yaw: _o.yaw, yawT: _o.yaw });
        q.queue.push(p); people.push(p); queued++;
      }
    }
    for (let k = Math.round(queued * 0.12); k > 0; k--) { const p = newPerson(accent); Object.assign(p, { mode: 'inside', shop, home: shop.lot, timer: prng() * 12 }); people.push(p); }
    for (let k = 0; k < (shop.cfg.walkers ?? 10); k++) { const p = newPerson(accent); placeWalker(p, shop.lot); people.push(p); }
  }
  for (const b of simBlocks) if (!b._shop) for (let k = 0; k < extraWalkers; k++) { const p = newPerson(null); placeWalker(p, b); people.push(p); }
  const crowd = createVoxelPeople(Math.max(1, people.length));
  people.forEach((p, i) => crowd.setLook(i, p.look));
  group.add(crowd.group);

  function moveToward(p, tx, tz, dt, idleYaw) {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = p.speed * dt;
    if (d <= step) { p.x = tx; p.z = tz; p.moving = false; if (idleYaw !== undefined) p.yawT = idleYaw; return true; }
    p.x += (dx / d) * step; p.z += (dz / d) * step; p.yawT = Math.atan2(dx, dz); p.moving = true;
    return false;
  }
  // 走到路口：要不要去排隊，或選下一段路（不回頭；離家越遠越想過馬路回家）
  function arriveNode(p) {
    if (p.cw >= 0) { crossBusy.set(p.cw, (crossBusy.get(p.cw) || 1) - 1); p.cw = -1; }
    const node = nodes[p.to], b = node.b, home = p.home, shop = b._shop;
    if (shop && b === home) {
      const q = shop.qs.find(x => x.joinK === node.k && x.queue.length < x.target);
      if (q && prng() < 0.65) { p.mode = 'queue'; p.shop = shop; p.q = q; p.delay = 0; p.approach = true; q.queue.push(p); return false; }
    }
    const dNow = Math.abs(b.c - home.c) + Math.abs(b.r - home.r), opts = [], ws = [];
    let total = 0;
    for (const L of node.links) {
      if (L.to === p.from && node.links.length > 1) continue;
      let w = 1;
      if (L.cross) { const nb = nodes[L.to].b, dNext = Math.abs(nb.c - home.c) + Math.abs(nb.r - home.r); w = dNow === 0 ? 0.035 : dNext < dNow ? 3 : 0.05; }
      opts.push(L); ws.push(w); total += w;
    }
    let pick = prng() * total, next = opts[0];
    for (let i = 0; i < opts.length; i++) { pick -= ws[i]; if (pick <= 0) { next = opts[i]; break; } }
    if (next.cross) { p.cw = cwKey(p.to, next.to); crossBusy.set(p.cw, (crossBusy.get(p.cw) || 0) + 1); }
    p.from = p.to; p.to = next.to;
    return true;
  }
  function stepWalker(p, dt) {
    const A = nodes[p.from], B = nodes[p.to], len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    p.s += p.speed * dt;
    if (p.s >= len) { const over = p.s - len; if (!arriveNode(p)) return; p.s = Math.min(over, 0.5); }
    walkerTarget(p);
    const a = 1 - Math.exp(-dt * 10);
    p.x += (p.tx - p.x) * a; p.z += (p.tz - p.z) * a; p.moving = true;
  }
  // 叫號：隊伍至少有目標的 92% 才叫下一位，讓長度維持在目標附近
  function stepQueue(q, dt) {
    q.timer -= dt;
    if (q.timer > 0 || !q.queue.length || q.queue.length < Math.max(1, Math.round(q.target * 0.92))) return;
    const front = q.queue[0];
    if (front.moving || front.delay > 0 || front.approach) return;
    q.queue.shift();
    front.mode = 'enter';
    q.queue.forEach((o, k) => { if (!o.moving && !o.approach) o.delay = 0.12 + Math.min(k, 18) * 0.06 + prng() * 0.1; });
    q.timer = q.shop.interval * (0.75 + prng() * 0.5);
  }
  // 排隊的人沿路線移動；新來的人先走到入口（迷宮出口外或人行道外側），再沿通道走到隊尾
  function stepQueuer(p, k, dt) {
    const q = p.q, td = k * GAP;
    if (p.delay > 0) { p.delay -= dt; p.moving = false; return; }
    if (p.approach) {
      let ex = q.entryX, ez = q.entryZ, d0 = q.entryD;
      if (td >= q.entryD) { pathAt(q.path, td, _o); ex = _o.x + 0.6 * q.mirror; ez = _o.z; d0 = td; }
      if (moveToward(p, ex, ez, dt)) { p.approach = false; p.pd = d0; }
      return;
    }
    if (p.pd > td + 0.001) { p.pd = Math.max(td, p.pd - p.speed * dt); p.moving = true; } else { p.pd = td; p.moving = false; }
    pathAt(q.path, p.pd, _o);
    const a = 1 - Math.exp(-dt * 12);
    p.x += (_o.x + p.jx - p.x) * a; p.z += (_o.z + p.jz - p.z) * a; p.yawT = _o.yaw;
  }
  function stepPerson(p, dt) {
    if (p.mode === 'walk') stepWalker(p, dt);
    else if (p.mode === 'enter') { if (moveToward(p, p.shop.door.x, p.shop.door.z, dt * 0.8)) { p.mode = 'inside'; p.timer = 6 + prng() * 8; } }
    else if (p.mode === 'inside') {
      p.timer -= dt;
      if (p.timer <= 0) { p.mode = 'exit'; p.pi = 0; p.x = p.shop.door.x; p.z = p.shop.door.z; p.y = DIM.curbY; p.yaw = p.yawT = 0; }
    } else if (p.mode === 'exit') {
      const t = p.shop.exitPath[p.pi];
      if (!moveToward(p, t[0], t[1], dt)) return;
      if (++p.pi < p.shop.exitPath.length) return;
      const lot = p.shop.lot, n = lot._nodes;
      p.mode = 'walk'; p.home = lot; p.shop = null; p.q = null;
      if (prng() < 0.5) { p.from = n[0]; p.to = n[1]; p.s = Math.max(0, nodes[n[0]].x - p.x); }
      else { p.from = n[1]; p.to = n[0]; p.s = Math.max(0, p.x - nodes[n[1]].x); }
      walkerTarget(p);
    }
  }
  function stepPeople(dt) {
    for (const shop of S) for (const q of shop.qs) stepQueue(q, dt);
    for (const shop of S) for (const q of shop.qs) for (let k = 0; k < q.queue.length; k++) stepQueuer(q.queue[k], k, dt);
    for (const p of people) if (p.mode !== 'queue') stepPerson(p, dt);
  }

  // ---- 車流 ----
  const loops = [], cars = [];
  let carMeshes = [], tailMesh = null, carMats = null;
  // ---- 快門光軌 ----
  const TRAIL_MAX = 150; // 每台車的軌跡點數（每前進 1 m 記一點）
  let shutter = 0, nightN = 1, trailMesh = null, view = null;
  function carPos(L, s, out) {
    let g = L.segs[L.segs.length - 1];
    for (const seg of L.segs) if (s < seg.s0 + seg.len) { g = seg; break; }
    const u = s - g.s0;
    if (g.arc) { const t = g.t0 + u / CAR.R; out.x = g.cx + CAR.R * Math.cos(t); out.z = g.cz + CAR.R * Math.sin(t); out.hx = -Math.sin(t); out.hz = Math.cos(t); }
    else { out.x = g.x0 + g.dx * u; out.z = g.z0 + g.dz * u; out.hx = g.dx; out.hz = g.dz; }
    out.seg = g;
    return out;
  }
  if (withCars) {
    const H = DIM.block / 2 + 2.5, a = H - CAR.R;
    for (const b of simBlocks) {
      const segs = [];
      let s0 = 0;
      const line = (x0, z0, x1, z1) => { const len = Math.hypot(x1 - x0, z1 - z0); segs.push({ arc: false, s0, len, x0, z0, dx: (x1 - x0) / len, dz: (z1 - z0) / len }); s0 += len; };
      const arc = (cx, cz, t0) => { const len = (CAR.R * Math.PI) / 2; segs.push({ arc: true, s0, len, cx, cz, t0 }); s0 += len; };
      const { x, z } = b;
      line(x + H, z - a, x + H, z + a); arc(x + a, z + a, 0);
      line(x + a, z + H, x - a, z + H); arc(x - a, z + a, Math.PI / 2);
      line(x - H, z + a, x - H, z - a); arc(x - a, z - a, Math.PI);
      line(x - a, z - H, x + a, z - H); arc(x + a, z - a, Math.PI * 1.5);
      const L = { b, segs, len: s0, cars: [], walks: [] };
      let n = b._shop ? (b._shop.cfg.cars ?? 2) : prng() < 0.55 ? 1 : 2;
      n = Math.max(b._shop ? 1 : 0, Math.round(n * carScale));
      for (let i = 0; i < n; i++) {
        const c = { L, s: (((i + prng() * 0.3) / n) * L.len) % L.len, v: 5, vmax: CAR.vmin + (CAR.vmax - CAR.vmin) * prng(), brake: false, color: CAR_COLORS[Math.floor(prng() * CAR_COLORS.length)], dist: 0, hx: new Float32Array(TRAIL_MAX), hz: new Float32Array(TRAIL_MAX), hdx: new Float32Array(TRAIL_MAX), hdz: new Float32Array(TRAIL_MAX), hb: new Uint8Array(TRAIL_MAX), ht: new Float64Array(TRAIL_MAX), head: 0, count: 0 };
        L.cars.push(c); cars.push(c);
      }
      L.cars.sort((p, q) => p.s - q.s);
      loops.push(L);
    }
    // 斑馬線在車道路線上的位置（人行穿越線往馬路走 4.1 m＝靠近該街廓的車道中心）
    const loopOf = new Map(loops.map(L => [L.b, L])), o = {};
    const nearestS = (L, px, pz) => { let best = 0, bd = Infinity; for (let s = 0; s < L.len; s += 0.25) { carPos(L, s, o); const d = (o.x - px) ** 2 + (o.z - pz) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
    nodes.forEach((A, ai) => {
      for (const lk of A.links) {
        if (!lk.cross || lk.to < ai) continue;
        const Bn = nodes[lk.to], k = cwKey(ai, lk.to), len = Math.hypot(Bn.x - A.x, Bn.z - A.z);
        [[A, Bn, 0], [Bn, A, 1]].forEach(([N1, N2, end]) => {
          const L = loopOf.get(N1.b);
          if (L) L.walks.push({ key: k * 2 + end, s: nearestS(L, N1.x + ((N2.x - N1.x) / len) * 4.1, N1.z + ((N2.z - N1.z) / len) * 4.1) });
        });
      }
    });
    buildCarMeshes();
  }
  function updateLaneBusy() {
    laneBusy.clear();
    for (const p of people) {
      if (p.mode !== 'walk' || p.cw < 0) continue;
      const A = nodes[p.from], B = nodes[p.to], len = Math.hypot(B.x - A.x, B.z - A.z), end = p.from < p.to ? 0 : 1;
      if (p.s > 0.6 && p.s < 7.4) laneBusy.add(p.cw * 2 + end);
      if (p.s > len - 7.4 && p.s < len - 0.6) laneBusy.add(p.cw * 2 + 1 - end);
    }
  }
  function stepCars(h) {
    updateLaneBusy();
    for (const L of loops) {
      const n = L.cars.length;
      for (let i = 0; i < n; i++) {
        const c = L.cars[i], g = carPos(L, c.s, _o).seg;
        let vt = c.vmax;
        if (g.arc) vt = Math.min(vt, CAR.vturn);
        else vt = Math.min(vt, Math.sqrt(CAR.vturn * CAR.vturn + 2 * CAR.brk * (g.s0 + g.len - c.s)));
        if (n > 1) { let gap = L.cars[(i + 1) % n].s - c.s; if (gap < 0) gap += L.len; vt = Math.min(vt, Math.sqrt(2 * CAR.brk * Math.max(0, gap - CAR.len - CAR.gap))); }
        for (const w of L.walks) {
          if (!laneBusy.has(w.key)) continue;
          let d = w.s - c.s; if (d < 0) d += L.len;
          if (d > 2 && d < 30) vt = Math.min(vt, Math.sqrt(2 * CAR.brk * Math.max(0, d - 3.8)));
        }
        c.brake = vt < c.v - 0.05;
        c.v = c.brake ? Math.max(vt, c.v - CAR.brk * 1.8 * h) : Math.min(vt, c.v + CAR.acc * h);
        c.s += c.v * h;
        if (c.s >= L.len) c.s -= L.len;
        c.dist += c.v * h;
        if (c.dist >= 1) { c.dist = 0; recordTrail(c); }
      }
    }
  }
  function beamTexture() {
    const W = 64, Hh = 128, c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d'), img = g.createImageData(W, Hh);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const f = (x - W / 2 + 0.5) / (7 + y * 0.18), i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(Math.exp(-f * f) * Math.pow(1 - y / Hh, 1.6) * 255);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function buildCarMeshes() {
    const N = cars.length;
    if (!N) return;
    const merge = geos => { const m = geos.map(g => g.toNonIndexed()); let n = 0; for (const g of m) n += g.attributes.position.count; const out = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'uv']) { const sz = m[0].attributes[k].itemSize, arr = new Float32Array(n * sz); let off = 0; for (const g of m) { arr.set(g.attributes[k].array, off); off += g.attributes[k].array.length; } out.setAttribute(k, new THREE.BufferAttribute(arr, sz)); } return out; };
    const body = new THREE.BoxGeometry(1.8, 0.7, 4.2).translate(0, 0.65, 0);
    const dark = merge([new THREE.BoxGeometry(1.6, 0.62, 2.2).translate(0, 1.3, -0.2), ...[[0.86, 1.35], [-0.86, 1.35], [0.86, -1.35], [-0.86, -1.35]].map(([x, z]) => new THREE.CylinderGeometry(0.32, 0.32, 0.24, 8).rotateZ(Math.PI / 2).translate(x, 0.32, z))]);
    const head = merge([-0.6, 0.6].map(x => new THREE.BoxGeometry(0.36, 0.16, 0.06).translate(x, 0.78, 2.1)));
    const tail = merge([-0.62, 0.62].map(x => new THREE.BoxGeometry(0.34, 0.14, 0.06).translate(x, 0.8, -2.1)));
    const beam = new THREE.PlaneGeometry(3.4, 8).rotateX(-Math.PI / 2).translate(0, 0.03, 6.1);
    carMats = {
      headBase: new THREE.Color('#fff4dc').multiplyScalar(3.0), tailBase: new THREE.Color('#ff2a1a').multiplyScalar(1.6),
      head: new THREE.MeshBasicMaterial({ color: '#ffffff' }), tail: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      beam: new THREE.MeshBasicMaterial({ map: beamTexture(), color: new THREE.Color('#ffe6bf').multiplyScalar(0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    };
    const col = new THREE.Color();
    const bodyMesh = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0.35 }), N);
    const darkMesh = new THREE.InstancedMesh(dark, new THREE.MeshStandardMaterial({ color: '#141a21', roughness: 0.3, metalness: 0.2 }), N);
    tailMesh = new THREE.InstancedMesh(tail, carMats.tail, N);
    const beamMesh = new THREE.InstancedMesh(beam, carMats.beam, N);
    cars.forEach((c, i) => { bodyMesh.setColorAt(i, col.set(c.color)); tailMesh.setColorAt(i, col.setScalar(1)); });
    bodyMesh.castShadow = bodyMesh.receiveShadow = darkMesh.castShadow = true;
    beamMesh.renderOrder = 2;
    carMeshes = [bodyMesh, darkMesh, new THREE.InstancedMesh(head, carMats.head, N), tailMesh, beamMesh];
    for (const m of carMeshes) { m.frustumCulled = false; group.add(m); }
    buildTrails();
    setNight(1);
  }

  // ---- 快門光軌：每台車兩條光帶（頭燈白、尾燈紅），依曝光秒數淡出；面向鏡頭的燈較亮，煞車處尾燈更亮 ----
  function recordTrail(c) {
    carPos(c.L, c.s, _o);
    const j = (c.head + 1) % TRAIL_MAX;
    c.hx[j] = _o.x; c.hz[j] = _o.z; c.hdx[j] = _o.hx; c.hdz[j] = _o.hz;
    c.hb[j] = c.brake ? 1 : 0; c.ht[j] = performance.now() / 1000;
    c.head = j;
    c.count = Math.min(TRAIL_MAX - 1, c.count + 1);
  }
  function buildTrails() {
    const ribs = cars.length * 2, verts = ribs * TRAIL_MAX * 2, uv = new Float32Array(verts * 2), idx = [];
    for (let r = 0; r < ribs; r++) {
      const base = r * TRAIL_MAX * 2;
      for (let i = 0; i < TRAIL_MAX; i++) {
        const v = base + i * 2, t = i / (TRAIL_MAX - 1);
        uv[v * 2] = 0; uv[v * 2 + 1] = t; uv[v * 2 + 2] = 1; uv[v * 2 + 3] = t;
        if (i < TRAIL_MAX - 1) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }
    const stripe = document.createElement('canvas');
    stripe.width = 64; stripe.height = 4;
    const sg = stripe.getContext('2d'), img = sg.createImageData(64, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 64; x++) { const f = (x - 31.5) / 13, i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(Math.exp(-f * f) * 255); }
    sg.putImageData(img, 0, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    trailMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(stripe), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    trailMesh.frustumCulled = false;
    trailMesh.renderOrder = 3;
    trailMesh.visible = false;
    group.add(trailMesh);
  }
  function updateTrails() {
    if (!trailMesh) return;
    trailMesh.visible = shutter > 0;
    if (!shutter) return;
    const now = performance.now() / 1000, P = trailMesh.geometry.attributes.position, C = trailMesh.geometry.attributes.color, pa = P.array, ca = C.array;
    let vx = 0, vz = 1;
    if (view) { vx = view.camera.position.x - view.target.x; vz = view.camera.position.z - view.target.z; const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl; }
    const glowK = 0.35 + 0.65 * nightN;
    let v = 0;
    for (const c of cars) {
      carPos(c.L, c.s, _o);
      const cx = _o.x, cz = _o.z, chx = _o.hx, chz = _o.hz;
      for (let side = 0; side < 2; side++) {
        const off = side ? -2.1 : 2.1, w = side ? 0.42 : 0.5, cr = side ? 2.6 : 2.2, cg = side ? 0.16 : 1.9, cb = side ? 0.1 : 1.35;
        let lx = cx + chx * off, lz = cz + chz * off;
        for (let k = 0; k < TRAIL_MAX; k++) {
          let alpha = 0, x = 0, z = 0, dx = 0, dz = 1, br = c.brake;
          if (k === 0) { alpha = 1; x = cx; z = cz; dx = chx; dz = chz; }
          else if (k - 1 < c.count) {
            const j = (c.head - (k - 1) + TRAIL_MAX) % TRAIL_MAX, age = now - c.ht[j];
            if (age >= 0 && age <= shutter) { alpha = 1 - age / shutter; x = c.hx[j]; z = c.hz[j]; dx = c.hdx[j]; dz = c.hdz[j]; br = c.hb[j]; }
          }
          const i3 = v * 3;
          if (alpha > 0) {
            const face = dx * vx + dz * vz, kk = alpha * glowK * (0.3 + 0.9 * Math.max(0, side ? -face : face)) * (side && br ? 1.8 : 1);
            const px = x + dx * off, pz = z + dz * off, nx = -dz * w, nz = dx * w;
            pa[i3] = px + nx; pa[i3 + 1] = 0.66; pa[i3 + 2] = pz + nz;
            pa[i3 + 3] = px - nx; pa[i3 + 4] = 0.66; pa[i3 + 5] = pz - nz;
            ca[i3] = ca[i3 + 3] = cr * kk; ca[i3 + 1] = ca[i3 + 4] = cg * kk; ca[i3 + 2] = ca[i3 + 5] = cb * kk;
            lx = px; lz = pz;
          } else {
            pa[i3] = pa[i3 + 3] = lx; pa[i3 + 1] = pa[i3 + 4] = 0.66; pa[i3 + 2] = pa[i3 + 5] = lz;
            ca.fill(0, i3, i3 + 6);
          }
          v += 2;
        }
      }
    }
    P.needsUpdate = true;
    C.needsUpdate = true;
  }

  // ---- 畫面更新 ----
  const oc = (cols - 1) / 2, orr = (rows - 1) / 2;
  const groundY = (x, z) => {
    const bx = (Math.round(x / DIM.pitch + oc) - oc) * DIM.pitch, bz = (Math.round(z / DIM.pitch + orr) - orr) * DIM.pitch;
    return Math.abs(x - bx) <= DIM.block / 2 && Math.abs(z - bz) <= DIM.block / 2 ? DIM.curbY : 0.01;
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
  let animT = 0;
  function writePeople(dt) {
    animT += dt;
    const turn = dt > 0 ? 1 - Math.exp(-dt * 8) : 1, lift = dt > 0 ? 1 - Math.exp(-dt * 12) : 1;
    people.forEach((p, i) => {
      if (p.mode === 'inside') { crowd.setPose(i, { hidden: true }); return; }
      const d = p.yawT - p.yaw;
      p.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * turn;
      p.y += (groundY(p.x, p.z) - p.y) * lift;
      if (p.moving) p.phase += dt * p.speed * 4.8;
      const w = walkPose(p.phase, p.moving, animT, p.phase);
      crowd.setPose(i, { x: p.x, y: p.y, z: p.z, yaw: p.yaw + w.look, scale: p.sc, swing: w.swing, bob: w.bob, roll: w.roll });
    });
    crowd.commit();
  }
  function writeCars() {
    if (!carMeshes.length) return;
    cars.forEach((c, i) => {
      carPos(c.L, c.s, _o);
      _e.set(0, Math.atan2(_o.hx, _o.hz), 0);
      _m.compose(_p.set(_o.x, 0, _o.z), _q.setFromEuler(_e), _s);
      for (const m of carMeshes) m.setMatrixAt(i, _m);
      tailMesh.setColorAt(i, _c.setScalar(c.brake ? 2.4 : 1));
    });
    for (const m of carMeshes) m.instanceMatrix.needsUpdate = true;
    tailMesh.instanceColor.needsUpdate = true;
  }
  // n：1＝夜晚（車燈全亮），0＝白天
  function setNight(n) {
    nightN = n;
    if (!carMats) return;
    carMats.head.color.copy(carMats.headBase).multiplyScalar(0.35 + 0.65 * n);
    carMats.tail.color.copy(carMats.tailBase).multiplyScalar(0.45 + 0.55 * n);
    carMats.beam.opacity = n;
  }

  const api = {
    group, people, cars, crowd,
    // 推進模擬 simDt 秒（縮時時傳 dt × 倍率，暫停時傳 0）
    step(simDt) {
      if (!(simDt > 0)) return;
      const n = Math.max(1, Math.ceil(simDt * 30)), h = simDt / n;
      for (let i = 0; i < n; i++) { stepPeople(h); if (withCars) stepCars(h); }
    },
    // 每幀呼叫：更新小人與車子的位置；dt 用來推動走路動作（建議傳 min(simDt, 0.5)）
    update(dt = 0) { writePeople(dt); writeCars(); updateTrails(); },
    prewarm(sec = 15) { for (let t = sec; t > 0; t -= 1) api.step(Math.min(1, t)); api.update(0); },
    setNight,
    setDetail(level) { crowd.setDetail(level); },
    // 快門：sec＝曝光秒數（0＝關閉）；setView 讓面向鏡頭的車燈較亮
    setShutter(sec) { shutter = sec; },
    setView(camera, target) { view = { camera, target }; },
    stats: () => S.map(s => ({ shop: s.i, queues: s.qs.map(q => ({ target: q.target, now: q.queue.length })) })),
    modes: () => people.reduce((m, p) => ((m[p.mode] = (m[p.mode] || 0) + 1), m), {}),
    traffic() {
      let minGap = Infinity, stopped = 0, crossing = 0;
      for (const L of loops) { const n = L.cars.length; for (let i = 0; i < n; i++) { const c = L.cars[i]; if (c.v < 0.3) stopped++; if (n > 1) { let g = L.cars[(i + 1) % n].s - c.s; if (g < 0) g += L.len; minGap = Math.min(minGap, g); } } }
      crossBusy.forEach(v => { crossing += v; });
      return { cars: cars.length, stopped, minGap: Number.isFinite(minGap) ? +minGap.toFixed(2) : null, pedsCrossing: crossing };
    },
  };
  return api;
}

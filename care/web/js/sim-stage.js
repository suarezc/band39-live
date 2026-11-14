/* Band 39 · simulator stage: Margaret (78) as an original blocky voxel character in her cozy room, acting out each
 * event, with band 39 on her left wrist and its LED glowing. three.js r186 (vendored). Original art, drawn as tiny
 * pixel textures on canvases; no game assets.
 *
 *   const stage = createStage(container)
 *   stage.setNight(bool) · stage.setLed(color|null, 'solid'|'blink'|'pulse'|'breathe') · stage.act(name, opts) → Promise
 *   stage.say(text, ms, who?) · stage.caption(text) · stage.step(sec) · stage.dispose()
 *   stage.guest('repair'|'nephew'|'ruth'|'lisa'|null, { mood: 'angry', card: true, at }) → Promise (arrived / gone)
 *     a second original voxel person; say(text, ms, 'guest') puts the bubble above them.
 *   Room is a cutaway (back walls at z=-4 and x=-5); a small garden lies in front of it (z 4…7.6) with a
 *   path, picket fence and gate: act('walk', { to: 'outside' | 'gate' }), act('nightwalk', { outside: true }).
 */
import * as THREE from '../vendor/three.module.js';

const PAL = {
  skin: '#F1C6A4', skinD: '#DDA684', cheek: '#EE9E8A', hair: '#E9E4DD', hairD: '#CFC8BE', glass: '#6B4F3D',
  plum: '#8A6AA8', plumD: '#715391', plumL: '#A48BC0', skirt: '#4B3F52', shoe: '#6A4632', mouth: '#B4584A',
  wood: '#C9935C', woodD: '#A97646', woodL: '#DDAA72', wall: '#F4E7D7', wallD: '#E6D2BC', trim: '#D9BFA2',
  terra: '#C8673F', terraL: '#E08A62', sage: '#7FA287', sageD: '#5F846A', cream: '#FBF4EA', navy: '#20294A',
};

// ---- tiny pixel textures ---------------------------------------------------------------------------
function tex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const px = (x, y, col, ww = 1, hh = 1) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); };
  draw(px, g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const noise = (px, w, h, cols, n) => { for (let i = 0; i < n; i++) px(Math.floor(rnd() * w), Math.floor(rnd() * h), cols[i % cols.length]); };

function textures() {
  const face = tex(16, 16, (px) => {
    px(0, 0, PAL.skin, 16, 16);
    px(0, 0, PAL.hair, 16, 4); px(0, 4, PAL.hair, 2, 3); px(14, 4, PAL.hair, 2, 3); px(3, 4, PAL.hairD, 10, 1);
    // round glasses
    for (const ox of [2, 9]) { px(ox, 6, PAL.glass, 5, 1); px(ox, 10, PAL.glass, 5, 1); px(ox, 7, PAL.glass, 1, 3); px(ox + 4, 7, PAL.glass, 1, 3); px(ox + 1, 7, '#FFF7EE', 3, 3); }
    px(7, 7, PAL.glass, 2, 1);
    px(4, 8, '#3A2A22', 1, 2); px(11, 8, '#3A2A22', 1, 2);       // kind eyes
    px(2, 11, PAL.cheek, 2, 1); px(12, 11, PAL.cheek, 2, 1);     // rosy cheeks
    px(7, 10, PAL.skinD, 2, 2);                                   // nose
    px(6, 13, PAL.mouth, 4, 1); px(5, 12, PAL.mouth); px(10, 12, PAL.mouth);   // smile
  });
  const headSide = tex(16, 16, (px) => { px(0, 0, PAL.hair, 16, 16); noise(px, 16, 7, [PAL.hairD], 10); px(0, 8, PAL.skin, 9, 8); px(4, 9, PAL.skinD, 2, 3); });
  const hair = tex(16, 16, (px) => { px(0, 0, PAL.hair, 16, 16); noise(px, 16, 16, [PAL.hairD, '#F4F1EC'], 40); });
  const cardi = tex(16, 16, (px) => {
    px(0, 0, PAL.plum, 16, 16); noise(px, 16, 16, [PAL.plumD, PAL.plumL], 34);
    px(7, 0, PAL.plumD, 2, 16); px(5, 0, PAL.cream, 6, 2); px(6, 2, PAL.cream, 4, 1);           // placket + blouse collar
    for (const y of [5, 9, 13]) px(7, y, '#E9D9B8', 2, 1);                                         // buttons
  });
  const cardiSide = tex(8, 8, (px) => { px(0, 0, PAL.plum, 8, 8); noise(px, 8, 8, [PAL.plumD, PAL.plumL], 10); });
  const skirt = tex(8, 8, (px) => { px(0, 0, PAL.skirt, 8, 8); noise(px, 8, 8, ['#584A60', '#3F3546'], 10); });
  const floor = tex(16, 16, (px) => {
    px(0, 0, PAL.wood, 16, 16); noise(px, 16, 16, [PAL.woodL, PAL.woodD], 30);
    for (const y of [0, 4, 8, 12]) px(0, y, PAL.woodD, 16, 1);
    px(5, 1, PAL.woodD, 1, 3); px(12, 5, PAL.woodD, 1, 3); px(2, 9, PAL.woodD, 1, 3); px(9, 13, PAL.woodD, 1, 3);
  }, [5, 4]);
  const wall = tex(16, 16, (px) => { px(0, 0, PAL.wall, 16, 16); noise(px, 16, 16, ['#F8EEE2', '#EFDFCC'], 18); }, [5, 2]);
  const wainscot = tex(16, 16, (px) => { px(0, 0, '#D8B48E', 16, 16); for (let x = 0; x < 16; x += 4) px(x, 0, '#C49C74', 1, 16); }, [10, 1]);
  const rug = tex(16, 16, (px) => {
    px(0, 0, PAL.terra, 16, 16); px(1, 1, PAL.cream, 14, 14); px(2, 2, PAL.terraL, 12, 12); px(3, 3, PAL.cream, 10, 10);
    for (let i = 0; i < 4; i++) { px(4 + i, 7 - i, PAL.sage, 1, 1); px(11 - i, 7 - i, PAL.sage); px(4 + i, 8 + i, PAL.sage); px(11 - i, 8 + i, PAL.sage); }
  });
  const blanket = tex(16, 16, (px) => { px(0, 0, PAL.terraL, 16, 16); for (let y = 0; y < 16; y += 4) px(0, y, PAL.terra, 16, 2); for (let x = 0; x < 16; x += 4) px(x, 0, '#D47650', 2, 16); });
  const halo = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const grass = tex(16, 16, (px) => {
    px(0, 0, '#93B57C', 16, 16); noise(px, 16, 16, ['#86A970', '#A2C389', '#7E9F68', '#9BBC83'], 70);
    for (const [x, y] of [[3, 2], [11, 6], [6, 12], [14, 13]]) { px(x, y, '#7A9A63'); px(x, y + 1, '#7A9A63'); px(x + 1, y + 1, '#6F905A'); }
    px(9, 3, '#FBF1DC'); px(2, 9, '#F3C66B');
  }, [10, 3.5]);
  const soil = tex(16, 8, (px) => { px(0, 0, '#9C6E4A', 16, 8); noise(px, 16, 8, ['#8A5E3C', '#AE8059', '#7E5536'], 26); px(0, 0, '#7FA36A', 16, 1); }, [12, 1]);
  const stone = tex(8, 8, (px) => { px(0, 0, '#D3C8B7', 8, 8); noise(px, 8, 8, ['#C4B8A5', '#DED5C6'], 12); px(0, 7, '#B7AA96', 8, 1); px(7, 0, '#B7AA96', 1, 8); });
  return { face, headSide, hair, cardi, cardiSide, skirt, floor, wall, wainscot, rug, blanket, halo, grass, soil, stone };
}

// ---- building blocks ----------------------------------------------------------------------------
const lam = (c, extra) => new THREE.MeshLambertMaterial(Object.assign(typeof c === 'string' ? { color: c } : { map: c }, extra || {}));
function box(w, h, d, mat, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}

// Spots in the room (floor coords) and how she stands there.
const SPOT = {
  center: { x: 0.3, z: 0.5, face: Math.PI / 4 },
  door: { x: -4.0, z: 1.5, face: -Math.PI / 2 },
  bed: { x: -1.9, z: -1.9, face: -Math.PI / 2 },
  chair: { x: 2.6, z: -1.0, face: Math.PI / 4 },
  table: { x: 1.8, z: 1.9, face: Math.PI / 2 },
  window: { x: 0.8, z: -3.0, face: Math.PI },
};
// Garden in front of the room: the floor edge is z=EDGE; the lawn sits GY lower; the path runs along x=PATH_X to a
// gate in the picket fence at z=FENCE_Z. Walks that cross the edge go through the doorway point on the path.
const EDGE = 4.0, GY = -0.2, PATH_X = 0.6, FENCE_Z = 7.35, GARDEN_Z1 = 7.6;
Object.assign(SPOT, {
  outside: { x: PATH_X + 0.05, z: 5.45, face: Math.PI / 4 },
  gate: { x: PATH_X, z: 6.75, face: 0 },
  doorTalk: { x: -2.55, z: 1.2, face: -Math.PI / 2 },   // where she stands when someone is at the door
});
const gy = (z) => (z <= EDGE ? 0 : z >= EDGE + 0.5 ? GY : GY * (3 - 2 * ((z - EDGE) / 0.5)) * ((z - EDGE) / 0.5) ** 2);
/** next point to walk toward: straight to `to`, unless it is on the other side of the room edge → the doorway first */
function route(p, to) {
  const a = p.z < EDGE, b = to.z < EDGE;
  if (a === b) return to;
  return { x: PATH_X, z: b ? EDGE - 0.02 : EDGE + 0.02, via: true };
}
const SEAT = { x: 3.35, z: -2.45, y: 0.12, face: -2.36 + Math.PI };   // armchair seat, facing into the room
const BED = { x: -3.4, z: -1.35, y: 0.62 };                              // lying in bed, head toward the wall

// Guests: original voxel people with their own palettes and silhouettes (built like Margaret, lighter).
const GSPEC = {
  repair: { label: 'Roofer', scale: 1.08, chestW: 0.88, skin: '#DFA77F', skinD: '#C68B63', hair: '#6B4A33', hairD: '#563A28', style: 'cap', cap: '#E07B39', capD: '#B9602A',
    eye: '#2B211C', brow: '#4D3423', mouth: '#9C4A3E', stubble: true, top: 'vest', sleeve: '#3A4A68', pants: '#41506C', pantsD: '#36435C', shoe: '#7A5232', prop: 'clipboard', enter: 'door' },
  nephew: { label: 'Nephew', scale: 1.12, chestW: 0.74, skin: '#EDC2A0', skinD: '#D6A27F', hair: '#4A3426', hairD: '#36261B', style: 'short',
    eye: '#2B211C', brow: '#36261B', mouth: '#A65446', stubble: true, top: 'hoodie', pants: '#353B48', pantsD: '#2A2F3A', shoe: '#EFECE6', sole: '#9A958C', enter: 'near' },
  ruth: { label: 'Ruth · neighbour', scale: 0.96, chestW: 0.8, skin: '#EBC09F', skinD: '#D6A27F', hair: '#DCD7E2', hairD: '#BDB6C8', style: 'curly',
    eye: '#3A2A22', brow: '#B0A8B8', mouth: '#B4584A', cheek: '#EC9F8C', top: 'cardigan', pants: '#8E7C6A', pantsD: '#7A6A5A', shoe: '#5A4436', enter: 'walk' },
  lisa: { label: 'Lisa · daughter', scale: 1.0, chestW: 0.74, skin: '#F0C7A6', skinD: '#DCA886', hair: '#8E4B2E', hairD: '#743B22', style: 'long',
    eye: '#3A2A22', brow: '#6E3820', mouth: '#B4584A', cheek: '#EE9E8A', top: 'sweater', pants: '#3A4560', pantsD: '#2F3850', shoe: '#4B3428', prop: 'bag', enter: 'walk' },
};
function guestTextures(S) {
  const face = (angry) => tex(16, 16, (px) => {
    px(0, 0, S.skin, 16, 16);
    if (S.stubble) for (let i = 0; i < 24; i++) px(1 + Math.floor(rnd() * 14), 11 + Math.floor(rnd() * 5), S.skinD);
    if (S.style === 'cap') { px(0, 0, S.cap, 16, 4); px(0, 4, S.capD, 16, 1); px(0, 5, S.hair, 1, 3); px(15, 5, S.hair, 1, 3); }
    else if (S.style === 'short') { px(0, 0, S.hair, 16, 3); px(0, 3, S.hair, 2, 3); px(14, 3, S.hair, 2, 3); px(3, 3, S.hair, 4, 1); px(9, 3, S.hair, 2, 1); px(5, 1, S.hairD, 4, 1); }
    else if (S.style === 'curly') { px(0, 0, S.hair, 16, 4); px(0, 4, S.hair, 3, 5); px(13, 4, S.hair, 3, 5); for (const x of [3, 6, 9, 12]) px(x, 4, S.hair, 2, 1); noise(px, 16, 4, [S.hairD], 10); }
    else if (S.style === 'long') { px(0, 0, S.hair, 16, 3); px(0, 3, S.hair, 3, 13); px(13, 3, S.hair, 3, 13); px(3, 3, S.hair, 6, 1); px(3, 4, S.hair, 3, 1); px(7, 0, S.hairD, 1, 3); }
    if (angry) { px(3, 5, S.brow, 2, 1); px(5, 6, S.brow, 2, 1); px(11, 5, S.brow, 2, 1); px(9, 6, S.brow, 2, 1); }
    else { px(3, 6, S.brow, 3, 1); px(10, 6, S.brow, 3, 1); }
    px(3, 8, '#FFFDF8', 2, 2); px(4, 8, S.eye, 1, 2); px(11, 8, '#FFFDF8', 2, 2); px(11, 8, S.eye, 1, 2);
    if (S.cheek || angry) { const c = angry ? '#E58A78' : S.cheek; px(2, 11, c, 2, 1); px(12, 11, c, 2, 1); }
    px(7, 10, S.skinD, 2, 2);
    if (angry) { px(6, 12, '#5A2A24', 4, 2); px(6, 12, '#F4EEE6', 4, 1); }
    else { px(6, 13, S.mouth, 4, 1); px(5, 12, S.mouth); px(10, 12, S.mouth); }
  });
  // +x face: texture left = front of the head; the -x face is the mirror image
  const side = (mirror) => tex(16, 16, (q) => {
    const px = mirror ? (x, y, c, w = 1, h = 1) => q(16 - x - w, y, c, w, h) : q;
    px(0, 0, S.skin, 16, 16);
    if (S.style === 'cap') { px(0, 0, S.cap, 16, 4); px(0, 4, S.capD, 16, 1); px(9, 5, S.hair, 7, 4); }
    else if (S.style === 'short') { px(0, 0, S.hair, 16, 4); px(8, 4, S.hair, 8, 5); px(2, 4, S.hair, 2, 2); }
    else if (S.style === 'curly') { px(0, 0, S.hair, 16, 6); px(6, 6, S.hair, 10, 5); px(2, 6, S.hair, 2, 3); }
    else { px(0, 0, S.hair, 16, 4); px(5, 4, S.hair, 11, 12); }
    px(6, 8, S.skinD, 2, 3); if (S.style === 'curly') px(6, 11, '#FFFFFF');
  });
  const back = tex(16, 16, (px) => { px(0, 0, S.skin, 16, 16); const h = S.style === 'long' ? 16 : S.style === 'curly' ? 12 : 10; px(0, 0, S.style === 'cap' ? S.cap : S.hair, 16, S.style === 'cap' ? 4 : h); if (S.style === 'cap') px(0, 4, S.hair, 16, 6); noise(px, 16, h, [S.hairD], 12); });
  const top = tex(16, 16, (px) => { px(0, 0, S.style === 'cap' ? S.cap : S.hair, 16, 16); noise(px, 16, 16, [S.style === 'cap' ? S.capD : S.hairD], 26); if (S.style === 'cap') px(6, 10, '#F7D64A', 4, 3); });
  const pants = tex(8, 8, (px) => { px(0, 0, S.pants, 8, 8); noise(px, 8, 8, [S.pantsD], 10); });
  let front, flank;
  if (S.top === 'vest') {
    const Y = '#E8D23A', YD = '#C9B42C', R = '#E4E7EA', N = '#34425F';
    front = tex(16, 16, (px) => { px(0, 0, N, 16, 16); px(0, 0, Y, 6, 16); px(10, 0, Y, 6, 16); px(6, 8, Y, 4, 8); px(0, 10, R, 16, 2); px(2, 0, R, 2, 10); px(12, 0, R, 2, 10); px(8, 8, YD, 1, 8); px(5, 0, '#2A3550', 6, 1); px(1, 13, YD, 4, 1); px(11, 13, YD, 4, 1); });
    flank = tex(8, 8, (px) => { px(0, 0, Y, 8, 8); px(0, 5, R, 8, 1); noise(px, 8, 8, [YD], 5); });
  } else if (S.top === 'hoodie') {
    const H = '#55708C', HD = '#476180', HL = '#6582A0';
    front = tex(16, 16, (px) => { px(0, 0, H, 16, 16); noise(px, 16, 16, [HD, HL], 30); px(4, 0, HD, 8, 2); px(6, 2, '#EDE6DA', 1, 5); px(9, 2, '#EDE6DA', 1, 5); px(3, 10, HD, 10, 1); px(3, 10, HD, 1, 5); px(12, 10, HD, 1, 5); px(0, 15, HD, 16, 1); });
    flank = tex(8, 8, (px) => { px(0, 0, H, 8, 8); noise(px, 8, 8, [HD, HL], 10); });
  } else if (S.top === 'cardigan') {
    const C = '#5E8E64', CD = '#4D7B54', CL = '#76A47A';
    front = tex(16, 16, (px) => { px(0, 0, C, 16, 16); noise(px, 16, 16, [CD, CL], 34); px(7, 0, CD, 2, 16); px(5, 0, PAL.cream, 6, 2); px(6, 2, PAL.cream, 4, 1); for (const x of [5, 7, 8, 10]) px(x, 3, '#FFFDF6'); for (const y of [6, 10, 14]) px(7, y, '#E9D9B8', 2, 1); px(2, 11, CD, 3, 1); px(11, 11, CD, 3, 1); });
    flank = tex(8, 8, (px) => { px(0, 0, C, 8, 8); noise(px, 8, 8, [CD, CL], 10); });
  } else {
    const W = '#D7A443', WD = '#C3912F', WL = '#E6B95C';
    front = tex(16, 16, (px) => { px(0, 0, W, 16, 16); noise(px, 16, 16, [WD, WL], 26); for (const x of [4, 11]) for (let y = 2; y < 14; y += 2) { px(x, y, WD); px(x + (y % 4 ? 1 : -1), y + 1, WD); } px(5, 0, WD, 6, 1); px(6, 1, WD, 4, 1); px(0, 14, WD, 16, 2); for (let x = 0; x < 16; x += 2) px(x, 14, WL, 1, 2); });
    flank = tex(8, 8, (px) => { px(0, 0, W, 8, 8); noise(px, 8, 8, [WD, WL], 10); px(0, 7, WD, 8, 1); });
  }
  return { face: face(false), faceAngry: face(true), sideR: side(false), sideL: side(true), back, top, pants, front, flank };
}

export function createStage(container, opts = {}) {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  const T = textures();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  const fb = container.querySelector('.stage-fallback'); if (fb) fb.style.display = 'none';

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
  cam.position.set(11, 10, 11); cam.lookAt(-0.3, 1.0, -0.4);

  // ---- light ----
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0xc9a882, 1.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2bd, 2.2); sun.position.set(4, 9, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 34 }); sun.shadow.bias = -0.0015; sun.shadow.radius = 4;
  scene.add(sun);
  const lampLight = new THREE.PointLight(0xffb36b, 0, 9, 1.2); lampLight.position.set(-1.6, 2.6, -3.3); scene.add(lampLight);
  const ledLight = new THREE.PointLight(0xffffff, 0, 3.5, 1.5); scene.add(ledLight);

  // ---- room ----
  const room = new THREE.Group(); scene.add(room);
  const floor = box(10, 0.3, 8, lam(T.floor), 0, -0.15, 0, room); floor.castShadow = false;
  const wallMat = lam(T.wall);
  box(10, 4.2, 0.3, wallMat, 0, 2.1, -4.15, room).castShadow = false;
  box(0.3, 4.2, 8.3, wallMat, -5.15, 2.1, -0.15, room).castShadow = false;
  box(10, 1.0, 0.06, lam(T.wainscot), 0, 0.5, -3.98, room); box(0.06, 1.0, 8, lam(T.wainscot), -4.98, 0.5, 0, room);
  box(10, 0.1, 0.12, lam(PAL.trim), 0, 1.02, -3.94, room); box(0.12, 0.1, 8, lam(PAL.trim), -4.94, 1.02, 0, room);
  box(10, 0.14, 0.14, lam(PAL.trim), 0, 0.07, -3.93, room); box(0.14, 0.14, 8, lam(PAL.trim), -4.93, 0.07, 0, room);
  // window
  const skyMat = new THREE.MeshBasicMaterial({ color: '#BFE0F2' });
  box(2.2, 1.7, 0.05, skyMat, 0.8, 2.35, -3.97, room).castShadow = false;
  const wf = lam('#FFF8EF');
  box(2.5, 0.15, 0.2, wf, 0.8, 3.27, -3.9, room); box(2.6, 0.18, 0.36, wf, 0.8, 1.45, -3.85, room);
  box(0.15, 1.9, 0.2, wf, -0.42, 2.35, -3.9, room); box(0.15, 1.9, 0.2, wf, 2.02, 2.35, -3.9, room); box(0.08, 1.7, 0.12, wf, 0.8, 2.35, -3.92, room); box(2.2, 0.08, 0.12, wf, 0.8, 2.35, -3.92, room);
  const sunDisc = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.02), new THREE.MeshBasicMaterial({ color: '#FFD98A', transparent: true }));
  sunDisc.position.set(1.45, 2.85, -3.93); room.add(sunDisc);
  const moon = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.02), new THREE.MeshBasicMaterial({ color: '#F4F0DC', transparent: true, opacity: 0 }));
  moon.position.set(0.25, 2.9, -3.93); room.add(moon);
  const stars = []; for (const [x, y] of [[1.6, 3.0], [1.2, 2.6], [0.1, 2.0], [1.75, 1.95], [0.55, 2.55]]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: '#FFF6D8', transparent: true, opacity: 0 })); st.position.set(x, y, -3.93); room.add(st); stars.push(st);
  }
  // curtains
  box(0.35, 2.1, 0.12, lam(PAL.sage), -0.68, 2.25, -3.86, room); box(0.35, 2.1, 0.12, lam(PAL.sage), 2.28, 2.25, -3.86, room);
  // bed (along z, head at the wall)
  const bed = new THREE.Group(); bed.position.set(-3.4, 0, -2.5); room.add(bed);
  box(1.6, 0.35, 3.0, lam(PAL.woodD), 0, 0.28, 0, bed); box(1.7, 1.3, 0.2, lam(PAL.woodD), 0, 0.65, -1.5, bed); box(1.7, 0.7, 0.2, lam(PAL.woodD), 0, 0.35, 1.5, bed);
  box(1.5, 0.2, 2.85, lam(PAL.cream), 0, 0.55, -0.02, bed);
  box(1.0, 0.18, 0.55, lam('#FFFFFF'), 0, 0.72, -1.1, bed);
  box(1.56, 0.12, 1.75, lam(T.blanket), 0, 0.68, 0.55, bed);
  // nightstand
  box(0.7, 0.7, 0.6, lam(PAL.wood), -2.2, 0.35, -3.6, room); box(0.3, 0.3, 0.3, lam('#F6E7C8'), -2.2, 0.85, -3.6, room);
  // floor lamp
  box(0.5, 0.08, 0.5, lam('#5A4A3E'), -1.6, 0.04, -3.4, room); box(0.08, 2.2, 0.08, lam('#5A4A3E'), -1.6, 1.15, -3.4, room);
  const shadeMat = lam('#F7DDB4', { emissive: new THREE.Color('#FFB66B'), emissiveIntensity: 0 });
  box(0.7, 0.5, 0.7, shadeMat, -1.6, 2.45, -3.4, room).castShadow = false;
  // armchair
  const chair = new THREE.Group(); chair.position.set(3.4, 0, -2.5); chair.rotation.y = SEAT.face; room.add(chair);
  const cm = lam(PAL.sage), cmd = lam(PAL.sageD);
  box(1.4, 0.45, 1.3, cm, 0, 0.32, 0, chair); box(1.4, 1.2, 0.3, cmd, 0, 0.9, -0.55, chair); box(0.25, 0.75, 1.3, cmd, -0.7, 0.6, 0, chair); box(0.25, 0.75, 1.3, cmd, 0.7, 0.6, 0, chair);
  for (const [x, z] of [[-0.6, -0.55], [0.6, -0.55], [-0.6, 0.55], [0.6, 0.55]]) box(0.12, 0.12, 0.12, lam(PAL.woodD), x, 0.06, z, chair);
  // side table with pill box + phone spot
  box(1.4, 0.12, 1.0, lam(PAL.wood), 3.0, 0.82, 1.9, room); for (const [x, z] of [[2.4, 1.5], [3.6, 1.5], [2.4, 2.3], [3.6, 2.3]]) box(0.1, 0.78, 0.1, lam(PAL.woodD), x, 0.39, z, room);
  box(0.42, 0.12, 0.2, lam('#7FB6D9'), 2.75, 0.94, 1.75, room); for (let i = 0; i < 4; i++) box(0.07, 0.03, 0.12, lam(['#F1C34B', '#E5735A', '#8FC48E', '#F1C34B'][i]), 2.61 + i * 0.095, 1.01, 1.75, room);
  box(0.36, 0.3, 0.36, lam('#E8D6BE'), 3.4, 1.03, 2.05, room); box(0.3, 0.06, 0.3, lam('#6E9E73'), 3.4, 1.2, 2.05, room);
  // door
  box(0.12, 2.6, 1.4, lam('#B07A4C'), -4.95, 1.3, 1.5, room); box(0.14, 2.75, 0.12, lam(PAL.trim), -4.94, 1.37, 0.75, room); box(0.14, 2.75, 0.12, lam(PAL.trim), -4.94, 1.37, 2.25, room); box(0.14, 0.12, 1.62, lam(PAL.trim), -4.94, 2.68, 1.5, room);
  box(0.1, 0.1, 0.1, lam('#E8C45E'), -4.86, 1.25, 2.0, room); box(0.06, 0.9, 0.9, lam('#A26F44'), -4.89, 1.75, 1.5, room);
  // rug + plant + frame
  const rug = box(4.2, 0.03, 3.0, lam(T.rug), 0.4, 0.015, 0.6, room); rug.castShadow = false;
  box(0.6, 0.55, 0.6, lam(PAL.terra), 4.3, 0.28, -0.4, room);
  const leaf = lam('#6F9A62'), leafD = lam('#57804C');
  for (const [x, y, z, s, m] of [[4.3, 0.75, -0.4, 0.45, leaf], [4.15, 1.05, -0.3, 0.35, leafD], [4.45, 1.15, -0.55, 0.32, leaf], [4.3, 1.4, -0.4, 0.28, leafD], [4.1, 0.85, -0.6, 0.3, leafD]]) box(s, s, s, m, x, y, z, room);
  box(1.0, 0.75, 0.06, lam('#FFFFFF'), -4.97, 2.6, -1.9, room).rotation.y = Math.PI / 2;
  box(0.8, 0.55, 0.07, lam('#F2B48F'), -4.95, 2.6, -1.9, room).rotation.y = Math.PI / 2;

  // ---- garden: porch step, stone path, lawn, picket fence + gate, mailbox, apple tree, flowers, porch lantern ----
  const garden = new THREE.Group(); scene.add(garden);
  const soilM = lam(T.soil), grassM = lam(T.grass), stoneM = lam(T.stone);
  const GD = GARDEN_Z1 - EDGE;
  box(10.3, 0.3, GD, [soilM, soilM, grassM, soilM, soilM, soilM], -0.15, GY - 0.15, EDGE + GD / 2, garden).castShadow = false;
  box(10, 0.2, 0.1, lam(PAL.woodD), 0, -0.1, EDGE + 0.05, garden).castShadow = false;               // floor sill
  box(1.6, 0.12, 0.42, stoneM, PATH_X, -0.14, EDGE + 0.27, garden).castShadow = false;              // porch step
  [4.82, 5.4, 5.97, 6.53, 7.06].forEach((z, i) => { box(0.72, 0.05, 0.5, stoneM, PATH_X + (i % 2 ? 0.1 : -0.08), GY + 0.02, z, garden).castShadow = false; });
  // picket fence: front run with a gate gap on the path, short side runs
  const fenceM = lam('#FBF1E1'), fenceD = lam('#E8D8C0');
  const GX0 = PATH_X - 0.62, GX1 = PATH_X + 0.62;
  const pk = [];                                       // static pickets are instanced (two draw calls for the whole fence)
  const picket = (x, z, alongX, parent = garden, y0 = GY) => {
    if (parent === garden) { pk.push([x, z, alongX]); return; }
    box(0.11, 0.6, 0.06, fenceM, x, y0 + 0.3, z, parent); box(0.06, 0.06, 0.06, fenceM, x, y0 + 0.63, z, parent);
  };
  const rails = (x0, x1, z0, z1) => { for (const y of [0.18, 0.46]) { const along = z0 === z1; box(along ? x1 - x0 : 0.05, 0.06, along ? 0.05 : z1 - z0, fenceD, (x0 + x1) / 2, GY + y, (z0 + z1) / 2 + (along ? -0.06 : 0), garden).castShadow = false; } };
  for (let x = -5.15; x <= 4.95; x += 0.32) if (x < GX0 - 0.12 || x > GX1 + 0.12) picket(x, FENCE_Z, true);
  rails(-5.2, GX0 - 0.08, FENCE_Z, FENCE_Z); rails(GX1 + 0.08, 5.0, FENCE_Z, FENCE_Z);
  for (let z = EDGE + 0.45; z < FENCE_Z - 0.1; z += 0.32) { picket(-5.18, z, false); picket(4.95, z, false); }
  for (const x of [-5.18, 4.95]) { box(0.05, 0.06, FENCE_Z - EDGE - 0.3, fenceD, x - 0.05, GY + 0.18, (EDGE + 0.3 + FENCE_Z) / 2, garden); box(0.05, 0.06, FENCE_Z - EDGE - 0.3, fenceD, x - 0.05, GY + 0.46, (EDGE + 0.3 + FENCE_Z) / 2, garden); }
  for (const [h, y] of [[0.6, GY + 0.3], [0.06, GY + 0.63]]) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(h > 0.1 ? 0.11 : 0.06, h, 0.06), fenceM, pk.length), o = new THREE.Object3D();
    pk.forEach(([x, z, alongX], i) => { o.position.set(x, y, z); o.rotation.y = alongX ? 0 : Math.PI / 2; o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.castShadow = im.receiveShadow = true; garden.add(im);
  }
  for (const x of [GX0 - 0.08, GX1 + 0.08]) { box(0.16, 0.86, 0.16, fenceD, x, GY + 0.43, FENCE_Z, garden); box(0.22, 0.06, 0.22, fenceM, x, GY + 0.89, FENCE_Z, garden); }
  const gate = new THREE.Group(); gate.position.set(GX0, GY, FENCE_Z); garden.add(gate);
  for (let i = 0; i < 5; i++) picket(0.12 + i * 0.25, 0, true, gate, 0);
  for (const y of [0.18, 0.46]) box(GX1 - GX0, 0.06, 0.05, fenceD, (GX1 - GX0) / 2, y, -0.06, gate);
  const brace = box(0.05, 0.36, 0.05, fenceD, (GX1 - GX0) / 2, 0.32, -0.06, gate); brace.rotation.z = 1.1;
  // mailbox (flag up), apple tree, bushes, flower bed
  const mx = GX0 - 0.55, mz = FENCE_Z - 0.32;
  box(0.1, 0.78, 0.1, lam(PAL.woodD), mx, GY + 0.39, mz, garden);
  box(0.34, 0.28, 0.5, lam(PAL.terra), mx, GY + 0.9, mz, garden); box(0.26, 0.07, 0.5, lam(PAL.terra), mx, GY + 1.07, mz, garden); box(0.3, 0.24, 0.02, lam('#A9532F'), mx, GY + 0.92, mz + 0.26, garden);
  box(0.03, 0.24, 0.06, lam('#F1C34B'), mx + 0.19, GY + 1.08, mz - 0.08, garden);
  const tx = -4.15, tz = 6.25;
  box(0.34, 1.5, 0.34, lam('#8A5E3C'), tx, GY + 0.75, tz, garden);
  const lf = [lam('#7FA36A'), lam('#6A9058'), lam('#8DB577')];
  for (const [x, y, z, sz, m] of [[0, 1.95, 0, 1.3, 0], [-0.4, 2.4, 0.2, 0.9, 1], [0.42, 2.32, -0.22, 0.86, 2], [0.05, 2.8, 0.05, 0.74, 0], [0.45, 1.78, 0.38, 0.7, 1], [-0.45, 1.72, -0.36, 0.72, 2]]) box(sz, sz, sz, lf[m], tx + x, GY + y, tz + z, garden);
  for (const [x, y, z] of [[0.62, 2.05, 0.2], [-0.2, 1.6, 0.66], [0.25, 2.5, 0.52], [-0.66, 2.2, 0.1]]) box(0.13, 0.13, 0.13, lam('#D9634A'), tx + x, GY + y, tz + z, garden);
  for (const [x, z, sz] of [[3.7, 6.85, 0.62], [4.3, 6.75, 0.48], [4.45, 6.2, 0.55], [2.75, 6.95, 0.46], [-4.55, 4.75, 0.5], [-3.95, 4.62, 0.38]]) { box(sz, sz * 0.8, sz, lf[1], x, GY + sz * 0.4, z, garden); box(sz * 0.6, sz * 0.5, sz * 0.6, lf[0], x + 0.06, GY + sz * 0.9, z - 0.04, garden); }
  box(2.9, 0.07, 0.52, lam('#8C5E3E'), 3.1, GY + 0.035, EDGE + 0.42, garden).castShadow = false;
  // a little garden bench on the left lawn
  for (const x of [-3.15, -2.05]) box(0.1, 0.32, 0.4, lam(PAL.woodD), x, GY + 0.16, 5.2, garden);
  box(1.4, 0.08, 0.46, lam(PAL.woodL), -2.6, GY + 0.36, 5.2, garden); box(1.4, 0.32, 0.07, lam(PAL.wood), -2.6, GY + 0.6, 4.98, garden);
  const bloom = [lam('#D9734E'), lam('#FBF1DC'), lam('#F1C34B'), lam('#E8A0A0'), lam(PAL.terraL)], stem = lam('#6F9A62');
  for (let i = 0; i < 11; i++) { const x = 1.78 + i * 0.25, z = EDGE + 0.28 + (i % 3) * 0.13, h = 0.18 + (i % 4) * 0.05; box(0.04, h, 0.04, stem, x, GY + h / 2, z, garden).castShadow = false; box(0.14, 0.12, 0.14, bloom[i % 5], x, GY + h + 0.04, z, garden); }
  for (const [x, z, c] of [[PATH_X - 0.62, 5.2, 0], [PATH_X - 0.7, 5.75, 2], [PATH_X + 0.62, 6.25, 1], [PATH_X - 0.6, 6.5, 4], [PATH_X + 0.66, 5.55, 3]]) { box(0.04, 0.2, 0.04, stem, x, GY + 0.1, z, garden).castShadow = false; box(0.13, 0.11, 0.13, bloom[c], x, GY + 0.24, z, garden); }
  // porch lantern on a post beside the step: dark by day, glows at night
  const lpx = PATH_X - 1.0, lpz = EDGE + 0.55;
  const lanternMat = lam('#FBEFD6', { emissive: new THREE.Color('#FFC27A'), emissiveIntensity: 0 });
  box(0.12, 1.3, 0.12, lam('#5A4A3E'), lpx, GY + 0.65, lpz, garden); box(0.34, 0.05, 0.34, lam('#5A4A3E'), lpx, GY + 1.31, lpz, garden);
  box(0.28, 0.34, 0.28, lanternMat, lpx, GY + 1.5, lpz, garden).castShadow = false; box(0.38, 0.08, 0.38, lam('#5A4A3E'), lpx, GY + 1.71, lpz, garden);
  const porchLight = new THREE.PointLight(0xffc27a, 0, 7, 1.3); porchLight.position.set(lpx + 0.1, GY + 1.45, lpz + 0.15); scene.add(porchLight);

  // ---- Margaret ----
  const root = new THREE.Group(); scene.add(root);
  const body = new THREE.Group(); root.add(body);
  const skin = lam(PAL.skin), plum = [lam(T.cardiSide), lam(T.cardiSide), lam(T.cardiSide), lam(T.cardiSide), lam(T.cardi), lam(T.cardiSide)];
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  function leg(x) {
    const hip = joint(body, x, 0.95, 0);
    box(0.3, 0.48, 0.3, lam(T.skirt), 0, -0.24, 0, hip);
    const knee = joint(hip, 0, -0.48, 0);
    box(0.26, 0.38, 0.26, lam('#E3D3C7'), 0, -0.19, 0, knee);                 // stockings
    box(0.3, 0.13, 0.42, lam(PAL.shoe), 0, -0.41, 0.06, knee);
    return { hip, knee };
  }
  const L = leg(0.17), R = leg(-0.17);
  const torso = joint(body, 0, 0.95, 0);
  box(0.82, 0.42, 0.52, lam(T.skirt), 0, 0.02, 0, torso);                     // skirt top / hips
  box(0.74, 0.78, 0.44, plum, 0, 0.6, 0, torso);
  const neck = joint(torso, 0, 1.0, 0);
  const headMats = [lam(T.headSide), lam(T.headSide), lam(T.hair), skin, lam(T.face), lam(T.hair)];
  box(0.64, 0.64, 0.6, headMats, 0, 0.32, 0, neck);
  box(0.68, 0.14, 0.64, lam(T.hair), 0, 0.66, -0.01, neck);
  box(0.34, 0.3, 0.26, lam(T.hair), 0, 0.62, -0.36, neck);                     // the bun
  function arm(x, side) {
    const sh = joint(torso, x, 0.92, 0);
    box(0.24, 0.62, 0.26, lam(T.cardiSide), 0, -0.29, 0, sh);
    box(0.2, 0.16, 0.22, skin, 0, -0.68, 0, sh);
    return sh;
  }
  const LA = arm(0.5, 1), RA = arm(-0.5, -1);
  // band 39 on her LEFT wrist (+x when she faces you)
  const band = new THREE.Group(); band.position.set(0, -0.56, 0); LA.add(band);
  box(0.29, 0.11, 0.31, lam('#3B302A'), 0, 0, 0, band);
  const ledMat = new THREE.MeshStandardMaterial({ color: '#2E2622', emissive: new THREE.Color('#000000'), emissiveIntensity: 2, roughness: 0.4 });
  const ledMesh = box(0.1, 0.07, 0.12, ledMat, 0.15, 0, 0.0, band); ledMesh.castShadow = false;
  const haloMat = new THREE.SpriteMaterial({ map: T.halo, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Sprite(haloMat); halo.scale.set(0.9, 0.9, 1); halo.position.set(0.2, 0, 0); band.add(halo);
  // props
  const phone = box(0.1, 0.26, 0.05, lam('#2C2C34'), 0.05, -0.72, 0.1, RA); phone.visible = false;
  const pillProp = box(0.06, 0.06, 0.06, lam('#F1C34B'), 0, -0.8, 0.1, RA); pillProp.visible = false;

  // ---- overlays (bubble + caption) ----
  function makeBubble(cls, bg, line) {
    const el = document.createElement('div'); el.className = cls;
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', transform: 'translateY(-100%)', maxWidth: '240px', padding: '9px 12px', borderRadius: '14px',
      background: bg, color: '#3B2A20', font: '500 13px/1.4 inherit', boxShadow: '0 8px 22px -8px rgba(60,35,20,.35)', border: '1px solid ' + line, pointerEvents: 'none', opacity: '0', transition: 'opacity .25s', zIndex: 2 });
    const tl = document.createElement('i'); Object.assign(tl.style, { position: 'absolute', left: '50%', bottom: '-6px', width: '12px', height: '12px', background: bg, borderRight: '1px solid ' + line, borderBottom: '1px solid ' + line, transform: 'translateX(-50%) rotate(45deg)' });
    const who = document.createElement('b'); Object.assign(who.style, { display: 'none', font: '700 10px/1.2 inherit', letterSpacing: '.06em', textTransform: 'uppercase', color: '#5B6B7E', marginBottom: '2px' });
    const tx = document.createElement('span'); el.append(who, tx, tl); container.appendChild(el);
    return { el, tail: tl, txt: tx, who };
  }
  const MB = makeBubble('stage-bubble', '#FFFAF2', '#EADBC8'), GB = makeBubble('stage-bubble stage-bubble-guest', '#F3F6FA', '#D6DEE8');
  const bubble = MB.el, btxt = MB.txt; GB.who.style.display = 'block';
  const cap = document.createElement('div'); cap.className = 'stage-caption';
  Object.assign(cap.style, { position: 'absolute', left: '12px', bottom: '12px', padding: '6px 11px', borderRadius: '999px', background: 'rgba(46,36,30,.78)', color: '#FBF4EA', font: '600 12.5px/1.2 inherit', pointerEvents: 'none', opacity: '0', transition: 'opacity .25s', backdropFilter: 'blur(6px)', zIndex: 2 });
  container.appendChild(cap);
  let bubbleUntil = 0;

  // ---- animation state ----
  const P = { lHip: 0, lKnee: 0, rHip: 0, rKnee: 0, lArmX: 0, lArmZ: 0.08, rArmX: 0, rArmZ: -0.08, headX: 0, headY: 0, lean: 0, tilt: 0, lie: 0, roll: 0, bob: 0 };
  const Q = Object.assign({}, P);                      // targets
  const pos = new THREE.Vector3(SPOT.center.x, 0, SPOT.center.z); let heading = SPOT.center.face;
  root.position.copy(pos);
  let cur = { name: 'idle', t0: 0, opts: {} }, plan = null, resolveCur = null, walkPhase = 0, seq = 0;
  let night = false, nightK = 0, ledColor = null, ledPattern = null, bandOnTable = false;
  const clock = new THREE.Clock(); let T0 = 0;

  // A "plan" is: walk to a spot (optional) → settle into a place/pose. Lying and sitting get up first when needed.
  function planFor(name, o) {
    const at = (k) => (k === 'door' && guestAtDoor() ? SPOT.doorTalk : SPOT[k] || SPOT.center);
    switch (name) {
      case 'walk': return { to: at(o.to || 'center') };
      case 'sleep': return { to: SPOT.bed, place: { x: BED.x, z: BED.z, y: BED.y, face: 0, lie: 1 } };
      case 'sit': return { to: SPOT.chair, place: { x: SEAT.x, z: SEAT.z, y: SEAT.y, face: SEAT.face, sit: 1 } };
      case 'pills': case 'bandoff': return { to: SPOT.table };
      case 'nightwalk': return o.outside ? { to: SPOT.gate, loop: ['gate', 'bed'], speed: 0.9 } : { to: SPOT.door, loop: ['door', 'bed'], speed: 0.9 };
      case 'shaky': return { to: { x: -1.2, z: 0.9, face: 0 }, loop: [{ x: -1.2, z: 0.9 }, { x: 1.8, z: 0.2 }], speed: 0.75 };
      case 'reset': return { to: SPOT.center, snap: true };
      case 'fall': case 'seizure': case 'getup': return {};
      default: return { stay: true };
    }
  }
  function act(name, o = {}) {
    if (!['bandoff'].includes(name) && bandOnTable) putBandOn();
    if (resolveCur) { resolveCur(); resolveCur = null; }
    const my = ++seq;
    cur = { name, t0: T0, opts: o, arrived: false, my };
    plan = planFor(name, o); plan.loopI = 0;
    if (plan.snap) { pos.set(SPOT.center.x, 0, SPOT.center.z); heading = SPOT.center.face; Object.assign(P, { lie: 0, roll: 0 }); }
    if (plan.stay) { plan.to = null; if (Q.lie > 0.5 || P.lie > 0.5 || cur.sitting) plan.to = SPOT.center; }
    if (name === 'fall' || name === 'seizure') { plan.to = null; }
    const dur = { fall: 2.2, getup: 1.6, seizure: 6.5, pills: 3.6, sos: 4.2, tap: 1.6, bandoff: 3.2, confused: 4, reset: 0.6 }[name];
    return new Promise((res) => { resolveCur = res; if (dur) setTimeout(() => { if (cur.my === my && resolveCur) { resolveCur(); resolveCur = null; } }, dur * 1000 + (plan.to ? 2500 : 0)); });
  }
  function putBandOn() { bandOnTable = false; LA.add(band); band.position.set(0, -0.56, 0); band.rotation.set(0, 0, 0); }
  function putBandOnTable() { bandOnTable = true; scene.add(band); band.position.set(2.45, 0.93, 2.15); band.rotation.set(0, 0.4, 0); }

  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  function standPose(t) {
    Object.assign(Q, { lHip: 0, lKnee: 0, rHip: 0, rKnee: 0, lArmX: 0.05, lArmZ: 0.08, rArmX: 0.05, rArmZ: -0.08, headX: 0, headY: Math.sin(t * 0.45) * 0.25 * (Math.sin(t * 0.17) > 0.3 ? 1 : 0), lean: 0, tilt: 0, lie: 0, roll: 0, bob: Math.sin(t * 2.2) * 0.012 });
  }
  function walkPose(speed, shaky) {
    const s = Math.sin(walkPhase), c = Math.cos(walkPhase);
    const amp = shaky ? 0.34 + 0.18 * Math.sin(walkPhase * 0.37) : 0.42;
    Object.assign(Q, { lHip: s * amp, rHip: -s * amp, lKnee: Math.max(0, -c) * 0.5, rKnee: Math.max(0, c) * 0.5, lArmX: -s * amp * 0.8, rArmX: s * amp * 0.8,
      lArmZ: shaky ? 0.55 : 0.08, rArmZ: shaky ? -0.55 : -0.08, headX: 0.05, headY: 0, lean: 0.06, tilt: shaky ? Math.sin(walkPhase * 0.5) * 0.12 : 0, lie: 0, roll: 0, bob: Math.abs(s) * 0.05 });
  }

  function update(dt, t) {
    const name = cur.name, ta = t - cur.t0, o = cur.opts;
    // 1) getting up first if she is lying and needs to stand
    const needStand = plan && (plan.to || plan.stay || ['getup', 'idle', 'talk', 'phone', 'tremor', 'confused', 'sad', 'sos', 'tap'].includes(name));
    let moving = false;
    if (needStand && P.lie > 0.25 && !(plan.place && plan.place.lie)) { standPose(t); Q.lie = 0; }
    else if (plan && plan.to && !cur.arrived) {
      const goal = route(pos, plan.to), dx = goal.x - pos.x, dz = goal.z - pos.z, d = Math.hypot(dx, dz);
      if (cur.sitting) cur.sitting = false;
      if (goal.via && d <= 0.06) { pos.x = goal.x; pos.z = goal.z; moving = true; walkPose(plan.speed || 1.35, name === 'shaky'); }
      else if (d > 0.06) {
        const sp = (plan.speed || 1.35) * (name === 'nightwalk' ? 1 : 1);
        const step = Math.min(d, sp * dt); pos.x += dx / d * step; pos.z += dz / d * step;
        heading = turn(heading, Math.atan2(dx, dz), dt * 8); walkPhase += dt * sp * 5.2; walkPose(sp, name === 'shaky'); moving = true;
      } else if (plan.loop) {
        plan.loopI = (plan.loopI + 1) % plan.loop.length; const nx = plan.loop[plan.loopI]; plan.to = typeof nx === 'string' ? SPOT[nx] : nx;
      } else { cur.arrived = true; cur.t1 = t; }
    }
    if (!moving && !(needStand && P.lie > 0.25 && !(plan.place && plan.place.lie))) {
      const arrived = !plan || !plan.to || cur.arrived;
      if (arrived) {
        const ts = cur.t1 != null ? t - cur.t1 : ta;
        if (plan && plan.place) {
          const pl = plan.place; pos.x += (pl.x - pos.x) * Math.min(1, dt * 5); pos.z += (pl.z - pos.z) * Math.min(1, dt * 5); heading = turn(heading, pl.face, dt * 6);
          standPose(t);
          if (pl.lie) { Q.lie = 1; Q.lArmZ = 0.15; Q.rArmZ = -0.15; Q.headY = 0; Q.bob = 0; if (o.restless) { const k = Math.sin(t * 0.9); Q.roll = k > 0.6 ? (k - 0.6) * 1.2 : k < -0.6 ? (k + 0.6) * 1.2 : 0; Q.lHip = Q.roll * 0.4; } }
          if (pl.sit) { cur.sitting = true; Object.assign(Q, { lHip: -1.45, rHip: -1.45, lKnee: 1.45, rKnee: 1.45, lArmX: -0.55, rArmX: -0.55, lArmZ: 0.12, rArmZ: -0.12, headX: name === 'sit' ? 0.28 : 0, lean: -0.05 }); }
        } else {
          if (plan && plan.to && plan.to.face != null) heading = turn(heading, plan.to.face, dt * 5);
          else if (!['fall', 'seizure', 'getup'].includes(name) && P.lie < 0.2) heading = turn(heading, Math.PI / 4, dt * 3);
          pose(name, ts, t, o);
        }
      }
    }
    if (bandOnTable) { /* band rests on the table */ }
    // 2) ease every joint toward its target
    const k = 1 - Math.exp(-dt * (name === 'fall' ? 9 : name === 'seizure' ? 22 : 10));
    for (const key in P) P[key] += (Q[key] - P[key]) * k;
    // 3) apply
    root.position.set(pos.x, (plan && plan.place && cur.arrived ? lerp(0, plan.place.y, Math.min(1, (t - (cur.t1 || t)) * 3)) : 0) + P.bob + gy(pos.z), pos.z);
    if (P.lie > 0.01) root.position.y += P.lie * 0.24 + (plan && plan.place && plan.place.lie ? 0 : 0);
    root.rotation.y = heading;
    body.rotation.set(-P.lie * Math.PI / 2 + P.lean * (1 - P.lie), 0, P.tilt + P.roll);
    L.hip.rotation.x = P.lHip; L.knee.rotation.x = P.lKnee; R.hip.rotation.x = P.rHip; R.knee.rotation.x = P.rKnee;
    LA.rotation.set(P.lArmX, 0, P.lArmZ); RA.rotation.set(P.rArmX, 0, P.rArmZ);
    neck.rotation.set(P.headX, P.headY, 0);
  }
  const lerp = (a, b, x) => a + (b - a) * x;
  function turn(a, b, r) { let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + d * Math.min(1, r * 0.12 + 0.05); }

  function pose(name, ts, t, o) {
    standPose(t);
    switch (name) {
      case 'talk': Object.assign(Q, { headX: Math.sin(t * 3.1) * 0.08, headY: Math.sin(t * 0.8) * 0.12, lArmX: -0.55 + Math.sin(t * 2.4) * 0.25, rArmX: -0.45 + Math.sin(t * 2.0 + 1) * 0.3, lArmZ: 0.25, rArmZ: -0.3 }); break;
      case 'phone': Object.assign(Q, { rArmX: -0.35, rArmZ: 2.55, headY: -0.15, headX: 0.05, lArmX: -0.1 + Math.sin(t * 1.6) * 0.08, lArmZ: 0.15 }); break;
      case 'tremor': Object.assign(Q, { lArmX: -1.0 + Math.sin(t * 2 * Math.PI * 5) * 0.09, lArmZ: 0.18 + Math.sin(t * 2 * Math.PI * 5 + 1) * 0.05, headX: 0.25, headY: 0.35 }); break;
      case 'confused': Object.assign(Q, { headY: Math.sin(ts * 1.4) * 0.6, headX: 0.05, lArmZ: ts % 4 > 2.4 ? 0.55 : 0.12, rArmZ: ts % 4 > 2.4 ? -0.55 : -0.12, lArmX: ts % 4 > 2.4 ? -0.4 : 0, rArmX: ts % 4 > 2.4 ? -0.4 : 0 }); break;
      case 'sad': Object.assign(Q, { headX: 0.5, lean: 0.14, tilt: Math.sin(t * 0.7) * 0.05, lArmZ: 0.02, rArmZ: -0.02, bob: 0 }); break;
      case 'pills': {
        const reach = ts < 1.1, mouth = ts >= 1.1 && ts < 2.4;
        Object.assign(Q, reach ? { rArmX: -1.2, rArmZ: 0.15, lean: 0.12, headX: 0.35 } : mouth ? { rArmX: -2.3, rArmZ: 0.5, headX: -0.15 } : {});
        pillProp.visible = ts > 0.7 && ts < 2.4; break;
      }
      case 'sos': {
        if (ts < 1.3) Object.assign(Q, { lArmX: -0.95, lArmZ: -0.1, rArmX: -1.05, rArmZ: 0.75, headX: 0.35 });
        else Object.assign(Q, { lArmX: -0.2, rArmZ: -2.6 + Math.sin(t * 9) * 0.35, rArmX: -0.1, headX: -0.1, headY: 0.2 });
        break;
      }
      case 'tap': { const tap = Math.max(0, Math.sin(ts * 2 * Math.PI * 1.6)) * (ts < 1.3 ? 1 : 0); Object.assign(Q, { lArmX: -0.95, lArmZ: -0.1, rArmX: -1.0, rArmZ: 0.72 + tap * 0.18, headX: 0.35 }); break; }
      case 'bandoff': {
        if (ts < 1.2) Object.assign(Q, { lArmX: -0.9, rArmX: -1.0, rArmZ: 0.75, headX: 0.35 });
        else if (ts < 2.2) { Object.assign(Q, { lArmX: -1.1, rArmX: -1.1, lean: 0.12, headX: 0.35 }); if (!bandOnTable && ts > 1.7) putBandOnTable(); }
        break;
      }
      case 'fall': {
        if (ts < 0.55) Object.assign(Q, { lean: 0.25 + Math.sin(ts * 20) * 0.08, lArmX: -1.6, rArmX: -1.4, lArmZ: 0.7, rArmZ: -0.7, headX: -0.2, tilt: Math.sin(ts * 14) * 0.1 });
        else { const f = ease((ts - 0.55) / 0.55); Object.assign(Q, { lie: f, lArmZ: 0.6 * (1 - f) + 0.35, rArmZ: -0.7 * (1 - f) - 0.25, lArmX: -0.4, rArmX: 0.2, lHip: -0.25, rHip: 0.1, lKnee: 0.4, headY: f * 0.5 }); P.lie = Math.max(P.lie, f * 0.95); }
        break;
      }
      case 'seizure': {
        const on = ts < 6, j = on ? Math.sin(t * 2 * Math.PI * 3.2) : 0;
        Object.assign(Q, { lie: 1, roll: j * 0.07, lArmX: -0.5 + j * 0.45, rArmX: -0.5 - j * 0.45, lArmZ: 0.5, rArmZ: -0.5, lHip: j * 0.25, rHip: -j * 0.25, lKnee: 0.3, rKnee: 0.3, headY: j * 0.18, headX: 0 });
        if (P.lie < 0.9) P.lie += (1 - P.lie) * 0.2;
        break;
      }
      case 'getup': { Q.lie = 0; break; }
      case 'walk': case 'reset': case 'idle': default: break;
    }
    if (name !== 'phone') phone.visible = false; else phone.visible = true;
    if (name !== 'pills') pillProp.visible = false;
    if (name === 'fall' && ts >= 1.1) Q.lie = 1;
  }

  // ---- guests: a second person when the story needs one -------------------------------------------------
  const GEO = new Map();
  const geo = (w, h, d) => { const k = w + '|' + h + '|' + d; let g = GEO.get(k); if (!g) GEO.set(k, (g = new THREE.BoxGeometry(w, h, d))); return g; };
  function gbox(w, h, d, mat, x, y, z, parent) { const m = new THREE.Mesh(geo(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }
  const KITS = {};                                     // per-kind textures + materials, built once and shared
  function kit(kind) {
    if (KITS[kind]) return KITS[kind];
    const S = GSPEC[kind], X = guestTextures(S), all = [];
    const M = (c) => { const m = lam(c); all.push(m); return m; };
    const flank = M(X.flank), faceM = M(X.face);
    const K = {
      all, faceM, X,
      head: [M(X.sideR), M(X.sideL), M(X.top), M(S.skin), faceM, M(X.back)],
      chest: [flank, flank, flank, flank, M(X.front), flank],
      sleeve: S.sleeve ? M(S.sleeve) : flank, pants: M(X.pants), shoe: M(S.shoe), sole: S.sole ? M(S.sole) : null, skin: M(S.skin),
      hair: M(X.top), hood: M('#476180'), cap: M(S.cap || '#000'), board: M('#9B6B3F'), paper: M('#FFFDF6'), clip: M('#B8BCC2'),
      card: M('#2F6FD0'), chip: M('#E8C45E'), bag: M(PAL.terra), strap: M('#8C4A2C'),
    };
    return (KITS[kind] = K);
  }
  function buildGuest(kind) {
    const S = GSPEC[kind], K = kit(kind);
    const groot = new THREE.Group(), gbody = new THREE.Group(); groot.add(gbody); gbody.scale.setScalar(S.scale); scene.add(groot);
    const J = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
    const legs = [0.17, -0.17].map((x) => {
      const hip = J(gbody, x, 0.95, 0); gbox(0.3, 0.5, 0.3, K.pants, 0, -0.24, 0, hip);
      const knee = J(hip, 0, -0.48, 0); gbox(0.28, 0.38, 0.28, K.pants, 0, -0.19, 0, knee); gbox(0.32, 0.14, 0.44, K.shoe, 0, -0.41, 0.06, knee);
      if (K.sole) gbox(0.33, 0.04, 0.45, K.sole, 0, -0.48, 0.06, knee);
      return { hip, knee };
    });
    const gtorso = J(gbody, 0, 0.95, 0);
    gbox(0.76, 0.28, 0.46, K.pants, 0, 0.0, 0, gtorso);
    gbox(S.chestW, 0.84, 0.48, K.chest, 0, 0.55, 0, gtorso);
    const gneck = J(gtorso, 0, 1.0, 0);
    gbox(0.62, 0.62, 0.58, K.head, 0, 0.31, 0, gneck);
    if (S.style === 'cap') { gbox(0.68, 0.16, 0.64, K.head[2], 0, 0.67, 0, gneck); gbox(0.56, 0.05, 0.3, K.cap, 0, 0.6, 0.43, gneck); }
    else if (S.style === 'short') { gbox(0.66, 0.12, 0.62, K.hair, 0, 0.66, -0.01, gneck); gbox(0.3, 0.08, 0.28, K.hair, 0.1, 0.75, 0.1, gneck); }
    else if (S.style === 'curly') {
      gbox(0.7, 0.18, 0.66, K.hair, 0, 0.66, -0.01, gneck); gbox(0.66, 0.4, 0.12, K.hair, 0, 0.42, -0.33, gneck);
      for (const sx of [-1, 1]) gbox(0.1, 0.3, 0.46, K.hair, sx * 0.35, 0.47, -0.06, gneck);
      for (const [x, z] of [[-0.18, 0.12], [0.16, -0.1], [0.02, 0.22], [-0.12, -0.2]]) gbox(0.18, 0.1, 0.18, K.hair, x, 0.78, z, gneck);
    } else if (S.style === 'long') {
      gbox(0.68, 0.12, 0.64, K.hair, 0, 0.66, -0.01, gneck); gbox(0.68, 0.84, 0.14, K.hair, 0, 0.22, -0.34, gneck);
      for (const sx of [-1, 1]) gbox(0.1, 0.62, 0.34, K.hair, sx * 0.35, 0.26, -0.1, gneck);
    }
    if (S.top === 'hoodie') gbox(0.56, 0.28, 0.18, K.hood, 0, 0.02, -0.3, gneck);
    const arm = (x) => { const sh = J(gtorso, x, 0.9, 0); gbox(0.24, 0.64, 0.26, K.sleeve, 0, -0.3, 0, sh); gbox(0.2, 0.16, 0.22, K.skin, 0, -0.7, 0, sh); return sh; };
    const gLA = arm(S.chestW / 2 + 0.13), gRA = arm(-S.chestW / 2 - 0.13);
    // hand props exist on both hands; the one on the camera-side hand is shown
    const props = { L: [], R: [] };
    if (S.prop === 'clipboard') for (const [side, A] of [['L', gLA], ['R', gRA]]) { const cb = J(A, 0, -0.66, 0.2); cb.rotation.x = 1.25; gbox(0.34, 0.46, 0.04, K.board, 0, 0, 0, cb); gbox(0.28, 0.36, 0.012, K.paper, 0, -0.02, 0.026, cb); gbox(0.14, 0.05, 0.05, K.clip, 0, 0.21, 0.03, cb); props[side].push({ o: cb, k: 'clip' }); }
    if (S.prop === 'bag') { gbox(0.14, 0.32, 0.36, K.bag, S.chestW / 2 + 0.1, 0.06, 0.02, gtorso); gbox(0.06, 0.6, 0.06, K.strap, S.chestW / 2 - 0.02, 0.6, 0.02, gtorso).rotation.z = 0.35; }
    if (kind === 'nephew') for (const [side, A] of [['L', gLA], ['R', gRA]]) { const c = J(A, 0, -0.8, 0.1); c.rotation.x = 1.2; gbox(0.22, 0.14, 0.025, K.card, 0, 0, 0, c); gbox(0.05, 0.04, 0.03, K.chip, 0.05, 0.02, 0.01, c); props[side].push({ o: c, k: 'card' }); }
    const zero = { lHip: 0, lKnee: 0, rHip: 0, rKnee: 0, lArmX: 0, lArmZ: 0.08, rArmX: 0, rArmZ: -0.08, headX: 0, headY: 0, lean: 0, bob: 0, crouch: 0 };
    return { kind, S, K, root: groot, body: gbody, legs, torso: gtorso, neck: gneck, LA: gLA, RA: gRA, props, P: Object.assign({}, zero), Q: Object.assign({}, zero),
      pos: new THREE.Vector3(), heading: Math.PI / 2, state: 'enter', alpha: 0, walkPhase: 0, opts: {}, anchor: null, anchorM: null, tArrive: null, waiters: [] };
  }

  const guests = [];
  let gBubbleUntil = 0;
  const DOOR_IN = { x: -4.45, z: 1.5 }, DOOR_OUT = { x: -5.05, z: 1.5 }, GATE_OUT = { x: PATH_X, z: FENCE_Z + 0.3 };
  const REPAIR_SPOTS = [{ x: -4.2, z: 1.6 }, { x: -4.15, z: 2.45 }, { x: -4.15, z: 0.7 }];
  const live = () => guests.find((g) => g.state !== 'leave');
  function guestAtDoor() { const g = live(); return !!(g && g.kind === 'repair'); }
  const BLOCK = [[-4.3, -2.5, -4.1, -0.9], [-2.65, -1.75, -4.1, -3.2], [-1.95, -1.25, -3.75, -3.05], [2.45, 4.35, -3.45, -1.55], [2.2, 3.8, 1.3, 2.5], [3.9, 4.7, -0.8, 0],
    [-4.75, -3.55, 5.65, 6.85], [lpx - 0.25, lpx + 0.25, lpz - 0.25, lpz + 0.25], [mx - 0.3, mx + 0.3, mz - 0.35, mz + 0.35], [1.6, 4.6, EDGE + 0.1, EDGE + 0.75], [-3.3, -1.9, 4.9, 5.5]];
  function free(x, z) {
    const inRoom = x > -4.55 && x < 4.6 && z > -3.5 && z < EDGE - 0.15, inGarden = x > -4.75 && x < 4.6 && z > EDGE + 0.55 && z < FENCE_Z - 0.4;
    if (!inRoom && !inGarden) return false;
    return !BLOCK.some(([x0, x1, z0, z1]) => x > x0 - 0.25 && x < x1 + 0.25 && z > z0 - 0.25 && z < z1 + 0.25);
  }
  const mc = new THREE.Vector3();
  function margaretAt() { torso.getWorldPosition(mc); return { x: mc.x, z: mc.z }; }
  // a free spot beside her, preferring her sides as seen from the camera so neither hides the other
  function standNear(m, r) {
    const dirs = [[0.6, -0.8], [-0.8, 0.6], [0.4, -0.92], [-0.92, 0.4], [0.97, 0.25], [-0.25, -0.97], [-0.97, -0.25], [0.25, 0.97]];
    for (const rr of [r, r * 1.25, r * 1.6]) for (const [dx, dz] of dirs) { const x = m.x + dx * rr, z = m.z + dz * rr; if (free(x, z)) return { x, z }; }
    return { x: m.x + 0.8 * r, z: m.z - 0.6 * r };
  }
  function setAlpha(g, a) {
    g.alpha = a; const tr = a < 0.999;
    for (const m of g.K.all) { if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.opacity = a; }
  }
  function removeGuest(g) { scene.remove(g.root); const i = guests.indexOf(g); if (i >= 0) guests.splice(i, 1); g.waiters.splice(0).forEach((f) => f()); }
  function anchorFor(g, m, lying) {
    const o = g.opts;
    if (o.at) return typeof o.at === 'string' ? (SPOT[o.at] || SPOT.center) : o.at;
    if (g.kind === 'repair' && !o.near) return REPAIR_SPOTS.find((p) => Math.hypot(p.x - m.x, p.z - m.z) > 0.95) || REPAIR_SPOTS[0];
    if (lying) {                                         // kneel beside her body, on the far side from the camera if there is room
      neck.getWorldPosition(mc); const ax = mc.x - m.x, az = mc.z - m.z, al = Math.hypot(ax, az) || 1, cx = m.x + ax * 0.5, cz = m.z + az * 0.5;
      const ux = ax / al, uz = az / al;              // at her head, or beside her chest; furthest from the camera first
      const cands = [[mc.x + ux * 0.8, mc.z + uz * 0.8], [cx - uz * 1.0, cz + ux * 1.0], [cx + uz * 1.0, cz - ux * 1.0]].sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]));
      for (const [x, z] of cands) if (free(x, z)) return { x, z };
    }
    return standNear(m, o.mood === 'angry' ? 1.2 : 1.3);
  }

  function updateGuests(dt, t) {
    if (!guests.length) return;
    const m = margaretAt(), lying = P.lie > 0.5, talking = performance.now() < gBubbleUntil;
    for (const g of guests.slice()) {
      const S = g.S, Q = g.Q, o = g.opts;
      let tgt;
      if (g.state === 'leave') {
        if (g.quick) { setAlpha(g, Math.max(0, g.alpha - dt * 3)); if (g.alpha <= 0) { removeGuest(g); continue; } tgt = g.pos; }
        else { tgt = g.pos.z > EDGE ? GATE_OUT : g.pastDoor ? DOOR_OUT : DOOR_IN; if (g.pastDoor || (g.pos.z > EDGE && g.pos.z > FENCE_Z - 0.2)) { setAlpha(g, Math.max(0, g.alpha - dt * 2.2)); if (g.alpha <= 0) { removeGuest(g); continue; } } }
      } else {
        if (g.alpha < 1) setAlpha(g, Math.min(1, g.alpha + dt * 2.5));
        if (!g.anchor || !g.anchorM || Math.hypot(g.anchorM.x - m.x, g.anchorM.z - m.z) > 0.75 || g.lying !== lying) { g.anchor = anchorFor(g, m, lying); g.anchorM = m; g.lying = lying; }
        tgt = g.anchor;
      }
      const goal = route(g.pos, tgt), dx = goal.x - g.pos.x, dz = goal.z - g.pos.z, d = Math.hypot(dx, dz);
      const sp = 1.45;
      // which hand faces the camera (sticky): props show there, the big gestures use it
      const camSide = Math.cos(g.heading) - Math.sin(g.heading); if (camSide > 0.2) g.nearL = true; else if (camSide < -0.2) g.nearL = false;
      const N = g.nearL ? 'l' : 'r', F = g.nearL ? 'r' : 'l';
      const arm = (sd, x, out) => { Q[sd + 'ArmX'] = x; Q[sd + 'ArmZ'] = sd === 'l' ? out : -out; };
      Object.assign(Q, { lHip: 0, lKnee: 0, rHip: 0, rKnee: 0, lArmX: 0.04, lArmZ: 0.08, rArmX: 0.04, rArmZ: -0.08, headX: 0, headY: 0, lean: 0, bob: Math.sin(t * 2.0 + 1) * 0.012, crouch: 0 });
      if (d > 0.05 || goal.via) {
        if (goal.via && d <= 0.05) { g.pos.x = goal.x; g.pos.z = goal.z; }
        else { const st = Math.min(d, sp * dt); g.pos.x += dx / d * st; g.pos.z += dz / d * st; g.heading = turn(g.heading, Math.atan2(dx, dz), dt * 8); }
        g.walkPhase += dt * sp * 5.2; const s = Math.sin(g.walkPhase), c = Math.cos(g.walkPhase);
        Object.assign(Q, { lHip: s * 0.45, rHip: -s * 0.45, lKnee: Math.max(0, -c) * 0.5, rKnee: Math.max(0, c) * 0.5, lArmX: -s * 0.36, rArmX: s * 0.36, lean: 0.05, bob: Math.abs(s) * 0.05 });
        if (S.prop === 'clipboard') arm(N, -0.9, 0.12);
        if (g.state === 'leave' && g.pos.z <= EDGE && Math.hypot(DOOR_IN.x - g.pos.x, DOOR_IN.z - g.pos.z) < 0.1) g.pastDoor = true;
      } else {
        if (g.state === 'leave') { g.pastDoor = true; }
        else if (g.tArrive == null) { g.tArrive = t; g.waiters.splice(0).forEach((f) => f()); }
        const fx = m.x - g.pos.x, fz = m.z - g.pos.z;
        const face = Math.hypot(fx, fz) < 7 ? Math.atan2(fx, fz) : Math.PI / 2;
        g.heading = turn(g.heading, face, dt * 5);
        const ta = g.tArrive != null ? t - g.tArrive : 0;
        const gesture = S.prop === 'clipboard' ? !o.quiet : talking;
        if (gesture) { arm(N, -0.7 + Math.sin(t * 2.6) * 0.35, 0.28 + Math.sin(t * 1.7) * 0.1); arm(F, -0.35 + Math.sin(t * 2.1 + 1) * 0.2, 0.2); Object.assign(Q, { headX: Math.sin(t * 3.2) * 0.07, headY: Math.sin(t * 0.9) * 0.1 }); }
        if (S.prop === 'clipboard') { arm(N, -0.95, 0.12); if (gesture) arm(F, -1.2 + Math.sin(t * 2.6) * 0.45, 0.35 + Math.sin(t * 1.7) * 0.15); }
        if (S.top === 'sweater' && ta < 1.8 && !lying) arm(N, -0.2, 2.6 + Math.sin(t * 11) * 0.3);   // Lisa waves hello
        if (o.mood === 'angry') {                        // arm raised, leaning in
          arm(N, -2.75 + Math.sin(t * 8) * 0.14, 0.12); arm(F, -0.6 + Math.sin(t * 5) * 0.12, 0.3);
          Object.assign(Q, { lean: 0.2, headX: 0.12 + Math.sin(t * 6) * 0.05, headY: 0, bob: Math.abs(Math.sin(t * 4)) * 0.03 });
        } else if (o.card) arm(N, -1.0, 0.1);
        if (lying && (g.kind === 'ruth' || g.kind === 'lisa') && !o.at) Object.assign(Q, { lHip: -1.45, lKnee: 1.5, rHip: 0.05, rKnee: 1.55, lean: 0.32, lArmX: -1.0, lArmZ: 0.15, rArmX: -0.75, rArmZ: -0.15, headX: 0.35, crouch: 1, bob: 0 });
      }
      for (const sd of ['L', 'R']) for (const pr of g.props[sd]) pr.o.visible = (sd === 'L') === !!g.nearL && (pr.k === 'clip' || !!o.card);
      const faceMap = o.mood === 'angry' ? g.K.X.faceAngry : g.K.X.face;
      if (g.K.faceM.map !== faceMap) { g.K.faceM.map = faceMap; g.K.faceM.needsUpdate = true; }
      const k = 1 - Math.exp(-dt * 10), Pg = g.P;
      for (const key in Pg) Pg[key] += (Q[key] - Pg[key]) * k;
      g.root.position.set(g.pos.x, gy(g.pos.z) + Pg.bob - Pg.crouch * 0.34 * S.scale, g.pos.z);
      g.root.rotation.y = g.heading;
      g.body.rotation.x = Pg.lean;
      g.legs[0].hip.rotation.x = Pg.lHip; g.legs[0].knee.rotation.x = Pg.lKnee; g.legs[1].hip.rotation.x = Pg.rHip; g.legs[1].knee.rotation.x = Pg.rKnee;
      g.LA.rotation.set(Pg.lArmX, 0, Pg.lArmZ); g.RA.rotation.set(Pg.rArmX, 0, Pg.rArmZ);
      g.neck.rotation.set(Pg.headX, Pg.headY, 0);
    }
  }
  function guest(kind, o = {}) {
    if (kind && !GSPEC[kind]) { console.warn('stage.guest: unknown kind', kind); kind = null; }
    const cur0 = live();
    if (kind && cur0 && cur0.kind === kind) { Object.assign(cur0.opts, o || {}); cur0.anchor = null; return Promise.resolve(); }
    for (const g of guests.slice()) {
      if (g.state === 'leave' && g.kind === kind) { removeGuest(g); continue; }
      if (g.state !== 'leave') { g.state = 'leave'; g.quick = !!kind; g.tArrive = null; }
    }
    if (!kind) {
      const leaving = guests.slice();
      return leaving.length ? Promise.race([Promise.all(leaving.map((g) => new Promise((r) => g.waiters.push(r)))), new Promise((r) => setTimeout(r, 7000))]).then(() => {}) : Promise.resolve();
    }
    const g = buildGuest(kind); g.opts = Object.assign({}, o || {});
    const m = margaretAt(), lying = P.lie > 0.5, enter = g.opts.enter || g.S.enter;
    if (enter === 'near') { const a = anchorFor(g, m, lying); g.pos.set(a.x, 0, a.z); g.heading = Math.atan2(m.x - a.x, m.z - a.z); }
    else if (m.z > EDGE && enter !== 'door') { g.pos.set(PATH_X, 0, EDGE + 0.6); g.heading = Math.PI; }
    else { g.pos.set(-4.8, 0, 1.5); g.heading = Math.PI / 2; }
    setAlpha(g, 0); guests.push(g); updateGuests(0.001, T0);
    return Promise.race([new Promise((r) => g.waiters.push(r)), new Promise((r) => setTimeout(r, 9000))]).then(() => {});
  }

  // ---- night + LED ----
  const dayC = { hemi: 1.6, sun: 2.2, sky: new THREE.Color('#BFE0F2'), ground: new THREE.Color('#c9a882'), top: new THREE.Color('#fff4e6') };
  const nightC = { hemi: 0.55, sun: 0.12, sky: new THREE.Color('#1E2850'), ground: new THREE.Color('#3a3046'), top: new THREE.Color('#8ea0d8') };
  const tmp = new THREE.Color();
  function applyNight(dt) {
    nightK += ((night ? 1 : 0) - nightK) * Math.min(1, dt * 2.2);
    hemi.intensity = lerp(dayC.hemi, nightC.hemi, nightK); sun.intensity = lerp(dayC.sun, nightC.sun, nightK);
    hemi.color.copy(dayC.top).lerp(nightC.top, nightK); hemi.groundColor.copy(dayC.ground).lerp(nightC.ground, nightK);
    skyMat.color.copy(dayC.sky).lerp(nightC.sky, nightK);
    sunDisc.material.opacity = 1 - nightK; moon.material.opacity = nightK; stars.forEach((s, i) => { s.material.opacity = nightK * (0.6 + 0.4 * Math.sin(T0 * 2 + i)); });
    lampLight.intensity = nightK * 7; shadeMat.emissiveIntensity = nightK * 0.9;
    porchLight.intensity = nightK * 9; lanternMat.emissiveIntensity = nightK * 1.3;
    const open = (Math.hypot(pos.x - PATH_X, pos.z - FENCE_Z) < 1.05 || guests.some((g) => Math.hypot(g.pos.x - PATH_X, g.pos.z - FENCE_Z) < 1.05)) ? 1 : 0;
    gate.rotation.y += (-1.2 * open - gate.rotation.y) * Math.min(1, dt * 3);
  }
  function ledLevel(t) {
    if (!ledColor) return 0;
    switch (ledPattern) { case 'blink': return (t * 2) % 1 < 0.5 ? 1 : 0.06; case 'pulse': return 0.3 + 0.7 * Math.abs(Math.sin(t * Math.PI * 2.2)); case 'breathe': return 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 1.8)); default: return 1; }
  }
  const ledWorld = new THREE.Vector3();
  function applyLed(t) {
    const lv = ledLevel(t);
    if (ledColor) { tmp.set(ledColor); ledMat.emissive.copy(tmp); ledMat.color.copy(tmp); haloMat.color.copy(tmp); ledLight.color.copy(tmp); }
    else { ledMat.emissive.set('#000000'); ledMat.color.set('#2E2622'); }
    ledMat.emissiveIntensity = 2.2 * lv; haloMat.opacity = ledColor ? 0.85 * lv : 0; ledLight.intensity = ledColor ? (1.2 + nightK * 2.5) * lv : 0;
    ledMesh.getWorldPosition(ledWorld); ledLight.position.copy(ledWorld);
  }

  // ---- sizing, loop, overlays ----
  const FIT = [], fitV = new THREE.Vector3();
  for (const x of [-5.3, 5.0]) for (const z of [-4.3, GARDEN_Z1]) FIT.push(new THREE.Vector3(x, GY - 0.3, z));
  FIT.push(new THREE.Vector3(-5.3, 3.5, -4.3), new THREE.Vector3(5.0, 3.6, -4.3), new THREE.Vector3(-5.3, 3.6, EDGE), new THREE.Vector3(tx, 2.9, tz));
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight), a = w / h;
    // fit room + garden: project the scene's extreme points into view space, pad, then match the aspect
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of FIT) { fitV.copy(p).applyMatrix4(cam.matrixWorldInverse); x0 = Math.min(x0, fitV.x); x1 = Math.max(x1, fitV.x); y0 = Math.min(y0, fitV.y); y1 = Math.max(y1, fitV.y); }
    let fw = (x1 - x0) * 1.03, fh = (y1 - y0) * 1.05; const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (fw / fh < a) fw = fh * a; else fh = fw / a;
    Object.assign(cam, { left: cx - fw / 2, right: cx + fw / 2, top: cy + fh / 2, bottom: cy - fh / 2 }); cam.updateProjectionMatrix();
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0 }); io.observe(container);
  const headWorld = new THREE.Vector3();
  function anchorPx(neckObj, up) { neckObj.getWorldPosition(headWorld); headWorld.y += up; headWorld.project(cam); return { x: (headWorld.x * 0.5 + 0.5) * container.clientWidth, y: (-headWorld.y * 0.5 + 0.5) * container.clientHeight }; }
  // frac: where along the bubble the tail sits (0.5 centred; pushed apart when both people are talking)
  function placeBubble(B, a, frac) {
    const W = container.clientWidth, w = B.el.offsetWidth, h = B.el.offsetHeight;
    const left = Math.max(6, Math.min(W - w - 6, a.x - w * frac));
    B.el.style.left = left + 'px'; B.el.style.top = Math.max(h + 8, a.y) + 'px';
    B.tail.style.left = Math.max(14, Math.min(w - 14, a.x - left)) + 'px';
  }
  function overlays() {
    const now = performance.now(), g = live() || guests[0];
    const mOn = now < bubbleUntil, gOn = !!g && now < gBubbleUntil;
    MB.el.style.opacity = mOn ? '1' : '0'; GB.el.style.opacity = gOn ? '1' : '0';
    if (!mOn && !gOn) return;
    const ma = mOn ? anchorPx(neck, P.lie > 0.5 ? 0.9 : 1.05) : null;
    const ga = gOn ? anchorPx(g.neck, (g.P.crouch > 0.5 ? 0.85 : 1.1) * g.S.scale) : null;
    if (gOn) GB.who.textContent = g.opts.name || g.S.label;
    if (ma && ga) {
      const mLeft = ma.x <= ga.x;
      placeBubble(MB, ma, mLeft ? 0.82 : 0.18); placeBubble(GB, ga, mLeft ? 0.18 : 0.82);
      // keep them from stacking: lift the higher-anchored one above the other if they overlap
      const r1 = MB.el.getBoundingClientRect(), r2 = GB.el.getBoundingClientRect();
      if (r1.left < r2.right && r2.left < r1.right && r1.top < r2.bottom && r2.top < r1.bottom) {
        const [up, other] = r1.top <= r2.top ? [MB, r2] : [GB, r1];
        up.el.style.top = Math.max(up.el.offsetHeight + 4, other.top - container.getBoundingClientRect().top - 6) + 'px';
      }
    } else if (ma) placeBubble(MB, ma, 0.5); else placeBubble(GB, ga, 0.5);
  }
  let raf = 0, disposed = false;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()); T0 += dt;
    if (!visible || document.visibilityState === 'hidden') return;
    update(dt, T0); updateGuests(dt, T0); applyNight(dt); applyLed(T0); renderer.render(scene, cam); overlays();
  }
  frame();

  const stage = {
    setNight(v) { night = !!v; },
    setLed(color, pattern) { ledColor = color || null; ledPattern = pattern || 'solid'; },
    act,
    /** who = 'guest' puts the bubble above the current guest (default: Margaret) */
    say(text, ms = 4500, who) {
      if (who === 'guest') { GB.txt.textContent = String(text || ''); gBubbleUntil = text ? performance.now() + ms : 0; }
      else { btxt.textContent = String(text || ''); bubbleUntil = performance.now() + ms; }
      overlays();
    },
    /** a second person: 'repair' (roofer at the door) · 'nephew' ({ mood: 'angry', card: true }) · 'ruth' (neighbour) · 'lisa' (daughter) · null (leaves) */
    guest,
    caption(text) { cap.textContent = String(text || ''); cap.style.opacity = text ? '1' : '0'; },
    /** advance the animation by hand (snapshots / tests): stage.step(seconds) */
    step(sec = 1) { const n = Math.ceil(sec / 0.033); for (let i = 0; i < n; i++) { T0 += 0.033; update(0.033, T0); updateGuests(0.033, T0); applyNight(0.033); } applyLed(T0); renderer.render(scene, cam); overlays(); },
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); bubble.remove(); GB.el.remove(); cap.remove(); GEO.forEach((g) => g.dispose()); renderer.domElement.remove(); },
  };
  act('idle');
  return stage;
}

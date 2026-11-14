/* Band 39 · simulator stage: Margaret (78) as an original blocky voxel character in her cozy room, acting out each
 * event, with band 39 on her left wrist and its LED glowing. three.js r186 (vendored). Original art, drawn as tiny
 * pixel textures on canvases; no game assets.
 *
 *   const stage = createStage(container)
 *   stage.setNight(bool) · stage.setLed(color|null, 'solid'|'blink'|'pulse'|'breathe') · stage.act(name, opts) → Promise
 *   stage.say(text, ms) · stage.caption(text) · stage.dispose()
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
  return { face, headSide, hair, cardi, cardiSide, skirt, floor, wall, wainscot, rug, blanket, halo };
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
const SEAT = { x: 3.35, z: -2.45, y: 0.12, face: -2.36 + Math.PI };   // armchair seat, facing into the room
const BED = { x: -3.4, z: -1.35, y: 0.62 };                              // lying in bed, head toward the wall

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
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 }); sun.shadow.bias = -0.0015; sun.shadow.radius = 4;
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
  const bubble = document.createElement('div'); bubble.className = 'stage-bubble';
  Object.assign(bubble.style, { position: 'absolute', left: '0', top: '0', transform: 'translate(-50%, -100%)', maxWidth: '240px', padding: '9px 12px', borderRadius: '14px',
    background: '#FFFAF2', color: '#3B2A20', font: '500 13px/1.4 inherit', boxShadow: '0 8px 22px -8px rgba(60,35,20,.35)', border: '1px solid #EADBC8', pointerEvents: 'none', opacity: '0', transition: 'opacity .25s', zIndex: 2 });
  const tail = document.createElement('i'); Object.assign(tail.style, { position: 'absolute', left: '50%', bottom: '-6px', width: '12px', height: '12px', background: '#FFFAF2', borderRight: '1px solid #EADBC8', borderBottom: '1px solid #EADBC8', transform: 'translateX(-50%) rotate(45deg)' });
  const btxt = document.createElement('span'); bubble.append(btxt, tail); container.appendChild(bubble);
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
    const at = (k) => SPOT[k] || SPOT.center;
    switch (name) {
      case 'walk': return { to: at(o.to || 'center') };
      case 'sleep': return { to: SPOT.bed, place: { x: BED.x, z: BED.z, y: BED.y, face: 0, lie: 1 } };
      case 'sit': return { to: SPOT.chair, place: { x: SEAT.x, z: SEAT.z, y: SEAT.y, face: SEAT.face, sit: 1 } };
      case 'pills': case 'bandoff': return { to: SPOT.table };
      case 'nightwalk': return { to: SPOT.door, loop: ['door', 'bed'], speed: 0.9 };
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
      const dx = plan.to.x - pos.x, dz = plan.to.z - pos.z, d = Math.hypot(dx, dz);
      if (cur.sitting) cur.sitting = false;
      if (d > 0.06) {
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
    root.position.set(pos.x, (plan && plan.place && cur.arrived ? lerp(0, plan.place.y, Math.min(1, (t - (cur.t1 || t)) * 3)) : 0) + P.bob, pos.z);
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
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight), a = w / h;
    const halfH = Math.max(4.3, 6.9 / a);
    Object.assign(cam, { left: -halfH * a, right: halfH * a, top: halfH, bottom: -halfH }); cam.updateProjectionMatrix();
    renderer.setSize(w, h, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0 }); io.observe(container);
  const headWorld = new THREE.Vector3();
  function overlays() {
    const on = performance.now() < bubbleUntil; bubble.style.opacity = on ? '1' : '0';
    if (!on) return;
    neck.getWorldPosition(headWorld); headWorld.y += P.lie > 0.5 ? 0.9 : 1.05;
    headWorld.project(cam);
    const x = (headWorld.x * 0.5 + 0.5) * container.clientWidth, y = (-headWorld.y * 0.5 + 0.5) * container.clientHeight;
    const half = bubble.offsetWidth / 2;
    bubble.style.left = Math.max(half + 6, Math.min(container.clientWidth - half - 6, x)) + 'px'; bubble.style.top = Math.max(bubble.offsetHeight + 8, y) + 'px';
  }
  let raf = 0, disposed = false;
  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta()); T0 += dt;
    if (!visible || document.visibilityState === 'hidden') return;
    update(dt, T0); applyNight(dt); applyLed(T0); renderer.render(scene, cam); overlays();
  }
  frame();

  const stage = {
    setNight(v) { night = !!v; },
    setLed(color, pattern) { ledColor = color || null; ledPattern = pattern || 'solid'; },
    act,
    say(text, ms = 4500) { btxt.textContent = String(text || ''); bubbleUntil = performance.now() + ms; overlays(); },
    caption(text) { cap.textContent = String(text || ''); cap.style.opacity = text ? '1' : '0'; },
    /** advance the animation by hand (snapshots / tests): stage.step(seconds) */
    step(sec = 1) { const n = Math.ceil(sec / 0.033); for (let i = 0; i < n; i++) { T0 += 0.033; update(0.033, T0); applyNight(0.033); } applyLed(T0); renderer.render(scene, cam); overlays(); },
    dispose() { disposed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); renderer.dispose(); bubble.remove(); cap.remove(); renderer.domElement.remove(); },
  };
  act('idle');
  return stage;
}

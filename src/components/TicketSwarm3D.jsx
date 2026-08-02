import { useEffect, useRef, useState } from 'react';
import { TicketSwarm } from './TicketSwarm.jsx';
import {
  CHORD,
  createTicket,
  createWind,
  FIXED_DT,
  MAX_SUBSTEPS,
  SPAN,
  stepTicket,
  wrap,
  applyGlass,
} from '../lib/ticketPhysics.js';

/**
 * Mock bookings. Theatres are the real Chennai cinemas seeded in
 * supabase/theatres.sql, so the stubs read like this marketplace's own stock.
 */
const BRANDS = [
  {
    name: 'BookMyShow', ink: '#e8434f', movie: 'Spider-Man: Brand New Day',
    theatre: 'PVR: Sathyam, Royapettah', screen: 'AUDI 3 · DOLBY ATMOS',
    when: 'SAT 9 AUG · 6:30 PM', seat: 'J12', price: '₹240', code: 'BMS 7K2Q',
  },
  {
    name: 'District', ink: '#6d4df0', movie: 'Dune: Part Three',
    theatre: 'INOX LUXE, Phoenix Velachery', screen: 'IMAX · RECLINER',
    when: 'SUN 10 AUG · 9:15 PM', seat: 'C04', price: '₹520', code: 'DST 4M8P',
  },
  {
    name: 'PVR Cinemas', ink: '#c9a227', movie: 'Toxic: A fairy tale for Grown-ups',
    theatre: 'PVR: Palazzo, Vadapalani', screen: 'AUDI 7 · 4K LASER',
    when: 'FRI 8 AUG · 10:00 PM', seat: 'H21', price: '₹190', code: 'PVR 9X3T',
  },
  {
    name: 'INOX', ink: '#2f7fd4', movie: 'Kaithi 2',
    theatre: 'INOX: Chennai Citi Centre', screen: 'LUXE 2 · ATMOS',
    when: 'SAT 9 AUG · 2:45 PM', seat: 'A09', price: '₹300', code: 'INX 5B1L',
  },
  {
    name: 'Cinépolis', ink: '#1f9d76', movie: 'Leo: Bloody Sweet',
    theatre: 'Cinépolis: BSR Mall, Thoraipakkam', screen: '4DX · PREMIUM',
    when: 'SUN 10 AUG · 7:00 PM', seat: 'F15', price: '₹450', code: 'CNP 2W6R',
  },
  {
    name: 'BookMyShow', ink: '#e8434f', movie: 'Ponniyin Selvan III',
    theatre: 'Rohini Silver Screens, Koyambedu', screen: 'SCREEN 1 · 4K',
    when: 'THU 7 AUG · 6:00 PM', seat: 'G07', price: '₹210', code: 'BMS 3H9V',
  },
  {
    name: 'District', ink: '#6d4df0', movie: 'Avengers: Doomsday',
    theatre: 'AGS Cinemas: OMR Sholinganallur', screen: 'RECLINER · ATMOS',
    when: 'SAT 9 AUG · 11:30 AM', seat: 'B18', price: '₹275', code: 'DST 8Q4K',
  },
  {
    name: 'PVR Cinemas', ink: '#c9a227', movie: 'DC',
    theatre: 'PVR: VR Chennai, Anna Nagar', screen: 'IMAX · RECLINER',
    when: 'FRI 8 AUG · 3:20 PM', seat: 'K05', price: '₹390', code: 'PVR 6D2N',
  },
];

const ATLAS_COLS = 2;
const ATLAS_ROWS = 4;
// 2.13:1 matches the 150 × 70 mm stub, so the artwork is never stretched
const CELL_W = 640;
const CELL_H = 300;

/** Ticket faces drawn once into a canvas, so no image assets ship. */
function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * ATLAS_COLS;
  canvas.height = CELL_H * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');

  const clip = (text, px, maxW) => {
    ctx.font = px;
    let t = text;
    while (t.length > 4 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
    return t === text ? t : t.trim() + '…';
  };

  BRANDS.forEach((b, i) => {
    const cx = (i % ATLAS_COLS) * CELL_W;
    const cy = Math.floor(i / ATLAS_COLS) * CELL_H;
    const STUB = Math.round(CELL_W * 0.71); // perforation line
    ctx.save();
    ctx.translate(cx, cy);

    // paper
    const g = ctx.createLinearGradient(0, 0, CELL_W, CELL_H);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#f0eee7');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CELL_W, CELL_H);

    // brand header band
    ctx.fillStyle = b.ink;
    ctx.fillRect(0, 0, CELL_W, 62);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px system-ui, sans-serif';
    ctx.fillText(b.name.toUpperCase(), 22, 44);
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText('E-TICKET', CELL_W - 130, 44);
    ctx.globalAlpha = 1;

    // movie title — the thing that must read at a glance
    ctx.fillStyle = '#14131a';
    ctx.font = '800 50px system-ui, sans-serif';
    ctx.fillText(clip(b.movie, '800 50px system-ui, sans-serif', STUB - 40), 20, 124);

    // venue + showtime
    ctx.fillStyle = '#55525e';
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText(clip(b.theatre, '500 22px system-ui, sans-serif', STUB - 44), 22, 158);
    ctx.fillStyle = '#14131a';
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.fillText(b.when, 22, 192);
    ctx.fillStyle = '#7d7a86';
    ctx.font = '500 19px system-ui, sans-serif';
    ctx.fillText(b.screen, 22, 208);

    // seat + price block
    ctx.fillStyle = '#8b8794';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('SEAT', 22, 244);
    ctx.fillText('PRICE', 150, 244);
    ctx.fillStyle = b.ink;
    ctx.font = '800 34px system-ui, sans-serif';
    ctx.fillText(b.seat, 22, 278);
    ctx.fillStyle = '#14131a';
    ctx.fillText(b.price, 150, 278);

    ctx.fillStyle = '#a8a4b0';
    ctx.font = '500 17px system-ui, sans-serif';
    ctx.fillText(b.code, 300, 278);

    // perforation
    ctx.strokeStyle = '#cfcabd';
    ctx.setLineDash([10, 9]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(STUB, 60);
    ctx.lineTo(STUB, CELL_H - 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // stub: seat repeated big, then a barcode
    ctx.fillStyle = '#8b8794';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('ADMIT ONE', STUB + 20, 88);
    ctx.fillStyle = '#14131a';
    ctx.font = '900 62px system-ui, sans-serif';
    ctx.fillText(b.seat, STUB + 18, 146);

    ctx.fillStyle = '#1b1a20';
    let x = STUB + 20;
    while (x < CELL_W - 22) {
      const w = 3 + Math.random() * 6;
      ctx.fillRect(x, 162, w, 92);
      x += w + 4 + Math.random() * 4;
    }
    ctx.fillStyle = '#8b8794';
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.fillText(b.code, STUB + 20, 278);

    ctx.restore();
  });

  return canvas;
}

/** Coarse capability tier — keeps the model identical, only the count moves. */
/**
 * Playback rate for the simulation clock. Trajectories are unchanged; only
 * the rate at which simulated time advances is scaled, as with high-speed
 * camera footage. Slow enough that a stub reads as a ticket rather than
 * as blowing litter.
 */
const TIME_SCALE = 0.3;

function deviceTier() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const narrow = window.innerWidth < 1100;
  if (mem <= 2 || cores <= 2) return { count: 6, dpr: 1, aa: false };
  if (mem <= 4 || cores <= 4 || narrow) return { count: 10, dpr: 1.5, aa: false };
  return { count: 15, dpr: 2, aa: true };
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function TicketSwarm3D() {
  const hostRef = useRef(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !hasWebGL()) {
      setFallback(true);
      return undefined;
    }

    let disposed = false;
    let cleanup = () => {};

    // Loaded on demand so three never lands in the initial bundle.
    import('three')
      .then((THREE) => {
        if (disposed || !hostRef.current) return;
        cleanup = mount(THREE, hostRef.current);
      })
      .catch(() => setFallback(true));

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  if (fallback) return <TicketSwarm />;
  return <div className="swarm3d" ref={hostRef} aria-hidden="true" />;
}

const FOV = 46;
const CAM_Z = 1.05;
/** Half-height of the slab the camera sees at the domain's mid-plane. */
const VIS_HALF_H = Math.tan((FOV * Math.PI) / 180 / 2) * CAM_Z;

/**
 * Half-width of the simulation box for a given viewport aspect. The domain
 * runs 1.5× wider than what the camera sees, so sheets drift in and out of
 * frame instead of milling about on screen. Holding that ratio matters on a
 * portrait phone: a fixed width would put most of the box off-screen and the
 * few visible sheets would read as an empty scene.
 */
function boundsX(aspect) {
  return Math.max(0.34, Math.min(0.8, VIS_HALF_H * aspect * 1.5));
}

function mount(THREE, host) {
  const tier = deviceTier();
  const aspect0 = Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight);
  const bounds = { x: boundsX(aspect0), y: 0.46, z: 0.42 };

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: tier.aa,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.dpr));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, CAM_Z);

  const atlas = new THREE.CanvasTexture(buildAtlas());
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 1;

  const N = tier.count;
  const SLOTS = N; // every sheet is a candidate; none is special
  const VERTS = 8; // two quads per sheet
  const positions = new Float32Array(SLOTS * VERTS * 3);
  const normals = new Float32Array(SLOTS * VERTS * 3);
  const uvs = new Float32Array(SLOTS * VERTS * 2);
  // Vertex colour multiplies the map. Fading it toward black dissolves a
  // sheet into the dark panel near a box wall, so the periodic wrap is never
  // visible as a pop.
  const colors = new Float32Array(SLOTS * VERTS * 3);
  const index = new Uint16Array(SLOTS * 12);

  const uSpan = 1 / ATLAS_COLS;
  const vSpan = 1 / ATLAS_ROWS;

  for (let i = 0; i < SLOTS; i++) {
    const b = i % BRANDS.length;
    const u0 = (b % ATLAS_COLS) * uSpan;
    const v0 = 1 - (Math.floor(b / ATLAS_COLS) + 1) * vSpan;
    // panel A spans the left 63% of the cell, panel B the rest
    const uMid = u0 + uSpan * 0.63;
    const uv = [
      u0, v0, uMid, v0, uMid, v0 + vSpan, u0, v0 + vSpan,
      uMid, v0, u0 + uSpan, v0, u0 + uSpan, v0 + vSpan, uMid, v0 + vSpan,
    ];
    uvs.set(uv, i * VERTS * 2);

    const o = i * VERTS;
    index.set(
      [o, o + 1, o + 2, o, o + 2, o + 3, o + 4, o + 5, o + 6, o + 4, o + 6, o + 7],
      i * 12,
    );
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  const uvAttr = new THREE.BufferAttribute(uvs, 2);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  uvAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('normal', normAttr);
  geo.setAttribute('color', colAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  const material = new THREE.MeshLambertMaterial({
    map: atlas,
    side: THREE.DoubleSide,
    transparent: false,
    vertexColors: true,
  });
  scene.add(new THREE.Mesh(geo, material));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3542, 3.4));
  const key = new THREE.DirectionalLight(0xfff2dd, 2.6);
  key.position.set(2.5, 3, 4);
  scene.add(key);

  const bodies = Array.from({ length: N }, () => createTicket(bounds));
  /** Distance at which a flattened sheet spans `frac` of the viewport width. */
  function glassDistance(frac) {
    const halfTan = Math.tan((camera.fov * Math.PI) / 180 / 2);
    return CHORD / (frac * 2 * halfTan * camera.aspect);
  }
  // The viewing plane is a wall of the domain. Recomputed on resize so a
  // pinned ticket always reads at the same size.
  let glassZ = camera.position.z - glassDistance(0.45);

  const sampleWind = createWind({ strength: 1.15, vortices: 3, drift: 0.45, bounds });

  const hc = CHORD / 2;
  const hs = SPAN / 2;
  const ZAXIS = new THREE.Vector3(0, 0, 1);
  const q = new THREE.Quaternion();
  const vtx = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  const local = new Float64Array(24);

  /** Write one sheet into its slot. `tint` 0 = invisible (black), 1 = lit. */
  function writeSheet(slot, pos, quat, fold, tint) {
    q.set(quat.x, quat.y, quat.z, quat.w);
    const cf = Math.cos(fold);
    const sf = Math.sin(fold);
    const base = slot * VERTS * 3;

    // Panel B is rotated about the hinge (local Y), matching the physics.
    local.set([
      -hc, -hs, 0, 0, -hs, 0, 0, hs, 0, -hc, hs, 0,
      0, -hs, 0, hc * cf, -hs, hc * sf, hc * cf, hs, hc * sf, 0, hs, 0,
    ]);
    const nAx = 0, nAy = 0, nAz = 1;
    const nBx = -sf, nBy = 0, nBz = cf;

    for (let v = 0; v < VERTS; v++) {
      vtx.set(local[v * 3], local[v * 3 + 1], local[v * 3 + 2]).applyQuaternion(q);
      const o = base + v * 3;
      positions[o] = vtx.x + pos.x;
      positions[o + 1] = vtx.y + pos.y;
      positions[o + 2] = vtx.z + pos.z;

      if (v < 4) nrm.set(nAx, nAy, nAz);
      else nrm.set(nBx, nBy, nBz);
      nrm.applyQuaternion(q);
      normals[o] = nrm.x;
      normals[o + 1] = nrm.y;
      normals[o + 2] = nrm.z;

      colors[o] = tint;
      colors[o + 1] = tint;
      colors[o + 2] = tint;
    }
  }

  // Sheets dissolve over the outer 30% of each half-extent, so the periodic
  // wrap always happens while the sheet is already black.
  const FADE_BAND = 0.3;
  const smoothstep = (t) => t * t * (3 - 2 * t);

  function edgeTint(b) {
    const dx = 1 - Math.min(1, Math.abs(b.pos.x) / bounds.x);
    const dy = 1 - Math.min(1, Math.abs(b.pos.y) / bounds.y);
    // Only the back wall fades. A sheet pinned to the glass stays at full
    // brightness so its details remain legible.
    const dz = 1 - Math.min(1, Math.max(0, -b.pos.z) / bounds.z);
    const d = Math.min(dx, dy, dz);
    return smoothstep(Math.min(1, d / FADE_BAND));
  }

  function writeGeometry() {
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      writeSheet(i, b.pos, b.quat, b.fold, edgeTint(b));
    }
    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  let lastW = 0;
  let lastH = 0;
  function resize() {
    const w = Math.max(1, Math.round(host.clientWidth));
    const h = Math.max(1, Math.round(host.clientHeight));
    if (w === lastW && h === lastH) return; // guards against ResizeObserver loops
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Orientation changes reshape the box; wrap() reads bounds every step.
    bounds.x = boundsX(camera.aspect);
    glassZ = camera.position.z - glassDistance(0.45);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // Draw once immediately. Otherwise the canvas stays blank until the first
  // unthrottled frame, which never arrives while the tab is backgrounded.
  writeGeometry();
  renderer.render(scene, camera);

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let simTime = 0;
  let visible = true;

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) last = performance.now();
  });
  io.observe(host);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !visible) {
      last = now;
      return;
    }
    // Fixed-step accumulator: physics is framerate-independent, and the
    // substep cap stops a slow device from spiralling.
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    acc += dt * TIME_SCALE;

    let steps = 0;
    while (acc >= FIXED_DT && steps < MAX_SUBSTEPS) {
      for (const b of bodies) {
        stepTicket(b, sampleWind, FIXED_DT, simTime);
        applyGlass(b, glassZ, FIXED_DT, sampleWind, simTime);
        wrap(b, bounds, glassZ);
      }
      simTime += FIXED_DT;
      acc -= FIXED_DT;
      steps++;
    }
    if (acc > FIXED_DT * MAX_SUBSTEPS) acc = 0;

    writeGeometry();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    geo.dispose();
    material.dispose();
    atlas.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
  };
}

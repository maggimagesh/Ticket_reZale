/**
 * Rigid-body paper dynamics in a turbulent wind field.
 *
 * Renderer-agnostic on purpose — no Three.js in here — so the model can be
 * verified numerically in Node.
 *
 * Model
 * -----
 * • Quasi-steady flat-plate aerodynamics after Andersen, Pesavento & Wang,
 *   "Unsteady aerodynamics of fluttering and tumbling plates" (JFM 2005):
 *      C_L(α) = C_L,max · sin(2α)
 *      C_D(α) = C_D,0 + (C_D,90 − C_D,0) · sin²(α)
 *   evaluated per panel from the true angle of attack.
 * • Centre of pressure offset from the panel centroid along the chord, which
 *   produces the pitching moment that makes paper tumble instead of falling
 *   flat. Plus the quadratic rotational damping term from the same model.
 * • Anisotropic added mass. For 80 gsm paper the entrained air actually
 *   exceeds the sheet's own mass, so ignoring it gives lead-like motion.
 * • Wind is the curl of a vector potential, so ∇·u = 0 by construction —
 *   the incompressibility condition. Rankine vortices and a rotating gust
 *   are superposed for large-scale structure.
 * • Bending: two panels on a hinge with a torsional spring–damper, driven by
 *   the differential aerodynamic moment. One real elastic degree of freedom.
 * • Symplectic (semi-implicit) Euler at a fixed 1/240 s step.
 *
 * Not modelled: vortex shedding history, Navier–Stokes coupling, panel
 * self-collision. Those need a real FSI solver.
 */

export const AIR_DENSITY = 1.225; // kg/m³ at sea level, 15 °C
export const GRAVITY = 9.81; // m/s²

// Ticket stub: 150 × 70 mm of 80 gsm paper
export const CHORD = 0.15; // m, local X
export const SPAN = 0.07; // m, local Y
const AREA = CHORD * SPAN;
const PAPER_GSM = 0.08; // kg/m²
export const MASS = AREA * PAPER_GSM;

// Flat-plate coefficients (Andersen et al. 2005, thin plate)
const CL_MAX = 1.1;
const CD_EDGE = 0.13;
const CD_BROAD = 1.9;
const C_ROT = 0.4; // quadratic rotational damping

// Torsional hinge along the fold line
const FOLD_STIFFNESS = 0.0016; // N·m/rad
const FOLD_DAMPING = 4.2e-5; // N·m·s/rad
const FOLD_LIMIT = 1.95; // rad, paper creases rather than passing through

/* ------------------------------- vec3 ------------------------------- */

const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const set = (o, x, y, z) => ((o.x = x), (o.y = y), (o.z = z), o);
const addTo = (a, b, s = 1) => ((a.x += b.x * s), (a.y += b.y * s), (a.z += b.z * s), a);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);
const cross = (out, a, b) =>
  set(out, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

function normalize(out, a) {
  const l = len(a);
  return l > 1e-12 ? set(out, a.x / l, a.y / l, a.z / l) : set(out, 0, 0, 0);
}

/** Rotate v by unit quaternion q (v' = q v q*), branch-free form. */
function rotByQuat(out, q, v) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y);
  const ty = 2 * (z * v.x - x * v.z);
  const tz = 2 * (x * v.y - y * v.x);
  return set(
    out,
    v.x + w * tx + (y * tz - z * ty),
    v.y + w * ty + (z * tx - x * tz),
    v.z + w * tz + (x * ty - y * tx),
  );
}

/** Inverse rotation (q is unit, so conjugate). */
function rotByQuatInv(out, q, v) {
  return rotByQuat(out, { x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/* ------------------------- divergence-free wind ------------------------- */

function hash3(i, j, k) {
  let h = i * 374761393 + j * 668265263 + k * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

/** Value noise on a lattice, C¹-smooth via quintic fade. */
function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = fade(x - i), fy = fade(y - j), fz = fade(z - k);
  const c = (di, dj, dk) => hash3(i + di, j + dj, k + dk);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

/** Vector potential ψ; wind is its curl, hence divergence free. */
function potential(out, x, y, z, t) {
  return set(
    out,
    noise3(x * 0.9 + 11.3, y * 0.9, z * 0.9 + t * 0.13),
    noise3(x * 0.9, y * 0.9 + 5.1, z * 0.9 - t * 0.11),
    noise3(x * 0.9 - 7.7, y * 0.9, z * 0.9 + t * 0.09),
  );
}

const _pa = v3(), _pb = v3();
// Central-difference stencil for the curl. Smaller keeps ∇·u nearer zero;
// too small and value-noise round-off starts to dominate.
const EPS = 0.015;

/**
 * u = ∇ × ψ, evaluated by central differences.
 * Divergence is zero to truncation order — verified in the test harness.
 */
export function curlWind(out, x, y, z, t) {
  potential(_pa, x, y + EPS, z, t);
  potential(_pb, x, y - EPS, z, t);
  const dzdy = (_pa.z - _pb.z) / (2 * EPS);
  const dxdy = (_pa.x - _pb.x) / (2 * EPS);

  potential(_pa, x, y, z + EPS, t);
  potential(_pb, x, y, z - EPS, t);
  const dydz = (_pa.y - _pb.y) / (2 * EPS);
  const dxdz = (_pa.x - _pb.x) / (2 * EPS);

  potential(_pa, x + EPS, y, z, t);
  potential(_pb, x - EPS, y, z, t);
  const dydx = (_pa.y - _pb.y) / (2 * EPS);
  const dzdx = (_pa.z - _pb.z) / (2 * EPS);

  return set(out, dzdy - dydz, dxdz - dzdx, dydx - dxdy);
}

/**
 * Rankine vortex: solid-body rotation inside the core, Γ/2πr outside.
 * Axis is vertical, which is what produces the visible swirls.
 */
function addVortex(out, x, z, cx, cz, gamma, core) {
  const dx = x - cx, dz = z - cz;
  const r = Math.hypot(dx, dz);
  if (r < 1e-4) return out;
  const vt = r < core ? (gamma * r) / (2 * Math.PI * core * core) : gamma / (2 * Math.PI * r);
  out.x += (-dz / r) * vt;
  out.z += (dx / r) * vt;
  return out;
}

export function createWind({ strength = 3.4, vortices = 3, drift = 0, bounds } = {}) {
  const cores = Array.from({ length: vortices }, (_, i) => ({
    phase: (i / vortices) * Math.PI * 2,
    radius: bounds.x * 0.55,
    gamma: (i % 2 ? -1 : 1) * (0.9 + i * 0.3),
    core: 0.55,
  }));

  return function sampleWind(out, x, y, z, t) {
    curlWind(out, x, y, z, t);
    out.x *= strength;
    out.y *= strength * 0.55;
    out.z *= strength;

    for (const c of cores) {
      const cx = Math.cos(t * 0.21 + c.phase) * c.radius;
      const cz = Math.sin(t * 0.17 + c.phase) * c.radius * 0.7;
      addVortex(out, x, z, cx, cz, c.gamma, c.core);
    }

    // Large-scale gust that slowly boxes the compass, so the sheets get
    // driven left→right, corner→corner, and top→bottom over time.
    const g = 0.55 + 0.35 * Math.sin(t * 0.13);
    out.x += Math.cos(t * 0.09) * g;
    out.z += Math.sin(t * 0.11) * g;
    out.y += Math.sin(t * 0.07 + 1.7) * 0.4;
    // Steady breeze toward the viewer. This is what carries sheets onto the
    // glass; no sheet is singled out for it.
    out.z += drift;
    return out;
  };
}

/* --------------------------- rigid-body state --------------------------- */

function randomQuat() {
  // Shoemake's uniform random rotation
  const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  return {
    x: s1 * Math.sin(2 * Math.PI * u2),
    y: s1 * Math.cos(2 * Math.PI * u2),
    z: s2 * Math.sin(2 * Math.PI * u3),
    w: s2 * Math.cos(2 * Math.PI * u3),
  };
}

export function createTicket(bounds) {
  return {
    pos: v3(
      (Math.random() * 2 - 1) * bounds.x,
      (Math.random() * 2 - 1) * bounds.y,
      (Math.random() * 2 - 1) * bounds.z,
    ),
    vel: v3((Math.random() - 0.5) * 0.25, (Math.random() - 0.5) * 0.18, (Math.random() - 0.5) * 0.25),
    quat: randomQuat(),
    omega: v3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6),
    onGlass: false,
    fold: (Math.random() - 0.5) * 0.5,
    foldVel: (Math.random() - 0.5) * 0.8,
  };
}

// Thin rectangular plate about its principal axes (normal = local Z)
const I_XX = (MASS * SPAN * SPAN) / 12;
const I_YY = (MASS * CHORD * CHORD) / 12;
const I_ZZ = (MASS * (CHORD * CHORD + SPAN * SPAN)) / 12;

// Added mass. Normal to the sheet the entrained air dominates; edge-on it is
// negligible. This is why paper flutters and a coin does not.
const M_ADD_N = AIR_DENSITY * (Math.PI / 4) * CHORD * CHORD * SPAN;
const M_EFF_X = MASS + 0.06 * M_ADD_N;
const M_EFF_Y = MASS + 0.06 * M_ADD_N;
const M_EFF_Z = MASS + M_ADD_N;

const PANEL_AREA = AREA / 2;
const PANEL_CHORD = CHORD / 2;
const I_HINGE = (MASS / 2) * ((PANEL_CHORD * PANEL_CHORD) / 3);

/* scratch — reused every step so the hot loop does not allocate */
const _wind = v3(), _cLocal = v3(), _cWorld = v3(), _vPanel = v3(), _vRel = v3();
const _n = v3(), _nWorld = v3(), _vHat = v3(), _lift = v3(), _perp = v3();
const _tmp = v3(), _force = v3(), _torque = v3(), _fBody = v3(), _aBody = v3();
const _rCp = v3(), _tPanel = v3(), _chordDir = v3(), _chordWorld = v3();

/**
 * Advance one body by a fixed step.
 * @returns {number} hinge moment, so callers can inspect bending load
 */
export function stepTicket(body, sampleWind, dt, t) {
  set(_force, 0, -MASS * GRAVITY, 0);
  set(_torque, 0, 0, 0);
  let hingeMoment = 0;

  const cosF = Math.cos(body.fold);
  const sinF = Math.sin(body.fold);

  for (let p = 0; p < 2; p++) {
    const folded = p === 1;
    // Panel centroid and normal in body frame; the far panel is rotated
    // about the hinge (local Y) by the fold angle.
    if (folded) {
      // Hinge rotation carries +X toward +Z, so the chord is (cosφ, 0, sinφ)
      // and the outward normal must be its perpendicular in that plane.
      set(_cLocal, (PANEL_CHORD / 2) * cosF, 0, (PANEL_CHORD / 2) * sinF);
      set(_n, -sinF, 0, cosF);
      set(_chordDir, cosF, 0, sinF);
    } else {
      set(_cLocal, -PANEL_CHORD / 2, 0, 0);
      set(_n, 0, 0, 1);
      set(_chordDir, 1, 0, 0);
    }

    rotByQuat(_cWorld, body.quat, _cLocal);
    rotByQuat(_nWorld, body.quat, _n);
    rotByQuat(_chordWorld, body.quat, _chordDir);

    // v = v_cm + ω × r
    cross(_vPanel, body.omega, _cWorld);
    addTo(_vPanel, body.vel);

    sampleWind(_wind, body.pos.x + _cWorld.x, body.pos.y + _cWorld.y, body.pos.z + _cWorld.z, t);
    set(_vRel, _wind.x - _vPanel.x, _wind.y - _vPanel.y, _wind.z - _vPanel.z);

    const speed = len(_vRel);
    if (speed < 1e-5) continue;
    normalize(_vHat, _vRel);

    // Angle of attack measured from the plate plane
    const sinA = Math.max(-1, Math.min(1, dot(_nWorld, _vHat)));
    const absSinA = Math.abs(sinA);
    const cosA = Math.sqrt(Math.max(0, 1 - sinA * sinA));

    const cd = CD_EDGE + (CD_BROAD - CD_EDGE) * sinA * sinA;
    const cl = CL_MAX * 2 * absSinA * cosA; // sin(2α)

    const qDyn = 0.5 * AIR_DENSITY * speed * speed * PANEL_AREA;

    // Drag along the relative wind
    set(_tmp, _vHat.x * qDyn * cd, _vHat.y * qDyn * cd, _vHat.z * qDyn * cd);
    set(_force, _force.x + _tmp.x, _force.y + _tmp.y, _force.z + _tmp.z);
    set(_tPanel, _tmp.x, _tmp.y, _tmp.z);

    // Lift ⟂ to the wind, in the (v̂, n) plane, pushed toward the face the
    // flow strikes
    set(_perp, _nWorld.x - sinA * _vHat.x, _nWorld.y - sinA * _vHat.y, _nWorld.z - sinA * _vHat.z);
    normalize(_lift, _perp);
    const lm = qDyn * cl * Math.sign(sinA || 1);
    addTo(_force, _lift, lm);
    addTo(_tPanel, _lift, lm);

    // Centre of pressure sits ahead of the centroid and migrates with α.
    // This offset is the source of the pitching moment that drives tumbling.
    const cpShift = 0.25 * PANEL_CHORD * cosA * -Math.sign(dot(_chordWorld, _vHat) || 1);
    set(
      _rCp,
      _cWorld.x + _chordWorld.x * cpShift,
      _cWorld.y + _chordWorld.y * cpShift,
      _cWorld.z + _chordWorld.z * cpShift,
    );
    cross(_tmp, _rCp, _tPanel);
    addTo(_torque, _tmp);

    // Moment of this panel about the hinge axis (local Y)
    rotByQuatInv(_tmp, body.quat, _tPanel);
    const armX = folded ? (PANEL_CHORD / 2) * cosF : -PANEL_CHORD / 2;
    const armZ = folded ? (PANEL_CHORD / 2) * sinF : 0;
    hingeMoment += folded ? armZ * _tmp.x - armX * _tmp.z : 0;
  }

  /* --- linear: anisotropic effective mass, so work in the body frame --- */
  rotByQuatInv(_fBody, body.quat, _force);
  set(_aBody, _fBody.x / M_EFF_X, _fBody.y / M_EFF_Y, _fBody.z / M_EFF_Z);
  rotByQuat(_tmp, body.quat, _aBody);
  addTo(body.vel, _tmp, dt);
  addTo(body.pos, body.vel, dt);

  /* --- angular: Euler's equations in the body frame ---
     Quadratic rotational damping is integrated implicitly as
     ω ← (ω + α dt)/(1 + k dt/I). Explicit integration of −k|ω|ω is unstable
     once k·dt/I > 2, which for a plate this light is around 60 rad/s — within
     the range the gusts produce. */
  rotByQuatInv(_tmp, body.quat, _torque);
  const wb = rotByQuatInv(_aBody, body.quat, body.omega);
  const alphaX = (_tmp.x - (I_ZZ - I_YY) * wb.y * wb.z) / I_XX;
  const alphaY = (_tmp.y - (I_XX - I_ZZ) * wb.z * wb.x) / I_YY;
  const alphaZ = (_tmp.z - (I_YY - I_XX) * wb.x * wb.y) / I_ZZ;

  const wMag = Math.hypot(wb.x, wb.y, wb.z);
  const kDamp = C_ROT * AIR_DENSITY * AREA * Math.pow(CHORD / 2, 3) * wMag;
  set(
    _tmp,
    (wb.x + alphaX * dt) / (1 + (kDamp * dt) / I_XX),
    (wb.y + alphaY * dt) / (1 + (kDamp * dt) / I_YY),
    (wb.z + alphaZ * dt) / (1 + (kDamp * dt) / I_ZZ),
  );
  rotByQuat(body.omega, body.quat, _tmp);

  // q̇ = ½ ω ⊗ q
  const q = body.quat, w = body.omega;
  const dx = 0.5 * (w.x * q.w + w.y * q.z - w.z * q.y);
  const dy = 0.5 * (w.y * q.w + w.z * q.x - w.x * q.z);
  const dz = 0.5 * (w.z * q.w + w.x * q.y - w.y * q.x);
  const dw = -0.5 * (w.x * q.x + w.y * q.y + w.z * q.z);
  q.x += dx * dt; q.y += dy * dt; q.z += dz * dt; q.w += dw * dt;
  const ql = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= ql; q.y /= ql; q.z /= ql; q.w /= ql;

  /* --- bending: torsional spring–damper on the hinge --- */
  const foldAcc =
    (hingeMoment - FOLD_STIFFNESS * body.fold - FOLD_DAMPING * body.foldVel) / I_HINGE;
  body.foldVel += foldAcc * dt;
  body.fold += body.foldVel * dt;
  if (body.fold > FOLD_LIMIT) { body.fold = FOLD_LIMIT; body.foldVel *= -0.25; }
  if (body.fold < -FOLD_LIMIT) { body.fold = -FOLD_LIMIT; body.foldVel *= -0.25; }

  return hingeMoment;
}

/* ------------------------- contact with the glass -------------------------
   The viewing plane is a real wall in the domain, not a scripted target.
   Whichever sheet the flow carries forward touches it, wherever it happens
   to arrive, and it stays only while the flow keeps pressing it there. */

// Chosen so μN/m sits just under g. Higher values let the draught pin the
// sheet in place instead of letting it slide down.
const GLASS_MU = 0.32;
const GLASS_STANDOFF = 0.003; // half the sheet thickness plus tolerance
const ALIGN_RATE = 16; // 1/s, how fast contact removes tilt error
// Fast, because the glass supports the sheet along its whole length: there
// is no net bending moment on a sheet lying flat on a rigid surface.
const FLATTEN_RATE = 130; // 1/s
const RELEASE_PUSH = -0.45; // flow reversal that lets go
const CONTACT_SPIN_DAMP = 14; // surface contact resists rotation

const _axis = v3();
const ZHAT = v3(0, 0, 1);

/**
 * Resolve contact with the glass at `glassZ`. Call after stepTicket, which
 * has already integrated gravity and the aerodynamic forces — this only adds
 * what the contact itself contributes.
 *
 * @returns {boolean} true while the sheet is against the glass
 */
export function applyGlass(body, glassZ, dt, sampleWind, t) {
  const contactZ = glassZ - GLASS_STANDOFF;
  if (!body.onGlass && body.pos.z < contactZ) return false;

  sampleWind(_wind, body.pos.x, body.pos.y, body.pos.z, t);
  const push = _wind.z - body.vel.z;

  // Flow no longer holds it there — let go and rejoin free flight
  if (body.onGlass && push < RELEASE_PUSH) {
    body.onGlass = false;
    body.vel.z = Math.min(body.vel.z, -0.02);
    return false;
  }

  body.onGlass = true;
  body.pos.z = contactZ;
  if (body.vel.z > 0) body.vel.z = 0; // paper does not bounce off glass

  // Normal load: dynamic pressure of the flow pinning it to the surface
  const N = Math.max(0, 0.5 * AIR_DENSITY * AREA * CD_BROAD * push * Math.abs(push));

  // Aligning couple — the pressure distribution over a sheet held against a
  // surface rotates its normal onto the surface normal. Critically damped,
  // and it settles onto whichever face is already closer so it never flips.
  // Resolved positionally rather than as a force. A rigid surface forbids the
  // sheet being tilted into it, and an added torque is overridden by the
  // aerodynamic torque stepTicket recomputes each substep.
  rotByQuat(_n, body.quat, ZHAT);
  const flip = _n.z >= 0 ? 1 : -1;
  set(_tmp, 0, 0, flip); // settle onto whichever face is already closer
  cross(_axis, _n, _tmp);
  const sA = len(_axis);
  const angle = Math.atan2(sA, _n.z * flip);
  if (sA > 1e-6 && angle > 1e-4) {
    normalize(_axis, _axis);
    const a = 1 - Math.exp(-ALIGN_RATE * dt); // fraction of error removed
    const half = (angle * a) / 2;
    const sh = Math.sin(half);
    const cx = _axis.x * sh, cy = _axis.y * sh, cz = _axis.z * sh, cw = Math.cos(half);
    const q = body.quat;
    const nx = cw * q.x + cx * q.w + cy * q.z - cz * q.y;
    const ny = cw * q.y - cx * q.z + cy * q.w + cz * q.x;
    const nz = cw * q.z + cx * q.y - cy * q.x + cz * q.w;
    const nw = cw * q.w - cx * q.x - cy * q.y - cz * q.z;
    const l = Math.hypot(nx, ny, nz, nw) || 1;
    q.x = nx / l; q.y = ny / l; q.z = nz / l; q.w = nw / l;
  }

  // Rubbing contact resists rotation, so it does not spin back off-plane
  const spinDamp = 1 / (1 + CONTACT_SPIN_DAMP * dt);
  body.omega.x *= spinDamp;
  body.omega.y *= spinDamp;
  body.omega.z *= spinDamp;

  // The surface presses the crease out — same positional treatment
  const fa = 1 - Math.exp(-FLATTEN_RATE * dt);
  body.fold += (0 - body.fold) * fa;
  body.foldVel *= 1 - fa;

  // Coulomb friction opposing the slide. Capped so it can decelerate the
  // sheet but never drive it backwards within a step.
  const vMag = Math.hypot(body.vel.x, body.vel.y);
  if (vMag > 1e-5) {
    const dv = Math.min(vMag, (GLASS_MU * N * dt) / MASS);
    body.vel.x -= (body.vel.x / vMag) * dv;
    body.vel.y -= (body.vel.y / vMag) * dv;
  }
  return true;
}

/**
 * Periodic box. With `glassZ` given, +Z is a wall rather than a wrap: a sheet
 * that slides off the bottom re-enters at the top, set back into the volume
 * so it does not immediately re-adhere.
 */
export function wrap(body, bounds, glassZ = null) {
  const { pos } = body;
  if (pos.x > bounds.x) pos.x = -bounds.x;
  else if (pos.x < -bounds.x) pos.x = bounds.x;

  if (pos.y > bounds.y) {
    pos.y = -bounds.y;
  } else if (pos.y < -bounds.y) {
    pos.y = bounds.y;
    if (glassZ !== null) {
      // last sliver has cleared the frame — send it back into the depth
      body.onGlass = false;
      pos.z = -bounds.z * (0.35 + Math.random() * 0.65);
      body.vel.z = 0;
    }
  }

  if (glassZ === null) {
    if (pos.z > bounds.z) pos.z = -bounds.z;
    else if (pos.z < -bounds.z) pos.z = bounds.z;
  } else if (pos.z < -bounds.z) {
    pos.z = -bounds.z;
    body.vel.z = Math.abs(body.vel.z) * 0.3;
  }
}

export const FIXED_DT = 1 / 240;
export const MAX_SUBSTEPS = 8;

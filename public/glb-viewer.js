/* MOONKATTY AI STUDIO — minimal local GLB viewer (WebGL1, no dependencies, no CDN; strict CSP friendly).
   Supports: binary glTF 2.0, meshes with POSITION/NORMAL (+indices), node hierarchy (TRS/matrix),
   material pbrMetallicRoughness.baseColorFactor. Orbit with mouse drag / touch, zoom with wheel. */
(function () {
  'use strict';
  const M = { // column-major 4x4
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; },
    trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) { const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
      return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1]; },
    persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2); return [t / a, 0, 0, 0, 0, t, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0]; },
    look(e, c, u) { const sub = (a, b) => a.map((v, i) => v - b[i]), nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const z = nrm(sub(e, c)), x = nrm(cr(u, z)), y = cr(z, x); return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]; }
  };
  function parseGLB(buf) {
    const dv = new DataView(buf); if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
    let off = 12, json = null, bin = null;
    while (off < buf.byteLength) { const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true); const chunk = buf.slice(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk)); else if (type === 0x004e4942) bin = chunk; off += 8 + len; }
    if (!json || !bin) throw new Error('GLB without JSON/BIN');
    const acc = i => { const a = json.accessors[i], bv = json.bufferViews[a.bufferView], n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
      const T = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[a.componentType]; const o = (bv.byteOffset || 0) + (a.byteOffset || 0);
      if (bv.byteStride && bv.byteStride !== n * T.BYTES_PER_ELEMENT) { const out = new T(a.count * n), src = new DataView(bin); for (let i2 = 0; i2 < a.count; i2++) for (let k = 0; k < n; k++) out[i2 * n + k] = src.getFloat32(o + i2 * bv.byteStride + k * 4, true); return out; }
      return new T(bin.slice(o, o + a.count * n * T.BYTES_PER_ELEMENT)); };
    const prims = []; const scene = json.scenes[json.scene || 0];
    const walk = (ni, parent) => { const n = json.nodes[ni]; const m = M.mul(parent, n.matrix || M.trs(n.translation, n.rotation, n.scale));
      if (n.mesh != null) for (const p of json.meshes[n.mesh].primitives) { if (p.attributes.POSITION == null) continue; const mat = p.material != null ? json.materials[p.material] : null;
        prims.push({ pos: acc(p.attributes.POSITION), nor: p.attributes.NORMAL != null ? acc(p.attributes.NORMAL) : null, idx: p.indices != null ? acc(p.indices) : null, color: mat?.pbrMetallicRoughness?.baseColorFactor || [0.8, 0.8, 0.8, 1], m }); }
      for (const c of n.children || []) walk(c, m); };
    for (const r of scene.nodes) walk(r, M.id()); return prims;
  }
  const VS = 'attribute vec3 p;attribute vec3 n;uniform mat4 mv,pr,nm;varying vec3 vn;varying vec3 vp;void main(){vec4 w=mv*vec4(p,1.0);vp=w.xyz;vn=(nm*vec4(n,0.0)).xyz;gl_Position=pr*w;}';
  const FS = 'precision mediump float;uniform vec4 c;varying vec3 vn;varying vec3 vp;void main(){vec3 N=normalize(vn);vec3 L=normalize(vec3(0.4,0.8,0.6));float d=max(dot(N,L),0.0);float r=pow(max(dot(reflect(-L,N),normalize(-vp)),0.0),24.0)*0.25;gl_FragColor=vec4(c.rgb*(0.28+0.8*d)+r,c.a);}';
  async function mount(canvas, url) {
    const gl = canvas.getContext('webgl', { antialias: true }); if (!gl) throw new Error('WebGL недоступен');
    const r = await fetch(url, { credentials: 'same-origin' }); if (!r.ok) throw new Error('HTTP ' + r.status); const prims = parseGLB(await r.arrayBuffer());
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pg); gl.useProgram(pg);
    const ext = gl.getExtension('OES_element_index_uint'); const bb = [];
    const items = prims.map(p => { const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; bb.push([lo, hi]); for (let i = 0; i < p.pos.length; i += 3) { const v = [0, 1, 2].map(k => p.m[k] * p.pos[i] + p.m[4 + k] * p.pos[i + 1] + p.m[8 + k] * p.pos[i + 2] + p.m[12 + k]); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } }
      const mk = (d, t = gl.ARRAY_BUFFER) => { const b = gl.createBuffer(); gl.bindBuffer(t, b); gl.bufferData(t, d, gl.STATIC_DRAW); return b; };
      let idx = p.idx; if (idx instanceof Uint32Array && !ext) idx = new Uint16Array(idx);
      return { pb: mk(p.pos), nb: p.nor ? mk(p.nor) : null, ib: idx ? mk(idx, gl.ELEMENT_ARRAY_BUFFER) : null, n: idx ? idx.length : p.pos.length / 3, it: idx instanceof Uint32Array ? gl.UNSIGNED_INT : idx instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT, color: p.color, m: p.m }; });
    // fit camera to the subject: ignore flat primitives (floor/backdrop planes) when anything else exists
    const flat = ([l, h]) => Math.min(...h.map((v, i) => v - l[i])) < 1e-3 * Math.max(...h.map((v, i) => v - l[i]));
    const use = bb.some(b => !flat(b)) ? bb.filter(b => !flat(b)) : bb; const lo = [0, 1, 2].map(k => Math.min(...use.map(b => b[0][k]))), hi = [0, 1, 2].map(k => Math.max(...use.map(b => b[1][k])));
    const ctr = lo.map((v, i) => (v + hi[i]) / 2), rad = Math.max(...hi.map((v, i) => v - lo[i])) || 1;
    let yaw = 0.6, pitch = 0.25, dist = rad * 1.6, drag = null;
    const L = { p: gl.getAttribLocation(pg, 'p'), n: gl.getAttribLocation(pg, 'n'), mv: gl.getUniformLocation(pg, 'mv'), pr: gl.getUniformLocation(pg, 'pr'), nm: gl.getUniformLocation(pg, 'nm'), c: gl.getUniformLocation(pg, 'c') };
    function draw() {
      const w = canvas.clientWidth || 400, h = canvas.clientHeight || 300; if (canvas.width !== w * devicePixelRatio) { canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio; }
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0.06, 0.06, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
      const eye = [ctr[0] + dist * Math.cos(pitch) * Math.sin(yaw), ctr[1] + dist * Math.sin(pitch), ctr[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
      const view = M.look(eye, ctr, [0, 1, 0]); gl.uniformMatrix4fv(L.pr, false, M.persp(0.8, w / h, rad / 100, rad * 20));
      for (const it of items) { const mv = M.mul(view, it.m); gl.uniformMatrix4fv(L.mv, false, mv); gl.uniformMatrix4fv(L.nm, false, mv); gl.uniform4fv(L.c, it.color);
        gl.bindBuffer(gl.ARRAY_BUFFER, it.pb); gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, 0, 0);
        if (it.nb) { gl.bindBuffer(gl.ARRAY_BUFFER, it.nb); gl.enableVertexAttribArray(L.n); gl.vertexAttribPointer(L.n, 3, gl.FLOAT, false, 0, 0); } else { gl.disableVertexAttribArray(L.n); gl.vertexAttrib3f(L.n, 0, 1, 0); }
        if (it.ib) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.ib); gl.drawElements(gl.TRIANGLES, it.n, it.it, 0); } else gl.drawArrays(gl.TRIANGLES, 0, it.n); }
    }
    const pt = e => e.touches ? e.touches[0] : e;
    canvas.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => { if (!drag) return; yaw -= (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.01)); drag = [e.clientX, e.clientY]; draw(); });
    canvas.addEventListener('pointerup', () => drag = null); canvas.addEventListener('wheel', e => { e.preventDefault(); dist = Math.max(rad * 0.3, Math.min(rad * 10, dist * (e.deltaY > 0 ? 1.1 : 0.9))); draw(); }, { passive: false });
    void pt; draw(); return { meshes: items.length, draw };
  }
  window.MKGlbViewer = { mount, parseGLB };
})();

/* ============================================================
   SANY FORGE · 三维设备模型查看器 (model3d.js)
   依赖：vendor/three.min.js (r147, UMD 全局 THREE)
   用途：为「工位产品 → 设备三维详情页」提供
        可旋转 / 缩放 / 带影棚光照与金属反射的精细设备模型，
        以及故障节点剖面染色、拆解视图、部件标注热点等交互。
   说明：模型全部由几何体程序化构建，离线可用、无外部资源。
   对外接口（window.Forge3D）：
     register(key, fn)   注册一个模型构建函数（返回 {root, hots, anim}）
     mount(host, key)    在容器内挂载查看器（同时只存在一个实例）
     unmount()           销毁当前查看器并释放 GPU 资源
     kit                 建模工具箱（材质库 MAT + 几何辅助函数）
   ============================================================ */
(function () {
  'use strict';

  var T = window.THREE;
  var API = {
    models: {},
    kit: null,
    supported: function () {
      return !!T;
    }
  };
  window.Forge3D = API;

  if (!T) {
    API.register = function () {};
    API.mount = function () {
      return null;
    };
    API.unmount = function () {};
    return;
  }

  /* ---------------- 材质库 ---------------- */
  function std(o) {
    return new T.MeshStandardMaterial(o);
  }
  var MAT = {
    yellow: std({ color: 0xf2a516, metalness: 0.52, roughness: 0.34, envMapIntensity: 1.15 }),
    yellowDeep: std({ color: 0xcf8a06, metalness: 0.5, roughness: 0.42, envMapIntensity: 1.0 }),
    red: std({ color: 0xd5232c, metalness: 0.5, roughness: 0.38, envMapIntensity: 1.15 }),
    redDeep: std({ color: 0x9c161d, metalness: 0.46, roughness: 0.48 }),
    steel: std({ color: 0xb5bac0, metalness: 0.92, roughness: 0.32, envMapIntensity: 1.2 }),
    steelDark: std({ color: 0x767d85, metalness: 0.9, roughness: 0.4, envMapIntensity: 1.1 }),
    graphite: std({ color: 0x2b3037, metalness: 0.62, roughness: 0.52 }),
    dark: std({ color: 0x1a1d21, metalness: 0.55, roughness: 0.5 }),
    rubber: std({ color: 0x191c1f, metalness: 0.04, roughness: 0.95 }),
    alu: std({ color: 0xd4d9de, metalness: 0.86, roughness: 0.26, envMapIntensity: 1.25 }),
    aluDark: std({ color: 0x9ba3ab, metalness: 0.85, roughness: 0.34 }),
    white: std({ color: 0xeef1f4, metalness: 0.16, roughness: 0.44 }),
    offWhite: std({ color: 0xdcdfe3, metalness: 0.2, roughness: 0.5 }),
    chrome: std({ color: 0xeaedf1, metalness: 1, roughness: 0.09, envMapIntensity: 1.5 }),
    copper: std({ color: 0xb87333, metalness: 0.95, roughness: 0.28 }),
    brass: std({ color: 0xc9a227, metalness: 0.9, roughness: 0.3 }),
    cell: std({ color: 0x152035, metalness: 0.4, roughness: 0.28, envMapIntensity: 1.3 }),
    ledWhite: std({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 1.3, roughness: 0.4 }),
    ledRed: std({ color: 0xff5a5a, emissive: 0xff2020, emissiveIntensity: 1.5, roughness: 0.4 }),
    ledAmber: std({ color: 0xffc14d, emissive: 0xff9d00, emissiveIntensity: 1.4, roughness: 0.4 }),
    ledBlue: std({ color: 0x5ec8ff, emissive: 0x1f7dff, emissiveIntensity: 1.3, roughness: 0.4 }),
    ledGreen: std({ color: 0x8cf0b0, emissive: 0x14c45e, emissiveIntensity: 1.2, roughness: 0.4 }),
    screen: std({ color: 0x0d2a3a, emissive: 0x1b6f9c, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.3 }),
    weldGlow: std({ color: 0xffffff, emissive: 0xa9e8ff, emissiveIntensity: 2.4, roughness: 0.3 }),
    glass: new T.MeshPhysicalMaterial({
      color: 0xb9dcee,
      metalness: 0.0,
      roughness: 0.05,
      transparent: true,
      opacity: 0.32,
      envMapIntensity: 2.0,
      side: T.DoubleSide,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.04
    }),
    glassDark: new T.MeshPhysicalMaterial({
      color: 0x6b8794,
      metalness: 0.1,
      roughness: 0.08,
      transparent: true,
      opacity: 0.45,
      envMapIntensity: 1.8,
      side: T.DoubleSide,
      depthWrite: false
    })
  };

  /* ---------------- 几何工具 ---------------- */
  function add(parent, mesh, x, y, z) {
    if (x !== undefined) mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function box(w, h, d, m, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.BoxGeometry(w, h, d), m), x, y, z);
  }

  /** 圆角盒：外扩 bevel，工业件倒角质感 */
  function rbox(w, h, d, r, m, bx, by, bz) {
    r = Math.min(r, Math.min(w, h) / 2 - 1e-3);
    var s = new T.Shape();
    var hw = w / 2,
      hh = h / 2;
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh);
    s.quadraticCurveTo(hw, -hh, hw, -hh + r);
    s.lineTo(hw, hh - r);
    s.quadraticCurveTo(hw, hh, hw - r, hh);
    s.lineTo(-hw + r, hh);
    s.quadraticCurveTo(-hw, hh, -hw, hh - r);
    s.lineTo(-hw, -hh + r);
    s.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    var b = Math.min(0.012, d * 0.06);
    var g = new T.ExtrudeGeometry(s, {
      depth: Math.max(d - b * 2, 0.001),
      bevelEnabled: true,
      bevelSize: b,
      bevelThickness: b,
      bevelSegments: 2,
      curveSegments: 4,
      steps: 1
    });
    g.translate(0, 0, -Math.max(d - b * 2, 0.001) / 2);
    var mesh = new T.Mesh(g, m);
    return add(new T.Group(), mesh, bx, by, bz);
  }

  function cyl(rt, rb, h, m, seg, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 28), m), x, y, z);
  }
  function tube(rOuter, rInner, h, m, seg, x, y, z) {
    var g = new T.CylinderGeometry(rOuter, rOuter, h, seg || 24, 1, true);
    var mesh = new T.Mesh(g, m);
    if (rInner) {
      /* 壁厚感用双层，简化处理 */
    }
    return add(new T.Group(), mesh, x, y, z);
  }
  function cone(r, h, m, seg, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.ConeGeometry(r, h, seg || 24), m), x, y, z);
  }
  function torus(r, tr, m, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.TorusGeometry(r, tr, 12, 40), m), x, y, z);
  }
  function sphere(r, m, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.SphereGeometry(r, 28, 20), m), x, y, z);
  }
  function plane(w, h, m, x, y, z) {
    return add(new T.Group(), new T.Mesh(new T.PlaneGeometry(w, h), m), x, y, z);
  }

  /** 沿曲线生成软管（parent 优先） */
  function hose(parent, points, r, m, seg) {
    var curve = new T.CatmullRomCurve3(
      points.map(function (p) {
        return new T.Vector3(p[0], p[1], p[2]);
      })
    );
    return add(parent, new T.Mesh(new T.TubeGeometry(curve, seg || 40, r, 8, false), m));
  }

  /** 文字贴花（三一标识 / 型号） */
  function decal(text, w, h, o) {
    o = o || {};
    var c = document.createElement('canvas');
    c.width = 512;
    c.height = Math.max(64, Math.round((512 * h) / w));
    var g = c.getContext('2d');
    if (o.bg) {
      g.fillStyle = o.bg;
      g.fillRect(0, 0, c.width, c.height);
    }
    g.fillStyle = o.color || '#d5232c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var fam = o.font || 'Arial Black, Arial, sans-serif';
    var size = Math.round(c.height * (o.scale || 0.62));
    g.font = (o.italic ? 'italic ' : '') + 'bold ' + size + 'px ' + fam;
    if (o.spacing) {
      try {
        g.letterSpacing = o.spacing;
      } catch (e) {}
    }
    g.fillText(text, c.width / 2, c.height * 0.52);
    var tex = new T.CanvasTexture(c);
    tex.anisotropy = 4;
    tex.encoding = T.sRGBEncoding;
    var m = new T.MeshStandardMaterial({
      map: tex,
      transparent: !o.bg,
      roughness: 0.42,
      metalness: o.metal || 0.05,
      side: T.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3
    });
    var mesh = new T.Mesh(new T.PlaneGeometry(w, h), m);
    mesh.userData.tex = tex;
    return mesh;
  }

  /** 螺栓阵列 */
  function bolts(parent, n, r, y, m, fn) {
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      fn(i, Math.cos(a) * r, y, Math.sin(a) * r, a);
    }
    return parent;
  }

  var K = {
    T: T,
    MAT: MAT,
    add: add,
    box: box,
    rbox: rbox,
    cyl: cyl,
    tube: tube,
    cone: cone,
    torus: torus,
    sphere: sphere,
    plane: plane,
    hose: hose,
    decal: decal,
    bolts: bolts,
    group: function () {
      return new T.Group();
    }
  };
  API.kit = K;

  /* ---------------- 影棚环境贴图（程序化，无外部 HDR） ---------------- */
  var envCache = {};
  function envTexture(renderer, dark) {
    var key = dark ? 'd' : 'l';
    if (envCache[key]) return envCache[key];
    var sc = new T.Scene();
    sc.background = new T.Color(dark ? 0x1d2226 : 0x9fa8b1);
    var room = new T.Mesh(
      new T.BoxGeometry(24, 16, 24),
      new T.MeshStandardMaterial({ color: dark ? 0x2c3238 : 0x8e979f, side: T.BackSide, roughness: 1, metalness: 0 })
    );
    sc.add(room);
    function panel(w, h, color, intensity, x, y, z, rx, ry) {
      var m = new T.MeshBasicMaterial({ color: new T.Color(color).multiplyScalar(intensity) });
      var p = new T.Mesh(new T.PlaneGeometry(w, h), m);
      p.position.set(x, y, z);
      if (rx) p.rotation.x = rx;
      if (ry) p.rotation.y = ry;
      sc.add(p);
    }
    panel(12, 6, 0xffffff, 2.9, 0, 7.4, 0, Math.PI / 2, 0); // 顶部主光
    panel(9, 7, 0xffffff, 1.5, -8.2, 2.5, 5.0, 0, Math.PI / 2.3); // 左前柔光
    panel(8, 6, 0xdfe9ff, 1.0, 8.0, 1.5, -3.5, 0, -Math.PI / 2.4); // 右后冷光
    panel(7, 4, 0xfff3e0, 0.7, 4.0, 0.4, 8.2, 0, Math.PI); // 地面反光
    var pmrem = new T.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    var tex = pmrem.fromScene(sc, 0.035).texture;
    pmrem.dispose();
    room.geometry.dispose();
    room.material.dispose();
    envCache[key] = tex;
    return tex;
  }

  /* ---------------- 自研轨道控制 ----------------
     球坐标系 (theta 方位角 / phi 极角 / dist 距离) + target 视点；
     want* 系列是「目标值」，每帧按指数平滑逼近，形成阻尼手感；
     交互：左键旋转 / 右键或 Shift 平移 / 滚轮缩放 / 双指捏合，
     空闲 2.2s 后自动旋转。不引 OrbitControls 是为了零外部依赖。 */
  function Orbit(cam, dom) {
    var self = this;
    this.cam = cam;
    this.dom = dom;
    this.target = new T.Vector3(0, 0, 0);
    this.minDist = 1.0;
    this.maxDist = 60;
    this.theta = 0.85;
    this.phi = 1.15;
    this.minPhi = 0.08;
    this.maxPhi = Math.PI / 2 - 0.015;
    this.dist = 8;
    this.wantDist = 8;
    this.wantTheta = 0.85;
    this.wantPhi = 1.15;
    this.wantTarget = new T.Vector3();
    this.autoRotate = true;
    this.autoSpeed = 0.16;
    this.idle = 99;
    this.enabled = true;
    this._drag = null;
    this._px = 0;
    this._py = 0;
    this._pointers = {};

    function onDown(e) {
      dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
      self._pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(self._pointers).length === 1) {
        self._drag = e.button === 2 || e.shiftKey ? 'pan' : 'rot';
        self._px = e.clientX;
        self._py = e.clientY;
      }
      self.idle = 0;
      dom.classList.add('is-grabbing');
    }
    function onMove(e) {
      if (!self._pointers[e.pointerId]) return;
      var keys = Object.keys(self._pointers);
      var prev = self._pointers[e.pointerId];
      var dx = e.clientX - prev.x,
        dy = e.clientY - prev.y;
      prev.x = e.clientX;
      prev.y = e.clientY;
      self.idle = 0;
      if (keys.length >= 2) {
        // 双指：缩放 + 平移
        var a = self._pointers[keys[0]],
          b = self._pointers[keys[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (self._pinch) self.wantDist = clamp(self.wantDist * (self._pinch / d), self.minDist, self.maxDist);
        self._pinch = d;
        self.panBy(dx * 0.5, dy * 0.5);
        return;
      }
      if (self._drag === 'pan') self.panBy(dx, dy);
      else if (self._drag === 'rot') {
        self.wantTheta -= dx * 0.0062;
        self.wantPhi = clamp(self.wantPhi - dy * 0.0058, self.minPhi, self.maxPhi);
      }
    }
    function onUp(e) {
      delete self._pointers[e.pointerId];
      if (Object.keys(self._pointers).length === 0) {
        self._drag = null;
        self._pinch = 0;
      }
      if (Object.keys(self._pointers).length < 2) self._pinch = 0;
      dom.classList.remove('is-grabbing');
    }
    function onWheel(e) {
      e.preventDefault();
      self.idle = 0;
      var k = Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
      self.wantDist = clamp(self.wantDist * k, self.minDist, self.maxDist);
    }
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointercancel', onUp);
    dom.addEventListener('pointerleave', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    this.dispose = function () {
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointercancel', onUp);
      dom.removeEventListener('pointerleave', onUp);
      dom.removeEventListener('wheel', onWheel);
    };
  }
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }

  Orbit.prototype.panBy = function (dx, dy) {
    var r = new T.Vector3(),
      u = new T.Vector3();
    this.cam.matrixWorld.extractBasis(r, u, new T.Vector3());
    var s = this.wantDist * 0.0016;
    this.wantTarget.addScaledVector(r, -dx * s).addScaledVector(u, dy * s);
  };
  Orbit.prototype.frame = function (radius, center) {
    this.target.copy(center);
    this.wantTarget.copy(center);
    var fov = (this.cam.fov * Math.PI) / 180;
    var d = (radius / Math.sin(fov / 2)) * 1.18;
    this.dist = this.wantDist = clamp(d, this.minDist, this.maxDist);
    this.minDist = radius * 0.85;
    this.maxDist = radius * 14;
  };
  Orbit.prototype.update = function (dt, animate) {
    if (animate) this.idle += dt;
    if (this.autoRotate && this.idle > 2.2) this.wantTheta += this.autoSpeed * dt;
    var k = 1 - Math.pow(0.0016, dt);
    this.theta += (this.wantTheta - this.theta) * k;
    this.phi += (this.wantPhi - this.phi) * k;
    this.dist += (this.wantDist - this.dist) * k;
    this.target.lerp(this.wantTarget, k);
    var sp = new T.Spherical(this.dist, clamp(this.phi, this.minPhi, this.maxPhi), this.theta);
    this.cam.position.setFromSpherical(sp).add(this.target);
    this.cam.lookAt(this.target);
  };

  /* ---------------- 查看器 ---------------- */
  var current = null;

  function Viewer(host, key, opts) {
    opts = opts || {};
    var builder = API.models[key];
    if (!builder) {
      host.innerHTML = '<div class="m3d-fallback">暂无该设备的三维模型。</div>';
      return;
    }
    var dark = !!opts.dark;
    var rect = host.getBoundingClientRect();
    var W = Math.max(320, Math.round(rect.width || 640));
    var H = Math.max(260, Math.round(rect.height || 420));

    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = 'm3d-canvas';
    host.appendChild(renderer.domElement);

    var scene = new T.Scene();
    scene.environment = envTexture(renderer, dark);

    var camera = new T.PerspectiveCamera(34, W / H, 0.02, 300);
    var orbit = new Orbit(camera, renderer.domElement);

    // 光照
    var hemi = new T.HemisphereLight(dark ? 0x9fb4c8 : 0xffffff, dark ? 0x2a2f34 : 0xb9c0c6, dark ? 0.45 : 0.62);
    scene.add(hemi);
    var key1 = new T.DirectionalLight(0xffffff, dark ? 1.5 : 2.05);
    key1.position.set(6.5, 10, 6);
    key1.castShadow = true;
    key1.shadow.mapSize.set(2048, 2048);
    key1.shadow.radius = 3;
    key1.shadow.bias = -0.0007;
    key1.shadow.normalBias = 0.02;
    var sc = key1.shadow.camera;
    sc.near = 0.5;
    sc.far = 46;
    sc.left = -11;
    sc.right = 11;
    sc.top = 11;
    sc.bottom = -11;
    scene.add(key1);
    scene.add(key1.target);
    var key2 = new T.DirectionalLight(dark ? 0x7fa6d8 : 0xdfe9ff, dark ? 0.55 : 0.62);
    key2.position.set(-8, 5.5, -7);
    scene.add(key2);
    var rim = new T.DirectionalLight(0xffe6bf, dark ? 0.5 : 0.42);
    rim.position.set(1.5, 2.4, -9.5);
    scene.add(rim);

    // 地面（径向渐隐圆盘 + 细网格）
    var gc = document.createElement('canvas');
    gc.width = gc.height = 256;
    var gg = gc.getContext('2d');
    var grd = gg.createRadialGradient(128, 128, 6, 128, 128, 126);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.82, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    gg.fillStyle = grd;
    gg.fillRect(0, 0, 256, 256);
    var gtex = new T.CanvasTexture(gc);
    var ground = new T.Mesh(
      new T.CircleGeometry(1, 64),
      new T.MeshStandardMaterial({
        color: dark ? 0x3a4147 : 0xdfe4e8,
        map: gtex,
        transparent: true,
        roughness: 0.94,
        metalness: 0.04
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    var grid = new T.GridHelper(1, 40, dark ? 0x515c66 : 0xc3cbd2, dark ? 0x424c55 : 0xd2d9df);
    grid.material.transparent = true;
    grid.material.opacity = dark ? 0.34 : 0.5;
    grid.position.y = 0.002;
    scene.add(grid);

    // 模型
    var built = builder(K) || {};
    var root = built.root || new T.Group();
    scene.add(root);

    // 自适应：把模型落到地面、按最大尺寸定标
    var bbox = new T.Box3().setFromObject(root);
    var size = new T.Vector3();
    bbox.getSize(size);
    var center = new T.Vector3();
    bbox.getCenter(center);
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var TARGET = 5.2;
    var scale = TARGET / maxDim;
    root.scale.setScalar(scale);
    root.position.set(-center.x * scale, -bbox.min.y * scale, -center.z * scale);

    var bbox2 = new T.Box3().setFromObject(root);
    var s2 = new T.Vector3();
    bbox2.getSize(s2);
    var c2 = new T.Vector3();
    bbox2.getCenter(c2);

    /** 按包围盒与视场角精确取景：竖高、横宽两个约束取大者 */
    function fitDistance() {
      var tanY = Math.tan((camera.fov * Math.PI) / 360);
      var tanX = tanY * (camera.aspect || W / H);
      var dV = s2.y / 2 / tanY;
      var dW = Math.hypot(s2.x, s2.z) / 2 / tanX;
      return Math.max(dV, dW) * 1.14;
    }
    var fitD = fitDistance();
    orbit.minDist = fitD * 0.24;
    orbit.maxDist = fitD * 6.5;
    /* 初始距离在「刚好装满」基础上再远一档（≈滚轮向下一格 ×1.2），
       保证进入页面时整机（含大臂/桅杆外沿）完整落在画面内 */
    orbit.dist = orbit.wantDist = fitD * 1.2;
    orbit.target.set(c2.x, c2.y, c2.z);
    orbit.wantTarget.set(c2.x, c2.y, c2.z);
    orbit.theta = orbit.wantTheta = 0.72;
    orbit.phi = orbit.wantPhi = 1.16;

    ground.scale.setScalar(Math.max(s2.x, s2.z) * 1.85 + 1.2);
    grid.scale.setScalar(Math.max(s2.x, s2.z) * 3.6 + 2.4);

    // 标注热点
    var hots = (built.hots || []).slice();
    var hotLayer = document.createElement('div');
    hotLayer.className = 'm3d-hots';
    host.appendChild(hotLayer);
    var hotNodes = hots.map(function (h) {
      var el = document.createElement('button');
      el.className = 'm3d-hot';
      el.type = 'button';
      el.innerHTML = '<i></i><span><b>' + h.t + '</b>' + (h.s ? '<em>' + h.s + '</em>' : '') + '</span>';
      el.addEventListener('click', function () {
        API.focusHot && API.focusHot(h);
      });
      hotLayer.appendChild(el);
      return el;
    });

    /* ---------------- 故障节点染色 / 拆解视图 ----------------
       （剖面深度裁剪功能已按需求下线，故障节点仅保留部件染色与未装载隐藏） */
    var faultOn = false;
    var exploding = false,
      explodeK = 0.62,
      explodeSavedDist = 0,
      explodeSavedAnim = null;
    var _cA = new T.Color(),
      _cB = new T.Color();

    /** 损坏程度 → 颜色：0 正常绿 | 0~1 黄→暗红 | ≥1 彻底损坏黑 | <0 未装载黑 */
    function lvColor(lv) {
      if (lv < 0) return _cA.setHex(0x17191d);
      if (lv <= 0) return _cA.setHex(0x27a35c);
      if (lv >= 1) return _cA.setHex(0x101215);
      return _cA.setHex(0xf0c419).lerp(_cB.setHex(0x6e120c), Math.min(lv, 1));
    }
    function lvLabel(lv) {
      if (lv < 0) return '未装载';
      if (lv <= 0) return '正常';
      if (lv < 0.35) return '轻度';
      if (lv < 0.7) return '中度';
      if (lv < 1) return '严重';
      return '彻底损坏';
    }
    /** o 可为单个 Object3D 或数组 */
    function eachO(o, fn) {
      if (!o) return;
      if (o.isObject3D) o.traverse(fn);
      else for (var i = 0; i < o.length; i++) o[i].traverse(fn);
    }
    function countO(o) {
      var n = 0;
      eachO(o, function (x) {
        if (x.isMesh) n++;
      });
      return n;
    }
    function paintO(o, color) {
      eachO(o, function (x) {
        if (x.isMesh && x.userData._omat) {
          x.material.color.copy(color);
          x.material.emissive.copy(color).multiplyScalar(0.22);
        }
      });
    }
    function restoreFault() {
      root.traverse(function (o) {
        if (o.isMesh && o.userData._omat) {
          if (o.material.dispose) o.material.dispose();
          o.material = o.userData._omat;
          delete o.userData._omat;
        }
        if (o.userData._ovis !== undefined) {
          o.visible = o.userData._ovis;
          delete o.userData._ovis;
        }
      });
      hotNodes.forEach(function (n) {
        n.classList.remove('is-fault', 'is-bad');
        var dot = n.querySelector('i');
        if (dot) {
          dot.style.background = '';
          dot.style.boxShadow = '';
        }
      });
    }
    /** faults: { 节点名: {level, note} }，level 0~1（<0 未装载，≥1 报废） */
    function applyFaults(faults) {
      restoreFault();
      // 1) 全模型材质克隆（故障染色不污染共享材质库 MAT）
      root.traverse(function (o) {
        if (o.isMesh) {
          o.userData._omat = o.material;
          o.material = o.material.clone();
        }
      });
      var entries = hots.map(function (h, i) {
        var f = faults ? faults[h.t] : null;
        return { h: h, i: i, lv: f && f.level !== undefined ? f.level : 0, f: f || null };
      });
      // 2) 有部件引用的节点默认染绿（正常）
      entries.forEach(function (e) {
        if (e.h.o) paintO(e.h.o, lvColor(0));
      });
      // 3) 损坏件按子树从大到小覆盖，最具体的子树最后画（子级故障不被父级绿色吞掉）
      entries
        .filter(function (e) {
          return e.lv > 0;
        })
        .sort(function (a, b) {
          return countO(b.h.o) - countO(a.h.o);
        })
        .forEach(function (e) {
          paintO(e.h.o, lvColor(e.lv));
        });
      // 4) 未装载：整个部件隐藏
      entries.forEach(function (e) {
        if (e.lv < 0 && e.h.o)
          eachO(e.h.o, function (x) {
            if (x.userData._ovis === undefined) x.userData._ovis = x.visible;
            x.visible = false;
          });
      });
      // 5) 热点标记点按状态着色
      entries.forEach(function (e) {
        var n = hotNodes[e.i],
          dot = n && n.querySelector('i');
        if (!dot) return;
        var hex = '#' + lvColor(e.lv).getHexString();
        dot.style.background = hex;
        dot.style.boxShadow = '0 0 0 3px ' + hex + '55';
        n.classList.toggle('is-fault', e.lv > 0);
        n.classList.toggle('is-bad', e.lv >= 1 || e.lv < 0);
      });
    }

    var raf = 0,
      last = performance.now(),
      elapsed = 0;
    var animate = opts.animate !== false;
    var tmp = new T.Vector3();

    function tick(now) {
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      elapsed += dt;
      if (animate && built.anim) built.anim(elapsed);
      orbit.update(dt, animate);
      renderer.render(scene, camera);
      // 热点投影
      if (!host.classList.contains('hots-off')) {
        var W2 = host.clientWidth,
          H2 = host.clientHeight;
        for (var i = 0; i < hots.length; i++) {
          tmp.set(hots[i].p[0], hots[i].p[1], hots[i].p[2]).multiplyScalar(scale);
          tmp.x += root.position.x;
          tmp.y += root.position.y;
          tmp.z += root.position.z;
          tmp.project(camera);
          var x = (tmp.x * 0.5 + 0.5) * W2,
            y = (-tmp.y * 0.5 + 0.5) * H2;
          var vis = tmp.z < 1; /* tmp.z<1 表示在相机远近平面之间（可见） */
          var node = hotNodes[i];
          node.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
          node.style.opacity = vis ? '' : '0';
          node.style.pointerEvents = vis ? 'auto' : 'none';
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    var ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () {
        var w = Math.max(240, host.clientWidth),
          h = Math.max(200, host.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      });
      ro.observe(host);
    }

    this.setAnimate = function (v) {
      animate = v;
    };
    this.getAnimate = function () {
      return animate;
    };
    this.setAutoRotate = function (v) {
      orbit.autoRotate = v;
      if (v) orbit.idle = 99;
    };

    /** 故障节点模式：部件按损坏程度染色（剖切功能已下线） */
    this.setFaultMode = function (on, faults) {
      faultOn = !!on;
      if (faultOn) applyFaults(faults || {});
      else restoreFault();
    };
    /** 拆解视图：零件沿“模型中心 → 自身”方向分离，视角拉远，动作冻结 */
    this.setExplode = function (on) {
      if (!!on === exploding) return;
      exploding = !!on;
      if (exploding) {
        root.updateMatrixWorld(true);
        var cW = new T.Vector3(c2.x, c2.y, c2.z);
        var pq = new T.Quaternion(),
          wp = new T.Vector3(),
          dir = new T.Vector3();
        root.traverse(function (o) {
          if (!o.isMesh) return;
          o.userData._epos = o.position.clone();
          o.getWorldPosition(wp);
          dir.copy(wp).sub(cW);
          var d = dir.length();
          if (d < 1e-4) dir.set(0, 1, 0);
          else dir.normalize();
          o.parent.getWorldQuaternion(pq).invert();
          dir.applyQuaternion(pq);
          o.position.addScaledVector(dir, ((0.3 + d * 0.62) * explodeK) / scale);
        });
        /* 底部零件会向下散开 → 整体抬升避免沉入地面盘；地面盘半透明便于观察 */
        root.updateMatrixWorld(true);
        var eb = new T.Box3().setFromObject(root);
        var lift = Math.max(0, 0.08 - eb.min.y);
        root.userData._elift = lift;
        root.position.y += lift;
        orbit.wantTarget.y = c2.y + lift;
        orbit.target.y = c2.y + lift;
        ground.userData._eop = ground.material.opacity;
        ground.material.opacity = 0.42;
        explodeSavedDist = orbit.wantDist;
        orbit.wantDist = Math.min(orbit.maxDist, fitD * 1.66);
        orbit.idle = 0;
        if (explodeSavedAnim === null) {
          explodeSavedAnim = animate;
          animate = false;
        }
      } else {
        root.traverse(function (o) {
          if (o.isMesh && o.userData._epos) {
            o.position.copy(o.userData._epos);
            delete o.userData._epos;
          }
        });
        if (root.userData._elift) {
          root.position.y -= root.userData._elift;
          delete root.userData._elift;
          orbit.wantTarget.y = c2.y;
          orbit.target.y = c2.y;
        }
        if (ground.userData._eop !== undefined) {
          ground.material.opacity = ground.userData._eop;
          delete ground.userData._eop;
        }
        if (explodeSavedDist) {
          orbit.wantDist = explodeSavedDist;
          explodeSavedDist = 0;
        }
        if (explodeSavedAnim !== null) {
          animate = explodeSavedAnim;
          explodeSavedAnim = null;
        }
      }
    };
    /** 热点清单（供页面故障面板用） */
    this.hotInfo = function () {
      return hots.map(function (h) {
        return { t: h.t, s: h.s, linked: !!h.o };
      });
    };
    this.hotStatus = function (faults) {
      return hots.map(function (h) {
        var f = faults ? faults[h.t] : null;
        var lv = f && f.level !== undefined ? f.level : 0;
        return {
          t: h.t,
          lv: lv,
          label: lvLabel(lv),
          note: f ? f.note || '' : '',
          color: '#' + lvColor(lv).clone().getHexString()
        };
      });
    };
    this.exploded = function () {
      return exploding;
    };
    this.faultModeOn = function () {
      return faultOn;
    };

    this.reset = function () {
      orbit.wantTheta = 0.72;
      orbit.wantPhi = 1.16;
      orbit.wantTarget.set(c2.x, c2.y, c2.z);
      orbit.wantDist = fitD * 1.2; /* 与初始视角一致：拉远一档 */
      orbit.idle = 0;
    };
    this.dispose = function () {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      orbit.dispose();
      root.traverse(function (o) {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.map && o.material.map.isCanvasTexture) o.material.map.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      if (hotLayer.parentNode) hotLayer.parentNode.removeChild(hotLayer);
    };
  }

  API.register = function (key, fn) {
    API.models[key] = fn;
  };
  API.mount = function (host, key, opts) {
    if (!host) return null;
    API.unmount();
    try {
      current = new Viewer(host, key, opts);
    } catch (e) {
      host.innerHTML = '<div class="m3d-fallback">三维视图初始化失败：' + (e && e.message ? e.message : e) + '</div>';
      current = null;
    }
    return current;
  };
  API.unmount = function () {
    if (current && current.dispose) {
      try {
        current.dispose();
      } catch (e) {}
    }
    current = null;
  };
  API.current = function () {
    return current;
  };
})();

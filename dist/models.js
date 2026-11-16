/* ============================================================
   SANY FORGE · 设备三维模型（一）
   excavator  SY215C 中型挖掘机
   welder     「灵眸」免示教六轴焊接机器人
   hydraulics SY215C 液压系统核心部件
   —— 全部由几何体程序化构建，细节以真实产品结构为依据
   ============================================================ */
(function () {
  'use strict';
  var F = window.Forge3D;
  if (!F || !F.kit) return;
  var K = F.kit,
    T = K.T,
    MAT = K.MAT;
  var add = K.add,
    box = K.box,
    rbox = K.rbox,
    cyl = K.cyl,
    cone = K.cone,
    torus = K.torus,
    sphere = K.sphere,
    plane = K.plane,
    hose = K.hose,
    decal = K.decal;
  var PI = Math.PI,
    TAU = PI * 2,
    rad = function (d) {
      return (d * PI) / 180;
    };

  /* ---------------- 通用零件工具 ---------------- */
  function cylX(r, len, m, x, y, z, seg) {
    // 轴沿 X
    var g = cyl(r, r, len, m, seg || 26);
    g.rotation.z = PI / 2;
    g.position.set(x || 0, y || 0, z || 0);
    return g;
  }
  function cylZ(r, len, m, x, y, z, seg) {
    // 轴沿 Z
    var g = cyl(r, r, len, m, seg || 26);
    g.rotation.x = PI / 2;
    g.position.set(x || 0, y || 0, z || 0);
    return g;
  }
  /** 沿 a→b 的杆件（工业连杆/臂） */
  function limb(parent, a, b, w, h, m, radius) {
    var va = new T.Vector3(a[0], a[1], a[2]),
      vb = new T.Vector3(b[0], b[1], b[2]);
    var dir = vb.clone().sub(va),
      len = dir.length();
    var g = rbox(w, h, len, radius === undefined ? Math.min(w, h) * 0.24 : radius, m);
    g.position.copy(va).add(vb).multiplyScalar(0.5);
    g.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir.normalize());
    parent.add(g);
    return g;
  }
  /** 液压缸（含活塞杆，可动画） */
  function actuator(Lb, rB, rR, mB, mR) {
    var g = new T.Group();
    var body = cylZ(rB, Lb, mB || MAT.steelDark);
    body.position.z = Lb / 2;
    g.add(body);
    var cap = cylZ(rB * 1.08, Lb * 0.07, mB || MAT.steelDark);
    cap.position.z = Lb * 0.035;
    g.add(cap);
    var head = cylZ(rB * 0.92, Lb * 0.1, MAT.steel);
    head.position.z = Lb * 0.95;
    g.add(head);
    // 活塞杆组（推拉 = 改 rod.position.z）
    var rod = new T.Group();
    rod.position.z = Lb * 0.5;
    var bar = cylZ(rR, Lb * 0.94, mR || MAT.chrome);
    rod.add(bar);
    var eye = torus(rR * 1.7, rR * 0.5, mB || MAT.steel);
    eye.rotation.y = PI / 2;
    eye.position.z = Lb * 0.52;
    rod.add(eye);
    g.add(rod);
    g.userData = {
      rod: rod,
      base: Lb,
      push: function (k) {
        rod.position.z = Lb * 0.5 + k * Lb * 0.5;
      }
    };
    return g;
  }
  /** 铝型材（方管 + 四道中心凹槽） */
  function profile(len, size, axis, m) {
    var g = new T.Group();
    g.add(box(size, size, len, m || MAT.alu));
    var gl = len * 0.94,
      gw = size * 0.42,
      gt = size * 0.07;
    var ga = box(gt, gw, gl, MAT.aluDark);
    ga.position.set(size * 0.5, 0, 0);
    g.add(ga);
    var gb = box(gt, gw, gl, MAT.aluDark);
    gb.position.set(-size * 0.5, 0, 0);
    g.add(gb);
    var gc = box(gw, gt, gl, MAT.aluDark);
    gc.position.set(0, size * 0.5, 0);
    g.add(gc);
    var gd = box(gw, gt, gl, MAT.aluDark);
    gd.position.set(0, -size * 0.5, 0);
    g.add(gd);
    if (axis === 'x') g.rotation.y = PI / 2;
    if (axis === 'y') g.rotation.x = PI / 2;
    return g;
  }
  /** 履带环取样点：体育场形闭合路径 */
  function trackLoop(hl, r, n) {
    var per = 4 * hl + TAU * r,
      pts = [],
      i;
    for (i = 0; i < n; i++) {
      var s = (i / n) * per,
        z,
        y;
      if (s < 2 * hl) {
        z = -hl + s;
        y = r;
      } else if (s < 2 * hl + PI * r) {
        var a = (s - 2 * hl) / r;
        z = hl + r * Math.sin(a);
        y = r * Math.cos(a);
      } else if (s < 4 * hl + PI * r) {
        z = hl - (s - 2 * hl - PI * r);
        y = -r;
      } else {
        var a2 = (s - 4 * hl - PI * r) / r;
        z = -hl - r * Math.sin(a2);
        y = -r * Math.cos(a2);
      }
      pts.push([y, z]);
    }
    var out = [];
    for (i = 0; i < n; i++) {
      var p = pts[i],
        pv = pts[(i - 1 + n) % n],
        nx = pts[(i + 1) % n];
      var dy = nx[0] - pv[0],
        dz = nx[1] - pv[1];
      out.push({ y: p[0], z: p[1], ang: Math.atan2(-dy, dz) });
    }
    return out;
  }

  K.cylX = cylX;
  K.cylZ = cylZ;
  K.limb = limb;
  K.actuator = actuator;
  K.profile = profile;

  /* ============================================================
     一、SY215C 中型挖掘机
     尺寸依据公开资料：整机宽 2990mm、履带板 600mm、斗容 1.1m³
     ============================================================ */
  F.register('excavator', function () {
    var root = new T.Group();
    var hots = [];

    /* --- 行走底盘（左右履带） --- */
    var under = new T.Group();
    root.add(under);
    [-1, 1].forEach(function (side) {
      var cx = side * 1.195;
      var track = new T.Group();
      under.add(track);

      // 履带架
      var frame = rbox(0.5, 0.46, 3.0, 0.07, MAT.graphite);
      frame.position.set(cx, 0.5, 0);
      track.add(frame);
      // 履带板阵列
      var loop = trackLoop(1.55, 0.42, 20);
      loop.forEach(function (p) {
        var pad = rbox(0.62, 0.1, 0.235, 0.02, MAT.rubber);
        pad.position.set(cx, 0.46 + p.y, p.z);
        pad.rotation.x = p.ang;
        track.add(pad);
        // 履刺
        var gr = rbox(0.6, 0.05, 0.07, 0.012, MAT.dark);
        gr.position.set(cx, 0.46 + p.y * 1.14, p.z + Math.sin(p.ang + PI / 2) * 0.0);
        gr.position.y = 0.46 + (p.y > 0 ? p.y + 0.075 : p.y - 0.075);
        gr.rotation.x = p.ang;
        track.add(gr);
      });
      // 驱动轮 + 齿
      var sprocket = cylX(0.38, 0.3, MAT.steelDark, cx, 0.46, -1.55, 22);
      track.add(sprocket);
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * TAU;
        var tooth = box(0.3, 0.09, 0.09, MAT.steelDark);
        tooth.position.set(cx, 0.46 + Math.cos(a) * 0.4, -1.55 + Math.sin(a) * 0.4);
        tooth.rotation.x = -a;
        track.add(tooth);
      }
      // 导向轮
      track.add(cylX(0.34, 0.26, MAT.steelDark, cx, 0.46, 1.55, 22));
      // 支重轮
      [-1.15, -0.58, 0, 0.58, 1.15].forEach(function (z) {
        track.add(cylX(0.155, 0.34, MAT.steel, cx, 0.21, z, 16));
      });
      // 托带轮
      [-0.6, 0.6].forEach(function (z) {
        track.add(cylX(0.12, 0.3, MAT.steel, cx, 0.85, z, 14));
      });
      // 履带张紧弹簧
      var spring = cylZ(0.09, 0.5, MAT.steelDark, cx, 0.46, 1.15, 12);
      track.add(spring);
    });

    /* --- 上部回转平台 --- */
    var upper = new T.Group();
    root.add(upper);
    var ring = cyl(0.6, 0.6, 0.18, MAT.steelDark, 34);
    ring.position.set(0, 0.78, -0.05);
    upper.add(ring);
    var platform = rbox(2.46, 0.24, 2.72, 0.07, MAT.yellow);
    platform.position.set(0, 0.94, -0.18);
    upper.add(platform);
    // 平台边梁
    var rail = rbox(2.52, 0.09, 2.78, 0.03, MAT.yellowDeep);
    rail.position.set(0, 0.85, -0.18);
    upper.add(rail);

    // 配重
    var cw = rbox(2.4, 1.0, 0.74, 0.1, MAT.yellow);
    cw.position.set(0, 1.46, -1.5);
    upper.add(cw);
    var cwTop = rbox(2.3, 0.12, 0.68, 0.04, MAT.yellowDeep);
    cwTop.position.set(0, 2.0, -1.5);
    upper.add(cwTop);
    var cwLogo = decal('SANY', 0.92, 0.24, { color: '#c8232c', scale: 0.82, italic: true });
    cwLogo.position.set(0, 1.5, -1.885);
    upper.add(cwLogo);

    // 发动机罩（右后）
    var hood = rbox(1.16, 0.92, 1.62, 0.09, MAT.yellow);
    hood.position.set(0.63, 1.52, -0.62);
    upper.add(hood);
    // 侧面散热格栅
    for (var vi = 0; vi < 5; vi++) {
      var vent = box(0.02, 0.62, 0.18, MAT.dark);
      vent.position.set(1.222, 1.5, -1.2 + vi * 0.28);
      upper.add(vent);
    }
    // 顶部散热格栅
    var grille = box(1.0, 0.03, 1.3, MAT.graphite);
    grille.position.set(0.63, 1.995, -0.62);
    upper.add(grille);
    // 排气管
    var exhaust = cyl(0.06, 0.06, 0.46, MAT.steelDark, 16);
    exhaust.position.set(0.42, 2.16, -0.82);
    upper.add(exhaust);
    var exhCap = cyl(0.075, 0.075, 0.07, MAT.dark, 16);
    exhCap.position.set(0.42, 2.4, -0.82);
    upper.add(exhCap);
    // 空气滤清器
    var air = cylX(0.16, 0.5, MAT.steelDark, 0.63, 1.36, 0.18, 18);
    upper.add(air);

    // 液压油箱 / 燃油箱（左）
    var tank = rbox(0.92, 0.86, 1.42, 0.08, MAT.yellow);
    tank.position.set(-0.72, 1.5, -0.6);
    upper.add(tank);
    var filler = cyl(0.075, 0.075, 0.1, MAT.steelDark, 14);
    filler.position.set(-0.72, 1.96, -1.2);
    upper.add(filler);
    var level = cyl(0.05, 0.05, 0.4, MAT.glass, 12);
    level.rotation.z = PI / 2;
    level.position.set(-1.2, 1.34, -0.2);
    upper.add(level);

    /* --- 驾驶室（前左） --- */
    var cab = new T.Group();
    cab.position.set(-0.78, 0.94, 0.9);
    upper.add(cab);
    var cabFloor = rbox(1.06, 0.12, 1.24, 0.03, MAT.graphite);
    cabFloor.position.y = 0.06;
    cab.add(cabFloor);
    [
      [-0.5, -0.58],
      [0.5, -0.58],
      [-0.5, 0.58],
      [0.5, 0.58]
    ].forEach(function (p) {
      var pillar = box(0.08, 1.72, 0.09, MAT.graphite);
      pillar.position.set(p[0], 0.98, p[1]);
      cab.add(pillar);
    });
    var cabRoof = rbox(1.14, 0.12, 1.32, 0.05, MAT.graphite);
    cabRoof.position.y = 1.9;
    cab.add(cabRoof);
    var cabTop = rbox(0.94, 0.06, 1.1, 0.03, MAT.yellow);
    cabTop.position.y = 1.99;
    cab.add(cabTop);
    // 玻璃
    var gf = plane(0.9, 1.6, MAT.glass);
    gf.position.set(0, 1.0, 0.615);
    cab.add(gf);
    var gl = plane(1.12, 1.6, MAT.glass);
    gl.rotation.y = -PI / 2;
    gl.position.set(-0.52, 1.0, 0);
    cab.add(gl);
    var gr = plane(1.12, 1.6, MAT.glass);
    gr.rotation.y = PI / 2;
    gr.position.set(0.52, 1.0, 0);
    cab.add(gr);
    var gb = plane(0.9, 1.6, MAT.glass);
    gb.rotation.y = PI;
    gb.position.set(0, 1.0, -0.615);
    cab.add(gb);
    // 门框 + 门把手
    var doorFrame = box(0.03, 1.5, 1.02, MAT.graphite);
    doorFrame.position.set(-0.53, 1.0, 0.05);
    cab.add(doorFrame);
    var handle = cyl(0.02, 0.02, 0.3, MAT.steel, 10);
    handle.position.set(-0.56, 1.05, 0.42);
    cab.add(handle);
    // 座椅 + 操纵杆
    var seat = rbox(0.42, 0.16, 0.44, 0.05, MAT.dark);
    seat.position.set(0, 0.5, -0.1);
    cab.add(seat);
    var back = rbox(0.42, 0.5, 0.12, 0.04, MAT.dark);
    back.position.set(0, 0.78, -0.3);
    cab.add(back);
    [-0.26, 0.26].forEach(function (x) {
      var stick = cyl(0.025, 0.025, 0.34, MAT.dark, 10);
      stick.position.set(x, 0.66, 0.22);
      cab.add(stick);
      var knob = sphere(0.045, MAT.red);
      knob.position.set(x, 0.83, 0.22);
      cab.add(knob);
    });
    // 顶灯
    [0.28, -0.28].forEach(function (x) {
      var lamp = box(0.2, 0.1, 0.09, MAT.ledWhite);
      lamp.position.set(x, 1.98, 0.62);
      cab.add(lamp);
    });
    // 警示灯
    var beaconBase = cyl(0.05, 0.05, 0.12, MAT.graphite, 12);
    beaconBase.position.set(-0.2, 2.05, 0.3);
    cab.add(beaconBase);
    var beacon = cyl(0.09, 0.09, 0.14, MAT.ledAmber, 14);
    beacon.position.set(-0.2, 2.17, 0.3);
    cab.add(beacon);
    hots.push({ p: [-0.78, 2.86, 0.9], t: '驾驶室', s: 'CABIN / ROPS', o: cab });

    // 扶手 / 走台
    var hr1 = cylX(0.025, 0.9, MAT.yellow, 0.63, 2.16, -1.05, 8);
    upper.add(hr1);
    var hr2 = cyl(0.025, 0.025, 0.24, MAT.yellow, 8);
    hr2.position.set(0.18, 2.04, -1.05);
    upper.add(hr2);
    var hr3 = cyl(0.025, 0.025, 0.24, MAT.yellow, 8);
    hr3.position.set(1.08, 2.04, -1.05);
    upper.add(hr3);
    var walkway = box(0.9, 0.03, 0.3, MAT.graphite);
    walkway.position.set(0.63, 1.99, -1.05);
    upper.add(walkway);

    hots.push({ p: [1.5, 0.9, 0.55], t: '履带底盘', s: 'UNDERCARRIAGE', o: under });
    hots.push({ p: [0, 2.2, -1.95], t: '配重', s: 'COUNTERWEIGHT', o: cw });
    hots.push({ p: [-1.24, 1.5, -0.6], t: '液压油箱', s: 'HYDRAULIC TANK', o: tank });

    /* --- 工作装置：动臂 → 斗杆 → 铲斗 --- */
    var P = [0.36, 1.12, 1.06]; // 动臂铰点
    var boomMount = rbox(0.66, 0.66, 0.5, 0.08, MAT.yellowDeep);
    boomMount.position.set(P[0], P[1] - 0.04, P[2] - 0.16);
    upper.add(boomMount);

    var boomG = new T.Group();
    boomG.position.set(P[0], P[1], P[2]);
    root.add(boomG);
    // 动臂（两段折弯）
    var knee = [0, 0.98, 1.52];
    var armPivot = [0, 0.5, 3.62];
    limb(boomG, [0, 0, 0], knee, 0.34, 0.5, MAT.yellow, 0.06);
    limb(boomG, knee, armPivot, 0.3, 0.44, MAT.yellow, 0.05);
    // 动臂加强肋
    limb(boomG, [0.17, 0.06, 0.1], [0.17, 1.0, 1.5], 0.05, 0.36, MAT.yellowDeep, 0.012);
    limb(boomG, [-0.17, 0.06, 0.1], [-0.17, 1.0, 1.5], 0.05, 0.36, MAT.yellowDeep, 0.012);
    // 动臂标识
    var boomLogo = decal('SY215C', 1.0, 0.26, { color: '#c8232c', scale: 0.72 });
    boomLogo.position.set(-0.19, 0.42, 0.72);
    boomLogo.rotation.y = -PI / 2;
    boomG.add(boomLogo);
    // 动臂灯
    var bLamp = box(0.22, 0.11, 0.1, MAT.ledWhite);
    bLamp.position.set(0, 1.12, 1.28);
    boomG.add(bLamp);
    // 动臂液压缸 ×2
    var bc1 = actuator(0.82, 0.1, 0.055);
    bc1.position.set(0.3, -0.02, 0.28);
    bc1.rotation.x = -0.62;
    boomG.add(bc1);
    var bc2 = actuator(0.82, 0.1, 0.055);
    bc2.position.set(-0.3, -0.02, 0.28);
    bc2.rotation.x = -0.62;
    boomG.add(bc2);
    // 动臂软管
    hose(
      boomG,
      [
        [0.22, 0.1, 0.05],
        [0.3, 0.62, 0.75],
        [0.26, 1.06, 1.5],
        [0.2, 0.72, 2.5],
        [0.16, 0.5, 3.3]
      ],
      0.028,
      MAT.dark
    );
    hose(
      boomG,
      [
        [-0.22, 0.1, 0.05],
        [-0.3, 0.6, 0.78],
        [-0.26, 1.02, 1.52],
        [-0.2, 0.7, 2.52],
        [-0.16, 0.5, 3.32]
      ],
      0.028,
      MAT.dark
    );

    var armG = new T.Group();
    armG.position.set(armPivot[0], armPivot[1], armPivot[2]);
    boomG.add(armG);
    var stickEnd = [0, -0.62, 1.72];
    limb(armG, [0, 0, 0], stickEnd, 0.24, 0.36, MAT.yellow, 0.05);
    // 斗杆前叉
    var fork = rbox(0.3, 0.34, 0.3, 0.04, MAT.yellowDeep);
    fork.position.set(0, -0.6, 1.7);
    armG.add(fork);
    // 斗杆液压缸
    var sc = actuator(0.72, 0.088, 0.05);
    sc.position.set(0, 0.3, 0.06);
    sc.rotation.x = 0.72;
    armG.add(sc);
    // 铲斗液压缸 + 摇臂
    var bkc = actuator(0.6, 0.082, 0.046);
    bkc.position.set(0, 0.16, 0.9);
    bkc.rotation.x = 0.32;
    armG.add(bkc);
    limb(armG, [0, -0.42, 1.55], [0, -0.02, 1.94], 0.09, 0.16, MAT.steelDark, 0.02);

    /* ================= 铲斗 =================
       挂在斗杆末端（bucketG 原点即与斗杆前叉的铰接点）。
       朝向约定：+Z = 远离机身（车头前方），-Z = 朝向机身。
       真实挖掘机收斗姿态下，斗背（凸面）朝前、斗口与斗齿朝内下方，
       所以这里让斗背落在 +Z 侧，斗口开在 -Z 侧（朝机身），斗齿朝 -Z 下方。 */
    var bucketG = new T.Group();
    bucketG.position.set(0, -0.62, 1.86);
    armG.add(bucketG);

    /* 斗体弧形壳：取一段「开口圆柱」，再绕 Z 轴转 90°——
       圆柱轴向由 Y 变为 X（即铲斗宽度 0.98），圆弧落在 YZ 平面上。
       弧上一点的局部坐标 (y, z) = (sinθ·0.44, cosθ·0.44)，关键角度：
         θ =   0°  → (0, +0.44)   正前，斗背最凸点
         θ = -90°  → (-0.44, 0)   正下，斗底
         θ =-155°  → (-0.19,-0.40) 下后方，斗唇（斗齿安装位）
         θ =  50°  → (+0.34,+0.28) 上前方，斗口上唇
       弧覆盖 -155°~50°，缺口 50°~205° 即为斗口，开口朝上后方（朝机身），
       整体剖面呈 U 形斗腔。 */
    var shellGeo = new T.CylinderGeometry(0.44, 0.44, 0.98, 26, 1, true, rad(-155), rad(205));
    var shell = new T.Mesh(
      shellGeo,
      new T.MeshStandardMaterial({
        color: 0xd9a41a,
        metalness: 0.62,
        roughness: 0.42,
        side: T.DoubleSide,
        envMapIntensity: 1.1
      })
    );
    shell.rotation.z = PI / 2;
    shell.position.set(0, 0, 0);
    shell.castShadow = true;
    bucketG.add(shell);

    /* 侧板 ×2：封住 U 形斗体左右两侧。
       形状 = 与斗壳同圆心同半径的「弓形」（圆弧边贴斗壳 + 直线弦边即斗口），
       用 Shape 画出剖面后 Extrude 出 0.035 厚度，再绕 Y 轴转 -90°
       把 Shape 的 XY 平面映射到铲斗的 YZ 平面（厚度沿 X）。 */
    var sideArcA = rad(50),
      sideArcB = rad(-155); // 弓形圆弧的起止角（同斗壳）
    var sideShape = new T.Shape();
    sideShape.moveTo(Math.cos(sideArcA) * 0.44, Math.sin(sideArcA) * 0.44);
    sideShape.absarc(0, 0, 0.44, sideArcA, sideArcB, true);
    sideShape.closePath(); // 弦边闭合 → 斗口直线边
    var sideGeo = new T.ExtrudeGeometry(sideShape, { depth: 0.035, bevelEnabled: false });
    [0.49, -0.455].forEach(function (x) {
      // 右板 / 左板（厚度 0.035 向内）
      var plate = new T.Mesh(sideGeo, MAT.yellow);
      plate.rotation.y = -PI / 2;
      plate.position.set(x, 0, 0);
      plate.castShadow = true;
      bucketG.add(plate);
    });

    /* 刃板（斗唇板）：贴在弧的斗齿端 θ=-155° 处，沿该点切线向斗底延伸。
       切线方向 (dy,dz)=(-0.906,+0.423)，对应绕 X 轴旋转 65° 让板厚方向对齐切线。 */
    var edge = box(0.98, 0.08, 0.26, MAT.steelDark);
    edge.position.set(0, -0.3, -0.34);
    edge.rotation.x = rad(65);
    bucketG.add(edge);

    /* 斗齿 ×5：从斗唇沿「背离斗腔中心」的方向伸出，即 (dy,dz)=(-0.42,-0.906)，
       锥体默认轴沿 +Y，绕 X 轴转 -115° 后尖端指向下后方（朝机身下方），
       对应挖掘时先入土、随后斗杆向机身回收的切削方向。 */
    for (var t = 0; t < 5; t++) {
      var tooth = cone(0.055, 0.22, MAT.steelDark, 12);
      tooth.rotation.x = rad(-115);
      tooth.position.set(-0.36 + t * 0.18, -0.24, -0.51);
      bucketG.add(tooth);
    }

    /* 斗背加强板：贴在斗背（+Z 侧）外表面，沿高度方向的一根立筋。 */
    limb(bucketG, [0, 0.28, 0.4], [0, -0.28, 0.4], 0.5, 0.07, MAT.yellowDeep, 0.02);

    /* 耳板 ×2：从斗口弦边中部向上伸出，底端衔接斗杆前叉 / 摇臂连杆的铰点，
       对应真实铲斗「耳板焊在斗体上缘、销轴穿斗杆」的结构。 */
    [-0.14, 0.14].forEach(function (x) {
      var ear = box(0.07, 0.2, 0.12, MAT.yellowDeep);
      ear.position.set(x, 0.12, -0.06);
      bucketG.add(ear);
    });
    hots.push({ p: [0.36, 1.6, 1.7], t: '动臂液压缸', s: 'BOOM CYLINDER', o: [bc1, bc2] });

    /* --- 出厂标签 --- */
    var plate = decal('三一重工  SY215C', 1.3, 0.16, { color: '#4a4f55', scale: 0.5 });
    plate.position.set(0, 1.1, 1.02);
    upper.add(plate);

    /* --- 动作：挖掘循环 ---
       各关节按同一相位链正弦联动（动臂→斗杆→铲斗→对应油缸）。
       铲斗摆幅限定 ±0.32 rad：再大耳板会与斗杆前叉脱开（穿模），
       0.32 内铰接点在视觉上始终相连。 */
    function anim(t) {
      var e = ((t % 9.5) / 9.5) * TAU;
      boomG.rotation.x = -0.08 + 0.2 * Math.sin(e);
      armG.rotation.x = 0.34 + 0.42 * Math.sin(e + 1.9);
      bucketG.rotation.x = -0.5 + 0.32 * Math.sin(e + 3.4);
      bc1.userData.push(0.35 + 0.3 * Math.sin(e));
      bc2.userData.push(0.35 + 0.3 * Math.sin(e));
      sc.userData.push(0.3 + 0.34 * Math.sin(e + 1.9));
      bkc.userData.push(0.3 + 0.3 * Math.sin(e + 3.4));
    }
    anim(0);

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     二、「灵眸」免示教六轴焊接机器人
     结构链：底座 → J1 回转座 → J2 肩 → 大臂 → J3 肘 → 小臂
            → J4 腕回转 → J5 腕摆 → J6 法兰 → 焊枪；
     配套：控制柜（右）、送丝机（大臂侧）、焊接工作台 + 工件（左）。
     关节全部用 Group 嵌套，动画只需转父关节、子关节自动跟随。
     ============================================================ */
  F.register('welder', function () {
    var root = new T.Group();
    var hots = [];

    // 底座
    var basePlate = rbox(1.5, 0.07, 1.5, 0.02, MAT.graphite);
    basePlate.position.y = 0.035;
    root.add(basePlate);
    var base = cyl(0.52, 0.58, 0.16, MAT.graphite, 32);
    base.position.y = 0.14;
    root.add(base);
    for (var i = 0; i < 4; i++) {
      var a = (i / 4) * TAU + PI / 4;
      var anchor = cyl(0.045, 0.045, 0.05, MAT.steel, 12);
      anchor.position.set(Math.cos(a) * 0.62, 0.075, Math.sin(a) * 0.62);
      root.add(anchor);
      var boltHead = cyl(0.028, 0.028, 0.03, MAT.chrome, 10);
      boltHead.position.set(Math.cos(a) * 0.62, 0.11, Math.sin(a) * 0.62);
      root.add(boltHead);
    }
    hots.push({ p: [0, 0.28, 0.72], t: '安装底座', s: 'BASE / J1', o: basePlate });

    // J1 回转座
    var j1 = new T.Group();
    j1.position.y = 0.22;
    root.add(j1);
    j1.add(rbox(0.92, 0.52, 0.86, 0.1, MAT.red));
    var j1Ring = cyl(0.44, 0.44, 0.06, MAT.steelDark, 30);
    j1Ring.position.y = 0.26;
    j1.add(j1Ring);
    var j1Logo = decal('SANY', 0.44, 0.13, { color: '#ffffff', scale: 0.8, italic: true });
    j1Logo.position.set(0, 0.12, 0.435);
    j1.add(j1Logo);

    // J2 肩关节
    var shoulder = [0, 0.42, 0];
    var j2 = new T.Group();
    j2.position.set(shoulder[0], shoulder[1], shoulder[2]);
    j1.add(j2);
    j2.add(cylX(0.27, 0.74, MAT.graphite, 0, 0, 0, 26));
    j2.add(cylX(0.3, 0.1, MAT.redDeep, 0.38, 0, 0, 26));
    j2.add(cylX(0.3, 0.1, MAT.redDeep, -0.38, 0, 0, 26));

    // 大臂 → 肘
    var elbow = [0, 1.02, 0.2];
    limb(j2, [0, 0, 0], elbow, 0.32, 0.4, MAT.red, 0.07);
    var rodG = limb(j2, [0, 0.12, 0.0], [0, 1.0, 0.2], 0.1, 0.14, MAT.steelDark, 0.03);
    void rodG;

    // J3 肘关节
    var j3 = new T.Group();
    j3.position.set(elbow[0], elbow[1], elbow[2]);
    j2.add(j3);
    j3.add(cylX(0.21, 0.56, MAT.graphite, 0, 0, 0, 24));
    j3.add(cylX(0.235, 0.08, MAT.redDeep, 0.29, 0, 0, 24));
    j3.add(cylX(0.235, 0.08, MAT.redDeep, -0.29, 0, 0, 24));

    // 小臂 → 腕
    var wrist = [0, 0.86, 0.16];
    limb(j3, [0, 0, 0], wrist, 0.24, 0.28, MAT.red, 0.055);

    // J4 腕部回转
    var j4 = new T.Group();
    j4.position.set(wrist[0], wrist[1], wrist[2]);
    j3.add(j4);
    j4.add(cylX(0.14, 0.42, MAT.graphite, 0, 0, 0, 22));
    j4.add(cylX(0.155, 0.07, MAT.redDeep, 0.22, 0, 0, 22));
    j4.add(cylX(0.155, 0.07, MAT.redDeep, -0.22, 0, 0, 22));

    // J5 腕摆
    var j5 = new T.Group();
    j5.position.set(0, 0.26, 0.02);
    j4.add(j5);
    j5.add(cylX(0.13, 0.34, MAT.graphite, 0, 0, 0, 20));
    // J6 法兰
    var j6 = new T.Group();
    j6.position.set(0, 0.24, 0);
    j5.add(j6);
    j6.add(cyl(0.1, 0.1, 0.09, MAT.steel, 22));
    j6.add(cyl(0.115, 0.115, 0.03, MAT.steelDark, 22));
    // 焊枪
    var torchBody = cyl(0.045, 0.06, 0.2, MAT.graphite, 16);
    torchBody.position.y = 0.16;
    j6.add(torchBody);
    var neckPts = [
      [0, 0.24, 0],
      [0.02, 0.42, 0.02],
      [0.05, 0.56, 0.08],
      [0.09, 0.66, 0.16]
    ];
    hose(j6, neckPts, 0.028, MAT.graphite, 26);
    var nozzle = cone(0.05, 0.16, MAT.copper, 18);
    nozzle.position.set(0.09, 0.72, 0.17);
    j6.add(nozzle);
    var tip = cyl(0.012, 0.012, 0.08, MAT.steelDark, 10);
    tip.position.set(0.09, 0.82, 0.18);
    j6.add(tip);
    // 焊丝
    var wire = cyl(0.004, 0.004, 0.16, MAT.chrome, 6);
    wire.position.set(0.09, 0.9, 0.18);
    j6.add(wire);
    hots.push({ p: [0, 1.62, 0.9], t: '焊接执行端', s: 'TORCH / J6', o: j6 });

    // 线缆束（大臂到腕部）
    hose(
      j2,
      [
        [0, 1.05, 0.42],
        [0, 0.9, 0.5],
        [0, 0.5, 0.46],
        [-0.05, 0.3, 0.36]
      ],
      0.035,
      MAT.dark,
      30
    );
    hose(
      j3,
      [
        [0, 0.3, 0.36],
        [0.02, 0.12, 0.3],
        [0.05, -0.02, 0.22]
      ],
      0.03,
      MAT.dark,
      20
    );

    // 送丝机
    var feeder = rbox(0.26, 0.22, 0.2, 0.03, MAT.graphite);
    feeder.position.set(-0.28, 0.66, 0.08);
    j2.add(feeder);
    var spool = cylX(0.11, 0.07, MAT.redDeep, -0.28, 0.66, -0.14, 20);
    j2.add(spool);
    hots.push({ p: [-0.5, 0.95, 0.1], t: '送丝机构', s: 'WIRE FEEDER', o: feeder });

    // 控制柜
    var cabRoot = new T.Group();
    cabRoot.position.set(1.35, 0, -0.35);
    root.add(cabRoot);
    cabRoot.add(rbox(0.66, 1.24, 0.56, 0.04, MAT.graphite));
    var cabPanel = rbox(0.5, 0.32, 0.03, 0.01, MAT.screen);
    cabPanel.position.set(0, 0.34, 0.29);
    cabRoot.add(cabPanel);
    for (var v = 0; v < 6; v++) {
      var slot = box(0.42, 0.03, 0.02, MAT.dark);
      slot.position.set(0, -0.05 - v * 0.06, 0.29);
      cabRoot.add(slot);
    }
    var cabFoot = rbox(0.72, 0.07, 0.62, 0.02, MAT.steelDark);
    cabFoot.position.y = -0.63;
    cabRoot.add(cabFoot);
    var cabLed = cyl(0.028, 0.028, 0.02, MAT.ledGreen, 10);
    cabLed.rotation.x = PI / 2;
    cabLed.position.set(0.2, 0.56, 0.29);
    cabRoot.add(cabLed);
    hose(
      root,
      [
        [1.05, 0.5, -0.35],
        [0.6, 0.3, -0.3],
        [0.2, 0.35, -0.1],
        [0, 0.4, 0.1]
      ],
      0.03,
      MAT.dark,
      24
    );
    hots.push({ p: [1.35, 1.4, 0.05], t: '控制柜', s: 'CONTROL CABINET', o: cabRoot });

    // 焊接工作台 + 工件
    var table = new T.Group();
    table.position.set(-1.5, 0, 0.7);
    root.add(table);
    table.add(rbox(1.2, 0.1, 0.9, 0.03, MAT.steelDark));
    [
      [-0.5, -0.35],
      [0.5, -0.35],
      [-0.5, 0.35],
      [0.5, 0.35]
    ].forEach(function (p) {
      var leg = rbox(0.09, 0.8, 0.09, 0.02, MAT.graphite);
      leg.position.set(p[0], -0.45, p[1]);
      table.add(leg);
    });
    table.position.y = 0.85;
    var workpiece = rbox(0.8, 0.5, 0.6, 0.05, MAT.steel);
    workpiece.position.y = 0.3;
    table.add(workpiece);
    var seam = box(0.82, 0.02, 0.03, MAT.weldGlow);
    seam.position.set(0, 0.56, 0.2);
    table.add(seam);
    hots.push({ p: [-1.5, 1.6, 0.7], t: '焊接工位', s: 'FIXTURE / JIG', o: table });

    /* 动作：焊接姿态摆焊——六个关节各自按不同频率/相位正弦摆动，
       叠加出「焊枪沿焊缝小幅摆动」的视觉效果（无真实轨迹规划） */
    function anim(t) {
      j1.rotation.y = -0.28 + 0.16 * Math.sin(t * 0.7);
      j2.rotation.x = -0.42 + 0.1 * Math.sin(t * 0.9 + 1.0);
      j3.rotation.x = 0.86 + 0.14 * Math.sin(t * 1.1 + 0.4);
      j4.rotation.x = 0.1 * Math.sin(t * 1.5);
      j5.rotation.x = 0.62 + 0.12 * Math.sin(t * 1.3 + 2.1);
      j6.rotation.y = 0.2 * Math.sin(t * 1.7);
    }
    anim(0);

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     三、SY215C 液压系统核心部件（泵 / 阀 / 缸 / 管路）
     ============================================================ */
  F.register('hydraulics', function () {
    var root = new T.Group();
    var hots = [];

    // 安装底架
    var skid = rbox(2.5, 0.1, 1.5, 0.03, MAT.steelDark);
    skid.position.y = 0.05;
    root.add(skid);
    [
      [-1.05, -0.6],
      [1.05, -0.6],
      [-1.05, 0.6],
      [1.05, 0.6]
    ].forEach(function (p) {
      var foot = rbox(0.22, 0.06, 0.22, 0.02, MAT.rubber);
      foot.position.set(p[0], 0.03, p[1]);
      root.add(foot);
    });

    /* 主液压泵（轴向柱塞泵） */
    var pumpG = new T.Group();
    pumpG.position.set(-0.72, 0.36, -0.28);
    root.add(pumpG);
    var pBody = cylX(0.27, 0.6, MAT.steel, 0, 0, 0, 30);
    pumpG.add(pBody);
    var pFlange = cylX(0.33, 0.07, MAT.steelDark, 0.31, 0, 0, 30);
    pumpG.add(pFlange);
    var pBack = cylX(0.29, 0.06, MAT.steelDark, -0.31, 0, 0, 30);
    pumpG.add(pBack);
    // 主轴
    var shaft = cylX(0.065, 0.34, MAT.chrome, 0.5, 0, 0, 20);
    pumpG.add(shaft);
    var key = box(0.05, 0.02, 0.1, MAT.steelDark);
    key.position.set(0.64, 0.03, 0);
    pumpG.add(key);
    // 调节器（恒功率/压力切断）
    var reg = rbox(0.24, 0.3, 0.22, 0.03, MAT.graphite);
    reg.position.set(-0.06, 0.3, 0);
    pumpG.add(reg);
    var regKnob = cyl(0.055, 0.055, 0.12, MAT.brass, 16);
    regKnob.position.set(-0.06, 0.5, 0);
    pumpG.add(regKnob);
    // 进出油口法兰
    pumpG.add(cylZ(0.1, 0.14, MAT.steelDark, 0, -0.12, 0.34, 20));
    pumpG.add(cylZ(0.085, 0.12, MAT.steelDark, 0, 0.1, -0.34, 20));
    // 铭牌
    var nameplate = decal('SANY  A11VO', 0.4, 0.12, { bg: '#c8232c', color: '#ffffff', scale: 0.5 });
    nameplate.position.set(0, 0.16, 0.28);
    nameplate.rotation.x = PI / 2;
    pumpG.add(nameplate);
    hots.push({ p: [-1.1, 0.95, -0.28], t: '主液压泵', s: 'AXIAL PISTON PUMP', o: pumpG });

    /* 驱动电机 */
    var motorG = new T.Group();
    motorG.position.set(-1.62, 0.36, -0.28);
    root.add(motorG);
    var mBody = cylX(0.25, 0.72, MAT.graphite, 0, 0, 0, 28);
    motorG.add(mBody);
    for (var f = 0; f < 10; f++) {
      var fin = cylX(0.275, 0.03, MAT.dark, -0.3 + f * 0.066, 0, 0, 28);
      motorG.add(fin);
    }
    var mCap = cylX(0.2, 0.3, MAT.ledBlue, -0.5, 0, 0, 24);
    motorG.add(mCap);
    var jbox = rbox(0.2, 0.18, 0.18, 0.02, MAT.graphite);
    jbox.position.set(-0.36, 0.24, 0);
    motorG.add(jbox);
    // 联轴器护罩
    var guard = cylX(0.3, 0.16, MAT.yellow, -0.4, 0, 0, 24);
    guard.position.set(-1.34, 0.36, -0.28);
    root.add(guard);

    /* 多路换向阀组 */
    var valveG = new T.Group();
    valveG.position.set(0.55, 0.42, -0.42);
    root.add(valveG);
    var vBody = rbox(1.42, 0.42, 0.4, 0.035, MAT.steel);
    valveG.add(vBody);
    for (var s = 0; s < 7; s++) {
      var x = -0.58 + s * 0.194;
      var spool = cyl(0.055, 0.055, 0.2, MAT.steel, 18);
      spool.position.set(x, 0.3, 0);
      valveG.add(spool);
      var pilot = cyl(0.075, 0.075, 0.14, MAT.graphite, 18);
      pilot.position.set(x, 0.46, 0);
      valveG.add(pilot);
      var cap = cyl(0.045, 0.045, 0.05, MAT.brass, 14);
      cap.position.set(x, 0.56, 0);
      valveG.add(cap);
      var base = rbox(0.14, 0.08, 0.3, 0.015, MAT.steelDark);
      base.position.set(x, -0.24, 0);
      valveG.add(base);
    }
    // 主溢流阀
    [-0.78, 0.78].forEach(function (x) {
      var rv = cyl(0.085, 0.085, 0.26, MAT.steelDark, 20);
      rv.position.set(x, 0.34, 0.15);
      valveG.add(rv);
      var rvCap = cyl(0.07, 0.07, 0.1, MAT.brass, 18);
      rvCap.position.set(x, 0.52, 0.15);
      valveG.add(rvCap);
    });
    // 油口法兰阵列
    for (var pf = 0; pf < 6; pf++) {
      valveG.add(cylZ(0.075, 0.09, MAT.steelDark, -0.5 + pf * 0.2, 0.02, 0.24, 16));
    }
    var vPlate = decal('SANY  MAIN VALVE', 0.6, 0.13, { bg: '#3c4247', color: '#e8ecef', scale: 0.44 });
    vPlate.position.set(0, 0.16, 0.203);
    valveG.add(vPlate);
    hots.push({ p: [0.55, 1.15, -0.42], t: '多路换向阀', s: 'MAIN CONTROL VALVE', o: valveG });

    /* 液压缸 */
    var cylG = new T.Group();
    cylG.position.set(0.62, 0.44, 0.42);
    cylG.rotation.y = -0.4;
    root.add(cylG);
    var barrel = cylZ(0.135, 0.92, MAT.steel, 0, 0, 0.46, 26);
    cylG.add(barrel);
    var barrelEnd = cylZ(0.15, 0.07, MAT.steelDark, 0, 0, 0.05, 26);
    cylG.add(barrelEnd);
    var gland = cylZ(0.15, 0.1, MAT.steelDark, 0, 0, 0.9, 26);
    cylG.add(gland);
    var pistonRod = cylZ(0.075, 0.86, MAT.chrome, 0, 0, 1.36, 22);
    cylG.add(pistonRod);
    var clevis = rbox(0.1, 0.24, 0.16, 0.03, MAT.steelDark);
    clevis.position.set(0, 0, 1.86);
    cylG.add(clevis);
    var pin = cylX(0.032, 0.2, MAT.chrome, 0, 0, 1.9, 14);
    cylG.add(pin);
    [-0.24, 0.24].forEach(function (z) {
      var p = cylZ(0.055, 0.1, MAT.steelDark, 0, 0.13, 0.5 + z, 16);
      cylG.add(p);
    });
    var rodAnim = cylG;
    hots.push({ p: [0.62, 1.05, 1.1], t: '液压缸', s: 'HYDRAULIC CYLINDER', o: cylG });

    /* 管路 */
    hose(
      root,
      [
        [-0.72, 0.66, -0.02],
        [-0.3, 0.78, 0.1],
        [0.1, 0.72, 0.02],
        [0.5, 0.66, -0.18],
        [0.55, 0.66, -0.2]
      ],
      0.045,
      MAT.dark,
      40
    );
    hose(
      root,
      [
        [0.55, 0.2, -0.2],
        [0.2, 0.2, 0.35],
        [0.3, 0.28, 0.5],
        [0.55, 0.32, 0.35]
      ],
      0.04,
      MAT.dark,
      30
    );
    hose(
      root,
      [
        [-1.6, 0.2, -0.1],
        [-1.1, 0.16, 0.4],
        [-0.5, 0.2, 0.55],
        [0.05, 0.28, 0.5]
      ],
      0.038,
      MAT.dark,
      40
    );
    // 硬管
    var hardPipe = hose(
      root,
      [
        [0.0, 0.66, -0.3],
        [0.15, 0.74, -0.42],
        [0.4, 0.72, -0.5]
      ],
      0.03,
      MAT.steel,
      18
    );
    void hardPipe;

    /* 压力表 */
    var gauge = cyl(0.09, 0.09, 0.05, MAT.steelDark, 22);
    gauge.rotation.x = PI / 2;
    gauge.position.set(-0.35, 0.86, -0.15);
    root.add(gauge);
    var dial = cyl(0.075, 0.075, 0.012, MAT.white, 22);
    dial.rotation.x = PI / 2;
    dial.position.set(-0.35, 0.86, -0.12);
    root.add(dial);
    var gPost = cyl(0.02, 0.02, 0.26, MAT.steel, 10);
    gPost.position.set(-0.35, 0.72, -0.15);
    root.add(gPost);

    /* 动作：柱塞泵主轴旋转 + 液压缸伸缩 */
    function anim(t) {
      shaft.rotation.x = t * 4.2;
      key.rotation.x = t * 4.2;
      var k = (Math.sin(t * 0.8) + 1) / 2;
      pistonRod.position.z = 1.36 + k * 0.3 - 0.15;
      clevis.position.z = 1.86 + k * 0.3 - 0.15;
      pin.position.z = 1.9 + k * 0.3 - 0.15;
      void rodAnim;
    }
    return { root: root, hots: hots, anim: anim };
  });
})();

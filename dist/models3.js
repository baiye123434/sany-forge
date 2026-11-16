/* ============================================================
   SANY FORGE · 设备三维模型（三）
   pump   SYM5552THB 710S 71米S系列混凝土泵车
   crane  SAC4000C8-8 400吨全地面起重机
   drill  SR315-S 旋挖钻机
   —— 全部由几何体程序化构建，结构与配色依据三一官网产品资料
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
  var cylX = K.cylX,
    cylZ = K.cylZ,
    limb = K.limb,
    actuator = K.actuator;
  var PI = Math.PI,
    TAU = PI * 2,
    rad = function (d) {
      return (d * PI) / 180;
    };

  /* ---------------- 局部材质与通用件 ---------------- */
  var MAT_RIM = new T.MeshStandardMaterial({ color: 0x33383d, roughness: 0.4, metalness: 0.72 });
  var MAT_ROPE = new T.MeshStandardMaterial({ color: 0x22262a, roughness: 0.88, metalness: 0.05 });
  var MAT_HOSE_SOFT = new T.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.92, metalness: 0.02 });

  /** 卡车车轮（轮胎 + 轮辋 + 螺栓） */
  function wheel(parent, x, y, z, r, w) {
    var tyre = cylX(r, w, MAT.rubber, x, y, z, 26);
    parent.add(tyre);
    var rim = cylX(r * 0.62, w + 0.045, MAT_RIM, x, y, z, 20);
    parent.add(rim);
    var cap = cylX(r * 0.17, w + 0.09, MAT.dark, x, y, z, 12);
    parent.add(cap);
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * TAU;
      var lug = cylX(0.028, w + 0.1, MAT.steelDark, x + Math.cos(a) * r * 0.4, y, z + Math.sin(a) * r * 0.4, 8);
      parent.add(lug);
    }
    return tyre;
  }

  /** 整桥：桥管 + 轮组（dual=true 时每侧双胎） */
  function axle(parent, z, y, r, w, dual) {
    var beam = cylX(0.13, 2.6, MAT.steelDark, 0, y, z, 16);
    parent.add(beam);
    var xs = dual ? [-1.06, -0.58, 0.58, 1.06] : [-1.0, 1.0];
    xs.forEach(function (x) {
      wheel(parent, x, y, z, r, w);
    });
    if (dual) {
      var diff = box(0.52, 0.52, 0.55, MAT.dark, 0, y - 0.1, z);
      parent.add(diff);
    }
  }

  /** 把执行器从 A 点指向 B 点摆放，返回所需杆长 */
  function aimActuator(group, ax, ay, az, bx, by, bz) {
    var a = new T.Vector3(ax, ay, az),
      b = new T.Vector3(bx, by, bz);
    var dir = b.sub(a),
      len = dir.length();
    group.position.set(ax, ay, az);
    group.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir.normalize());
    return len;
  }

  /** 在世界（=root 局部）坐标上落一个热点 */
  function hotWorld(hots, root, obj, ox, oy, oz, t, s) {
    var v = new T.Vector3(ox || 0, oy || 0, oz || 0);
    obj.updateWorldMatrix(true, false);
    v.applyMatrix4(obj.matrixWorld);
    hots.push({ p: [v.x, v.y, v.z], t: t, s: s || '', o: obj });
  }

  /* ============================================================
     一、SYM5552THB 710S · 71米S系列混凝土泵车
     5 桥底盘 / 5 节 Z 型折叠臂架 / 支腿展开 / 后置料斗
     ============================================================ */
  F.register('pump', function () {
    var root = new T.Group();
    var hots = [];

    /* --- 5 桥载重底盘 --- */
    var rails = [-0.42, 0.42].map(function (x) {
      var r = rbox(0.18, 0.32, 15.2, 0.04, MAT.graphite, x, 1.02, 0);
      root.add(r);
      return r;
    });
    for (var cx = -6; cx <= 6; cx += 3) {
      var cross = box(1.0, 0.2, 0.16, MAT.graphite, 0, 1.02, cx);
      root.add(cross);
    }
    var bumper = rbox(2.45, 0.55, 0.35, 0.06, MAT.dark, 0, 0.95, 7.62);
    root.add(bumper);
    var plate = rbox(2.5, 0.1, 5.8, 0.03, MAT.graphite, 0, 1.2, -4.6);
    root.add(plate);
    var tank = rbox(0.42, 0.62, 2.0, 0.1, MAT.steelDark, -1.28, 0.95, 1.6);
    root.add(tank);
    var battery = rbox(0.4, 0.5, 0.8, 0.08, MAT.dark, 1.28, 0.9, 2.2);
    root.add(battery);
    [-1.28, 1.28].forEach(function (x) {
      var guard = rbox(0.06, 0.26, 4.4, 0.02, MAT.dark, x, 0.58, -2.2);
      root.add(guard);
    });
    // 桥位：前 2 桥转向单胎，后 3 桥驱动双胎
    var axleZs = [5.8, 4.35, -0.7, -2.7, -4.7];
    axleZs.forEach(function (z, i) {
      axle(root, z, 0.78, 0.55, 0.4, i >= 2);
    });
    // 后桥挡泥板
    [4.0, 2.2].forEach(function (z) {
      [-1.32, 1.32].forEach(function (x) {
        var fender = rbox(0.06, 0.06, 1.9, 0.02, MAT.graphite, x, 1.42, z);
        root.add(fender);
      });
    });

    /* --- 驾驶室 --- */
    var cab = rbox(2.3, 1.45, 1.9, 0.08, MAT.offWhite, 0, 2.25, 6.25);
    root.add(cab);
    var cabStripe = rbox(2.34, 0.26, 1.94, 0.02, MAT.red, 0, 1.74, 6.25);
    root.add(cabStripe);
    var windshield = plane(1.95, 0.85, MAT.glass, 0, 2.62, 7.16);
    windshield.rotation.x = -0.16;
    root.add(windshield);
    [-1.156, 1.156].forEach(function (x) {
      var win = plane(1.05, 0.62, MAT.glass, x, 2.6, 6.4);
      win.rotation.y = x > 0 ? PI / 2 : -PI / 2;
      root.add(win);
    });
    var visor = rbox(2.0, 0.07, 0.5, 0.02, MAT.red, 0, 3.06, 7.0);
    root.add(visor);
    [-0.75, 0.75].forEach(function (x) {
      var lamp = box(0.34, 0.15, 0.07, MAT.ledWhite, x, 1.18, 7.78);
      root.add(lamp);
    });
    [-1.16, 1.16].forEach(function (x) {
      var rod = cyl(0.02, 0.02, 0.34, MAT.steelDark, 8, x, 2.72, 7.05);
      rod.rotation.z = x > 0 ? 0.5 : -0.5;
      root.add(rod);
      var mirror = box(0.05, 0.34, 0.2, MAT.dark, x * 1.24, 2.6, 7.1);
      root.add(mirror);
    });
    [1.35, 1.05, 0.75].forEach(function (y) {
      var step = rbox(0.66, 0.05, 0.32, 0.01, MAT.steelDark, 1.18, y, 7.15);
      root.add(step);
    });
    var exhaust = cyl(0.09, 0.09, 1.5, MAT.steelDark, 14, 0.95, 2.6, 5.1);
    root.add(exhaust);
    var exhCap = cyl(0.105, 0.105, 0.08, MAT.dark, 14, 0.95, 3.38, 5.1);
    root.add(exhCap);
    var doorLogo = decal('SANY', 0.62, 0.18, { color: '#c8232c', scale: 0.82, italic: true });
    doorLogo.position.set(1.165, 2.28, 6.05);
    doorLogo.rotation.y = PI / 2;
    root.add(doorLogo);

    /* --- 支腿（前 / 后各一对，展开状态） --- */
    [3.5, -3.5].forEach(function (z) {
      [-1, 1].forEach(function (sd) {
        var house = rbox(0.52, 0.52, 0.56, 0.06, MAT.graphite, sd * 0.95, 1.02, z);
        root.add(house);
        var beam = rbox(1.9, 0.3, 0.4, 0.05, MAT.red, sd * 1.85, 1.02, z);
        root.add(beam);
        var vert = cyl(0.1, 0.1, 1.0, MAT.steelDark, 14, sd * 2.72, 0.5, z);
        root.add(vert);
        var pad = rbox(0.62, 0.08, 0.62, 0.02, MAT.dark, sd * 2.72, 0.04, z);
        root.add(pad);
      });
    });

    /* --- 回转台上装（臂架 + 料斗 + 液压油箱 + 配重） --- */
    var slew = new T.Group();
    slew.position.set(0, 1.35, -4.4);
    root.add(slew);
    var ring = cyl(1.12, 1.12, 0.22, MAT.steelDark, 32, 0, 0.05, 0);
    slew.add(ring);
    var pedestal = rbox(1.15, 1.15, 1.0, 0.1, MAT.graphite, 0, 0.66, 0.1);
    slew.add(pedestal);
    [-0.56, 0.56].forEach(function (x) {
      var side = rbox(0.09, 1.05, 0.85, 0.03, MAT.steelDark, x, 0.66, 0.1);
      slew.add(side);
    });
    var oilTank = rbox(1.35, 0.85, 0.62, 0.08, MAT.yellowDeep, 0, 0.62, -0.95);
    slew.add(oilTank);
    var cw = rbox(2.3, 0.8, 0.45, 0.08, MAT.yellow, 0, 0.52, -1.85);
    slew.add(cw);
    var cwLogo = decal('SANY', 0.85, 0.22, { color: '#c8232c', scale: 0.8, italic: true });
    cwLogo.position.set(0, 0.52, -2.09);
    slew.add(cwLogo);

    /* --- 后置料斗与泵送机构 --- */
    var hopper = rbox(2.1, 0.95, 1.15, 0.06, MAT.yellow, 0, 0.6, -2.15);
    slew.add(hopper);
    var hopperMouth = box(1.86, 0.05, 0.92, MAT.dark, 0, 1.04, -2.15);
    slew.add(hopperMouth);
    var agitator = cylX(0.06, 2.0, MAT.steel, 0, 0.9, -2.15, 12);
    slew.add(agitator);
    for (var bi = 0; bi < 6; bi++) {
      var blade = box(0.05, 0.34, 0.14, MAT.steelDark, -0.85 + bi * 0.34, 0.9, -2.15);
      blade.rotation.x = bi * 0.5;
      slew.add(blade);
    }
    [-0.52, 0.52].forEach(function (x) {
      var dc = cylZ(0.15, 1.5, MAT.steel, x, 0.3, -0.85, 18);
      slew.add(dc);
      var dcCap = cylZ(0.19, 0.1, MAT.steelDark, x, 0.3, -0.12, 18);
      slew.add(dcCap);
    });
    hose(
      slew,
      [
        [0, 1.05, -1.75],
        [0, 1.5, -1.1],
        [0, 1.95, 0.15]
      ],
      0.09,
      MAT_HOSE_SOFT,
      24
    );

    /* --- 5 节 Z 型折叠臂架（工作姿态） --- */
    var boomBase = new T.Group();
    boomBase.position.set(0, 1.15, 0.45);
    slew.add(boomBase);
    /* 展示比例：臂架按 ~0.6 缩放（71m 实机全展过于细长，取景后仅占画面边缘），
       节宽节厚保持原值，结构与折叠方式不变 */
    var BL = [5.8, 5.4, 5.0, 4.6, 4.3],
      BW = [0.95, 0.8, 0.68, 0.58, 0.48],
      BT = [0.74, 0.62, 0.54, 0.46, 0.4];
    var baseAngles = [-58, 26, -34, 18, -30];
    var secs = [];
    var boomParent = boomBase;
    for (var si = 0; si < 5; si++) {
      var s = new T.Group();
      var body = rbox(BW[si], BT[si], BL[si] - 0.5, Math.min(BW[si], BT[si]) * 0.16, MAT.red);
      body.position.z = BL[si] / 2;
      s.add(body);
      var pipe = cylZ(0.06, BL[si] - 0.9, MAT.dark, BW[si] * 0.4, 0.08, BL[si] / 2, 10);
      s.add(pipe);
      var knuckle = cylX(0.15, BW[si] * 0.94, MAT.redDeep, 0, 0, 0, 16);
      s.add(knuckle);
      if (si === 0 || si === 1) {
        var bd = decal('SANY', 1.3, 0.24, { color: '#ffffff', scale: 0.78, italic: true });
        bd.position.set(BW[si] / 2 + 0.012, 0.02, BL[si] * 0.52);
        bd.rotation.y = PI / 2;
        s.add(bd);
        var bd2 = decal('SANY', 1.3, 0.24, { color: '#ffffff', scale: 0.78, italic: true });
        bd2.position.set(-BW[si] / 2 - 0.012, 0.02, BL[si] * 0.52);
        bd2.rotation.y = -PI / 2;
        s.add(bd2);
      }
      if (si > 0) s.position.z = BL[si - 1] - 0.42;
      s.rotation.x = rad(baseAngles[si]);
      boomParent.add(s);
      boomParent = s;
      secs.push(s);
    }
    // 臂架连杆（折臂油缸）
    var foldCyl = actuator(2.3, 0.09, 0.05, MAT.redDeep, MAT.chrome);
    aimActuator(foldCyl, 0.32, 0.3, 0.4, 0.3, 0.85, BL[0] * 0.45);
    foldCyl.userData.push(0.18);
    boomBase.add(foldCyl);
    var foldCyl2 = actuator(2.7, 0.07, 0.04, MAT.redDeep, MAT.chrome);
    aimActuator(foldCyl2, -0.26, -0.28, 0.3, -0.22, 0.4, BL[0] * 0.5);
    foldCyl2.userData.push(0.15);
    boomBase.add(foldCyl2);
    // 末端软管
    var tip = new T.Group();
    tip.position.z = BL[4] - 0.42;
    secs[4].add(tip);
    var tipSheave = cylX(0.16, 0.5, MAT.redDeep, 0, 0, 0, 14);
    tip.add(tipSheave);
    hose(
      tip,
      [
        [0, 0, 0],
        [0, -0.6, 0.16],
        [0, -1.3, 0.1],
        [0, -1.8, -0.06]
      ],
      0.085,
      MAT_HOSE_SOFT,
      26
    );
    var nozzle = cone(0.09, 0.3, MAT.red, 12, 0, -1.95, -0.08);
    nozzle.rotation.x = PI;
    tip.add(nozzle);
    // 遥控器站台
    var console = rbox(0.6, 0.5, 0.42, 0.05, MAT.graphite, 1.35, 0.42, 1.3);
    slew.add(console);
    var consoleScr = plane(0.4, 0.26, MAT.screen, 1.35, 0.62, 1.52);
    slew.add(consoleScr);

    /* --- 动作：臂架微动 + 转台回转 + 料斗搅拌 --- */
    function anim(t) {
      slew.rotation.y = Math.sin(t * 0.3) * 0.16;
      secs[1].rotation.x = rad(26) + Math.sin(t * 0.5) * rad(2.2);
      secs[2].rotation.x = rad(-34) + Math.sin(t * 0.5 + 1.1) * rad(2.0);
      secs[4].rotation.x = rad(-30) + Math.sin(t * 0.75 + 0.4) * rad(3.0);
      agitator.rotation.x = t * 2.6;
    }

    root.updateMatrixWorld(true);
    hotWorld(hots, root, secs[0], 0, 0, BL[0] * 0.55, '臂架·第一节', 'BOOM SEC.1');
    hotWorld(hots, root, secs[2], 0, 0.1, BL[2] * 0.5, '臂架·第三节', 'BOOM SEC.3');
    hotWorld(hots, root, tip, 0, -0.9, 0.05, '末端软管', 'END HOSE');
    hotWorld(hots, root, hopper, 0, 0.6, -0.6, '料斗与搅拌机构', 'HOPPER');
    hotWorld(hots, root, pedestal, 0, 0.9, 0, '回转支承', 'SLEW RING');
    hotWorld(hots, root, boomBase, 1.35, 0.42, 0.85, '支腿与操纵台', 'OUTRIGGER');

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     二、SAC4000C8-8 · 400吨全地面起重机
     6 桥底盘 / 8 节U型主臂(展示部分伸出) / 双变幅油缸 / 配重
     布局：车头朝 +Z；上车回转台（upper）承载操纵室(右前)、动力舱(左前)、
     主卷扬(中部)、80t 配重(尾部)，主臂从回转台前上方变幅伸出。
     ============================================================ */
  F.register('crane', function () {
    var root = new T.Group();
    var hots = [];

    /* --- 6 桥全地面底盘 --- */
    [-0.44, 0.44].forEach(function (x) {
      var rail = rbox(0.2, 0.36, 16.4, 0.05, MAT.graphite, x, 1.16, -0.2);
      root.add(rail);
    });
    var deck = rbox(2.9, 0.14, 12.6, 0.04, MAT.graphite, 0, 1.4, -1.6);
    root.add(deck);
    var bumper = rbox(2.9, 0.6, 0.4, 0.08, MAT.dark, 0, 1.05, 8.05);
    root.add(bumper);
    [-1.0, 1.0].forEach(function (x) {
      var lamp = box(0.4, 0.18, 0.08, MAT.ledWhite, x, 1.3, 8.24);
      root.add(lamp);
    });
    var tank = rbox(0.5, 0.7, 2.4, 0.12, MAT.steelDark, -1.35, 1.0, 2.8);
    root.add(tank);
    var tankCap = cyl(0.07, 0.07, 0.1, MAT.steel, 10, -1.35, 1.38, 2.2);
    root.add(tankCap);
    var axleZs = [6.9, 5.25, 1.9, 0.25, -2.2, -3.85];
    axleZs.forEach(function (z, i) {
      axle(root, z, 0.98, 0.78, 0.52, i >= 2);
    });

    /* --- 支腿（横跨 8 m，展开状态） --- */
    [4.7, -5.1].forEach(function (z) {
      [-1, 1].forEach(function (sd) {
        var house = rbox(0.62, 0.62, 0.68, 0.07, MAT.graphite, sd * 1.0, 1.05, z);
        root.add(house);
        var beam = rbox(3.3, 0.36, 0.5, 0.06, MAT.red, sd * 2.15, 1.05, z);
        root.add(beam);
        var vert = cyl(0.14, 0.14, 1.25, MAT.steelDark, 14, sd * 3.62, 0.62, z);
        root.add(vert);
        var pad = rbox(0.85, 0.12, 0.85, 0.03, MAT.dark, sd * 3.62, 0.06, z);
        root.add(pad);
      });
    });

    /* --- 上车（回转） --- */
    var upper = new T.Group();
    upper.position.set(0, 1.55, -0.4);
    root.add(upper);
    var ring = cyl(1.45, 1.45, 0.26, MAT.steelDark, 36, 0, 0.08, 0);
    upper.add(ring);
    var udeck = rbox(2.7, 0.52, 8.8, 0.1, MAT.graphite, 0, 0.42, -0.5);
    upper.add(udeck);
    // 配重（80t 挂块）
    var cw1 = rbox(2.9, 1.6, 0.9, 0.1, MAT.red, 0, 1.2, -5.0);
    upper.add(cw1);
    var cw2 = rbox(2.9, 1.1, 0.62, 0.08, MAT.redDeep, 0, 0.95, -5.95);
    upper.add(cw2);
    var cwLogo = decal('SANY', 1.6, 0.42, { color: '#ffffff', scale: 0.8, italic: true });
    cwLogo.position.set(0, 1.35, -5.46);
    upper.add(cwLogo);
    // 上车操纵室（右前）
    var cab = rbox(1.4, 1.5, 1.6, 0.09, MAT.offWhite, 0.62, 1.7, 3.3);
    upper.add(cab);
    var cabGlass = plane(1.1, 0.75, MAT.glass, 0.62, 2.1, 4.11);
    upper.add(cabGlass);
    var cabSide = plane(1.1, 0.62, MAT.glass, 1.33, 2.05, 3.25);
    cabSide.rotation.y = PI / 2;
    upper.add(cabSide);
    var cabStripe = rbox(1.44, 0.24, 1.64, 0.02, MAT.red, 0.62, 1.1, 3.3);
    upper.add(cabStripe);
    var beacon = cyl(0.07, 0.09, 0.14, MAT.ledAmber, 12, 0.62, 2.55, 3.0);
    upper.add(beacon);
    // 上车动力舱（左前）+ 排气管
    var hood = rbox(1.25, 0.95, 2.3, 0.08, MAT.graphite, -0.72, 1.35, 2.6);
    upper.add(hood);
    for (var vi = 0; vi < 6; vi++) {
      var vent = box(0.02, 0.6, 0.16, MAT.dark, -1.36, 1.35, 1.7 + vi * 0.3);
      upper.add(vent);
    }
    var exh = cyl(0.1, 0.1, 1.4, MAT.steelDark, 12, -0.95, 2.5, 1.55);
    upper.add(exh);
    var exhCap = cyl(0.12, 0.12, 0.08, MAT.dark, 12, -0.95, 3.22, 1.55);
    upper.add(exhCap);
    // 主卷扬
    var drum = cylX(0.52, 1.9, MAT.steelDark, 0, 1.15, -2.3, 24);
    upper.add(drum);
    [0, 0.7, -0.7].forEach(function (x) {
      var flange = cylX(0.62, 0.1, MAT.dark, x, 1.15, -2.3, 24);
      upper.add(flange);
    });
    var drumMotor = cylX(0.22, 0.55, MAT.red, -1.3, 1.15, -2.3, 16);
    upper.add(drumMotor);
    for (var gi = 0; gi < 9; gi++) {
      var groove = torus(0.53, 0.014, MAT.dark, 0, 1.15, -2.3);
      groove.rotation.y = PI / 2;
      groove.position.x = -0.72 + gi * 0.18;
      upper.add(groove);
    }

    /* --- 8 节 U 型主臂（展示部分伸出，前 4 节可见；展示比例 ~0.7） --- */
    var boomBase = new T.Group();
    boomBase.position.set(0, 1.25, 1.3);
    upper.add(boomBase);
    var BOOM_L = [8.0, 7.4, 6.8, 6.2],
      BOOM_W = [1.06, 0.92, 0.8, 0.7],
      BOOM_T = [0.94, 0.82, 0.72, 0.62];
    var BOOM_Z = [0, 6.4, 12.4, 18.0];
    for (var bi = 0; bi < 4; bi++) {
      var b = rbox(BOOM_W[bi], BOOM_T[bi], BOOM_L[bi], Math.min(BOOM_W[bi], BOOM_T[bi]) * 0.22, MAT.red);
      b.position.z = BOOM_Z[bi] + BOOM_L[bi] / 2;
      boomBase.add(b);
      if (bi < 2) {
        [-1, 1].forEach(function (sd) {
          var d = decal('SANY', 1.6, 0.26, { color: '#ffffff', scale: 0.76, italic: true });
          d.position.set(sd * (BOOM_W[bi] / 2 + 0.012), 0.02, BOOM_Z[bi] + BOOM_L[bi] * 0.55);
          d.rotation.y = (sd * PI) / 2;
          boomBase.add(d);
        });
      }
    }
    // 臂头滑轮组
    var headG = new T.Group();
    headG.position.z = BOOM_Z[3] + BOOM_L[3] - 0.3;
    boomBase.add(headG);
    var headBox = rbox(0.62, 0.55, 0.5, 0.06, MAT.red, 0, 0, 0.2);
    headG.add(headBox);
    var headSheave = torus(0.17, 0.06, MAT.steelDark, 0, 0, -0.1);
    headSheave.rotation.y = PI / 2;
    headG.add(headSheave);

    /* --- 双变幅油缸 --- */
    var luffL = actuator(4.4, 0.17, 0.09, MAT.dark, MAT.chrome);
    var luffR = actuator(4.4, 0.17, 0.09, MAT.dark, MAT.chrome);
    var boomAng = 58;
    var aimY = 1.25 + 5.0 * Math.sin(rad(boomAng)),
      aimZ = 1.3 + 5.0 * Math.cos(rad(boomAng));
    aimActuator(luffL, -0.78, 0.72, 3.9, -0.5, aimY - 0.35, aimZ + 0.3);
    aimActuator(luffR, 0.78, 0.72, 3.9, 0.5, aimY - 0.35, aimZ + 0.3);
    luffL.userData.push(0.12);
    luffR.userData.push(0.12);
    upper.add(luffL);
    upper.add(luffR);

    /* --- 吊钩组（随臂尖，保持铅垂） --- */
    var hookG = new T.Group();
    upper.add(hookG);
    var rope = cyl(0.022, 0.022, 1, MAT_ROPE, 6, 0, 0, 0);
    hookG.add(rope);
    var block = rbox(0.52, 0.95, 0.48, 0.07, MAT.yellow, 0, 0, 0);
    hookG.add(block);
    var sheave1 = torus(0.14, 0.05, MAT.steelDark, 0, 0.34, 0);
    sheave1.rotation.y = PI / 2;
    hookG.add(sheave1);
    var sheave2 = torus(0.14, 0.05, MAT.steelDark, 0, 0.34, 0.16);
    sheave2.rotation.y = PI / 2;
    hookG.add(sheave2);
    var hookStem = cyl(0.05, 0.05, 0.3, MAT.steelDark, 10, 0, -0.62, 0);
    hookG.add(hookStem);
    var hookCurve = torus(0.16, 0.055, MAT.steelDark, 0, -0.86, 0);
    hookG.add(hookCurve);
    var hookTip = cone(0.07, 0.18, MAT.steelDark, 10, 0.16, -0.8, 0);
    hookG.add(hookTip);

    var TL = BOOM_Z[3] + BOOM_L[3] - 0.4; // 臂尖到回转中心的臂上长度
    /* 动作：上车缓慢回转 + 主臂小幅变幅；
       吊钩组用「臂尖坐标 - 绳长」反算各部件位置，保证吊钩始终铅垂悬挂在臂尖下方 */
    function anim(t) {
      upper.rotation.y = Math.sin(t * 0.22) * 0.5;
      var ang = rad(boomAng) - Math.sin(t * 0.3) * rad(0.6);
      boomBase.rotation.x = -ang;
      var tipY = 1.25 + TL * Math.sin(ang),
        tipZ = 1.3 + TL * Math.cos(ang);
      hookG.position.set(0, tipY, tipZ);
      var len = Math.max(4, tipY - 2.6);
      rope.scale.y = len;
      rope.position.y = -len / 2 + 0.3;
      block.position.y = -len + 0.75;
      sheave1.position.y = -len + 1.1;
      sheave2.position.y = -len + 1.1;
      hookStem.position.y = -len + 0.14;
      hookCurve.position.y = -len - 0.1;
      hookTip.position.y = -len - 0.06;
    }

    root.updateMatrixWorld(true);
    hotWorld(hots, root, boomBase, 0, 0, BOOM_Z[0] + BOOM_L[0] * 0.5, 'U 型主臂', 'TELE BOOM');
    hotWorld(hots, root, boomBase, 0, 0.3, BOOM_Z[2] + BOOM_L[2] * 0.5, '臂节·伸出段', 'BOOM SEC.');
    hotWorld(hots, root, headG, 0, 0, -0.1, '臂头滑轮组', 'BOOM HEAD');
    hotWorld(hots, root, upper, 0.62, 1.9, 3.9, '上车操纵室', 'CABIN');
    hotWorld(hots, root, upper, 0, 1.5, -5.2, '配重·80t', 'COUNTERWEIGHT');
    hotWorld(hots, root, root, 3.62, 1.2, 4.7, '支腿·跨距 9m', 'OUTRIGGER');

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     三、SR315-S · 旋挖钻机
     履带底盘 / 桅杆 + 机锁钻杆 / 动力头 / 主卷扬 / 钻斗
     布局：车头朝 +Z；桅杆立在上车前部并前倾 5°，
     三层机锁钻杆（k1>k2>k3 嵌套方杆）竖直贯穿桅杆、顶部穿出桅顶，
     动力头（rotary）沿桅杆导轨进给升降，钻斗挂在钻杆下端。
     ============================================================ */
  F.register('drill', function () {
    var root = new T.Group();
    var hots = [];

    /* --- 履带底盘（左右） --- */
    /* 履带环取样（体育场形闭合路径）——与 models.js 中的实现相同，
       因 models3.js 需保持可独立加载，这里内联一份副本而非跨文件依赖 */
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
    var TR = 0.82,
      TC = 0.86,
      THL = 2.28; // 履带半径 / 高度中心 / 半长
    [-1.5, 1.5].forEach(function (cx) {
      var track = new T.Group();
      root.add(track);
      var frame = rbox(0.78, 0.46, 5.4, 0.1, MAT.graphite, cx, TC, 0);
      track.add(frame);
      var loop = trackLoop(THL, TR, 26);
      loop.forEach(function (p) {
        var pad = rbox(0.9, 0.12, 0.35, 0.025, MAT.rubber, cx, TC + p.y, p.z);
        pad.rotation.x = p.ang;
        track.add(pad);
        var gr = rbox(0.88, 0.05, 0.09, 0.012, MAT.dark, cx, TC + (p.y > 0 ? p.y + 0.085 : p.y - 0.085), p.z);
        gr.rotation.x = p.ang;
        track.add(gr);
      });
      var sprocket = cylX(0.58, 0.7, MAT.steelDark, cx, TC, THL, 20);
      track.add(sprocket);
      var idler = cylX(0.52, 0.62, MAT.steelDark, cx, TC, -THL, 20);
      track.add(idler);
      [-1.75, -0.9, 0, 0.9, 1.75].forEach(function (z) {
        var roller = cylX(0.22, 0.52, MAT.steel, cx, TC - TR + 0.22, z, 14);
        track.add(roller);
      });
      var motor = cylX(0.3, 0.5, MAT.dark, cx, TC, -THL - 0.35, 16);
      track.add(motor);
    });
    var carBody = rbox(2.55, 0.5, 3.4, 0.12, MAT.graphite, 0, TC + 0.32, 0);
    root.add(carBody);

    /* --- 上车结构 --- */
    var upper = new T.Group();
    upper.position.y = TC + 0.6;
    root.add(upper);
    var base = rbox(3.0, 0.45, 4.9, 0.1, MAT.offWhite, 0, 0.1, -0.15);
    upper.add(base);
    // 发动机罩（后）
    var hood = rbox(2.6, 1.05, 1.7, 0.12, MAT.offWhite, 0, 0.85, -1.6);
    upper.add(hood);
    var hoodTop = rbox(2.3, 0.08, 1.3, 0.03, MAT.graphite, 0, 1.4, -1.6);
    upper.add(hoodTop);
    for (var vi = 0; vi < 5; vi++) {
      var vent = box(0.02, 0.7, 0.18, MAT.dark, -1.32, 0.85, -1.15 + vi * 0.24);
      upper.add(vent);
    }
    var exh = cyl(0.08, 0.08, 1.1, MAT.steelDark, 12, 0.9, 1.75, -2.0);
    upper.add(exh);
    var exhCap = cyl(0.1, 0.1, 0.07, MAT.dark, 12, 0.9, 2.32, -2.0);
    upper.add(exhCap);
    // 配重
    var cw = rbox(2.7, 0.85, 0.5, 0.08, MAT.red, 0, 0.55, -2.65);
    upper.add(cw);
    var cwLogo = decal('SANY', 1.0, 0.26, { color: '#ffffff', scale: 0.78, italic: true });
    cwLogo.position.set(0, 0.55, -2.91);
    upper.add(cwLogo);
    // 驾驶室（右前）
    var cab = rbox(1.3, 1.4, 1.55, 0.09, MAT.graphite, 0.85, 1.3, 1.5);
    upper.add(cab);
    var cabGlass = plane(1.0, 0.7, MAT.glass, 0.85, 1.62, 2.29);
    upper.add(cabGlass);
    var cabSide = plane(1.05, 0.6, MAT.glass, 1.51, 1.58, 1.45);
    cabSide.rotation.y = PI / 2;
    upper.add(cabSide);
    var cabStripe = rbox(1.34, 0.22, 1.59, 0.02, MAT.red, 0.85, 0.75, 1.5);
    upper.add(cabStripe);
    var beacon = cyl(0.06, 0.08, 0.13, MAT.ledAmber, 12, 0.85, 2.08, 1.1);
    upper.add(beacon);
    // 主卷扬（驾驶室后）
    var drum = cylX(0.44, 1.5, MAT.steelDark, -0.35, 0.85, 0.35, 22);
    upper.add(drum);
    [-0.98, 0.28].forEach(function (x) {
      var flange = cylX(0.55, 0.09, MAT.dark, x, 0.85, 0.35, 22);
      upper.add(flange);
    });
    var drumMotor = cylX(0.2, 0.5, MAT.red, -1.25, 0.85, 0.35, 14);
    upper.add(drumMotor);
    for (var gi = 0; gi < 7; gi++) {
      var groove = torus(0.45, 0.013, MAT.dark, 0, 0.85, 0.35);
      groove.rotation.y = PI / 2;
      groove.position.x = -0.75 + gi * 0.16;
      upper.add(groove);
    }
    // 液压油箱
    var oilTank = rbox(0.9, 0.8, 1.1, 0.08, MAT.graphite, -0.95, 0.55, -0.75);
    upper.add(oilTank);

    /* --- 桅杆（前倾 5°；展示比例：15.5m → 11.5m） --- */
    var mast = new T.Group();
    mast.position.set(0, 0.35, 2.0);
    mast.rotation.x = rad(5);
    upper.add(mast);
    var MH = 11.5; // 桅杆高度
    [-0.62, 0.62].forEach(function (x) {
      var chord = rbox(0.3, MH, 0.36, 0.05, MAT.red, x, MH / 2 + 0.6, 0);
      mast.add(chord);
    });
    var web = rbox(1.55, MH - 1.6, 0.18, 0.04, MAT.redDeep, 0, MH / 2 + 0.6, -0.52);
    mast.add(web);
    for (var di = 0; di < 7; di++) {
      var step = (MH - 1.7) / 7;
      var y0 = 1.1 + di * step;
      limb(
        mast,
        [di % 2 ? 0.62 : -0.62, y0, 0.16],
        [di % 2 ? -0.62 : 0.62, y0 + step, 0.16],
        0.1,
        0.1,
        MAT.graphite,
        0.02
      );
    }
    [-0.33, 0.33].forEach(function (x) {
      var rail = rbox(0.1, MH - 1.2, 0.12, 0.02, MAT.steelDark, x, MH / 2 + 0.6, 0.24);
      mast.add(rail);
    });
    // 桅顶滑轮组
    var crown = rbox(1.55, 0.72, 0.95, 0.09, MAT.red, 0, MH + 0.95, 0);
    mast.add(crown);
    [-0.3, 0.3].forEach(function (x) {
      var sheave = torus(0.26, 0.08, MAT.steelDark, x, MH + 1.05, 0.18);
      sheave.rotation.y = PI / 2;
      mast.add(sheave);
    });
    var crownLamp = box(0.24, 0.12, 0.1, MAT.ledRed, 0, MH + 1.4, 0);
    mast.add(crownLamp);
    // 桅杆支撑油缸（左右）
    var mastL = actuator(4.6, 0.16, 0.08, MAT.dark, MAT.chrome);
    var mastR = actuator(4.6, 0.16, 0.08, MAT.dark, MAT.chrome);
    aimActuator(mastL, -0.85, 0.5, 0.9, -0.5, 5.0, 1.75);
    aimActuator(mastR, 0.85, 0.5, 0.9, 0.5, 5.0, 1.75);
    mastL.userData.push(0.1);
    mastR.userData.push(0.1);
    upper.add(mastL);
    upper.add(mastR);

    /* --- 进给 + 回转组：动力头 / 机锁钻杆 / 钻斗 --- */
    var feed = new T.Group();
    feed.position.set(0, 1.2, 0.62);
    mast.add(feed);
    var spin = new T.Group();
    feed.add(spin);
    // 机锁钻杆（三层方杆，竖直贯穿桅杆，顶部穿出桅顶）
    var k1 = rbox(0.52, 7.0, 0.52, 0.05, MAT.steel, 0, 6.0, 0);
    spin.add(k1);
    var k2 = rbox(0.44, 5.4, 0.44, 0.04, MAT.chrome, 0, 5.1, 0);
    spin.add(k2);
    var k3 = rbox(0.36, 4.0, 0.36, 0.03, MAT.steel, 0, 4.2, 0);
    spin.add(k3);
    var kHead = rbox(0.62, 0.5, 0.62, 0.05, MAT.steelDark, 0, 9.7, 0);
    spin.add(kHead);
    var kPin = cylX(0.07, 0.75, MAT.steelDark, 0, 9.7, 0, 12);
    spin.add(kPin);
    // 动力头
    var rotary = new T.Group();
    rotary.position.y = 4.0;
    feed.add(rotary);
    var rotBox = rbox(1.78, 0.85, 0.92, 0.09, MAT.graphite, 0, 0, -0.18);
    rotary.add(rotBox);
    var rotCover = rbox(1.7, 0.22, 0.8, 0.05, MAT.red, 0, 0.52, -0.18);
    rotary.add(rotCover);
    [-1.05, 1.05].forEach(function (x) {
      var motor = cylX(0.17, 0.52, MAT.offWhite, x, 0, -0.18, 16);
      rotary.add(motor);
      var mCap = cylX(0.09, 0.56, MAT.red, x, 0, -0.18, 12);
      rotary.add(mCap);
    });
    hose(
      mast,
      [
        [-0.9, 4.2, 0.4],
        [-0.75, 4.8, 1.3],
        [-0.4, 5.7, 1.15]
      ],
      0.045,
      MAT_HOSE_SOFT,
      20
    );
    hose(
      mast,
      [
        [0.9, 4.2, 0.4],
        [0.75, 4.8, 1.3],
        [0.4, 5.7, 1.15]
      ],
      0.045,
      MAT_HOSE_SOFT,
      20
    );
    // 钻斗（回转体）
    var bucket = new T.Group();
    bucket.position.y = 1.6;
    spin.add(bucket);
    var bTop = cyl(0.55, 0.55, 0.22, MAT.steelDark, 22, 0, 0.55, 0);
    bucket.add(bTop);
    var bBody = cyl(0.95, 0.95, 1.15, MAT.steelDark, 26, 0, -0.1, 0);
    bucket.add(bBody);
    var bBelt = torus(0.96, 0.05, MAT.red, 0, 0.3, 0);
    bucket.add(bBelt);
    var bDoor = rbox(0.9, 0.9, 0.1, 0.02, MAT.dark, 0.42, -0.1, 0.72);
    bucket.add(bDoor);
    for (var ti = 0; ti < 8; ti++) {
      var a = (ti / 8) * TAU;
      var tooth = cone(0.085, 0.26, MAT.chrome, 10, Math.cos(a) * 0.72, -0.78, Math.sin(a) * 0.72);
      bucket.add(tooth);
    }
    // 孔口（示意钻孔）
    var hole = cyl(1.0, 1.0, 0.05, MAT.dark, 26, 0, 0.025, 2.75);
    root.add(hole);
    var holeRing = torus(1.05, 0.06, MAT.rubber, 0, 0.05, 2.75);
    holeRing.rotation.x = PI / 2;
    root.add(holeRing);
    // 卷扬钢丝绳 → 桅顶
    hose(
      root,
      [
        [-0.35, TC + 1.45, 0.35],
        [-0.2, TC + 2.2, 1.5],
        [-0.3, 13.4, 2.95]
      ],
      0.032,
      MAT_ROPE,
      26
    );

    /* --- 动作：动力头回转 + 进给升降 + 卷扬 --- */
    function anim(t) {
      spin.rotation.y = t * 1.6;
      feed.position.y = 1.2 + Math.sin(t * 0.35) * 1.2;
      drum.rotation.x = t * 0.7;
    }

    root.updateMatrixWorld(true);
    hotWorld(hots, root, mast, 0, MH * 0.62, 0.1, '桅杆·高 25.4m', 'MAST');
    hotWorld(hots, root, rotary, 0, 0, -0.2, '动力头·315kN·m', 'ROTARY HEAD');
    hotWorld(hots, root, kHead, 0, 0, 0, '机锁钻杆', 'KELLY BAR');
    hotWorld(hots, root, bucket, 0, 0.4, 0, '钻斗·ø2500mm', 'AUGER BUCKET');
    hotWorld(hots, root, upper, -0.35, 1.3, 0.35, '主卷扬·380kN', 'MAIN WINCH');
    hotWorld(hots, root, upper, 0.85, 1.6, 1.9, '驾驶室', 'CABIN');

    return { root: root, hots: hots, anim: anim };
  });
})();

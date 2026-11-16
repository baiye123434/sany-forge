/* ============================================================
   SANY FORGE · 设备三维模型（二）
   agv    无人叉车 AGV
   vision 智能装配检测单元（机器视觉柔性装配岛）
   solar  TOPCon 双面双玻光伏组件 + 单轴跟踪支架
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
    profile = K.profile;
  var PI = Math.PI,
    TAU = PI * 2,
    rad = function (d) {
      return (d * PI) / 180;
    };

  // 局部材质
  var MAT_WOOD = new T.MeshStandardMaterial({ color: 0xb08a56, roughness: 0.92, metalness: 0.02 });
  var MAT_CARTON = new T.MeshStandardMaterial({ color: 0xc9a97c, roughness: 0.95, metalness: 0.0 });
  var MAT_CURTAIN = new T.MeshStandardMaterial({
    color: 0xff8a8a,
    emissive: 0xff2020,
    emissiveIntensity: 1.2,
    roughness: 0.4
  });
  var MAT_BELT = new T.MeshStandardMaterial({ color: 0x23282d, roughness: 0.82, metalness: 0.06 });
  var MAT_BLACKOUT = new T.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x7fd0ff,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.16,
    side: T.DoubleSide,
    blending: T.AdditiveBlending,
    depthWrite: false
  });
  var MAT_PANEL_GLASS = new T.MeshPhysicalMaterial({
    color: 0x8fb6d8,
    metalness: 0.05,
    roughness: 0.05,
    transparent: true,
    opacity: 0.24,
    envMapIntensity: 2.4,
    side: T.DoubleSide,
    depthWrite: false,
    clearcoat: 1,
    clearcoatRoughness: 0.03
  });

  /* ============================================================
     四、无人叉车 AGV（SA20LJS-S）
     布局：车头朝 +Z——前部为门架 + 货叉 + 托盘货物，
     后部为电池仓 / 显示屏 / 急停；激光雷达对角布置（左前右后），
     carriage 组整体升降模拟货叉起升。
     ============================================================ */
  F.register('agv', function () {
    var root = new T.Group();
    var hots = [];

    /* 底盘 + 车身 */
    var chassis = rbox(1.3, 0.32, 2.16, 0.06, MAT.graphite);
    chassis.position.y = 0.44;
    root.add(chassis);
    var body = rbox(1.34, 0.52, 2.02, 0.09, MAT.offWhite);
    body.position.y = 0.8;
    root.add(body);
    var stripe = rbox(1.36, 0.11, 1.94, 0.02, MAT.red);
    stripe.position.y = 0.62;
    root.add(stripe);
    var top = rbox(1.28, 0.14, 1.92, 0.06, MAT.white);
    top.position.y = 1.1;
    root.add(top);
    var deck = rbox(1.2, 0.04, 1.86, 0.02, MAT.alu);
    deck.position.y = 1.19;
    root.add(deck);
    // 车体标识
    var logoA = decal('SANY', 0.5, 0.16, { color: '#c8232c', scale: 0.82, italic: true });
    logoA.position.set(0.68, 0.9, -0.1);
    logoA.rotation.y = PI / 2;
    root.add(logoA);
    var logoB = decal('AGV  SA20LJS', 0.72, 0.14, { color: '#4a5057', scale: 0.46 });
    logoB.position.set(-0.68, 0.9, -0.1);
    logoB.rotation.y = -PI / 2;
    root.add(logoB);

    /* 电池仓 + 充电口 + 急停 */
    var batDoor = rbox(0.78, 0.44, 0.03, 0.01, MAT.aluDark);
    batDoor.position.set(0, 0.82, -1.02);
    root.add(batDoor);
    var batHandle = cylX(0.018, 0.24, MAT.steel, 0, 0.66, -1.05, 10);
    root.add(batHandle);
    var chargePort = cylZ(0.075, 0.06, MAT.ledBlue, 0.42, 0.5, -1.06, 18);
    root.add(chargePort);
    var estopBase = cyl(0.055, 0.055, 0.03, MAT.red, 18);
    estopBase.rotation.x = PI / 2;
    estopBase.position.set(-0.5, 0.98, -1.03);
    root.add(estopBase);
    var estop = cyl(0.062, 0.062, 0.045, MAT.redDeep, 18);
    estop.rotation.x = PI / 2;
    estop.position.set(-0.5, 0.98, -1.08);
    root.add(estop);

    /* 显示屏（后部，微倾） */
    var screen = new T.Group();
    screen.position.set(0.34, 0.86, -1.03);
    screen.rotation.x = -0.22;
    root.add(screen);
    screen.add(rbox(0.46, 0.3, 0.05, 0.012, MAT.graphite));
    var disp = box(0.38, 0.22, 0.008, MAT.screen);
    disp.position.z = 0.028;
    screen.add(disp);

    /* 状态灯带 */
    [-0.44, -0.28, -0.12, 0.04].forEach(function (x, i) {
      var led = box(0.07, 0.05, 0.02, i < 2 ? MAT.ledGreen : i === 2 ? MAT.ledAmber : MAT.ledRed);
      led.position.set(x, 1.14, -1.0);
      root.add(led);
    });

    /* 警示灯（顶部后侧） */
    var beaconPost = cyl(0.028, 0.028, 0.2, MAT.steelDark, 12);
    beaconPost.position.set(-0.52, 1.28, -0.86);
    root.add(beaconPost);
    var beaconBase = cyl(0.07, 0.07, 0.04, MAT.graphite, 16);
    beaconBase.position.set(-0.52, 1.4, -0.86);
    root.add(beaconBase);
    var beacon = cyl(0.09, 0.09, 0.13, MAT.ledAmber, 18);
    beacon.position.set(-0.52, 1.49, -0.86);
    root.add(beacon);
    // 天线
    [-0.2, 0.2].forEach(function (x) {
      var ant = cyl(0.012, 0.012, 0.4, MAT.dark, 8);
      ant.position.set(x, 1.36, -0.9);
      root.add(ant);
      var tip2 = sphere(0.02, MAT.dark);
      tip2.position.set(x, 1.56, -0.9);
      root.add(tip2);
    });

    /* 激光雷达（前后对角，统一 lidarG 组便于故障染色） */
    var lidarG = new T.Group();
    root.add(lidarG);
    [
      [-0.66, 0.66],
      [0.66, -0.62]
    ].forEach(function (p) {
      var tower = cyl(0.1, 0.11, 0.14, MAT.graphite, 22);
      tower.position.set(p[0], 1.27, p[1]);
      lidarG.add(tower);
      var band = cyl(0.104, 0.104, 0.05, MAT.dark, 22);
      band.position.set(p[0], 1.27, p[1]);
      lidarG.add(band);
      var glassRing = cyl(0.108, 0.108, 0.032, MAT.ledBlue, 22);
      glassRing.position.set(p[0], 1.27, p[1]);
      lidarG.add(glassRing);
      var cap = cyl(0.1, 0.08, 0.04, MAT.steelDark, 22);
      cap.position.set(p[0], 1.36, p[1]);
      lidarG.add(cap);
    });
    hots.push({ p: [-0.66, 1.44, 0.66], t: '激光雷达', s: 'LiDAR / SLAM', o: lidarG });

    /* 安全激光扫描仪（前下方） */
    var scanBody = box(0.5, 0.09, 0.12, MAT.graphite);
    scanBody.position.set(0, 0.34, 1.02);
    root.add(scanBody);
    var scanEye = box(0.42, 0.03, 0.02, MAT.ledRed);
    scanEye.position.set(0, 0.34, 1.09);
    root.add(scanEye);

    /* 行走轮 */
    var wheels = [];
    [-0.6, 0.6].forEach(function (x) {
      var tyre = cylX(0.24, 0.19, MAT.rubber, x, 0.24, -0.62, 26);
      root.add(tyre);
      wheels.push(tyre);
      var hub = cylX(0.12, 0.21, MAT.alu, x, 0.24, -0.62, 20);
      root.add(hub);
      wheels.push(hub);
      var spokes = cylX(0.155, 0.1, MAT.steelDark, x, 0.24, -0.62, 20);
      root.add(spokes);
      wheels.push(spokes);
    });
    [
      [-0.52, 0.78],
      [0.52, 0.78],
      [-0.5, -0.16],
      [0.5, -0.16]
    ].forEach(function (p) {
      var castor = cylX(0.1, 0.09, MAT.rubber, p[0], 0.11, p[1], 18);
      root.add(castor);
      var fork2 = box(0.05, 0.16, 0.14, MAT.steelDark);
      fork2.position.set(p[0], 0.2, p[1]);
      root.add(fork2);
    });

    /* 门架 */
    var mastG = new T.Group();
    root.add(mastG);
    [-0.6, 0.6].forEach(function (x) {
      var outer = rbox(0.13, 1.9, 0.24, 0.02, MAT.aluDark);
      outer.position.set(x, 1.12, 0.92);
      mastG.add(outer);
      var inner = rbox(0.1, 1.62, 0.17, 0.02, MAT.steel);
      inner.position.set(x, 1.0, 0.99);
      mastG.add(inner);
    });
    var mastTop = rbox(1.32, 0.12, 0.22, 0.03, MAT.aluDark);
    mastTop.position.set(0, 2.06, 0.92);
    mastG.add(mastTop);
    var mastMid = rbox(1.32, 0.09, 0.19, 0.02, MAT.aluDark);
    mastMid.position.set(0, 0.72, 0.92);
    mastG.add(mastMid);
    var mastBot = rbox(1.36, 0.14, 0.3, 0.03, MAT.steelDark);
    mastBot.position.set(0, 0.22, 0.92);
    mastG.add(mastBot);
    // 提升油缸 ×2 + 链条
    [-0.3, 0.3].forEach(function (x) {
      var liftCyl = cyl(0.055, 0.055, 1.55, MAT.steel, 20);
      liftCyl.position.set(x, 1.02, 0.99);
      mastG.add(liftCyl);
      var liftRod = cyl(0.03, 0.03, 0.5, MAT.chrome, 14);
      liftRod.position.set(x, 1.9, 0.99);
      mastG.add(liftRod);
      [-0.14, 0.14].forEach(function (d) {
        var chain = cyl(0.016, 0.016, 1.5, MAT.steelDark, 8);
        chain.position.set(x + d, 1.15, 0.86);
        mastG.add(chain);
      });
    });
    // 门架标识
    var mLbl = decal('SANY', 0.34, 0.11, { color: '#c8232c', scale: 0.8, italic: true });
    mLbl.position.set(0, 1.8, 0.81);
    mastG.add(mLbl);
    hots.push({ p: [0, 2.2, 0.92], t: '起升门架', s: 'LIFT MAST', o: mastG });

    /* 滑架 + 货叉 + 托盘货物（整体升降） */
    var carriage = new T.Group();
    carriage.position.y = 0;
    root.add(carriage);
    var carrier = rbox(1.26, 0.4, 0.14, 0.02, MAT.steelDark);
    carrier.position.set(0, 0.62, 1.06);
    carriage.add(carrier);
    var carrierFace = box(1.0, 0.24, 0.02, MAT.alu);
    carrierFace.position.set(0, 0.62, 1.14);
    carriage.add(carrierFace);
    [-0.36, 0.36].forEach(function (x) {
      var heel = rbox(0.16, 0.42, 0.06, 0.012, MAT.steelDark);
      heel.position.set(x, 0.46, 1.16);
      carriage.add(heel);
      var blade = rbox(0.16, 0.05, 1.06, 0.012, MAT.steelDark);
      blade.position.set(x, 0.26, 1.66);
      carriage.add(blade);
      var tipEdge = box(0.16, 0.02, 0.06, MAT.steel);
      tipEdge.position.set(x, 0.29, 2.17);
      carriage.add(tipEdge);
    });
    // 托盘 + 货物
    var pallet = new T.Group();
    pallet.position.set(0, 0.35, 1.4);
    carriage.add(pallet);
    for (var pj = 0; pj < 3; pj++) {
      var plank = box(1.06, 0.04, 0.13, MAT_WOOD);
      plank.position.set(0, 0.02, -0.42 + pj * 0.42);
      pallet.add(plank);
    }
    [-0.42, 0, 0.42].forEach(function (z) {
      var rail = box(1.06, 0.07, 0.11, MAT_WOOD);
      rail.position.set(0, -0.04, z);
      pallet.add(rail);
    });
    [
      [-0.48, -0.42],
      [0.48, -0.42],
      [-0.48, 0.42],
      [0.48, 0.42]
    ].forEach(function (p) {
      var block = box(0.11, 0.07, 0.1, MAT_WOOD);
      block.position.set(p[0], -0.07, p[1]);
      pallet.add(block);
    });
    var carton = rbox(0.94, 0.72, 0.84, 0.02, MAT_CARTON);
    carton.position.set(0, 0.42, 0);
    pallet.add(carton);
    var tape = box(0.96, 0.02, 0.1, MAT_WHITE_TAPE());
    tape.position.set(0, 0.79, 0);
    pallet.add(tape);
    var cartonLabel = decal('SANY · 精密件', 0.5, 0.16, { bg: '#f4f6f8', color: '#3c4247', scale: 0.42 });
    cartonLabel.position.set(0, 0.52, -0.425);
    cartonLabel.rotation.y = PI;
    pallet.add(cartonLabel);
    hots.push({ p: [0.62, 1.15, 1.6], t: '货叉与载货', s: 'FORK / PALLET', o: carriage });

    /* 动作：货叉升降 + 轮转 + 警示灯 */
    var carryY = 0;
    function anim(t) {
      carryY = 0.26 + (0.26 * (Math.sin(t * 0.7) + 1)) / 2;
      carriage.position.y = carryY;
      wheels.forEach(function (w) {
        w.rotation.x = t * 1.6;
      });
      beacon.rotation.y = t * 5.5;
      scanEye.material = Math.sin(t * 3) > 0 ? MAT.ledRed : MAT.dark;
    }
    /* 注意：MAT_WHITE_TAPE 是函数声明，靠「函数提升」才能在上方第 147 行提前调用；
       每次调用返回一个新材质实例（封箱胶带用） */
    function MAT_WHITE_TAPE() {
      return new T.MeshStandardMaterial({ color: 0xf0f2f4, roughness: 0.6 });
    }
    anim(0);

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     五、智能装配检测单元（机器视觉柔性装配岛）
     布局：铝型材龙门架跨在输送线上方，顶部滑台沿 X 往复；
     滑台下挂六轴臂（r1 基座→r6 法兰，关节 Group 嵌套），
     末端是 3D 结构光相机 + 投射光锥；工件随滚筒线进出检测位，
     两侧安全光幕、右侧控制柜。
     ============================================================ */
  F.register('vision', function () {
    var root = new T.Group();
    var hots = [];

    /* 龙门机架（铝型材） */
    var frame = new T.Group();
    root.add(frame);
    [
      [-1.2, -0.9],
      [1.2, -0.9],
      [-1.2, 0.9],
      [1.2, 0.9]
    ].forEach(function (p) {
      var col = profile(1.5, 0.09, 'y', MAT.alu);
      col.position.set(p[0], 0.75, p[1]);
      frame.add(col);
      var footPl = rbox(0.24, 0.03, 0.24, 0.01, MAT.steelDark);
      footPl.position.set(p[0], 0.015, p[1]);
      frame.add(footPl);
      var footBolt = cyl(0.022, 0.022, 0.06, MAT.steel, 10);
      footBolt.position.set(p[0], 0.03, p[1]);
      frame.add(footBolt);
    });
    [-0.9, 0.9].forEach(function (z) {
      var beam = profile(2.4, 0.09, 'x', MAT.alu);
      beam.position.set(0, 2.36, z);
      frame.add(beam);
    });
    [-1.2, 1.2].forEach(function (x) {
      var beam = profile(1.8, 0.09, 'z', MAT.alu);
      beam.position.set(x, 2.36, 0);
      frame.add(beam);
    });
    // 斜撑
    limb(frame, [-1.2, 1.58, -0.9], [-0.9, 2.31, -0.9], 0.06, 0.06, MAT.aluDark, 0.01);
    limb(frame, [1.2, 1.58, -0.9], [0.9, 2.31, -0.9], 0.06, 0.06, MAT.aluDark, 0.01);
    limb(frame, [-1.2, 1.58, 0.9], [-0.9, 2.31, 0.9], 0.06, 0.06, MAT.aluDark, 0.01);
    limb(frame, [1.2, 1.58, 0.9], [0.9, 2.31, 0.9], 0.06, 0.06, MAT.aluDark, 0.01);
    hots.push({ p: [1.2, 2.5, 0.9], t: '龙门机架', s: 'GANTRY FRAME', o: frame });

    /* 顶部导轨 + 滑台 */
    var railX = profile(2.5, 0.1, 'x', MAT.steel);
    railX.position.set(0, 2.25, 0);
    frame.add(railX);
    var slide = new T.Group();
    slide.position.set(0, 2.15, 0);
    frame.add(slide);
    slide.add(rbox(0.34, 0.17, 0.34, 0.02, MAT.steelDark));
    slide.add(rbox(0.24, 0.06, 0.4, 0.01, MAT.alu)); // 滑座

    /* 六轴机器臂（悬挂式，朝下作业） */
    var r1 = new T.Group();
    r1.position.set(0, -0.1, 0);
    slide.add(r1);
    r1.add(cyl(0.13, 0.14, 0.12, MAT.graphite, 24));
    var r1cap = cyl(0.115, 0.115, 0.05, MAT.red, 24);
    r1cap.position.y = 0.08;
    r1.add(r1cap);
    var r2 = new T.Group();
    r2.position.set(0, -0.06, 0);
    r1.add(r2);
    r2.add(cylX(0.1, 0.3, MAT.graphite, 0, 0, 0, 20));
    r2.add(cylX(0.11, 0.05, MAT.redDeep, 0.16, 0, 0, 20));
    r2.add(cylX(0.11, 0.05, MAT.redDeep, -0.16, 0, 0, 20));
    limb(r2, [0, 0, 0], [0, -0.5, 0.42], 0.16, 0.2, MAT.red, 0.035);
    var r3 = new T.Group();
    r3.position.set(0, -0.5, 0.42);
    r2.add(r3);
    r3.add(cylX(0.085, 0.24, MAT.graphite, 0, 0, 0, 18));
    limb(r3, [0, 0, 0], [0, -0.46, 0.3], 0.12, 0.15, MAT.red, 0.028);
    var r4 = new T.Group();
    r4.position.set(0, -0.46, 0.3);
    r3.add(r4);
    r4.add(cylX(0.07, 0.2, MAT.graphite, 0, 0, 0, 16));
    var r5 = new T.Group();
    r5.position.set(0, -0.13, 0.02);
    r4.add(r5);
    r5.add(cylX(0.062, 0.17, MAT.graphite, 0, 0, 0, 16));
    var r6 = new T.Group();
    r6.position.set(0, -0.13, 0);
    r5.add(r6);
    r6.add(cyl(0.055, 0.055, 0.05, MAT.steel, 18));

    /* 3D 视觉相机（结构光） */
    var cam = new T.Group();
    cam.position.set(0, -0.06, 0);
    r6.add(cam);
    cam.add(rbox(0.3, 0.13, 0.34, 0.02, MAT.graphite));
    cam.add(rbox(0.24, 0.02, 0.28, 0.01, MAT.dark));
    [-0.075, 0.075].forEach(function (x) {
      var lens = cyl(0.05, 0.055, 0.07, MAT.graphite, 20);
      lens.rotation.x = PI / 2;
      lens.position.set(x, -0.05, 0.17);
      cam.add(lens);
      var glassLens = cyl(0.042, 0.042, 0.012, MAT.ledBlue, 20);
      glassLens.rotation.x = PI / 2;
      glassLens.position.set(x, -0.05, 0.205);
      cam.add(glassLens);
    });
    var ringLight = torus(0.115, 0.018, MAT.ledWhite);
    ringLight.rotation.x = PI / 2;
    ringLight.position.set(0, -0.07, 0.17);
    cam.add(ringLight);
    // 投射光锥（结构光扫描范围）
    var coneBeam = new T.Mesh(new T.CylinderGeometry(0.02, 0.42, 1.1, 30, 1, true), MAT_BLACKOUT);
    coneBeam.position.set(0, -0.62, 0.24);
    cam.add(coneBeam);
    hots.push({ p: [0, -0.72, 0.62], t: '3D 视觉相机', s: '3D VISION SENSOR', o: cam });

    /* 输送线 */
    var conv = new T.Group();
    conv.position.set(0, 0, 0);
    root.add(conv);
    [-0.34, 0.34].forEach(function (z) {
      var side = profile(3.4, 0.08, 'x', MAT.aluDark);
      side.position.set(0, 0.66, z);
      conv.add(side);
    });
    var rollers = [];
    for (var i = 0; i < 15; i++) {
      var x = -1.4 + i * 0.2;
      var roll = cylX(0.055, 0.62, MAT.steel, x, 0.7, 0, 20);
      conv.add(roll);
      rollers.push(roll);
      var rollEnd1 = cylX(0.03, 0.04, MAT.graphite, -0.32, 0.7, 0, 12);
      rollEnd1.position.x = x - 0.33;
      conv.add(rollEnd1);
      var rollEnd2 = cylX(0.03, 0.04, MAT.graphite, 0.33, 0.7, 0, 12);
      rollEnd2.position.x = x + 0.33;
      conv.add(rollEnd2);
    }
    [
      [-1.5, -0.34],
      [1.5, -0.34],
      [-1.5, 0.34],
      [1.5, 0.34]
    ].forEach(function (p) {
      var leg = rbox(0.07, 0.64, 0.07, 0.015, MAT.graphite);
      leg.position.set(p[0], 0.32, p[1]);
      conv.add(leg);
      var legFoot = rbox(0.14, 0.03, 0.14, 0.01, MAT.steelDark);
      legFoot.position.set(p[0], 0.015, p[1]);
      conv.add(legFoot);
    });
    // 背光板（检测工位）
    var backLight = box(0.9, 0.02, 0.6, MAT.ledWhite);
    backLight.position.set(0, 0.68, 0);
    conv.add(backLight);
    hots.push({ p: [-1.5, 0.95, 0.34], t: '输送线', s: 'CONVEYOR', o: conv });

    /* 工件 + 定位夹具 */
    var work = new T.Group();
    work.position.set(0, 0.96, 0);
    conv.add(work);
    work.add(rbox(0.52, 0.3, 0.4, 0.03, MAT.alu));
    var wTop = rbox(0.44, 0.06, 0.32, 0.02, MAT.steelDark);
    wTop.position.y = 0.16;
    work.add(wTop);
    var wMid = rbox(0.2, 0.14, 0.2, 0.02, MAT.graphite);
    wMid.position.y = 0.24;
    work.add(wMid);
    [-0.16, 0.16].forEach(function (x) {
      var hole = cyl(0.035, 0.035, 0.02, MAT.dark, 16);
      hole.position.set(x, 0.16, 0);
      work.add(hole);
    });
    var wMark = decal('SANY', 0.2, 0.06, { color: '#c8232c', scale: 0.8, italic: true });
    wMark.position.set(0, 0.04, 0.202);
    work.add(wMark);
    var clampA = rbox(0.1, 0.16, 0.12, 0.02, MAT.steelDark);
    clampA.position.set(-0.4, 0.86, 0);
    conv.add(clampA);
    var clampB = rbox(0.1, 0.16, 0.12, 0.02, MAT.steelDark);
    clampB.position.set(0.4, 0.86, 0);
    conv.add(clampB);
    hots.push({ p: [0, 1.3, 0], t: '待检工件', s: 'WORKPIECE', o: work });

    /* 安全光幕 */
    [-1.05, 1.05].forEach(function (x) {
      var post = rbox(0.06, 1.9, 0.06, 0.012, MAT.aluDark);
      post.position.set(x, 0.95, 0.55);
      conv.add(post);
      for (var s = 0; s < 8; s++) {
        var seg = box(0.02, 0.055, 0.02, MAT_CURTAIN);
        seg.position.set(x - (x > 0 ? 0.035 : -0.035), 0.3 + s * 0.2, 0.55);
        conv.add(seg);
      }
    });

    /* 控制柜 */
    var cab = new T.Group();
    cab.position.set(1.86, 0, -0.72);
    root.add(cab);
    cab.add(rbox(0.62, 1.3, 0.52, 0.04, MAT.graphite));
    var cScreen = rbox(0.44, 0.3, 0.02, 0.01, MAT.screen);
    cScreen.position.set(0, 0.36, 0.27);
    cab.add(cScreen);
    var cLeds = [MAT.ledGreen, MAT.ledAmber, MAT.ledBlue];
    cLeds.forEach(function (lm, li) {
      var led = cyl(0.022, 0.022, 0.02, lm, 12);
      led.rotation.x = PI / 2;
      led.position.set(-0.16 + li * 0.16, 0.11, 0.27);
      cab.add(led);
    });
    for (var vs = 0; vs < 7; vs++) {
      var vslot = box(0.46, 0.028, 0.02, MAT.dark);
      vslot.position.set(0, -0.08 - vs * 0.055, 0.27);
      cab.add(vslot);
    }
    var cabFoot = rbox(0.68, 0.06, 0.58, 0.02, MAT.steelDark);
    cabFoot.position.y = -0.68;
    cab.add(cabFoot);
    hose(
      root,
      [
        [1.7, 0.5, -0.72],
        [1.3, 0.9, -0.4],
        [0.7, 1.35, -0.15],
        [0.2, 1.5, -0.05]
      ],
      0.032,
      MAT.dark,
      26
    );
    hots.push({ p: [1.86, 1.5, -0.72], t: '控制柜', s: 'CONTROL CABINET', o: cab });

    /* 动作：滑台往复扫描 + 滚筒转动 + 光幕闪烁 */
    function anim(t) {
      slide.position.x = 0.72 * Math.sin(t * 0.55);
      r2.rotation.x = -0.16 + 0.12 * Math.sin(t * 0.8);
      r3.rotation.x = 0.5 + 0.2 * Math.sin(t * 1.0 + 0.6);
      r4.rotation.y = 0.3 * Math.sin(t * 0.7);
      r5.rotation.x = 0.2 * Math.sin(t * 1.4);
      r6.rotation.y = 0.5 * Math.sin(t * 0.9);
      rollers.forEach(function (rr) {
        rr.rotation.x = t * 2.4;
      });
      var pulse = 0.75 + 0.5 * Math.abs(Math.sin(t * 1.6));
      MAT_CURTAIN.emissiveIntensity = pulse;
      MAT_BLACKOUT.opacity = 0.13 + 0.05 * Math.sin(t * 2.2);
    }
    anim(0);

    return { root: root, hots: hots, anim: anim };
  });

  /* ============================================================
     六、TOPCon 双面双玻光伏组件 + 单轴跟踪支架
     布局：两根混凝土基础 + 立柱支撑扭矩管（tracker 组，绕 Z 俯仰跟踪），
     檩条托住一块竖装组件；地面另有两块平放待装组件（垫木），
     右侧组串式逆变器柜（柜底贴地，电缆沿立柱接到组件）。
     ============================================================ */
  F.register('solar', function () {
    var root = new T.Group();
    var hots = [];

    /** 电池片阵列纹理（细栅 + 主栅），6 列 × 20 行 */
    function cellTexture() {
      var c = document.createElement('canvas');
      c.width = 1024;
      c.height = 480;
      var g = c.getContext('2d');
      g.fillStyle = '#0c1322';
      g.fillRect(0, 0, 1024, 480);
      var cols = 6,
        rows = 20,
        cw = 1024 / cols,
        ch = 480 / rows;
      for (var i = 0; i < cols; i++) {
        for (var j = 0; j < rows; j++) {
          var x = i * cw,
            y = j * ch;
          var grd = g.createLinearGradient(x, y, x + cw, y + ch);
          grd.addColorStop(0, '#1b2c4e');
          grd.addColorStop(0.5, '#16233f');
          grd.addColorStop(1, '#101c33');
          g.fillStyle = grd;
          g.fillRect(x + 1.6, y + 1.6, cw - 3.2, ch - 3.2);
          g.strokeStyle = 'rgba(206,220,238,0.5)';
          g.lineWidth = 1.1;
          for (var k = 1; k <= 5; k++) {
            var yy = y + (ch * k) / 6;
            g.beginPath();
            g.moveTo(x + 3, yy);
            g.lineTo(x + cw - 3, yy);
            g.stroke();
          }
          g.strokeStyle = 'rgba(232,240,250,0.9)';
          g.lineWidth = 2.6;
          g.beginPath();
          g.moveTo(x + cw * 0.32, y + 2);
          g.lineTo(x + cw * 0.32, y + ch - 2);
          g.stroke();
          g.beginPath();
          g.moveTo(x + cw * 0.68, y + 2);
          g.lineTo(x + cw * 0.68, y + ch - 2);
          g.stroke();
        }
      }
      var t = new T.CanvasTexture(c);
      t.encoding = T.sRGBEncoding;
      t.anisotropy = 8;
      return t;
    }

    /** 单块组件：2.28m × 1.134m，法线朝 +Z */
    function buildPanel() {
      var p = new T.Group();
      var W = 2.28,
        H = 1.134,
        TH = 0.035;
      var fTop = box(W, 0.03, TH, MAT.alu);
      fTop.position.set(0, H / 2 - 0.015, 0);
      p.add(fTop);
      var fBot = box(W, 0.03, TH, MAT.alu);
      fBot.position.set(0, -H / 2 + 0.015, 0);
      p.add(fBot);
      var fL = box(0.03, H - 0.06, TH, MAT.alu);
      fL.position.set(-W / 2 + 0.015, 0, 0);
      p.add(fL);
      var fR = box(0.03, H - 0.06, TH, MAT.alu);
      fR.position.set(W / 2 - 0.015, 0, 0);
      p.add(fR);
      // 前后玻璃
      var front = box(W - 0.05, H - 0.05, 0.012, MAT_PANEL_GLASS);
      front.position.z = 0.011;
      p.add(front);
      var backG = box(W - 0.05, H - 0.05, 0.01, MAT.offWhite);
      backG.position.z = -0.011;
      p.add(backG);
      // 电池片阵列
      var cells = new T.Mesh(
        new T.PlaneGeometry(W - 0.1, H - 0.09),
        new T.MeshStandardMaterial({
          map: cellTexture(),
          roughness: 0.26,
          metalness: 0.42,
          envMapIntensity: 1.4
        })
      );
      cells.position.z = 0.004;
      p.add(cells);
      // 汇流条
      for (var r = 0; r < 5; r++) {
        var bus = box(W - 0.12, 0.016, 0.004, MAT.chrome);
        bus.position.set(0, -H / 2 + 0.1 + r * 0.234, 0.008);
        p.add(bus);
      }
      // 接线盒 + 线缆
      var jb = rbox(0.2, 0.13, 0.05, 0.012, MAT.graphite);
      jb.position.set(0, 0, -0.05);
      p.add(jb);
      var jb2 = rbox(0.09, 0.05, 0.02, 0.006, MAT.dark);
      jb2.position.set(-0.3, 0, -0.05);
      p.add(jb2);
      jb2.rotation.x = PI;
      var jb3 = rbox(0.09, 0.05, 0.02, 0.006, MAT.dark);
      jb3.position.set(0.3, 0, -0.05);
      p.add(jb3);
      jb3.rotation.x = PI;
      return p;
    }

    /* 跟踪支架基础（静止部分） */
    var base = new T.Group();
    root.add(base);
    [-0.9, 0.9].forEach(function (x) {
      var block = rbox(0.5, 0.28, 0.5, 0.03, MAT.offWhite);
      block.position.set(x, 0.14, 0);
      base.add(block);
      var blockTop = rbox(0.34, 0.06, 0.34, 0.02, MAT.steelDark);
      blockTop.position.set(x, 0.3, 0);
      base.add(blockTop);
      var post = rbox(0.14, 0.95, 0.14, 0.02, MAT.aluDark);
      post.position.set(x, 0.78, 0);
      base.add(post);
      var brace = limb(base, [x, 0.32, 0], [x, 0.9, 0.42], 0.07, 0.07, MAT.aluDark, 0.012);
      var brace2 = limb(base, [x, 0.32, 0], [x, 0.9, -0.42], 0.07, 0.07, MAT.aluDark, 0.012);
      void brace;
      void brace2;
    });
    var pillar = rbox(1.9, 0.14, 0.14, 0.02, MAT.aluDark);
    pillar.position.set(0, 0.78, 0);
    base.add(pillar);
    // 驱动电机 | 减速机
    var motor = cylX(0.11, 0.3, MAT.graphite, 1.05, 0.78, 0, 20);
    base.add(motor);
    var gearbox = rbox(0.18, 0.2, 0.18, 0.02, MAT.steelDark);
    gearbox.position.set(0.88, 0.78, 0);
    base.add(gearbox);

    /* 跟踪转动部分（组件 + 扭矩管 + 檩条） */
    var tracker = new T.Group();
    tracker.position.set(0, 1.26, 0);
    root.add(tracker);
    var tube = cylX(0.075, 2.0, MAT.steel, 0, 0, 0, 20);
    tracker.add(tube);
    // 檩条（沿 Z 向，托住组件背面）+ 压块
    [-0.76, 0.76].forEach(function (x) {
      var purlin = box(0.07, 0.05, 1.14, MAT.alu);
      purlin.position.set(x, 0.105, 0);
      tracker.add(purlin);
      var clamp = rbox(0.1, 0.11, 0.1, 0.014, MAT.steelDark);
      clamp.position.set(x, 0.05, 0);
      tracker.add(clamp);
    });
    // 扭矩管与檩条的连接支耳
    [-0.76, 0.76].forEach(function (x) {
      var ear = rbox(0.06, 0.12, 0.08, 0.012, MAT.steelDark);
      ear.position.set(x, 0.02, 0);
      tracker.add(ear);
    });
    var mount = new T.Group();
    mount.rotation.x = -PI / 2;
    tracker.add(mount);
    var panelA = buildPanel();
    panelA.position.set(0, 0, 0.13);
    mount.add(panelA);

    /* 地面平放待装组件（两台叠放 + 垫木） */
    [0.06, 0.135].forEach(function (y, si) {
      var flat = buildPanel();
      flat.rotation.x = -PI / 2;
      flat.position.set(0, y, -1.55 + si * 0.02);
      root.add(flat);
    });
    [-0.9, 0, 0.9].forEach(function (x) {
      var dunnage = box(0.1, 0.05, 1.05, MAT_WOOD);
      dunnage.position.set(x, 0.026, -1.55);
      root.add(dunnage);
    });
    hots.push({ p: [0, 1.9, 0.75], t: 'TOPCon 双面双玻组件', s: '625W / 22.4%', o: panelA });

    /* 逆变器柜（底部贴地） */
    var inv = new T.Group();
    inv.position.set(1.95, 0.46, 0.75);
    root.add(inv);
    inv.add(rbox(0.56, 0.82, 0.3, 0.03, MAT.offWhite));
    for (var fin = 0; fin < 10; fin++) {
      var f2 = box(0.5, 0.02, 0.06, MAT.aluDark);
      f2.position.set(0, 0.36 - fin * 0.055, -0.16);
      inv.add(f2);
    }
    var invScreen = rbox(0.26, 0.16, 0.02, 0.01, MAT.screen);
    invScreen.position.set(-0.1, 0.12, 0.16);
    inv.add(invScreen);
    var invLed = cyl(0.022, 0.022, 0.02, MAT.ledGreen, 12);
    invLed.rotation.x = PI / 2;
    invLed.position.set(0.16, 0.12, 0.16);
    inv.add(invLed);
    var invFoot = rbox(0.62, 0.05, 0.36, 0.02, MAT.steelDark);
    invFoot.position.y = -0.44;
    inv.add(invFoot);
    var invLabel = decal('SANY  SOLAR', 0.34, 0.1, { color: '#c8232c', scale: 0.5 });
    invLabel.position.set(-0.1, -0.16, 0.152);
    inv.add(invLabel);
    hose(
      root,
      [
        [1.9, 0.96, 0.55],
        [1.4, 1.25, 0.5],
        [0.7, 1.45, 0.4],
        [0.1, 1.45, 0.3]
      ],
      0.026,
      MAT.dark,
      26
    );
    hots.push({ p: [1.95, 1.41, 0.9], t: '组串式逆变器', s: 'STRING INVERTER', o: inv });

    /* 动作：单轴跟踪缓慢俯仰 */
    function anim(t) {
      tracker.rotation.z = 0.16 * Math.sin(t * 0.32);
      invLed.material = Math.sin(t * 2.4) > -0.3 ? MAT.ledGreen : MAT.dark;
    }
    anim(0);

    return { root: root, hots: hots, anim: anim };
  });
})();

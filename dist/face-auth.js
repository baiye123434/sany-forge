/* 本机摄像头身份核验：真实模型采样，返回证据交由服务端核对账号与权限。 */
(function () {
  'use strict';

  const scriptUrl = document.currentScript?.src || new URL('face-auth.js', document.baseURI).href;
  const modelUrl = new URL('vendor/face-models', scriptUrl).href;
  const STEP_COUNT = 3;
  const STABLE_FRAMES = 4;
  const STABLE_MILLISECONDS = 650;
  let modelLoading = null;
  let activeRun = null;

  function faceError(message, code = 'FACE_ERROR') {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function abortError() {
    return new DOMException('已取消人脸验证。', 'AbortError');
  }

  function checkRun(run) {
    if (run.controller.signal.aborted) throw run.controller.signal.reason || abortError();
  }

  /* 模型加载或浏览器权限弹窗都可能较慢；取消时立即结束业务等待。 */
  function interruptible(promise, run) {
    checkRun(run);
    return new Promise((resolve, reject) => {
      const signal = run.controller.signal;
      const cancel = () => {
        signal.removeEventListener('abort', cancel);
        reject(signal.reason || abortError());
      };
      signal.addEventListener('abort', cancel, { once: true });
      Promise.resolve(promise).then(
        (value) => { signal.removeEventListener('abort', cancel); resolve(value); },
        (error) => { signal.removeEventListener('abort', cancel); reject(error); },
      );
    });
  }

  function wait(ms, run) {
    return interruptible(new Promise((resolve) => setTimeout(resolve, ms)), run);
  }

  function cleanup(run) {
    clearTimeout(run.timeout);
    run.finished = true;
    if (run.stream) {
      run.stream.getTracks().forEach((track) => track.stop());
      if (run.video.srcObject === run.stream) {
        run.video.pause();
        run.video.srcObject = null;
      }
    }
    if (activeRun === run) activeRun = null;
  }

  function stop() {
    if (!activeRun) return;
    const run = activeRun;
    run.controller.abort(abortError());
    cleanup(run);
  }

  function status(run, message, detail = {}) {
    if (run.controller.signal.aborted) return;
    const state = {
      phase: 'capture',
      step: run.samples.length,
      total: STEP_COUNT,
      direction: run.directions[run.samples.length] || 'complete',
      progress: run.samples.length / STEP_COUNT,
      remainingSeconds: Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000)),
      ...detail,
    };
    if (typeof run.onStatus === 'function') {
      try { run.onStatus(message, state); } catch { /* 展示层异常不改变身份核验结果。 */ }
    }
  }

  async function loadModels() {
    const api = window.faceapi;
    if (!api?.nets?.tinyFaceDetector || !api?.nets?.faceLandmark68Net || !api?.nets?.faceRecognitionNet) {
      throw faceError('本地人脸识别组件缺失，请重新安装完整软件。', 'MODEL_MISSING');
    }
    if (!modelLoading) {
      modelLoading = (async () => {
        /*
         * 优先使用本地 WebGL；不支持时使用同包内 CPU 后端。
         * 不选择需要额外远程二进制文件的 WASM 后端，也没有模拟识别分支。
         */
        let backendReady = false;
        try { backendReady = await api.tf.setBackend('webgl'); } catch { /* 继续使用真实 CPU 推理。 */ }
        if (!backendReady) await api.tf.setBackend('cpu');
        await api.tf.ready();
        await Promise.all([
          api.nets.tinyFaceDetector.loadFromUri(modelUrl),
          api.nets.faceLandmark68Net.loadFromUri(modelUrl),
          api.nets.faceRecognitionNet.loadFromUri(modelUrl),
        ]);
      })().catch(() => {
        modelLoading = null;
        throw faceError('本地人脸模型加载失败，请检查软件资源是否完整后重试。', 'MODEL_LOAD_FAILED');
      });
    }
    await modelLoading;
    return api;
  }

  function cameraError(error) {
    const messages = {
      NotAllowedError: '摄像头权限未开启，请在系统或浏览器中允许访问后重试。',
      PermissionDeniedError: '摄像头权限未开启，请允许访问后重试。',
      NotFoundError: '未检测到摄像头，请连接摄像头后重试。',
      DevicesNotFoundError: '未检测到摄像头，请连接摄像头后重试。',
      NotReadableError: '摄像头被其他程序占用或无法读取，请关闭占用程序后重试。',
      TrackStartError: '摄像头被其他程序占用，请关闭占用程序后重试。',
      OverconstrainedError: '摄像头不支持当前采集设置，请换用其他摄像头。',
      SecurityError: '当前页面不允许使用摄像头，请从配套桌面软件或本机服务打开。',
    };
    return faceError(messages[error.name] || '无法打开摄像头，请检查设备连接和权限后重试。', 'CAMERA_FAILED');
  }

  async function openCamera(run) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw faceError('请使用桌面软件、localhost 本机服务或 HTTPS 页面进行人脸验证。', 'CAMERA_UNAVAILABLE');
    }
    const request = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 } },
    }).then((stream) => {
      /*
       * 浏览器的权限弹窗无法用 AbortController 直接取消。
       * 若用户取消流程后才允许摄像头，立刻停止迟到的流，避免设备留在开启状态。
       */
      if (run.controller.signal.aborted || run.finished) {
        stream.getTracks().forEach((track) => track.stop());
        throw run.controller.signal.reason || abortError();
      }
      run.stream = stream;
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
        if (!run.finished && !run.controller.signal.aborted) {
          run.controller.abort(faceError('摄像头连接已断开，请重新连接后验证。', 'CAMERA_DISCONNECTED'));
          cleanup(run);
        }
      }, { once: true }));
      return stream;
    }).catch((error) => {
      if (run.controller.signal.aborted) throw run.controller.signal.reason || abortError();
      throw cameraError(error);
    });
    const stream = await interruptible(request, run);
    checkRun(run);
    run.video.muted = true;
    run.video.autoplay = true;
    run.video.playsInline = true;
    run.video.srcObject = stream;
    await interruptible(run.video.play(), run);
    while (run.video.readyState < 2 || !run.video.videoWidth) await wait(80, run);
  }

  const pointMean = (points) => ({
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
  });

  /*
   * 1.7.15 的 angle.yaw 实际是未归一化像素差，不能直接用于服务端 0.17 阈值。
   * 这里将鼻尖到双眼中点的偏移投影到眼睛轴，再除以眼距：
   * 原始摄像头画面里本人左转时鼻尖向图像右侧移动，故取负号。
   * 此 yaw 是无量纲偏转指标，不是角度；预览可通过 CSS 镜像，不改变采样坐标。
   */
  function measurePose(result) {
    const leftEye = pointMean(result.landmarks.getLeftEye());
    const rightEye = pointMean(result.landmarks.getRightEye());
    const [firstEye, secondEye] = [leftEye, rightEye].sort((a, b) => a.x - b.x);
    const dx = secondEye.x - firstEye.x;
    const dy = secondEye.y - firstEye.y;
    const eyeSpan = Math.hypot(dx, dy);
    const nose = result.landmarks.positions[30];
    if (!nose || eyeSpan < 12) return null;
    const center = { x: (firstEye.x + secondEye.x) / 2, y: (firstEye.y + secondEye.y) / 2 };
    const projection = ((nose.x - center.x) * dx + (nose.y - center.y) * dy) / eyeSpan;
    return { yaw: -projection / eyeSpan, roll: Math.atan2(dy, dx) };
  }

  function inspectResult(results, run, api) {
    if (results.length === 0) return { message: '未检测到清晰人脸，请面向摄像头并保持光线充足。' };
    if (results.length !== 1) return { message: '画面中有多张人脸，请仅由当前账号本人进行验证。' };
    const result = results[0];
    const box = result.detection.box;
    const width = run.video.videoWidth;
    const height = run.video.videoHeight;
    if (result.detection.score < 0.65) return { message: '人脸不够清晰，请改善光线并保持稳定。' };
    if (box.width < width * 0.18) return { message: '请靠近一点，让面部清晰显示在画面中。' };
    if (box.width > width * 0.85 || box.x < 0 || box.y < 0 || box.x + box.width > width || box.y + box.height > height) {
      return { message: '请稍微后退，将完整面部放入画面。' };
    }
    const pose = measurePose(result);
    if (!pose || !Number.isFinite(pose.yaw)) return { message: '无法稳定定位五官，请调整光线并看向摄像头。' };
    if (Math.abs(pose.roll) > 0.35) return { message: '请保持头部端正，避免向肩膀方向歪头。' };
    if (Math.abs(pose.yaw) > 0.6) return { message: '转头幅度较大，请稍微转回一些并让双眼保持可见。' };
    const vector = Array.from(result.descriptor);
    if (vector.length !== 128 || vector.some((value) => !Number.isFinite(value) || Math.abs(value) > 3)) {
      throw faceError('本次人脸特征无效，请重新验证。', 'INVALID_DESCRIPTOR');
    }
    if (run.samples[0] && api.euclideanDistance(vector, run.samples[0].descriptor) > 0.46) {
      return { message: '当前人脸与正面采集不一致，请保持同一人完成动作。' };
    }
    return { vector, yaw: pose.yaw, center: { x: (box.x + box.width / 2) / width, y: (box.y + box.height / 2) / height } };
  }

  function directionPrompt(direction) {
    if (direction === 'front') return '请正视摄像头，保持头部端正。';
    return direction === 'left' ? '请缓慢向您自己的左侧转头，双眼保持可见。' : '请缓慢向您自己的右侧转头，双眼保持可见。';
  }

  function poseMatches(direction, yaw) {
    if (direction === 'front') return Math.abs(yaw) <= 0.11;
    return direction === 'left' ? yaw <= -0.2 : yaw >= 0.2;
  }

  async function captureStep(run, api, direction) {
    let stable = [];
    let stableSince = 0;
    status(run, directionPrompt(direction));
    while (true) {
      checkRun(run);
      const results = await interruptible(
        api.detectAllFaces(run.video, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.55 }))
          .withFaceLandmarks().withFaceDescriptors(),
        run,
      );
      checkRun(run);
      const observed = inspectResult(results, run, api);
      const previous = stable[stable.length - 1];
      const still = !previous || (
        !observed.message
        && api.euclideanDistance(previous.vector, observed.vector) <= 0.22
        && Math.hypot(previous.center.x - observed.center.x, previous.center.y - observed.center.y) <= 0.08
      );
      if (observed.message || !poseMatches(direction, observed.yaw) || !still) {
        stable = [];
        stableSince = 0;
        status(run, observed.message || (!still ? '请放慢动作，并在提示姿势下保持片刻。' : directionPrompt(direction)));
      } else {
        if (!stable.length) stableSince = Date.now();
        stable.push(observed);
        if (stable.length > 6) stable.shift();
        const progress = Math.min(stable.length / STABLE_FRAMES, (Date.now() - stableSince) / STABLE_MILLISECONDS, 1);
        status(run, '姿势正确，请保持片刻，正在采集。', {
          progress: (run.samples.length + progress) / STEP_COUNT,
          stableFrames: stable.length,
        });
        if (stable.length >= STABLE_FRAMES && Date.now() - stableSince >= STABLE_MILLISECONDS) {
          /* 多帧均值降低单帧抖动，仍然全部来自真实模型计算。 */
          return {
            descriptor: Array.from({ length: 128 }, (_, index) => stable.reduce((sum, frame) => sum + frame.vector[index], 0) / stable.length),
            yaw: stable.reduce((sum, frame) => sum + frame.yaw, 0) / stable.length,
          };
        }
      }
      await wait(140, run);
    }
  }

  async function authenticate(challenge, options = {}) {
    stop();
    if (!challenge || typeof challenge.challenge !== 'string' || !Array.isArray(challenge.turns)
      || challenge.turns.length !== 2 || new Set(challenge.turns).size !== 2
      || challenge.turns.some((turn) => !['left', 'right'].includes(turn))) {
      throw faceError('身份验证挑战无效，请重新输入账号密码。', 'INVALID_CHALLENGE');
    }
    if (!(options.video instanceof HTMLVideoElement)) throw faceError('缺少摄像头预览区域。', 'VIDEO_MISSING');
    if (challenge.enroll && options.consent !== true) {
      throw faceError('首次录入前，请先同意在本机保存人脸特征用于本人验证。', 'CONSENT_REQUIRED');
    }
    const seconds = Number(challenge.expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) throw faceError('身份验证挑战已过期，请重新登录。', 'INVALID_CHALLENGE');
    const run = {
      controller: new AbortController(), stream: null, video: options.video, onStatus: options.onStatus,
      samples: [], directions: ['front', ...challenge.turns], finished: false,
      deadline: Date.now() + Math.min(120, seconds) * 1000,
    };
    activeRun = run;
    run.timeout = setTimeout(() => {
      run.controller.abort(faceError('人脸验证已超时，请重新输入账号密码后再试。', 'FACE_TIMEOUT'));
      cleanup(run);
    }, Math.min(120, seconds) * 1000);
    try {
      status(run, '正在加载本地人脸模型，首次使用可能需要片刻。', { phase: 'loading' });
      const api = await interruptible(loadModels(), run);
      checkRun(run);
      status(run, '请允许使用摄像头，画面只在本机处理。', { phase: 'camera' });
      await openCamera(run);
      for (const direction of run.directions) {
        const sample = await captureStep(run, api, direction);
        run.samples.push(sample);
        status(run, `已完成 ${run.samples.length} / ${STEP_COUNT} 个动作。`, { phase: 'step-complete' });
        if (run.samples.length < STEP_COUNT) await wait(300, run);
      }
      checkRun(run);
      status(run, '采集完成，正在等待账号核验。', { phase: 'complete', progress: 1, step: STEP_COUNT });
      return { samples: run.samples, consent: options.consent === true };
    } catch (error) {
      if (run.controller.signal.aborted) throw run.controller.signal.reason || abortError();
      if (error.code || error.name === 'AbortError') throw error;
      throw faceError('人脸采集失败，请重新打开摄像头后重试。', 'CAPTURE_FAILED');
    } finally {
      cleanup(run);
    }
  }

  window.addEventListener('pagehide', stop);
  window.SanyFace = Object.freeze({ authenticate, stop });
})();

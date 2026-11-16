# 本地人脸识别资源

本目录用于参赛作品的离线人脸特征匹配；摄像头画面在当前设备计算，不需要调用第三方识别服务。

## 上游与版本

- 作者官方仓库：[vladmandic/face-api](https://github.com/vladmandic/face-api)
- npm 包：`@vladmandic/face-api`，版本 `1.7.15`
- 固定源码提交：`189226d63aabb48cb40776fd1c453ebc0fa722f1`
- 浏览器资源：上游 `dist/face-api.js`，IIFE 版本，自带 TensorFlow.js，提供全局 `faceapi`
- 模型资源：同一提交的 `model/` 目录
- 许可证：MIT，原文保存在上一级 `face-api.LICENSE.txt`
- 包内 TensorFlow.js 版本为 `4.22.0`，另附作者官方仓库的 Apache 2.0 许可证 `face-api.tfjs.LICENSE.txt`；上游浏览器包未改写或再次压缩
- 官方仓库在 2025 年 2 月 5 日归档，因此这里固定版本，不自动跟随远程更新

## 模型

| API | 清单 | 用途 |
| --- | --- | --- |
| `faceapi.nets.tinyFaceDetector` | `tiny_face_detector_model-weights_manifest.json` | 检测人脸位置 |
| `faceapi.nets.faceLandmark68Net` | `face_landmark_68_model-weights_manifest.json` | 68 点定位与对齐 |
| `faceapi.nets.faceRecognitionNet` | `face_recognition_model-weights_manifest.json` | 提取 128 维特征 |

清单和其中 `paths` 指定的 `.bin` 权重必须保持在同一个可访问目录。各文件的精确字节数、SHA-256 与固定提交下载地址记录在 `asset-integrity.json`。

## 接入方法

```html
<script src="vendor/face-api.js"></script>
```

```js
/* 模型预加载完成后再启用摄像头采集按钮，避免把网络或加载失败误报为识别失败。 */
await Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri('vendor/face-models'),
  faceapi.nets.faceLandmark68Net.loadFromUri('vendor/face-models'),
  faceapi.nets.faceRecognitionNet.loadFromUri('vendor/face-models'),
]);

const results = await faceapi
  .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
  .withFaceLandmarks()
  .withFaceDescriptors();

/* 注册和登录均要求画面仅有一个人；不要自动选中多人画面里的某一张脸。 */
if (results.length !== 1) throw new Error('请保证画面中只有本人一张清晰正脸');
const descriptor = results[0].descriptor;

/* 阈值需要结合实际设备和使用环境校准，距离越低代表特征越接近。 */
const distance = faceapi.euclideanDistance(descriptor, new Float32Array(enrolledDescriptor));
```

官方接口说明：[FaceAPI Tutorial](https://github.com/vladmandic/face-api/blob/189226d63aabb48cb40776fd1c453ebc0fa722f1/TUTORIAL.md)。

## 平台采集控制器

页面按顺序引用 `vendor/face-api.js`、`face-auth.js`。使用配套本地服务 `/api/setup` 或 `/api/login` 返回的完整挑战对象启动采集：

```js
const proof = await SanyFace.authenticate(challengeResponse, {
  video: document.querySelector('#face-video'),
  consent: consentCheckbox.checked,
  onStatus: (message, state) => {
    statusElement.textContent = message;
    progressElement.value = state.progress;
  },
});
/* challenge 为单次使用凭证；采集结果仍需要后端完成比对，不能据此直接授予权限。 */
const response = await fetch('/api/face/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challenge: challengeResponse.challenge, ...proof }),
});
```

`authenticate` 返回 `{ samples, consent }`。`samples` 按“正面、挑战中的第一个方向、第二个方向”排列，每项为 `{ descriptor: number[128], yaw: number }`。首次录入时要求 `consent === true`。

`onStatus(message, state)` 的第二参包含：

- `phase`：`loading`、`camera`、`capture`、`step-complete`、`complete`
- `step`：已完成动作数，0–3
- `total`：3
- `direction`：`front`、`left`、`right`、`complete`
- `progress`：0–1 的进度
- `remainingSeconds`：当前挑战剩余采集时间
- `stableFrames`：稳定采集时可选的帧数

关闭窗口、取消按钮或切换登录方式时调用 `SanyFace.stop()`；Promise 将以 `AbortError` 拒绝。超时返回 `code: 'FACE_TIMEOUT'`。成功、异常、超时和取消都会停止已有摄像头；取消后迟到的摄像头授权也会立即关闭视频流。每步至少 4 个连续稳定帧、至少 650 毫秒，不足一张或多于一张人脸会清空当前步骤的稳定计数。

预览建议设置 `video { transform: scaleX(-1); object-fit: cover; }`，只镜像视觉展示；算法读取原始视频坐标。不要将镜像后的画布再次作为采集源。提示中的“左 / 右”指本人方向。

`yaw` 是鼻尖相对双眼中点的横向投影除以眼距后的无量纲量，左转为负、右转为正。它不是角度。上游 `angle.yaw` 实现是像素差，因此控制器没有直接使用该值。前端正面阈值为 `abs(yaw) <= 0.11`，左右阈值为 `-0.2`、`0.2`，预留后端 `0.14` / `0.17` 阈值的余量。

## 使用边界

这三个模型负责特征匹配，不提供经过认证的活体检测或防照片攻击能力。账号认证与权限判断仍由应用完成，不应仅靠前端返回的“匹配成功”授予后台权限。登记人脸应由已验证身份的账号主动操作；特征仅用于本人登录核验，不做陌生人识别，也不推断年龄、性别或其他属性。

需要摄像头权限及安全来源（本机 `localhost`、可信桌面窗口或 HTTPS）。不应为摄像头访问关闭浏览器的安全机制。若直接以 `file://` 打开页面导致模型加载或权限失败，请用配套桌面程序或本地服务。

## 重新下载与核验

在项目根目录运行：

```text
node scripts/fetch-face-assets.cjs
node scripts/fetch-face-assets.cjs --verify
```

下载脚本只请求 FaceAPI 作者官方 GitHub 的固定提交 / 固定 blob 和 TensorFlow.js 官方版本的许可证，顺序下载、最多重试三次；读取每个清单检查权重总字节数，保存后读回并计算 SHA-256。离线 `--verify` 不需要联网。

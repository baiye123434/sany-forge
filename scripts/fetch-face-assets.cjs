'use strict';

/*
 * 固定上游提交，下载浏览器端识别所需的最小资源集。
 * 所有资源仅来自作者官方 GitHub；顺序请求避免占用过多连接，
 * 下载完成后按模型清单核对权重字节数并生成 SHA-256 追溯记录。
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const vendorDir = path.join(root, 'dist', 'vendor');
const modelDir = path.join(vendorDir, 'face-models');
const version = '1.7.15';
const commit = '189226d63aabb48cb40776fd1c453ebc0fa722f1';
const upstream = `https://raw.githubusercontent.com/vladmandic/face-api/${commit}`;
const modelNames = ['tiny_face_detector_model', 'face_landmark_68_model', 'face_recognition_model'];
const pinnedBlobs = {
  'model/face_recognition_model.bin': '62496a8f2b884aa2669531eadff1c1e7dfffc85b',
};
/* 这些摘要来自上述固定官方提交；复跑时可安全复用已验证资源。 */
const expectedHashes = {
  'dist/face-api.js': '0160f7af3a8c78cece45c7ecc765383bad74becfd438bb787cdd627b2d6f2cf6',
  LICENSE: '9a3442b79acaf4fbc7c2e07b7e2d8f84af9bb3871bf08a69d80304ab00640e9a',
  'model/tiny_face_detector_model-weights_manifest.json': '5d1af4849ac48d5b985f4a9b16010c512353ddd6fcc63d50fd0bc9e9e64296e5',
  'model/tiny_face_detector_model.bin': 'b7503ce7df31039b1c43316a9b865cab6a70dd748cc602d3fa28b551503c3871',
  'model/face_landmark_68_model-weights_manifest.json': 'ca4886639f86e99b39fed0c155f81b63317225773bd9616716e887b0153389c9',
  'model/face_landmark_68_model.bin': '4611ef65c87d836d03d684b30eec4d195d8b219fa1dd58fc58945831c6b9299b',
  'model/face_recognition_model-weights_manifest.json': 'cbaffa501b0b9275a12b63357a6843e7e30c054e1c9151e1a5f879b26e32986b',
  'model/face_recognition_model.bin': 'b413e420d6840b2775fba32008db6f3cddb07d485967fb42cfcf379c16a8c589',
};
const records = [];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/* 大型权重使用 GitHub 官方 blob 接口，绕开部分网络对 raw 大文件的连接重置。 */
async function downloadPinnedBlob(relativePath, destination) {
  const expectedSha = pinnedBlobs[relativePath];
  const matchesBlob = (bytes) => crypto.createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex') === expectedSha;
  if (destination) {
    try {
      const cached = await fs.readFile(destination);
      if (matchesBlob(cached)) return cached;
    } catch {
      /* 没有缓存时继续从固定 blob 下载，不采纳未经校验的本地文件。 */
    }
  }
  const response = await fetch(`https://api.github.com/repos/vladmandic/face-api/git/blobs/${expectedSha}`, {
    signal: AbortSignal.timeout(90000),
    headers: { 'User-Agent': 'SANY-coursework-asset-sync/1.0' },
  });
  if (!response.ok) throw new Error(`GitHub blob HTTP ${response.status}`);
  const blob = await response.json();
  if (blob.encoding !== 'base64') throw new Error('GitHub blob 编码不符');
  const bytes = Buffer.from(blob.content, 'base64');
  if (blob.sha !== expectedSha || !matchesBlob(bytes)) throw new Error('GitHub blob 哈希不符');
  return bytes;
}

async function download(relativePath, destination, sourceUrl) {
  const url = sourceUrl || `${upstream}/${relativePath}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let bytes;
      if (destination && expectedHashes[relativePath]) {
        try {
          const cached = await fs.readFile(destination);
          if (sha256(cached) === expectedHashes[relativePath]) bytes = cached;
        } catch {
          /* 文件缺失或未通过摘要检查时重新获取，不能把损坏缓存视为成功。 */
        }
      }
      if (!bytes && pinnedBlobs[relativePath]) {
        bytes = await downloadPinnedBlob(relativePath, destination);
      } else if (!bytes) {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(90000),
          headers: { 'User-Agent': 'SANY-coursework-asset-sync/1.0' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!bytes.length) throw new Error(`下载为空：${url}`);
      if (expectedHashes[relativePath] && sha256(bytes) !== expectedHashes[relativePath]) {
        throw new Error(`官方资源摘要不符：${relativePath}`);
      }
      if (destination) {
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, bytes);
        const saved = await fs.readFile(destination);
        if (sha256(saved) !== sha256(bytes)) throw new Error(`落盘校验失败：${destination}`);
        records.push({
          file: path.relative(vendorDir, destination).split(path.sep).join('/'),
          source: url,
          ...(pinnedBlobs[relativePath] ? { gitBlob: pinnedBlobs[relativePath] } : {}),
          bytes: bytes.length,
          sha256: sha256(bytes),
        });
        console.log(`已验证 ${path.basename(destination)} (${bytes.length} bytes)`);
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

/*
 * TensorFlow manifest 采用量化 uint8 或原始 float32 编码。
 * 通过张量形状推算字节长度，防止下载到 HTML 错误页或截断权重。
 */
function expectedWeightBytes(weights) {
  const bytesPerType = { uint8: 1, uint16: 2, float32: 4, int32: 4, bool: 1 };
  return weights.reduce((total, weight) => {
    const dtype = weight.quantization?.dtype || weight.dtype;
    const width = bytesPerType[dtype];
    if (!width) throw new Error(`不支持的权重编码：${dtype}`);
    return total + weight.shape.reduce((size, dimension) => size * dimension, 1) * width;
  }, 0);
}

async function verifyModels() {
  for (const name of modelNames) {
    const manifest = JSON.parse(await fs.readFile(path.join(modelDir, `${name}-weights_manifest.json`), 'utf8'));
    if (!Array.isArray(manifest) || !manifest.length) throw new Error(`无效模型清单：${name}`);
    for (const group of manifest) {
      let actualBytes = 0;
      for (const weightPath of group.paths) {
        if (path.basename(weightPath) !== weightPath) throw new Error(`非法权重路径：${weightPath}`);
        actualBytes += (await fs.stat(path.join(modelDir, weightPath))).size;
      }
      const expectedBytes = expectedWeightBytes(group.weights);
      if (actualBytes !== expectedBytes) {
        throw new Error(`${name} 权重长度不符：${actualBytes}，应为 ${expectedBytes}`);
      }
    }
  }
}

async function main() {
  if (process.argv.includes('--verify')) {
    await verifyModels();
    const inventory = JSON.parse(await fs.readFile(path.join(modelDir, 'asset-integrity.json'), 'utf8'));
    for (const record of inventory.files) {
      const fullPath = path.resolve(vendorDir, record.file);
      if (!fullPath.startsWith(`${vendorDir}${path.sep}`)) throw new Error(`非法资源路径：${record.file}`);
      const bytes = await fs.readFile(fullPath);
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) {
        throw new Error(`资源完整性校验失败：${record.file}`);
      }
    }
    console.log(`离线资源校验通过：${inventory.files.length} 个文件，${inventory.totalBytes} bytes`);
    return;
  }

  const packageInfo = JSON.parse((await download('package.json')).toString('utf8'));
  if (packageInfo.name !== '@vladmandic/face-api' || packageInfo.version !== version || packageInfo.license !== 'MIT') {
    throw new Error('上游版本或许可证与已审阅版本不一致，已中止。');
  }
  await download('dist/face-api.js', path.join(vendorDir, 'face-api.js'));
  await download('LICENSE', path.join(vendorDir, 'face-api.LICENSE.txt'));
  await download('tfjs/LICENSE', path.join(vendorDir, 'face-api.tfjs.LICENSE.txt'),
    'https://raw.githubusercontent.com/tensorflow/tfjs/tfjs-v4.22.0/LICENSE');
  for (const name of modelNames) {
    const filename = `${name}-weights_manifest.json`;
    const manifest = JSON.parse((await download(`model/${filename}`, path.join(modelDir, filename))).toString('utf8'));
    for (const weightPath of new Set(manifest.flatMap((group) => group.paths))) {
      if (path.basename(weightPath) !== weightPath) throw new Error(`非法权重路径：${weightPath}`);
      await download(`model/${weightPath}`, path.join(modelDir, weightPath));
    }
  }
  await verifyModels();
  const inventory = {
    package: '@vladmandic/face-api',
    version,
    commit,
    license: 'MIT',
    retrievedAt: new Date().toISOString(),
    totalBytes: records.reduce((total, record) => total + record.bytes, 0),
    files: records,
  };
  const inventoryFile = path.join(modelDir, 'asset-integrity.json');
  await fs.writeFile(inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`);
  JSON.parse(await fs.readFile(inventoryFile, 'utf8'));
  console.log(`完成：${records.length} 个资源，合计 ${inventory.totalBytes} bytes。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

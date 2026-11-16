'use strict';

/* 保留已有启动命令入口，实际业务服务统一交由 Java/MySQL 运行。
 * 原 Node.js 业务实现保存在 legacy-node/platform.cjs，仅供迁移对照。 */
const { createPlatform, runCli } = require('./java-platform.cjs');
module.exports = { createPlatform };
if (require.main === module) runCli();

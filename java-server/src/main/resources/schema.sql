-- 使用 InnoDB 和二进制排序规则保留 V3 的标识大小写语义，JSON 保存完整历史结构。
CREATE TABLE IF NOT EXISTS records (
  kind VARCHAR(40) NOT NULL, id VARCHAR(100) NOT NULL, body JSON NOT NULL,
  PRIMARY KEY(kind,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS files (
  id VARCHAR(100) PRIMARY KEY, owner_kind VARCHAR(40) NOT NULL, owner_id VARCHAR(100) NOT NULL,
  name VARCHAR(150) NOT NULL, mime VARCHAR(150) NOT NULL, bytes LONGBLOB NOT NULL,
  created_at VARCHAR(32) NOT NULL, INDEX idx_files_owner(owner_kind,owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS audit (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, actor VARCHAR(200), action VARCHAR(200),
  target VARCHAR(200), at VARCHAR(32), detail TEXT, INDEX idx_audit_at(at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS document_sequences (
  prefix VARCHAR(8) NOT NULL, day CHAR(8) NOT NULL, value INT NOT NULL,
  PRIMARY KEY(prefix,day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
-- 路由事务先锁此行，确保两个 Java 实例也不能并发覆盖 revision 或重复发号。
CREATE TABLE IF NOT EXISTS mutation_lock (id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO mutation_lock(id) VALUES(1);

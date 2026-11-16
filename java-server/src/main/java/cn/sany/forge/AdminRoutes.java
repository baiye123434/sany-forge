package cn.sany.forge;

import static cn.sany.forge.J.*;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * 管理员工具沿用网页接口；业务恢复保留当前身份、权限和审计链。
 * Core 在路由事务内锁定 mutation_lock，因此导出和恢复与其他实例的业务写入串行。
 */
public class AdminRoutes {
    private static final String PREFIX = "/api/admin/tools/";
    private static final String FORMAT = "sany-forge-mysql-backup-v1";
    private static final List<String> CAPABILITIES = List.of("projects", "orders", "tickets", "chat", "followups");
    private static final Set<String> NUMBER_PREFIXES = Set.of("SO", "PR", "WO", "FU");
    private static final long MAX_BACKUP_BYTES = 1024L * 1024L * 1024L;
    private final Core c;
    private final Path backupDir;

    public AdminRoutes(Core c) {
        this.c = c;
        this.backupDir = c.dataDir.resolve("backups").toAbsolutePath().normalize();
        try {
            Files.createDirectories(backupDir);
        } catch (IOException ex) {
            throw fail("无法创建本机备份目录，请检查数据目录权限。", 500);
        }
    }

    private Map<String, Object> permissions() {
        Map<String, Object> saved = c.get("settings", "permissions");
        if (saved != null) return saved;
        Map<String, Object> service = new LinkedHashMap<>();
        Map<String, Object> reviewer = new LinkedHashMap<>();
        for (String key : CAPABILITIES) {
            service.put(key, true);
            reviewer.put(key, !key.equals("chat"));
        }
        return obj("id", "permissions", "revision", 0, "roles", obj("service", service, "reviewer", reviewer));
    }

    private Map<String, Object> content() {
        Map<String, Object> saved = c.get("settings", "content");
        return saved != null ? saved : obj("id", "content", "revision", 0, "published", false,
            "title", "", "announcement", "", "contact", "", "hours", "");
    }

    public Map<String, Object> capabilities(String role) {
        Map<String, Object> result = new LinkedHashMap<>();
        if ("admin".equals(role)) {
            for (String key : CAPABILITIES) result.put(key, !key.equals("chat"));
            return result;
        }
        Map<String, Object> roles = map(permissions().get("roles"));
        Map<String, Object> config = map(roles.get(role));
        for (String key : CAPABILITIES) result.put(key, Boolean.TRUE.equals(config.get(key)));
        return result;
    }

    /** 功能开关只能收紧原岗位权限，不能使审核员获得客服权限。 */
    public void enforce(Req req, Map<String, Object> user) {
        String role = s(user, "role");
        if (role.equals("admin")) return;
        String p = req.path();
        String key = p.startsWith("/api/projects") ? "projects"
            : p.startsWith("/api/orders") ? "orders"
            : p.startsWith("/api/tickets") ? "tickets"
            : p.startsWith("/api/conversations") || p.startsWith("/api/customer/chats") ? "chat"
            : p.startsWith("/api/followup") ? "followups" : null;
        if (key != null && !Boolean.TRUE.equals(capabilities(role).get(key))) {
            throw fail("该角色已关闭此功能权限，请联系管理员。", 403);
        }
    }

    public Object handle(Req req, Map<String, Object> body) {
        String p = req.path();
        String method = req.method();
        if (p.equals("/api/site-content") && method.equals("GET")) {
            Map<String, Object> current = content();
            return obj("content", Boolean.TRUE.equals(current.get("published"))
                ? obj("title", s(current, "title"), "announcement", s(current, "announcement"),
                    "contact", s(current, "contact"), "hours", s(current, "hours")) : null);
        }
        if (!p.startsWith(PREFIX)) return null;
        Map<String, Object> access = c.auth(req, "admin");
        String actor = s(access, "actor");
        String tool = p.substring(PREFIX.length());

        if (tool.equals("monitor") && method.equals("GET")) return monitor();
        if (tool.equals("backups")) {
            if (method.equals("GET")) return obj("backups", listBackups());
            if (method.equals("POST")) return obj("backup", c.atomic(() -> snapshot(actor, "手动备份")));
        }
        if (tool.equals("restore-preview") && method.equals("POST")) {
            CheckedBackup backup = checked(body.get("id"));
            return obj("backup", backup.meta, "counts", recordCounts(backup.records));
        }
        if (tool.equals("restore") && method.equals("POST")) {
            if (!"恢复数据".equals(body.get("confirm"))) throw fail("请输入“恢复数据”确认。");
            CheckedBackup backup = checked(body.get("id"));
            Object result = c.atomic(() -> restore(actor, backup));
            c.revokeAll();
            return result;
        }
        if (tool.equals("permissions")) {
            if (method.equals("GET")) return obj("config", permissions(), "capabilities", CAPABILITIES);
            if (method.equals("POST")) return c.atomic(() -> savePermissions(actor, body));
        }
        if (tool.equals("content")) {
            if (method.equals("GET")) return obj("content", content());
            if (method.equals("POST")) return c.atomic(() -> saveContent(actor, body));
        }
        throw fail("管理工具接口不存在。", 404);
    }

    private Object savePermissions(String actor, Map<String, Object> body) {
        Map<String, Object> old = permissions();
        requireRevision(body, old, "权限配置已变更，请刷新。");
        Map<String, Object> submitted = map(body.get("roles"));
        Map<String, Object> roles = new LinkedHashMap<>();
        for (String role : List.of("service", "reviewer")) {
            Map<String, Object> source = map(submitted.get(role));
            Map<String, Object> config = new LinkedHashMap<>();
            for (String key : CAPABILITIES) {
                if (!(source.get(key) instanceof Boolean)) throw fail("权限选项不完整。");
                config.put(key, source.get(key));
            }
            roles.put(role, config);
        }
        if (Boolean.TRUE.equals(map(roles.get("reviewer")).get("chat"))) throw fail("审核员不能授予客服会话权限。");
        Map<String, Object> config = obj("id", "permissions", "revision", n(old, "revision") + 1, "roles", roles);
        c.put("settings", config);
        c.audit(actor, "更新角色功能权限", "permissions");
        return obj("config", config);
    }

    private Object saveContent(String actor, Map<String, Object> body) {
        Map<String, Object> old = content();
        requireRevision(body, old, "内容已被修改，请刷新。");
        if (!(body.get("published") instanceof Boolean)) throw fail("发布状态无效。");
        Map<String, Object> value = obj("id", "content", "revision", n(old, "revision") + 1,
            "published", body.get("published"));
        for (Map.Entry<String, Integer> field : Map.of("title", 60, "announcement", 1000, "contact", 100, "hours", 100).entrySet()) {
            Object raw = body.get(field.getKey());
            if (!(raw instanceof String) || ((String) raw).length() > field.getValue()) throw fail("内容长度或格式无效。");
            value.put(field.getKey(), ((String) raw).trim());
        }
        if (Boolean.TRUE.equals(value.get("published")) && s(value, "title").isEmpty()) throw fail("发布时需填写标题。");
        c.put("settings", value);
        c.audit(actor, Boolean.TRUE.equals(value.get("published")) ? "发布首页内容" : "保存未发布内容", "content");
        return obj("content", value);
    }

    private void requireRevision(Map<String, Object> incoming, Map<String, Object> old, String message) {
        Object revision = incoming.get("revision");
        if (!(revision instanceof Number) || ((Number) revision).doubleValue() != n(old, "revision")) throw fail(message, 409);
    }

    private Object monitor() {
        Long databaseBytes = c.store.jdbc.queryForObject(
            "SELECT COALESCE(SUM(data_length + index_length),0) FROM information_schema.tables WHERE table_schema=DATABASE()",
            Long.class);
        Long attachments = c.store.jdbc.queryForObject("SELECT COUNT(*) FROM files", Long.class);
        Integer reachable = c.store.jdbc.queryForObject("SELECT 1", Integer.class);
        // MySQL 没有 SQLite WAL 文件；保留 walBytes 兼容旧页面，并附实际统计口径。
        return obj("at", now(), "uptimeSeconds", Math.max(0, (System.currentTimeMillis() - c.started) / 1000),
            "requests", c.requests.get(), "errors", c.errors.get(),
            "memoryBytes", ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getUsed(),
            "databaseBytes", databaseBytes == null ? 0L : databaseBytes, "walBytes", 0L,
            "counts", c.store.jdbc.queryForList("SELECT kind,COUNT(*) AS count FROM records GROUP BY kind ORDER BY kind"),
            "attachments", attachments == null ? 0L : attachments, "backupCount", listBackups().size(),
            "integrity", Integer.valueOf(1).equals(reachable) ? "ok" : "unavailable",
            "databaseEngine", "MySQL", "memoryScope", "jvm-used-heap", "databaseBytesScope", "table-and-index-estimate",
            "walApplicable", false, "integrityScope", "connection-and-table-access");
    }

    private List<Map<String, Object>> listBackups() {
        List<Map<String, Object>> result = new ArrayList<>();
        try (Stream<Path> stream = Files.list(backupDir)) {
            for (Path path : stream.filter(p -> p.getFileName().toString().matches("backup-[a-f0-9-]{36}\\.json")).toList()) {
                try {
                    if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) > 65536) continue;
                    Map<String, Object> meta = map(c.parse(Files.readString(path, StandardCharsets.UTF_8)));
                    if (!path.getFileName().toString().equals(s(meta, "id") + ".json") || !validId(s(meta, "id"))) continue;
                    if (!(meta.get("size") instanceof Number) || s(meta, "createdAt").isEmpty() || !s(meta, "sha256").matches("[a-f0-9]{64}")) continue;
                    result.add(meta);
                } catch (IOException | RuntimeException ignored) {
                    // 半写入或已损坏的元数据不影响其他备份的列表展示；实际恢复还会完整校验。
                }
            }
        } catch (IOException ex) {
            throw fail("无法读取本机备份目录。", 500);
        }
        result.sort(Comparator.comparing((Map<String, Object> value) -> s(value, "createdAt")).reversed());
        return result;
    }

    /** 同一个 MySQL 事务读取业务、附件和序号，附件显式编码以避免驱动对象进入 JSON。 */
    private Map<String, Object> snapshot(String actor, String reason) {
        String backupId = "backup-" + UUID.randomUUID();
        String createdAt = now();
        List<Map<String, Object>> rows = c.store.jdbc.query("SELECT kind,id,body FROM records ORDER BY kind,id",
            (rs, index) -> obj("kind", rs.getString("kind"), "id", rs.getString("id"), "body", c.parse(rs.getString("body"))));
        List<Map<String, Object>> files = c.store.jdbc.query("SELECT id,owner_kind,owner_id,name,mime,bytes,created_at FROM files ORDER BY id",
            (rs, index) -> obj("id", rs.getString("id"), "owner_kind", rs.getString("owner_kind"), "owner_id", rs.getString("owner_id"),
                "name", rs.getString("name"), "mime", rs.getString("mime"), "data", Base64.getEncoder().encodeToString(rs.getBytes("bytes")),
                "created_at", rs.getString("created_at")));
        Map<String, Object> payload = obj("format", FORMAT, "id", backupId, "createdAt", createdAt,
            "records", rows, "files", files,
            "audit", c.store.jdbc.queryForList("SELECT id,actor,action,target,at,detail FROM audit ORDER BY id"),
            "documentSequences", c.store.jdbc.queryForList("SELECT prefix,day,value FROM document_sequences ORDER BY prefix,day"));
        byte[] bytes = c.json(payload).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BACKUP_BYTES) throw fail("当前备份超过 1 GB，请由管理员离线导出数据库。", 413);
        Map<String, Object> meta = obj("id", backupId, "createdAt", createdAt, "reason", reason,
            "size", (long) bytes.length, "sha256", digest(bytes), "format", FORMAT);
        try {
            // CREATE_NEW 保证不覆盖任何已有备份；先写内容再写元数据，列表不暴露半成品。
            Files.write(backupDir.resolve(backupId + ".data.json"), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            Files.writeString(backupDir.resolve(backupId + ".json"), c.json(meta), StandardCharsets.UTF_8,
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (IOException ex) {
            throw fail("保存备份失败，请检查可用磁盘空间和目录权限。", 500);
        }
        c.audit(actor, "创建本机备份", backupId, reason);
        return meta;
    }

    private CheckedBackup checked(Object input) {
        if (!(input instanceof String) || !validId((String) input)) throw fail("备份编号无效。");
        String backupId = (String) input;
        Map<String, Object> meta = listBackups().stream().filter(value -> backupId.equals(s(value, "id"))).findFirst()
            .orElseThrow(() -> fail("备份不存在。", 404));
        Path file = backupDir.resolve(backupId + ".data.json");
        if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) throw fail("备份不存在。", 404);
        byte[] bytes;
        try {
            long size = Files.size(file);
            if (size <= 0 || size > MAX_BACKUP_BYTES || size != ((Number) meta.get("size")).longValue()) throw fail("备份大小校验失败，不能恢复。");
            bytes = Files.readAllBytes(file);
        } catch (IOException ex) {
            throw fail("无法读取备份文件。", 500);
        }
        if (!MessageDigest.isEqual(digest(bytes).getBytes(StandardCharsets.US_ASCII), s(meta, "sha256").getBytes(StandardCharsets.US_ASCII))) {
            throw fail("备份校验失败，不能恢复。");
        }
        Map<String, Object> payload;
        try {
            Object parsed = c.parse(new String(bytes, StandardCharsets.UTF_8));
            if (!(parsed instanceof Map)) throw fail("备份格式无效。");
            payload = map(parsed);
        } catch (RuntimeException ex) {
            throw fail("备份 JSON 格式无效，不能恢复。");
        }
        if (!FORMAT.equals(s(payload, "format")) || !FORMAT.equals(s(meta, "format"))
            || !backupId.equals(s(payload, "id")) || !s(meta, "createdAt").equals(s(payload, "createdAt"))) {
            throw fail("备份版本或标识不一致，不能恢复。");
        }
        List<Map<String, Object>> records = requiredRows(payload, "records");
        List<Map<String, Object>> files = requiredRows(payload, "files");
        List<Map<String, Object>> sequences = requiredRows(payload, "documentSequences");
        requiredRows(payload, "audit");
        Set<String> recordIds = new HashSet<>();
        for (Map<String, Object> row : records) {
            String kind = backupText(row.get("kind"), 40, false);
            String recordId = backupText(row.get("id"), 100, false);
            if (!recordIds.add(kind + "\u0000" + recordId) || !(row.get("body") instanceof Map)) throw fail("备份记录重复或内容无效。");
            if (!recordId.equals(s(map(row.get("body")), "id"))) throw fail("备份记录编号与内容不一致。");
        }
        Set<String> fileIds = new HashSet<>();
        for (Map<String, Object> row : files) {
            if (!fileIds.add(backupText(row.get("id"), 100, false))) throw fail("备份附件编号重复。");
            backupText(row.get("owner_kind"), 40, false);
            backupText(row.get("owner_id"), 100, false);
            backupText(row.get("name"), 150, false);
            backupText(row.get("mime"), 150, false);
            backupText(row.get("created_at"), 32, false);
            Object data = row.get("data");
            if (!(data instanceof String) || ((String) data).length() > 5_600_000) throw fail("备份附件数据无效。");
            byte[] decoded;
            try { decoded = Base64.getDecoder().decode((String) data); }
            catch (IllegalArgumentException ex) { throw fail("备份附件编码无效。"); }
            if (decoded.length == 0 || decoded.length > 4 * 1024 * 1024) throw fail("备份附件大小无效。");
            row.put("decodedBytes", decoded);
        }
        Set<String> sequenceIds = new HashSet<>();
        for (Map<String, Object> row : sequences) {
            String prefix = backupText(row.get("prefix"), 8, false);
            String day = backupText(row.get("day"), 8, false);
            Object value = row.get("value");
            if (!NUMBER_PREFIXES.contains(prefix) || !day.matches("[0-9]{8}") || !sequenceIds.add(prefix + day)
                || !(value instanceof Number) || ((Number) value).doubleValue() != ((Number) value).intValue()
                || ((Number) value).intValue() < 0 || ((Number) value).intValue() > 9999) throw fail("备份单据序号无效。");
            try { LocalDate.parse(day, DateTimeFormatter.BASIC_ISO_DATE); }
            catch (RuntimeException ex) { throw fail("备份单据日期无效。"); }
        }
        return new CheckedBackup(meta, records, files, sequences);
    }

    /** 恢复只替换业务记录与附件；身份、权限、审计和本机密钥保留当前状态。 */
    private Object restore(String actor, CheckedBackup backup) {
        Map<String, Object> safety = snapshot(actor, "恢复前自动备份");
        c.store.jdbc.update("DELETE FROM records WHERE kind NOT IN ('user','customer') AND NOT (kind='settings' AND id='permissions')");
        c.store.jdbc.update("DELETE FROM files");
        for (Map<String, Object> row : backup.records) {
            String kind = s(row, "kind");
            String recordId = s(row, "id");
            if (kind.equals("user") || kind.equals("customer") || kind.equals("settings") && recordId.equals("permissions")) continue;
            c.store.jdbc.update("INSERT INTO records(kind,id,body) VALUES(?,?,?)", kind, recordId, c.json(row.get("body")));
        }
        for (Map<String, Object> file : backup.files) {
            c.store.jdbc.update("INSERT INTO files(id,owner_kind,owner_id,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?)",
                file.get("id"), file.get("owner_kind"), file.get("owner_id"), file.get("name"), file.get("mime"), file.get("decodedBytes"), file.get("created_at"));
        }
        // 已经发出的单据号不能在恢复后复用；合并备份序号时保留数据库现有高水位。
        for (Map<String, Object> sequence : backup.sequences) {
            c.store.jdbc.update("INSERT INTO document_sequences(prefix,day,value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE value=GREATEST(value,VALUES(value))",
                sequence.get("prefix"), sequence.get("day"), sequence.get("value"));
        }
        c.audit(actor, "恢复业务数据", s(backup.meta, "id"), "恢复前备份：" + s(safety, "id"));
        return obj("ok", true, "safetyBackup", s(safety, "id"));
    }

    private List<Map<String, Object>> requiredRows(Map<String, Object> payload, String key) {
        Object value = payload.get(key);
        if (!(value instanceof List)) throw fail("备份缺少必要的数据表。");
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object row : (List<?>) value) {
            if (!(row instanceof Map)) throw fail("备份数据行无效。");
            result.add(map(row));
        }
        return result;
    }

    private String backupText(Object value, int max, boolean emptyAllowed) {
        if (!(value instanceof String) || ((String) value).length() > max || (!emptyAllowed && ((String) value).isEmpty())
            || ((String) value).indexOf('\u0000') >= 0) throw fail("备份字段格式无效。");
        return (String) value;
    }

    private List<Map<String, Object>> recordCounts(List<Map<String, Object>> rows) {
        Map<String, Long> grouped = new java.util.TreeMap<>();
        for (Map<String, Object> row : rows) grouped.merge(s(row, "kind"), 1L, Long::sum);
        List<Map<String, Object>> counts = new ArrayList<>();
        grouped.forEach((kind, count) -> counts.add(obj("kind", kind, "count", count)));
        return counts;
    }

    private boolean validId(String value) {
        return value != null && value.matches("backup-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}");
    }

    private String digest(byte[] bytes) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException ex) { throw fail("当前 Java 运行环境缺少 SHA-256。", 500); }
    }

    private static final class CheckedBackup {
        private final Map<String, Object> meta;
        private final List<Map<String, Object>> records;
        private final List<Map<String, Object>> files;
        private final List<Map<String, Object>> sequences;

        private CheckedBackup(Map<String, Object> meta, List<Map<String, Object>> records,
                List<Map<String, Object>> files, List<Map<String, Object>> sequences) {
            this.meta = meta;
            this.records = records;
            this.files = files;
            this.sequences = sequences;
        }
    }
}

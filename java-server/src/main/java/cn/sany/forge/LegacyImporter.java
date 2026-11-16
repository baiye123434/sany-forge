package cn.sany.forge;

import static cn.sany.forge.J.*;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.ResolverStyle;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 将显式导出的 SQLite 快照一次导入空 MySQL 库，保留原记录、材料、审计和加密密钥。
 * 此工具只在独立 CLI 进程使用；不读取 APPDATA，不覆盖业务库，也不迁移内存登录会话。
 */
public final class LegacyImporter {
    private static final String FORMAT = "sany-forge-legacy-v1";
    private static final Set<String> KINDS = Set.of("user","customer","order","ticket","product","project","conversation","followup","supportChat","settings");
    private static final Set<String> FILE_KINDS = Set.of("order","ticket","project","conversation","product-image");
    private static final Set<String> PREFIXES = Set.of("SO","PR","WO","FU");
    private static final ObjectMapper JSON = new ObjectMapper().enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION).enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("uuuuMMdd").withResolverStyle(ResolverStyle.STRICT);
    private LegacyImporter() {}

    public static Map<String,Object> run(Core c, Path input) {
        Checked checked;
        try {
            if (!Files.isRegularFile(input, LinkOption.NOFOLLOW_LINKS) || Files.size(input) > 1024L * 1024 * 1024) throw fail("导入文件须为不超过 1 GB 的普通 JSON 文件。");
            try (var stream = Files.newInputStream(input)) { checked = validate(JSON.readValue(stream, Object.class)); }
        } catch (J.ApiException ex) { throw ex; }
        catch (Exception ex) { throw fail("无法读取迁移文件，或 JSON 格式不完整。文件内容不会写入日志。"); }

        Path keyFile = c.dataDir.resolve("face.key");
        byte[][] previous = new byte[1][];
        boolean[] replaced = {false};
        Map<String,Object> result;
        try {
            result = c.atomic(() -> {
                // 连序号表也要求为空，防止把目标库历史计数误当作新库。
                for (String table : List.of("records","files","audit","document_sequences")) {
                    Long count = c.store.jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Long.class);
                    if (count == null || count != 0) throw fail("只允许导入全新空业务库；目标库已有数据，已停止。",409);
                }
                try {
                    if (!Files.isRegularFile(keyFile, LinkOption.NOFOLLOW_LINKS)) throw new IOException();
                    previous[0] = Files.readAllBytes(keyFile);
                    if (previous[0].length != 32 || !Arrays.equals(previous[0],c.faceKey)) throw new IOException();
                } catch (IOException ex) { throw fail("目标平台密钥状态不一致，请停止服务并检查资料目录。"); }

                for (Map<String,Object> row : checked.records) c.store.jdbc.update("INSERT INTO records(kind,id,body) VALUES(?,?,?)",row.get("kind"),row.get("id"),c.json(row.get("body")));
                for (Map<String,Object> row : checked.files) c.store.jdbc.update("INSERT INTO files(id,owner_kind,owner_id,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?)",
                    row.get("id"),row.get("owner_kind"),row.get("owner_id"),row.get("name"),row.get("mime"),row.get("bytes"),row.get("created_at"));
                for (Map<String,Object> row : checked.audit) c.store.jdbc.update("INSERT INTO audit(id,actor,action,target,at,detail) VALUES(?,?,?,?,?,?)",
                    row.get("id"),row.get("actor"),row.get("action"),row.get("target"),row.get("at"),row.get("detail"));
                for (Map<String,Object> row : checked.sequences) c.store.jdbc.update("INSERT INTO document_sequences(prefix,day,value) VALUES(?,?,?)",row.get("prefix"),row.get("day"),row.get("value"));
                try {
                    // 同目录原子替换保证提交后的库必有匹配密钥；保留旧 key 以便人工恢复。
                    writeNew(c.dataDir.resolve("face.before-legacy-" + UUID.randomUUID() + ".key"),previous[0]);
                    replaceKey(keyFile,checked.key);
                    replaced[0] = true;
                } catch (IOException ex) { throw fail("无法原子保存迁移密钥，数据库事务已取消。"); }
                return obj("records",checked.records.size(),"files",checked.files.size(),"audit",checked.audit.size(),"documentSequences",checked.sequences.size());
            });
        } catch (RuntimeException ex) {
            if (replaced[0]) {
                try { replaceKey(keyFile,previous[0]); }
                catch (IOException restore) { throw fail("导入失败且密钥自动恢复失败；请保留资料目录和 face.before-legacy 备份，停止启动服务。"); }
            }
            if (ex instanceof J.ApiException api) throw api;
            // JDBC 异常可能包含绑定参数，绝不将底层异常或用户记录输出到 CLI。
            throw fail("导入事务失败，已回滚业务数据并恢复原密钥。请检查 MySQL 连接和可用空间。");
        }
        // 只在事务成功后同步内存密钥；CLI 没有需要恢复的会话，并将在返回后退出。
        System.arraycopy(checked.key,0,c.faceKey,0,32);
        return result;
    }

    private static void writeNew(Path path, byte[] bytes) throws IOException {
        try (FileChannel file = FileChannel.open(path,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE)) {
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            while (buffer.hasRemaining()) file.write(buffer);
            file.force(true);
        }
    }

    private static void replaceKey(Path target, byte[] key) throws IOException {
        Path stage = target.resolveSibling("face.pending-legacy-" + UUID.randomUUID() + ".key");
        writeNew(stage,key);
        Files.move(stage,target,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
    }

    /** 所有校验先于数据库写入，拒绝重复键、跨记录材料、损坏人脸密文和不合法序号。 */
    static Checked validate(Object input) {
        Map<String,Object> root = object(input);
        if (!FORMAT.equals(root.get("format"))) throw fail("不支持的旧数据导出格式。");
        timestamp(root.get("exportedAt"),false);
        byte[] key = base64(root.get("faceKey"),32);
        if (key.length != 32) throw fail("迁移密钥必须恰好为 32 字节。");
        List<Map<String,Object>> records = rows(root.get("records")), files = rows(root.get("files")), audit = rows(root.get("audit")), sequences = rows(root.get("documentSequences"));
        Map<String,Map<String,Object>> byRecord = new HashMap<>(), byFile = new HashMap<>();
        Set<String> usernames = new HashSet<>(), phones = new HashSet<>(), numbers = new HashSet<>();
        Map<String,Long> maxNumbers = new HashMap<>();
        for (Map<String,Object> row : records) {
            String kind = string(row.get("kind"),40,false), recordId = identifier(row.get("id"));
            Map<String,Object> body = object(row.get("body"));
            if (!KINDS.contains(kind) || !recordId.equals(body.get("id")) || byRecord.put(kind + ":" + recordId,body) != null) throw fail("记录类型、主键或内容标识无效，或存在重复记录。");
            if (body.containsKey("revision")) integral(body.get("revision"),0,Integer.MAX_VALUE);
            if (kind.equals("user") || kind.equals("customer")) {
                if (!(body.get("password") instanceof String password) || !password.matches("[a-fA-F0-9]{32}:[a-fA-F0-9]{64}")) throw fail("账户密码存储格式无效。");
                if (!(body.get("active") instanceof Boolean)) throw fail("账户状态格式无效。");
                if (kind.equals("user")) {
                    String username = string(body.get("username"),200,false);
                    if (!usernames.add(username.toLowerCase(Locale.ROOT)) || !Set.of("admin","service","reviewer").contains(body.get("role"))) throw fail("员工账号重复或角色无效。");
                    if (body.get("face") != null) validateFace(body.get("face"),key);
                } else {
                    String mobile = string(body.get("phone"),40,false).replaceAll("[\\s()+-]","").replaceFirst("^(?:0086|86)(?=1[3-9]\\d{9}$)","");
                    if (!mobile.matches("1[3-9]\\d{9}") || !phones.add(mobile)) throw fail("客户手机号无效或存在重复账户。");
                }
            }
            if (Set.of("order","project","ticket","followup").contains(kind) && body.containsKey("number")) {
                String number = string(body.get("number"),100,false);
                if (!numbers.add(kind + ":" + number)) throw fail("业务单据编号重复。");
                if (number.matches("(?:SO|PR|WO|FU)-\\d{8}-\\d{4}")) {
                    String[] parts = number.split("-"); validDay(parts[1]);
                    long serial = Long.parseLong(parts[2]);
                    String expected = Map.of("order","SO","project","PR","ticket","WO","followup","FU").get(kind);
                    if (serial == 0 || !expected.equals(parts[0])) throw fail("业务单据序号无效。");
                    maxNumbers.merge(parts[0] + ":" + parts[1],serial,Math::max);
                }
            }
        }
        for (Map<String,Object> row : records) {
            String kind = s(row,"kind"); Map<String,Object> body = map(row.get("body"));
            if (kind.equals("order") || kind.equals("project")) reference(byRecord,"customer",body.get("customerId"),false);
            if (kind.equals("ticket")) {
                reference(byRecord,"order",body.get("orderId"),true);
                for (String field : List.of("assignee","completedBy","reviewer")) reference(byRecord,"user",body.get(field),false);
            }
            if (kind.equals("conversation") || kind.equals("followup")) {
                Set<String> allowed = kind.equals("conversation") ? Set.of("order","project") : Set.of("order","project","ticket");
                if (!allowed.contains(body.get("kind"))) throw fail("业务关联类型无效。");
                reference(byRecord,s(body,"kind"),body.get("recordId"),true);
            }
            if (kind.equals("followup")) {
                reference(byRecord,"user",body.get("ownerId"),true);
                reference(byRecord,"user",body.get("createdBy"),true);
                reference(byRecord,"user",body.get("completedBy"),false);
            }
            if (kind.equals("supportChat")) reference(byRecord,"customer",body.get("customerId"),true);
        }
        for (Map<String,Object> row : files) {
            String fileId = identifier(row.get("id")), ownerKind = string(row.get("owner_kind"),40,false), ownerId = identifier(row.get("owner_id"));
            if (!FILE_KINDS.contains(ownerKind) || byFile.put(fileId,row) != null) throw fail("附件标识重复或归属类型无效。");
            if (!ownerKind.equals("product-image")) reference(byRecord,ownerKind,ownerId,true);
            String name = string(row.get("name"),150,false), mime = string(row.get("mime"),150,false);
            byte[] bytes = base64(row.get("data"),4 * 1024 * 1024);
            if (bytes.length == 0) throw fail("附件内容为空。");
            MaterialFiles.Material material = MaterialFiles.validateIncoming(List.of(obj("name",name,"data",row.get("data"))),true).get(0);
            if (!mime.equals(material.mime) || !name.equals(material.name) || ownerKind.equals("product-image") && !mime.startsWith("image/")) throw fail("附件类型与实际内容不一致。");
            timestamp(row.get("created_at"),false);
            row.put("bytes",bytes);
        }
        for (Map<String,Object> row : records) {
            String kind = s(row,"kind");
            if (Set.of("order","project","ticket","conversation").contains(kind)) attachments(row.get("body"),kind,s(row,"id"),byFile);
            imageReferences(row.get("body"),byFile);
        }
        Set<Long> auditIds = new HashSet<>();
        for (Map<String,Object> row : audit) {
            long auditId = integral(row.get("id"),1,9_007_199_254_740_991L);
            if (!auditIds.add(auditId)) throw fail("审计记录标识重复。");
            for (String field : List.of("actor","action","target")) string(row.get(field),200,true);
            timestamp(row.get("at"),true);
            String detail = string(row.get("detail"),65535,true);
            if (detail != null && detail.getBytes(StandardCharsets.UTF_8).length > 65535) throw fail("审计详情超出目标数据库字段容量。");
        }
        Set<String> sequenceKeys = new HashSet<>();
        for (Map<String,Object> row : sequences) {
            String prefix = string(row.get("prefix"),8,false), day = string(row.get("day"),8,false);
            validDay(day); long value = integral(row.get("value"),0,9999); String sequenceKey = prefix + ":" + day;
            if (!PREFIXES.contains(prefix) || !sequenceKeys.add(sequenceKey) || value < maxNumbers.getOrDefault(sequenceKey,0L)) throw fail("单据序号重复、越界或低于已有单据。");
        }
        return new Checked(records,files,audit,sequences,key);
    }

    private static void attachments(Object value, String kind, String ownerId, Map<String,Map<String,Object>> files) {
        if (value instanceof List<?> list) { for (Object item : list) attachments(item,kind,ownerId,files); }
        else if (value instanceof Map<?,?>) {
            Map<String,Object> valueMap = map(value);
            for (var entry : valueMap.entrySet()) {
                if ((entry.getKey().equals("files") || entry.getKey().equals("attachments")) && entry.getValue() != null) {
                    for (Map<String,Object> ref : rows(entry.getValue())) {
                        Map<String,Object> file = files.get(identifier(ref.get("id")));
                        if (file == null || !kind.equals(file.get("owner_kind")) || !ownerId.equals(file.get("owner_id"))) throw fail("材料引用缺失或跨越所属业务记录。");
                        if (ref.containsKey("size") && integral(ref.get("size"),0,4 * 1024 * 1024) != ((byte[])file.get("bytes")).length) throw fail("材料引用大小与原文件不一致。");
                    }
                } else attachments(entry.getValue(),kind,ownerId,files);
            }
        }
    }

    private static void imageReferences(Object value, Map<String,Map<String,Object>> files) {
        if (value instanceof List<?> list) { for (Object item : list) imageReferences(item,files); }
        else if (value instanceof Map<?,?>) {
            for (var entry : map(value).entrySet()) {
                if (entry.getKey().equals("image") && entry.getValue() instanceof String image && image.startsWith("/api/product-images/")) {
                    Map<String,Object> file = files.get(image.substring("/api/product-images/".length()));
                    if (file == null || !"product-image".equals(file.get("owner_kind"))) throw fail("商品图片引用缺失或类型错误。");
                } else imageReferences(entry.getValue(),files);
            }
        }
    }

    private static void validateFace(Object value, byte[] key) {
        try {
            String[] parts = string(value,20000,false).split(":",-1);
            if (parts.length != 3 || !parts[0].matches("[a-fA-F0-9]{24}") || !parts[1].matches("[a-fA-F0-9]{32}")) throw new IllegalArgumentException();
            byte[] ciphertext = base64(parts[2],16000), tag = HexFormat.of().parseHex(parts[1]);
            byte[] joined = Arrays.copyOf(ciphertext,ciphertext.length + 16); System.arraycopy(tag,0,joined,ciphertext.length,16);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,HexFormat.of().parseHex(parts[0])));
            Object decoded = JSON.readValue(cipher.doFinal(joined),Object.class);
            if (!(decoded instanceof List<?> list) || list.size() != 128) throw new IllegalArgumentException();
            for (Object item : (List<?>) decoded) if (!(item instanceof Number number) || !Double.isFinite(number.doubleValue()) || Math.abs(number.doubleValue()) > 3) throw new IllegalArgumentException();
        } catch (Exception ex) { throw fail("人脸档案损坏，或导出密钥与档案不匹配；已停止导入。"); }
    }

    private static void reference(Map<String,Map<String,Object>> index, String kind, Object id, boolean required) {
        if (id == null && !required) return;
        if (!index.containsKey(kind + ":" + identifier(id))) throw fail("业务记录引用的关联对象不存在。");
    }
    private static Map<String,Object> object(Object input) { if (!(input instanceof Map<?,?>)) throw fail("迁移对象格式无效。"); return map(input); }
    private static List<Map<String,Object>> rows(Object input) {
        if (!(input instanceof List<?> list)) throw fail("迁移数据表必须为数组。");
        List<Map<String,Object>> result = new ArrayList<>(); for (Object row : list) result.add(object(row)); return result;
    }
    private static String identifier(Object input) {
        String value = string(input,100,false);
        if (!value.equals(value.strip()) || value.chars().anyMatch(Character::isISOControl)) throw fail("迁移记录标识包含空白或控制字符。");
        return value;
    }
    private static String string(Object input, int maximum, boolean nullable) {
        if (input == null && nullable) return null;
        if (!(input instanceof String value) || value.length() > maximum || !nullable && value.isEmpty() || value.indexOf('\0') >= 0) throw fail("迁移文本字段类型或长度无效。");
        return value;
    }
    private static long integral(Object input, long minimum, long maximum) {
        if (!(input instanceof Number)) throw fail("迁移整数格式无效。");
        try { long value = new BigDecimal(input.toString()).longValueExact(); if (value < minimum || value > maximum) throw new ArithmeticException(); return value; }
        catch (ArithmeticException | NumberFormatException ex) { throw fail("迁移整数超出范围或包含小数。"); }
    }
    private static byte[] base64(Object input, int maximum) {
        if (!(input instanceof String value) || value.length() > ((maximum + 2L) / 3) * 4) throw fail("迁移二进制字段大小无效。");
        try {
            byte[] bytes = Base64.getDecoder().decode(value);
            if (bytes.length > maximum || !Base64.getEncoder().encodeToString(bytes).equals(value)) throw new IllegalArgumentException();
            return bytes;
        } catch (IllegalArgumentException ex) { throw fail("迁移二进制字段编码无效。"); }
    }
    private static void validDay(String value) { try { if (value.length() != 8) throw new IllegalArgumentException(); LocalDate.parse(value,DAY); } catch (Exception ex) { throw fail("单据流水日期无效。"); } }
    private static void timestamp(Object input, boolean nullable) {
        String value = string(input,32,nullable); if (value == null) return;
        try { Instant.parse(value); } catch (Exception ex) { throw fail("迁移时间字段无效。"); }
    }
    record Checked(List<Map<String,Object>> records,List<Map<String,Object>> files,List<Map<String,Object>> audit,List<Map<String,Object>> sequences,byte[] key) {}
}

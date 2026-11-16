package cn.sany.forge;

import static cn.sany.forge.J.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.CRC32;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.ErrorHandler;
import org.xml.sax.SAXException;
import org.xml.sax.SAXParseException;

/**
 * 工程材料按文件名、真实内容和 OOXML 包结构联合校验。
 * DOCX 不能仅按 ZIP 魔数判断；先验证目录、大小、CRC 和危险内容，再保存原文件。
 */
public class MaterialFiles {
    private static final int MAX_FILE = 4 * 1024 * 1024;
    private static final int MAX_ENTRY = 16 * 1024 * 1024;
    private static final int MAX_EXPANDED = 32 * 1024 * 1024;
    private static final int MAX_RATIO = 200;
    private static final String DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String MAIN_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
    private static final Map<String, String> TYPES = Map.of(".png", "image/png", ".jpg", "image/jpeg", ".jpeg", "image/jpeg",
        ".webp", "image/webp", ".pdf", "application/pdf", ".docx", DOCX_MIME);
    private static final Pattern INVALID_NAME = Pattern.compile("[<>:\"/\\\\|?*\\x00-\\x1f\\x7f\\u202a-\\u202e\\u2066-\\u2069]");
    private static final Pattern RESERVED_NAME = Pattern.compile("^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern DANGEROUS_PART = Pattern.compile("(vbaproject|activex|embeddings|customui)|\\.(exe|dll|com|scr|bat|cmd|ps1|js|vbs|hta|html?|bin)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern DANGEROUS_XML = Pattern.compile("<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject", Pattern.CASE_INSENSITIVE);
    private final Core c;

    public MaterialFiles(Core c) { this.c = c; }

    public List<Map<String, Object>> add(Object incoming, String kind, String ownerId, boolean required) {
        List<Material> materials = validateIncoming(incoming, required);
        List<Map<String, Object>> result = new ArrayList<>();
        for (Material file : materials) {
            String fileId = id("MAT");
            String at = now();
            c.store.jdbc.update("INSERT INTO files(id,owner_kind,owner_id,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?,?)",
                fileId, kind, ownerId, file.name, file.mime, file.bytes, at);
            result.add(obj("id", fileId, "name", file.name, "mime", file.mime, "size", file.bytes.length, "at", at));
        }
        return result;
    }

    /** 整批预检成功后才写入，调用方的业务事务继续保证材料与业务记录一并提交。 */
    static List<Material> validateIncoming(Object incoming, boolean required) {
        if (!(incoming instanceof List) || ((List<?>) incoming).size() > 4 || required && ((List<?>) incoming).isEmpty()) {
            throw fail("此状态变更需要提交材料，最多 4 个文件。");
        }
        List<Material> result = new ArrayList<>();
        for (Object input : (List<?>) incoming) {
            if (!(input instanceof Map)) throw fail("材料文件格式无效。");
            Map<String, Object> file = map(input);
            String name = text(file.get("name"), 150);
            if (INVALID_NAME.matcher(name).find() || name.endsWith(".") || name.endsWith(" ") || RESERVED_NAME.matcher(name).find()) {
                throw fail("文件名不能包含路径、控制字符或系统保留名称。");
            }
            int dot = name.lastIndexOf('.');
            String extension = dot >= 0 ? name.substring(dot).toLowerCase(Locale.ROOT) : "";
            String expectedMime = TYPES.get(extension);
            if (expectedMime == null) throw fail("文件扩展名仅支持 .docx、.pdf、.jpg、.jpeg、.png 或 .webp。");
            Object data = file.get("data");
            if (!(data instanceof String) || ((String) data).length() > 5_600_000 || !((String) data).matches("[A-Za-z0-9+/]*={0,2}")) {
                throw fail("材料文件无效或超过 4 MB。");
            }
            byte[] bytes;
            try { bytes = Base64.getDecoder().decode((String) data); }
            catch (IllegalArgumentException ex) { throw fail("材料文件编码无效。"); }
            if (bytes.length == 0 || bytes.length > MAX_FILE) throw fail("每份材料限 4 MB。");
            String mime;
            if (starts(bytes, new byte[] {(byte) 137, 80, 78, 71, 13, 10, 26, 10}, 0)) mime = "image/png";
            else if (starts(bytes, new byte[] {(byte) 255, (byte) 216, (byte) 255}, 0)) mime = "image/jpeg";
            else if (starts(bytes, "%PDF-".getBytes(StandardCharsets.US_ASCII), 0)) mime = "application/pdf";
            else if (starts(bytes, "RIFF".getBytes(StandardCharsets.US_ASCII), 0) && starts(bytes, "WEBP".getBytes(StandardCharsets.US_ASCII), 8)) mime = "image/webp";
            else if (isDocx(bytes, name)) mime = DOCX_MIME;
            else throw fail("请上传 JPG、PNG、WebP、PDF 或有效的 DOCX 文档；不支持旧 DOC、宏文档及普通压缩包。");
            if (!mime.equals(expectedMime)) throw fail("文件内容与扩展名不一致，请使用原始文件，勿直接修改后缀。");
            result.add(new Material(name, mime, bytes));
        }
        return result;
    }

    static boolean isDocx(byte[] bytes, String name) {
        if (bytes == null || name == null || !name.toLowerCase(Locale.ROOT).endsWith(".docx") || bytes.length < 22) return false;
        try {
            int end = -1;
            for (int offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
                if (u32(bytes, offset) == 0x06054b50L && offset + 22 + u16(bytes, offset + 20) == bytes.length) { end = offset; break; }
            }
            if (end < 0 || u16(bytes, end + 4) != 0 || u16(bytes, end + 6) != 0) return false;
            int count = u16(bytes, end + 10);
            long centralSize = u32(bytes, end + 12);
            long centralStart = u32(bytes, end + 16);
            if (count < 1 || count > 2000 || count != u16(bytes, end + 8) || centralStart + centralSize != end || centralStart > end) return false;
            int central = (int) centralStart;
            int cursor = central;
            int total = 0;
            Map<String, byte[]> entries = new HashMap<>();
            List<int[]> ranges = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                if (cursor + 46 > end || u32(bytes, cursor) != 0x02014b50L) return false;
                int flags = u16(bytes, cursor + 8);
                int method = u16(bytes, cursor + 10);
                long checksum = u32(bytes, cursor + 16);
                long compressedLong = u32(bytes, cursor + 20);
                long expandedLong = u32(bytes, cursor + 24);
                int nameSize = u16(bytes, cursor + 28);
                int extraSize = u16(bytes, cursor + 30);
                int commentSize = u16(bytes, cursor + 32);
                long localLong = u32(bytes, cursor + 42);
                if ((flags & 0x2041) != 0 || method != 0 && method != 8 || u16(bytes, cursor + 34) != 0
                    || expandedLong > MAX_ENTRY || compressedLong > bytes.length || localLong + 30 > central
                    || cursor + 46L + nameSize + extraSize + commentSize > end) return false;
                int compressed = (int) compressedLong;
                int expanded = (int) expandedLong;
                int local = (int) localLong;
                // 绝对大小限制之外限制压缩比，避免小上传在解压时长时间占用内存和 CPU。
                if (expandedLong > Math.max(1L, compressedLong) * MAX_RATIO) return false;
                String entryName = utf8(bytes, cursor + 46, nameSize);
                String lowerName = entryName.toLowerCase(Locale.ROOT);
                if (entryName.isEmpty() || entryName.indexOf('\\') >= 0 || entryName.indexOf('\u0000') >= 0
                    || entryName.startsWith("/") || entryName.indexOf(':') >= 0 || Arrays.asList(entryName.split("/", -1)).contains("..")
                    || entries.containsKey(lowerName) || DANGEROUS_PART.matcher(entryName).find()
                    || !validExtra(bytes, cursor + 46 + nameSize, extraSize)) return false;
                if (u32(bytes, local) != 0x04034b50L || u16(bytes, local + 6) != flags || u16(bytes, local + 8) != method) return false;
                int localNameSize = u16(bytes, local + 26);
                int localExtraSize = u16(bytes, local + 28);
                long dataStartLong = local + 30L + localNameSize + localExtraSize;
                if (dataStartLong + compressed > central || localNameSize != nameSize
                    || !entryName.equals(utf8(bytes, local + 30, localNameSize))
                    || !validExtra(bytes, local + 30 + localNameSize, localExtraSize)) return false;
                int dataStart = (int) dataStartLong;
                int rangeEnd = dataStart + compressed;
                if ((flags & 8) == 0) {
                    if (u32(bytes, local + 14) != checksum || u32(bytes, local + 18) != compressedLong || u32(bytes, local + 22) != expandedLong) return false;
                } else {
                    // 流式 ZIP 把 CRC 和大小写在数据描述符里，必须与中央目录相同。
                    int descriptor = rangeEnd;
                    if (descriptor + 4 <= central && u32(bytes, descriptor) == 0x08074b50L) descriptor += 4;
                    if (descriptor + 12 > central || u32(bytes, descriptor) != checksum || u32(bytes, descriptor + 4) != compressedLong
                        || u32(bytes, descriptor + 8) != expandedLong) return false;
                    rangeEnd = descriptor + 12;
                }
                ranges.add(new int[] {local, rangeEnd});
                byte[] expandedBytes;
                if (method == 0) {
                    if (compressed != expanded) return false;
                    expandedBytes = Arrays.copyOfRange(bytes, dataStart, dataStart + compressed);
                } else expandedBytes = inflate(bytes, dataStart, compressed, expanded);
                if (expandedBytes.length != expanded) return false;
                CRC32 crc = new CRC32();
                crc.update(expandedBytes);
                if (crc.getValue() != checksum) return false;
                total += expandedBytes.length;
                if (total > MAX_EXPANDED) return false;
                if ((lowerName.endsWith(".xml") || lowerName.endsWith(".rels")) && DANGEROUS_XML.matcher(xmlText(expandedBytes)).find()) return false;
                entries.put(lowerName, expandedBytes);
                cursor += 46 + nameSize + extraSize + commentSize;
            }
            ranges.sort(Comparator.comparingInt(value -> value[0]));
            if (cursor != end || ranges.isEmpty() || ranges.get(0)[0] != 0) return false;
            for (int i = 1; i < ranges.size(); i++) if (ranges.get(i)[0] < ranges.get(i - 1)[1]) return false;
            return validWordPackage(entries);
        } catch (Exception ex) {
            return false;
        }
    }

    /** 不支持 ZIP64 或 AES 扩展，避免扩展字段与已校验的 32 位目录产生第二套尺寸解释。 */
    private static boolean validExtra(byte[] bytes, int start, int length) {
        int end = start + length;
        if (start < 0 || end < start || end > bytes.length) return false;
        int cursor = start;
        while (cursor < end) {
            if (cursor + 4 > end) return false;
            int tag = u16(bytes, cursor);
            int size = u16(bytes, cursor + 2);
            if (tag == 1 || tag == 0x9901 || cursor + 4 + size > end) return false;
            cursor += 4 + size;
        }
        return cursor == end;
    }

    private static byte[] inflate(byte[] bytes, int offset, int compressed, int expanded) throws DataFormatException {
        Inflater inflater = new Inflater(true);
        try {
            inflater.setInput(bytes, offset, compressed);
            ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(expanded, 65536));
            byte[] chunk = new byte[8192];
            while (!inflater.finished()) {
                int size = inflater.inflate(chunk);
                if (size > 0) {
                    if ((long) output.size() + size > MAX_ENTRY || output.size() + size > expanded) throw new DataFormatException("解压大小超过声明或限制。");
                    output.write(chunk, 0, size);
                } else if (!inflater.finished()) throw new DataFormatException("压缩数据不完整或需要字典。");
            }
            if (inflater.getRemaining() != 0) throw new DataFormatException("压缩条目存在多余数据。");
            return output.toByteArray();
        } finally { inflater.end(); }
    }

    /** 只接受标准 Word 主文档类型、包入口关系和正文命名空间，并关闭所有外部解析。 */
    private static boolean validWordPackage(Map<String, byte[]> entries) throws Exception {
        byte[] typesBytes = entries.get("[content_types].xml");
        byte[] relsBytes = entries.get("_rels/.rels");
        byte[] documentBytes = entries.get("word/document.xml");
        if (typesBytes == null || relsBytes == null || documentBytes == null) return false;
        Document types = xml(typesBytes);
        Document relationships = xml(relsBytes);
        Document document = xml(documentBytes);
        boolean override = false;
        NodeList overrides = types.getElementsByTagNameNS("*", "Override");
        for (int i = 0; i < overrides.getLength(); i++) {
            Element element = (Element) overrides.item(i);
            if ("/word/document.xml".equals(element.getAttribute("PartName")) && MAIN_TYPE.equals(element.getAttribute("ContentType"))) override = true;
        }
        boolean office = false;
        NodeList links = relationships.getElementsByTagNameNS("*", "Relationship");
        for (int i = 0; i < links.getLength(); i++) {
            Element element = (Element) links.item(i);
            String type = element.getAttribute("Type");
            String target = element.getAttribute("Target");
            if (type.matches("https?://(?:schemas\\.openxmlformats\\.org/officeDocument/2006|purl\\.oclc\\.org/ooxml/officeDocument)/relationships/officeDocument")
                && (target.equals("word/document.xml") || target.equals("/word/document.xml")) && !"External".equalsIgnoreCase(element.getAttribute("TargetMode"))) office = true;
        }
        Element root = document.getDocumentElement();
        return override && office && "document".equals(root.getLocalName())
            && ("http://schemas.openxmlformats.org/wordprocessingml/2006/main".equals(root.getNamespaceURI())
                || "http://purl.oclc.org/ooxml/wordprocessingml/main".equals(root.getNamespaceURI()));
    }

    private static Document xml(byte[] bytes) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        var builder = factory.newDocumentBuilder();
        builder.setErrorHandler(new ErrorHandler() {
            public void warning(SAXParseException ex) throws SAXException { throw ex; }
            public void error(SAXParseException ex) throws SAXException { throw ex; }
            public void fatalError(SAXParseException ex) throws SAXException { throw ex; }
        });
        return builder.parse(new ByteArrayInputStream(bytes));
    }

    private static String xmlText(byte[] bytes) {
        if (bytes.length >= 2 && ((bytes[0] == (byte) 0xff && bytes[1] == (byte) 0xfe) || (bytes[0] == (byte) 0xfe && bytes[1] == (byte) 0xff))) {
            return new String(bytes, StandardCharsets.UTF_16);
        }
        // 去除 NUL 后也检查 UTF-16 无 BOM 的 ASCII 标记，不能靠换编码隐藏宏或实体声明。
        return new String(bytes, StandardCharsets.UTF_8).replace("\u0000", "");
    }

    private static String utf8(byte[] bytes, int start, int size) throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes, start, size)).toString();
    }

    private static int u16(byte[] bytes, int offset) {
        if (offset < 0 || offset + 2 > bytes.length) throw new IllegalArgumentException("ZIP 目录越界。");
        return (bytes[offset] & 255) | ((bytes[offset + 1] & 255) << 8);
    }

    private static long u32(byte[] bytes, int offset) {
        return ((long) u16(bytes, offset) | ((long) u16(bytes, offset + 2) << 16)) & 0xffffffffL;
    }

    private static boolean starts(byte[] bytes, byte[] signature, int offset) {
        if (offset < 0 || bytes.length < offset + signature.length) return false;
        for (int i = 0; i < signature.length; i++) if (bytes[offset + i] != signature[i]) return false;
        return true;
    }

    static final class Material {
        final String name;
        final String mime;
        final byte[] bytes;
        Material(String name, String mime, byte[] bytes) { this.name = name; this.mime = mime; this.bytes = bytes; }
    }
}

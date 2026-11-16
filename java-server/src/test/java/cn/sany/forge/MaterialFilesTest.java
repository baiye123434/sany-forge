package cn.sany.forge;

import static cn.sany.forge.J.obj;
import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;

/** 使用独立 JDK ZIP 写入器生成夹具，覆盖真实压缩流、目录篡改和材料上传约束。 */
class MaterialFilesTest {
    private static final byte[] PNG = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMVEAAAAASUVORK5CYII=");
    private static final String TYPES = "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>";
    private static final String RELS = "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
    private static final String DOCUMENT = "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>隔离测试工程资料</w:t></w:r></w:p></w:body></w:document>";

    @Test void acceptsStoredAndStreamingDeflatedWordPackages() throws Exception {
        assertTrue(MaterialFiles.isDocx(zip(wordParts(), false), "工程资料.docx"));
        byte[] compressed = zip(wordParts(), true);
        assertTrue(MaterialFiles.isDocx(compressed, "工程资料.DOCX"));
        var files = MaterialFiles.validateIncoming(List.of(upload("工程资料.docx", compressed), upload("现场.png", PNG)), true);
        assertEquals(2, files.size());
        assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document", files.get(0).mime);
        assertArrayEquals(compressed, files.get(0).bytes);
        assertEquals("image/png", files.get(1).mime);
    }

    @Test void enforcesBatchShapeCountRequiredAndFourMegabyteLimit() {
        assertTrue(MaterialFiles.validateIncoming(List.of(), false).isEmpty());
        assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(null, false));
        assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(List.of(), true));
        assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(List.of(upload("a.png", PNG), upload("b.png", PNG),
            upload("c.png", PNG), upload("d.png", PNG), upload("e.png", PNG)), true));
        byte[] oversized = new byte[4 * 1024 * 1024 + 1];
        System.arraycopy(PNG, 0, oversized, 0, PNG.length);
        assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(List.of(upload("大图.png", oversized)), true));
        assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(List.of(obj("name", "a.png", "data", "%%%")), true));
    }

    @Test void rejectsWindowsReservedNamesTraversalControlsAndDisguisedExtensions() {
        for (String name : List.of("../资料.png", "C:\\资料.png", "资料:stream.png", "CON.png", "LPT9.png", "NUL.png",
                "资料\u0000.png", "图\u202egnp.exe.png", "伪装.html", "伪装.docm", "图片.pdf", "图片.docx", "图片.png.")) {
            assertThrows(J.ApiException.class, () -> MaterialFiles.validateIncoming(List.of(upload(name, PNG)), true), name);
        }
    }

    @Test void rejectsOrdinaryZipAndMissingRequiredWordParts() throws Exception {
        assertFalse(MaterialFiles.isDocx(zip(List.of(new Part("readme.txt", "not a Word document")), true), "普通.docx"));
        assertFalse(MaterialFiles.isDocx("PK\u0003\u0004not a package".getBytes(StandardCharsets.UTF_8), "伪造.docx"));
        List<Part> missing = wordParts();
        missing.remove(1);
        assertFalse(MaterialFiles.isDocx(zip(missing, true), "缺失关系.docx"));
    }

    @Test void rejectsDangerousPartsAndDuplicateCaseInsensitiveNames() throws Exception {
        for (String name : List.of("word/vbaProject.bin", "word/activeX/control.xml", "word/embeddings/oleObject.bin", "customUI/ribbon.xml",
                "../escape.txt", "word/run.ps1", "word/show.html", "word\\escape.xml", "/root.xml", "C:escape.xml", "WORD/DOCUMENT.XML")) {
            List<Part> parts = wordParts();
            parts.add(new Part(name, "danger"));
            assertFalse(MaterialFiles.isDocx(zip(parts, true), "危险.docx"), name);
        }
    }

    @Test void rejectsDtdEntitiesMacroTypesAndExternalMainDocument() throws Exception {
        List<Part> dtd = wordParts();
        dtd.set(2, new Part("word/document.xml", "<?xml version=\"1.0\"?><!DOCTYPE x [<!ENTITY danger SYSTEM \"file:///test\">]>" + DOCUMENT.substring(DOCUMENT.indexOf("<w:document"))));
        assertFalse(MaterialFiles.isDocx(zip(dtd, true), "实体.docx"));
        List<Part> macros = wordParts();
        macros.set(0, new Part("[Content_Types].xml", TYPES.replace("wordprocessingml.document.main+xml", "wordprocessingml.document.macroEnabled.main+xml")));
        assertFalse(MaterialFiles.isDocx(zip(macros, true), "宏.docx"));
        List<Part> external = wordParts();
        external.set(1, new Part("_rels/.rels", RELS.replace("Target=", "TargetMode=\"External\" Target=")));
        assertFalse(MaterialFiles.isDocx(zip(external, true), "外部正文.docx"));
    }

    @Test void rejectsMalformedXmlEvenWithWordLookingText() throws Exception {
        List<Part> parts = wordParts();
        parts.set(2, new Part("word/document.xml", DOCUMENT.replace("</w:document>", "")));
        assertFalse(MaterialFiles.isDocx(zip(parts, false), "残缺正文.docx"));
    }

    @Test void rejectsChecksumCorruptionAndLocalCentralMismatch() throws Exception {
        byte[] crc = zip(wordParts(), false);
        int central = centralOffset(crc);
        crc[14] ^= 1;
        crc[central + 16] ^= 1;
        assertFalse(MaterialFiles.isDocx(crc, "错误校验.docx"));
        byte[] names = zip(wordParts(), false);
        names[30] = 'X';
        assertFalse(MaterialFiles.isDocx(names, "目录不一致.docx"));
        byte[] flags = zip(wordParts(), false);
        flags[6] ^= 8;
        assertFalse(MaterialFiles.isDocx(flags, "标志不一致.docx"));
    }

    @Test void rejectsEncryptionMultiDiskAndTrailingBytes() throws Exception {
        byte[] encrypted = zip(wordParts(), false);
        encrypted[6] |= 1;
        encrypted[centralOffset(encrypted) + 8] |= 1;
        assertFalse(MaterialFiles.isDocx(encrypted, "加密.docx"));
        byte[] multiDisk = zip(wordParts(), false);
        multiDisk[multiDisk.length - 22 + 4] = 1;
        assertFalse(MaterialFiles.isDocx(multiDisk, "多卷.docx"));
        byte[] valid = zip(wordParts(), false);
        assertFalse(MaterialFiles.isDocx(java.util.Arrays.copyOf(valid, valid.length + 1), "附加数据.docx"));
    }

    @Test void rejectsTamperedStreamingDescriptor() throws Exception {
        byte[] bytes = zip(wordParts(), true);
        int central = centralOffset(bytes);
        int compressed = little(bytes).getInt(central + 20);
        int nameSize = Short.toUnsignedInt(little(bytes).getShort(26));
        int extra = Short.toUnsignedInt(little(bytes).getShort(28));
        int descriptor = 30 + nameSize + extra + compressed;
        assertEquals(0x08074b50, little(bytes).getInt(descriptor));
        bytes[descriptor + 4] ^= 1;
        assertFalse(MaterialFiles.isDocx(bytes, "错误描述符.docx"));
    }

    @Test void rejectsExpansionBombAndOversizedDeclaredEntry() throws Exception {
        List<Part> bomb = wordParts();
        bomb.add(new Part("word/large.txt", "x".repeat(1024 * 1024)));
        byte[] compressed = zip(bomb, true);
        assertTrue(compressed.length < 4 * 1024 * 1024);
        assertFalse(MaterialFiles.isDocx(compressed, "解压炸弹.docx"));
        byte[] large = zip(wordParts(), false);
        little(large).putInt(centralOffset(large) + 24, 17 * 1024 * 1024);
        assertFalse(MaterialFiles.isDocx(large, "超大条目.docx"));
    }

    private static Map<String, Object> upload(String name, byte[] bytes) {
        return obj("name", name, "data", Base64.getEncoder().encodeToString(bytes));
    }

    private static List<Part> wordParts() {
        return new ArrayList<>(List.of(new Part("[Content_Types].xml", TYPES), new Part("_rels/.rels", RELS), new Part("word/document.xml", DOCUMENT)));
    }

    private static byte[] zip(List<Part> parts, boolean deflated) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            for (Part part : parts) {
                byte[] content = part.content.getBytes(StandardCharsets.UTF_8);
                ZipEntry entry = new ZipEntry(part.name);
                if (!deflated) {
                    CRC32 crc = new CRC32();
                    crc.update(content);
                    entry.setMethod(ZipEntry.STORED);
                    entry.setSize(content.length);
                    entry.setCompressedSize(content.length);
                    entry.setCrc(crc.getValue());
                }
                zip.putNextEntry(entry);
                zip.write(content);
                zip.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private static ByteBuffer little(byte[] bytes) { return ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN); }
    private static int centralOffset(byte[] bytes) { return little(bytes).getInt(bytes.length - 22 + 16); }
    private record Part(String name, String content) {}
}

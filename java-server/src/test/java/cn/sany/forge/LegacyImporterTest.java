package cn.sany.forge;

import static cn.sany.forge.J.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.function.Supplier;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/** 只使用本测试生成的快照和临时密钥，不查找或读取任何真实旧平台资料。 */
class LegacyImporterTest {
    @TempDir Path temp;
    private final ObjectMapper json = new ObjectMapper();
    private final byte[] importedKey = new byte[32];
    private final String at = "2026-10-27T00:00:00.000Z";
    LegacyImporterTest() { for (int i = 0; i < 32; i++) importedKey[i] = (byte)(i + 1); }

    private Map<String,Object> fixture() {
        byte[] png = new byte[] {(byte)137,80,78,71,13,10,26,10};
        Map<String,Object> record = obj("kind","order","id","SO-fixture","body",obj("id","SO-fixture","number","SO-20261027-0004","revision",1,
            "history",List.of(obj("files",List.of(obj("id","MAT-fixture","size",png.length))))));
        return obj("format","sany-forge-legacy-v1","exportedAt",at,"faceKey",Base64.getEncoder().encodeToString(importedKey),
            "records",new ArrayList<>(List.of(record)),"files",new ArrayList<>(List.of(obj("id","MAT-fixture","owner_kind","order","owner_id","SO-fixture","name","fixture.png","mime","image/png","data",Base64.getEncoder().encodeToString(png),"created_at",at))),
            "audit",new ArrayList<>(List.of(obj("id",7,"actor","合成测试","action","创建记录","target","SO-fixture","at",at,"detail","仅测试"))),
            "documentSequences",new ArrayList<>(List.of(obj("prefix","SO","day","20261027","value",4))));
    }

    private Core core(boolean occupied) throws Exception {
        Core c = mock(Core.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        byte[] currentKey = new byte[32]; Arrays.fill(currentKey,(byte)99);
        Files.write(temp.resolve("face.key"),currentKey,StandardOpenOption.CREATE_NEW);
        ReflectionTestUtils.setField(c,"dataDir",temp);
        ReflectionTestUtils.setField(c,"faceKey",currentKey.clone());
        ReflectionTestUtils.setField(c,"store",new Store(jdbc,json));
        when(jdbc.queryForObject(anyString(),eq(Long.class))).thenReturn(occupied ? 1L : 0L);
        when(c.json(any())).thenAnswer(call -> json.writeValueAsString(call.getArgument(0)));
        when(c.atomic(any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(0)).get());
        return c;
    }
    private Path save(Map<String,Object> value) throws Exception {
        Path file = temp.resolve("export-" + UUID.randomUUID() + ".json"); json.writeValue(file.toFile(),value); return file;
    }
    private void invalid(Map<String,Object> value) { assertThrows(J.ApiException.class,() -> LegacyImporter.validate(value)); }

    @Test void validSnapshotKeepsEveryByteAndOptionalOldSequences() {
        Map<String,Object> fixture = fixture(); LegacyImporter.Checked value = LegacyImporter.validate(fixture);
        assertArrayEquals(importedKey,value.key()); assertEquals(1,value.records().size());
        assertArrayEquals(Base64.getDecoder().decode(s(maps(fixture.get("files")).get(0),"data")),(byte[])value.files().get(0).get("bytes"));
        fixture.put("documentSequences",List.of()); assertEquals(0,LegacyImporter.validate(fixture).sequences().size());
    }

    @Test void mismatchedDuplicateOrUnknownRecordIsRejected() {
        Map<String,Object> value = fixture(); map(maps(value.get("records")).get(0).get("body")).put("id","other"); invalid(value);
        value = fixture(); arr(value.get("records")).add(maps(value.get("records")).get(0)); invalid(value);
        value = fixture(); maps(value.get("records")).get(0).put("kind","session"); invalid(value);
    }

    @Test void missingCrossRecordOrWrongSizedMaterialIsRejected() {
        Map<String,Object> value = fixture(); maps(value.get("files")).get(0).put("owner_id","missing"); invalid(value);
        value = fixture(); maps(value.get("files")).get(0).put("mime","application/pdf"); invalid(value);
        value = fixture(); map(maps(value.get("records")).get(0).get("body")).put("files",List.of(obj("id","MAT-fixture","size",1))); invalid(value);
        value = fixture(); maps(value.get("files")).get(0).put("data",Base64.getEncoder().encodeToString(new byte[4 * 1024 * 1024 + 1])); invalid(value);
    }

    @Test void invalidSequenceDateDuplicateFractionAndLagAreRejected() {
        for (Object number : List.of(3,10000,1.5,"4")) { Map<String,Object> value = fixture(); maps(value.get("documentSequences")).get(0).put("value",number); invalid(value); }
        Map<String,Object> value = fixture(); maps(value.get("documentSequences")).get(0).put("day","20260230"); invalid(value);
        value = fixture(); arr(value.get("documentSequences")).add(maps(value.get("documentSequences")).get(0)); invalid(value);
    }

    @Test void encryptedFaceMustMatchExactLegacyKey() throws Exception {
        Map<String,Object> value = fixture(); byte[] iv = new byte[12];
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(importedKey,"AES"),new GCMParameterSpec(128,iv));
        byte[] encrypted = cipher.doFinal(json.writeValueAsBytes(Collections.nCopies(128,0.25)));
        String face = HexFormat.of().formatHex(iv) + ":" + HexFormat.of().formatHex(Arrays.copyOfRange(encrypted,encrypted.length - 16,encrypted.length)) + ":" + Base64.getEncoder().encodeToString(Arrays.copyOf(encrypted,encrypted.length - 16));
        arr(value.get("records")).add(obj("kind","user","id","USR-fixture","body",obj("id","USR-fixture","username","fixture","active",true,"role","admin","password","a".repeat(32) + ":" + "b".repeat(64),"face",face)));
        assertEquals(2,LegacyImporter.validate(value).records().size());
        value.put("faceKey",Base64.getEncoder().encodeToString(new byte[32])); invalid(value);
        value.put("faceKey",Base64.getEncoder().encodeToString(new byte[31])); invalid(value);
    }

    @Test void successfulImportUsesBoundInsertsAndRestoresKeyExactly() throws Exception {
        Core c = core(false); Map<String,Object> result = LegacyImporter.run(c,save(fixture()));
        assertEquals(obj("records",1,"files",1,"audit",1,"documentSequences",1),result);
        assertArrayEquals(importedKey,Files.readAllBytes(temp.resolve("face.key"))); assertArrayEquals(importedKey,c.faceKey);
        long inserts = mockingDetails(c.store.jdbc).getInvocations().stream().filter(call -> call.getMethod().getName().equals("update")).count();
        assertEquals(4,inserts);
        try (var paths = Files.list(temp)) { assertEquals(1,paths.filter(path -> path.getFileName().toString().startsWith("face.before-legacy-")).count()); }
    }

    @Test void occupiedDatabaseIsNeverOverwrittenAndKeyStaysUnchanged() throws Exception {
        Core c = core(true); byte[] original = c.faceKey.clone();
        assertEquals(409,assertThrows(J.ApiException.class,() -> LegacyImporter.run(c,save(fixture()))).status);
        assertArrayEquals(original,Files.readAllBytes(temp.resolve("face.key")));
        assertFalse(mockingDetails(c.store.jdbc).getInvocations().stream().anyMatch(call -> call.getMethod().getName().equals("update")));
    }

    @Test void commitFailureRestoresOriginalFileAndKeepsRecoveryBackup() throws Exception {
        Core c = core(false); byte[] original = c.faceKey.clone();
        doAnswer(call -> { ((Supplier<?>)call.getArgument(0)).get(); throw new IllegalStateException("synthetic commit failure"); }).when(c).atomic(any());
        assertThrows(J.ApiException.class,() -> LegacyImporter.run(c,save(fixture())));
        assertArrayEquals(original,Files.readAllBytes(temp.resolve("face.key"))); assertArrayEquals(original,c.faceKey);
        try (var paths = Files.list(temp)) {
            Path backup = paths.filter(path -> path.getFileName().toString().startsWith("face.before-legacy-")).findFirst().orElseThrow();
            assertArrayEquals(original,Files.readAllBytes(backup));
        }
    }

    @Test void malformedOrDuplicateJsonFailsBeforeDatabaseAccess() throws Exception {
        Core c = mock(Core.class); Path input = temp.resolve("bad.json");
        Files.writeString(input,"{\"format\":\"secret-never-log\",\"format\":\"sany-forge-legacy-v1\"}",StandardCharsets.UTF_8);
        J.ApiException error = assertThrows(J.ApiException.class,() -> LegacyImporter.run(c,input));
        assertFalse(error.getMessage().contains("secret-never-log")); verifyNoInteractions(c);
        Files.writeString(input,json.writeValueAsString(fixture()) + " {}",StandardCharsets.UTF_8);
        assertThrows(J.ApiException.class,() -> LegacyImporter.run(c,input)); verifyNoInteractions(c);
    }
}

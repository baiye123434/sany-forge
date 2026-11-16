package cn.sany.forge;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;

/** 保留 V3 的 JSON 字段与校验规则，集中处理 Java 和 JavaScript 的数值及空值差异。 */
public final class J {
    private J() {}
    public static class ApiException extends RuntimeException {
        public final int status;
        public ApiException(String message,int status) { super(message); this.status=status; }
    }
    public static ApiException fail(String message) { return fail(message,400); }
    public static ApiException fail(String message,int status) { return new ApiException(message,status); }
    public static Map<String,Object> obj(Object... pairs) {
        Map<String,Object> result=new LinkedHashMap<>();
        for(int i=0;i<pairs.length;i+=2) result.put(String.valueOf(pairs[i]),pairs[i+1]);
        return result;
    }
    @SuppressWarnings("unchecked") public static Map<String,Object> map(Object value) { return value instanceof Map ? (Map<String,Object>)value : obj(); }
    @SuppressWarnings("unchecked") public static List<Object> arr(Object value) { return value instanceof List ? (List<Object>)value : new ArrayList<>(); }
    public static List<Map<String,Object>> maps(Object value) { return arr(value).stream().map(J::map).toList(); }
    public static Map<String,Object> copy(Map<String,Object> value) { return new LinkedHashMap<>(value); }
    public static String s(Map<String,Object> value,String key) { return value==null||value.get(key)==null ? "" : String.valueOf(value.get(key)); }
    public static int n(Map<String,Object> value,String key) { Object v=value==null?null:value.get(key); return v instanceof Number?((Number)v).intValue():0; }
    public static boolean b(Map<String,Object> value,String key) { return value!=null&&Boolean.TRUE.equals(value.get(key)); }
    public static boolean truthy(Object value) { return value!=null&&!Boolean.FALSE.equals(value)&&!(value instanceof String s&&s.isEmpty())&&!(value instanceof Number n&&n.doubleValue()==0); }
    public static String text(Object value,int max) { return text(value,max,true); }
    public static String text(Object value,int max,boolean required) {
        if(!(value instanceof String v)||v.length()>max||(required&&v.trim().isEmpty())) throw fail("请完整填写必填内容，并检查长度。");
        return ((String)value).trim();
    }
    public static int integer(Object value,int min,int max) {
        try { double n=value instanceof Boolean b?(b?1:0):value==null?0:Double.parseDouble(value.toString().isBlank()?"0":value.toString());
            if(!Double.isFinite(n)||n!=Math.rint(n)||n<min||n>max) throw fail("数字超出允许范围。"); return (int)n;
        } catch(NumberFormatException e) { throw fail("数字超出允许范围。"); }
    }
    public static String phone(Object value) { String v=text(value,30); if(!v.matches("[+\\d()\\s-]{6,30}")||v.replaceAll("\\D","").length()<6) throw fail("请填写有效联系电话。"); return v; }
    public static String phoneKey(Object value) { return (value==null?"":value.toString()).replaceAll("[()\\s-]","").replaceFirst("^(?:\\+?86|0086)(1[3-9]\\d{9})$","$1"); }
    public static String date(Object value) { try { String v=text(value,10); if(!v.matches("\\d{4}-\\d{2}-\\d{2}")||!LocalDate.parse(v).toString().equals(v)) throw fail("日期无效。"); return v; } catch(Exception e) { throw fail("日期无效。"); } }
    public static String hash(Object value) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(String.valueOf(value).getBytes(StandardCharsets.UTF_8))); } catch(Exception e) { throw new IllegalStateException(e); } }
    public static String now() { return DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC).format(Instant.now()); }
    public static String id(String prefix) { return prefix+"-"+UUID.randomUUID(); }
}

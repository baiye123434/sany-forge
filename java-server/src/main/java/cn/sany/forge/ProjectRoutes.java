package cn.sany.forge;

import static cn.sany.forge.J.*;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** 工程需求与业务客服保留原接口；客户回执仅授权一笔订单或一个工程需求。 */
public final class ProjectRoutes {
    private final Core c;
    private final SecureRandom random = new SecureRandom();
    private static final byte[] ACCESS_AAD = "sany-platform:receipt:v1".getBytes(StandardCharsets.UTF_8);
    private static final List<String> ALL_ROLES = List.of("admin","service","reviewer");

    public ProjectRoutes(Core c) { this.c = c; }

    private Map<String,Object> clean(Map<String,Object> record) { Map<String,Object> result = copy(record); result.remove("secretHash"); return result; }

    public Map<String,Object> lookup(String kind, String value) {
        Map<String,Object> record = c.get(kind,value);
        return record != null ? record : c.all(kind).stream().filter(item -> value.equals(s(item,"number"))).findFirst().orElse(null);
    }

    /** 与 Node 的 HKDF-SHA256 保持相同参数，确保导入旧密钥后既有查询链接仍可解封。 */
    private byte[] accessSecret() throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(new byte[32],"HmacSHA256"));
        byte[] extracted = mac.doFinal(c.faceKey);
        mac.init(new SecretKeySpec(extracted,"HmacSHA256"));
        mac.update("sany-receipt-access-v1".getBytes(StandardCharsets.UTF_8));
        return mac.doFinal(new byte[]{1});
    }

    private String makeAccessKey(Map<String,Object> record, String kind) {
        try {
            byte[] iv = new byte[12]; random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(accessSecret(),"AES"),new GCMParameterSpec(128,iv));
            cipher.updateAAD(ACCESS_AAD);
            byte[] sealed = cipher.doFinal(c.json(obj("version",1,"purpose","receipt","kind",kind,"id",record.get("id"),"secretHash",record.get("secretHash"))).getBytes(StandardCharsets.UTF_8));
            /* Java 输出为密文后接认证标签；旧格式为版本、IV、标签、密文，因此显式换位。 */
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            output.write(1); output.write(iv); output.write(sealed,sealed.length-16,16); output.write(sealed,0,sealed.length-16);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(output.toByteArray());
        } catch (Exception error) { throw new IllegalStateException("无法创建查询凭证。",error); }
    }

    public Map<String,Object> receipt(Map<String,Object> record, String kind) {
        if(kind.equals("order")&&truthy(record.get("salesId"))) throw fail("内部销售订单不能生成客户查询凭证。",403);
        return obj(kind,clean(record),"accessKey",makeAccessKey(record,kind),"token",c.guestSession(s(record,"id"),kind));
    }

    private Map<String,Object> readAccessKey(Object value) {
        try {
            if (!(value instanceof String input) || input.length() > 1600 || !input.matches("[\\w-]+")) throw new IllegalArgumentException();
            byte[] bytes = Base64.getUrlDecoder().decode(input);
            if (bytes.length < 30 || bytes[0] != 1) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(accessSecret(),"AES"),new GCMParameterSpec(128,Arrays.copyOfRange(bytes,1,13)));
            cipher.updateAAD(ACCESS_AAD);
            ByteArrayOutputStream sealed = new ByteArrayOutputStream(); sealed.write(bytes,29,bytes.length-29); sealed.write(bytes,13,16);
            Map<String,Object> payload = map(c.parse(new String(cipher.doFinal(sealed.toByteArray()),StandardCharsets.UTF_8)));
            String kind = s(payload,"kind");
            if (!(payload.get("version") instanceof Number version) || version.doubleValue() != 1 || !s(payload,"purpose").equals("receipt") || !List.of("order","project").contains(kind)) throw new IllegalArgumentException();
            Map<String,Object> record = c.get(kind,s(payload,"id"));
            if (record == null || !truthy(record.get("secretHash")) || !Objects.equals(record.get("secretHash"),payload.get("secretHash"))) throw new IllegalArgumentException();
            return obj("kind",kind,"record",record);
        } catch (Exception error) { throw fail("查询链接无效、已失效或不属于本机数据，请重新查询。",401); }
    }

    public Map<String,Object> ownRecord(Req req, String kind, String recordId, String... staffRoles) {
        Map<String,Object> access = c.auth(req);
        if (access.get("user") instanceof Map<?,?>) {
            if(kind.equals("order")) c.staff.requireVisible(map(access.get("user")),c.get("order",recordId));
            else if(s(map(access.get("user")),"role").equals("service")) throw fail("客服只能访问本人分配的订单和客户会话。",403);
            List<String> allowed = staffRoles.length == 0 ? ALL_ROLES : Arrays.asList(staffRoles);
            if (!allowed.contains(s(map(access.get("user")),"role"))) throw fail("当前账号没有此操作权限。",403);
        } else {
            String field = kind.equals("order") ? "orderId" : "projectId", other = kind.equals("order") ? "projectId" : "orderId";
            if (!recordId.equals(s(access,field)) || truthy(access.get(other))) throw fail("不能访问其他客户的资料。",403);
        }
        return access;
    }

    private List<Map<String,Object>> projectItems(Object incoming) {
        if (!(incoming instanceof List<?> rows) || rows.size() > 50) throw fail("设备清单最多 50 项，请检查格式。");
        Map<String,Map<String,Object>> products = new LinkedHashMap<>();
        for (Map<String,Object> product : c.publicProducts()) if (!b(product,"exhibitOnly")) products.put(s(product,"id"),product);
        Set<String> seen = new HashSet<>(); List<Map<String,Object>> result = new ArrayList<>();
        for (Object value : rows) {
            if (!(value instanceof Map<?,?>)) throw fail("设备清单格式无效。");
            Map<String,Object> item = map(value), product = products.get(s(item,"productId"));
            if (product == null) throw fail("清单中存在已下架或教学设备，请重新选择。");
            if (!seen.add(s(product,"id"))) throw fail("同一设备请合并数量，不要重复添加。");
            Map<String,Object> snapshot = new LinkedHashMap<>();
            for (String field : List.of("id","code","name","category","subcategory","image")) if (product.containsKey(field)) snapshot.put(field,product.get(field));
            snapshot.put("referencePrice",truthy(product.get("referencePrice")) ? product.get("referencePrice") : null);
            result.add(obj("productId",product.get("id"),"quantity",integer(item.get("quantity"),1,999),"product",snapshot));
        }
        return result;
    }

    private void checkProjectContent(boolean confidential, List<?> items, Object incoming) {
        if (!(incoming instanceof List<?> files)) throw fail("材料文件格式无效。");
        if (confidential && !files.isEmpty()) throw fail("保密工程只接收设备清单，不接收设计资料附件。");
        if (confidential && items.isEmpty()) throw fail("保密工程至少选择一项设备。");
        if (!confidential && items.isEmpty() && files.isEmpty()) throw fail("请选择设备或上传工程资料。");
    }

    private Map<String,Object> cardFor(String kind, Map<String,Object> record) {
        Map<String,Object> product = map(record.get("product"));
        List<Map<String,Object>> items = maps(record.get("items"));
        Map<String,Object> first = items.isEmpty() ? new LinkedHashMap<>() : items.get(0);
        Object image = kind.equals("order") ? product.get("image") : truthy(map(first.get("product")).get("image")) ? map(first.get("product")).get("image") : truthy(first.get("image")) ? first.get("image") : "";
        Map<String,Object> card=obj("kind",kind,"recordId",record.get("id"),"number",truthy(record.get("number")) ? record.get("number") : record.get("id"),
                "title",kind.equals("order") ? s(product,"code") + " " + s(product,"name") : record.get("title"),"image",image,"status",record.get("status"),"confidential",kind.equals("project") && b(record,"confidential"));
        // 工作人员会话列表用客户身份作主标题，设备名称只保留为关联业务摘要。
        if(kind.equals("order")) card.putAll(obj("customerName",truthy(record.get("customerName"))?record.get("customerName"):record.get("contact"),
                "customerPhone",truthy(record.get("customerPhone"))?record.get("customerPhone"):record.get("phone")));
        return card;
    }

    private Map<String,Object> cleanConversation(Map<String,Object> conversation) {
        Map<String,Object> record = c.get(s(conversation,"kind"),s(conversation,"recordId")), result = copy(conversation);
        List<Map<String,Object>> messages = maps(result.remove("messages"));
        result.put("record",record == null ? null : cardFor(s(conversation,"kind"),record));
        result.put("lastMessage",messages.isEmpty() ? null : publicMessage(messages.get(messages.size()-1)));
        return result;
    }

    public Map<String,Object> conversationAccess(Req req, String conversationId) {
        Map<String,Object> conversation = c.get("conversation",conversationId);
        if (conversation == null) throw fail("客服会话不存在。",404);
        Map<String,Object> access = ownRecord(req,s(conversation,"kind"),s(conversation,"recordId"),"admin","service");
        return obj("conversation",conversation,"access",access);
    }

    public Map<String,Object> publicMessage(Map<String,Object> message) { Map<String,Object> result = copy(message); result.remove("clientMessageId"); result.remove("actorId"); return result; }

    private boolean visibleConversation(Map<String,Object> user, Map<String,Object> conversation) {
        if (!s(conversation,"kind").equals("order")) return false;
        return c.staff.visible(user,c.get("order",s(conversation,"recordId")));
    }

    private long supportUnread(Map<String,Object> user) {
        return c.all("supportChat").stream().filter(chat -> s(user,"id").equals(s(chat,"assigneeId")))
                .mapToLong(chat -> maps(chat.get("messages")).stream().filter(message -> s(message,"sender").equals("customer") && n(message,"seq") > n(chat,"readByStaff")).count()).sum();
    }

    private List<String> ticketOrderIds(Map<String,Object> user) {
        return c.all("ticket").stream().map(ticket -> s(ticket,"orderId")).filter(orderId -> c.staff.visible(user,c.get("order",orderId))).distinct().toList();
    }

    private long after(Req req) {
        try {
            String query = req.query("after"); double number = query == null || query.isEmpty() ? 0 : Double.parseDouble(query);
            if (!Double.isFinite(number) || number < 0 || number > 9_007_199_254_740_991D || Math.floor(number) != number) throw new NumberFormatException();
            return (long) number;
        } catch (RuntimeException error) { throw fail("数字超出允许范围。"); }
    }

    public Object handle(Req req, Map<String,Object> body) {
        String path = req.path(), method = req.method();
        if (path.equals("/api/guest/phone-projects") && method.equals("POST")) {
            c.checkPhoneQuery(); String key = phoneKey(phone(body.get("phone")));
            return obj("projects",c.all("project").stream().filter(project -> phoneKey(project.get("phone")).equals(key))
                    .sorted(Comparator.comparing((Map<String,Object> project) -> s(project,"createdAt")).reversed().thenComparing(project -> s(project,"id")))
                    .map(project -> obj("id",project.get("id"),"number",project.get("number"),"title",project.get("title"),"status",project.get("status"),"createdAt",project.get("createdAt"))).toList());
        }
        if (path.equals("/api/guest/phone-project") && method.equals("POST")) {
            c.checkPhoneQuery(); String key = phoneKey(phone(body.get("phone")));
            Map<String,Object> project = lookup("project",text(body.get("projectId"),100));
            if (project == null || !phoneKey(project.get("phone")).equals(key)) throw fail("联系电话与项目不匹配。",401);
            return receipt(project,"project");
        }
        if (path.equals("/api/guest/access") && method.equals("POST")) {
            Map<String,Object> decoded = readAccessKey(body.get("key")), result = obj("kind",decoded.get("kind"));
            result.putAll(receipt(map(decoded.get("record")),s(decoded,"kind"))); return result;
        }
        if (path.equals("/api/projects/lookup") && method.equals("POST")) {
            Map<String,Object> project = lookup("project",text(body.get("projectId"),100));
            if (project == null || !Objects.equals(project.get("phone"),body.get("phone")) || !(body.get("code") instanceof String) || !hash(body.get("code")).equals(s(project,"secretHash"))) throw fail("工单号、电话或查询凭证不匹配。",401);
            return receipt(project,"project");
        }
        if (path.equals("/api/projects") && method.equals("POST")) return c.atomic(() -> {
            Map<String,Object> customer = c.customers.customer(req);
            if (body.containsKey("customerType") && body.get("customerType") == null) throw fail("请选择个人或企业用户类型。");
            if (!(body.get("confidential") instanceof Boolean)) throw fail("请选择是否使用保密设备清单模式。");
            boolean confidential = b(body,"confidential");
            List<Map<String,Object>> items = projectItems(truthy(body.get("items")) ? body.get("items") : List.of());
            Object incoming = truthy(body.get("files")) ? body.get("files") : List.of();
            checkProjectContent(confidential,items,incoming);
            byte[] secret = new byte[12]; random.nextBytes(secret); String accessCode = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
            Map<String,Object> project = obj("customerId",customer.get("id"),"customerType",c.customers.customerType(body.get("customerType")),"id",id("PR"),"number",c.documentNumber("PR"),
                    "title",text(body.get("title"),120),"contact",text(body.get("contact"),40),"phone",phone(body.get("phone")),"notes",text(truthy(body.get("notes")) ? body.get("notes") : "",4000,false),
                    "confidential",confidential,"items",items,"status","submitted","revision",1,"secretHash",hash(accessCode),"createdAt",now(),"updatedAt",now());
            List<Map<String,Object>> files = c.addFiles(incoming,"project",s(project,"id"),false); project.put("files",files);
            project.put("history",List.of(obj("id",id("EV"),"from",null,"to","submitted","actor","客户","role","customer","note",truthy(project.get("notes")) ? project.get("notes") : "客户提交工程需求，等待审核。","files",files,"at",now())));
            c.put("project",project); c.audit("客户","提交工程需求工单",s(project,"id"));
            Map<String,Object> result = receipt(project,"project"); result.put("accessCode",accessCode); return result;
        });
        if (path.equals("/api/projects") && method.equals("GET")) { c.auth(req,"admin","service","reviewer"); return obj("projects",c.all("project").stream().map(this::clean).toList()); }
        Matcher projectPath = Pattern.compile("^/api/projects/([\\w-]+)(?:/(review|supplement))?$").matcher(path);
        if (projectPath.matches()) {
            Map<String,Object> project = lookup("project",projectPath.group(1)); if (project == null) throw fail("工程工单不存在。",404);
            Map<String,Object> access = ownRecord(req,"project",s(project,"id"));
            if (method.equals("GET") && projectPath.group(2) == null) return obj("project",clean(project));
            if (method.equals("POST") && projectPath.group(2) != null) return c.atomic(() -> {
                Map<String,Object> current = c.get("project",s(project,"id")); c.revision(current,body);
                String next, note; List<Map<String,Object>> files; Map<String,Object> extra = new LinkedHashMap<>();
                if (projectPath.group(2).equals("review")) {
                    c.auth(req,"admin","reviewer");
                    Map<String,List<String>> transitions = Map.of("submitted",List.of("reviewing","needs_info"),"reviewing",List.of("needs_info","accepted"),"accepted",List.of("closed"));
                    next = s(body,"status");
                    if (!transitions.getOrDefault(s(current,"status"),List.of()).contains(next)) throw fail("当前工程工单不能跳转到此状态。",409);
                    note = text(body.get("note"),2000);
                    if (b(current,"confidential") && !arr(body.get("files")).isEmpty()) throw fail("保密工程不接收设计资料附件。");
                    files = c.addFiles(truthy(body.get("files")) ? body.get("files") : List.of(),"project",s(current,"id"),false);
                } else {
                    if (!truthy(access.get("projectId"))) throw fail("只有此工单客户可以补充资料。",403);
                    if (!s(current,"status").equals("needs_info")) throw fail("当前工单不处于待补充资料状态。",409);
                    note = text(body.get("notes"),4000);
                    List<Map<String,Object>> items = body.containsKey("items") ? projectItems(body.get("items")) : maps(current.get("items"));
                    if (body.containsKey("files") && !(body.get("files") instanceof List<?>)) throw fail("材料文件格式无效。");
                    List<Object> combined = new ArrayList<>(arr(current.get("files"))); combined.addAll(arr(body.get("files")));
                    checkProjectContent(b(current,"confidential"),items,combined);
                    files = c.addFiles(truthy(body.get("files")) ? body.get("files") : List.of(),"project",s(current,"id"),false);
                    extra.put("items",items); extra.put("notes",note); next = "submitted";
                }
                List<Map<String,Object>> merged = new ArrayList<>(maps(current.get("files"))); merged.addAll(files); extra.put("files",merged);
                Map<String,Object> updated = c.transition(current,next,access,note,files,extra);
                c.put("project",updated); c.audit(s(access,"actor"),"工程工单 " + s(current,"status") + " → " + next,s(current,"id"));
                return obj("project",clean(updated));
            });
        }
        if (path.equals("/api/conversations") && method.equals("POST")) return c.atomic(() -> {
            String kind = s(body,"kind"); if (!List.of("order","project").contains(kind)) throw fail("请选择有效订单或工程工单。");
            Map<String,Object> record = lookup(kind,text(body.get("recordId"),100)); if (record == null) throw fail("关联记录不存在。",404);
            Map<String,Object> access = ownRecord(req,kind,s(record,"id"),"admin","service");
            Map<String,Object> existing = c.all("conversation").stream().filter(value -> kind.equals(s(value,"kind")) && Objects.equals(value.get("recordId"),record.get("id"))).findFirst().orElse(null);
            if (existing != null) return obj("conversation",cleanConversation(existing));
            Map<String,Object> conversation = obj("id",id("CHAT"),"kind",kind,"recordId",record.get("id"),"createdAt",now(),"updatedAt",now(),"readByCustomer",0,"readByStaff",0,"latestSeq",0,"messages",new ArrayList<>());
            c.put("conversation",conversation); c.audit(s(access,"actor"),"建立本机客服会话",s(conversation,"id"));
            return obj("conversation",cleanConversation(conversation));
        });
        if (path.equals("/api/conversations/unread") && method.equals("GET")) {
            Map<String,Object> user = map(c.auth(req,"service").get("user"));
            List<Map<String,Object>> conversations = c.all("conversation").stream().filter(chat -> visibleConversation(user,chat)).map(chat -> obj("kind",chat.get("kind"),"recordId",chat.get("recordId"),
                    "unread",maps(chat.get("messages")).stream().filter(message -> s(message,"sender").equals("customer") && n(message,"seq") > n(chat,"readByStaff")).count())).filter(chat -> n(chat,"unread") > 0).toList();
            return obj("supportUnread",supportUnread(user),"ticketOrderIds",ticketOrderIds(user),"conversations",conversations);
        }
        if (path.equals("/api/conversations") && method.equals("GET")) {
            Map<String,Object> user = map(c.auth(req,"service").get("user"));
            return obj("supportUnread",supportUnread(user),"ticketOrderIds",ticketOrderIds(user),"conversations",c.all("conversation").stream().filter(chat -> visibleConversation(user,chat)).map(this::cleanConversation).sorted(Comparator.comparing((Map<String,Object> chat) -> s(chat,"updatedAt")).reversed()).toList());
        }
        Matcher conversationPath = Pattern.compile("^/api/conversations/([\\w-]+)(?:/(messages|read))?$").matcher(path);
        if (conversationPath.matches()) {
            Map<String,Object> bundle = conversationAccess(req,conversationPath.group(1)), conversation = map(bundle.get("conversation")), access = map(bundle.get("access"));
            if (method.equals("GET") && conversationPath.group(2) == null) {
                long after = after(req); List<Map<String,Object>> messages = maps(conversation.get("messages")).stream().filter(message -> n(message,"seq") > after).limit(200).toList();
                long latest = messages.isEmpty() ? Math.min(after,n(conversation,"latestSeq")) : n(messages.get(messages.size()-1),"seq");
                return obj("conversation",cleanConversation(conversation),"messages",messages.stream().map(this::publicMessage).toList(),"latestSeq",latest,"hasMore",!messages.isEmpty() && latest < n(conversation,"latestSeq"));
            }
            if (method.equals("POST") && "messages".equals(conversationPath.group(2))) return c.atomic(() -> {
                Map<String,Object> current = c.get("conversation",s(conversation,"id"));
                String clientMessageId = text(body.get("clientMessageId"),100); if (!clientMessageId.matches("[\\w.-]+")) throw fail("消息重试标识无效。");
                boolean staff = access.get("user") instanceof Map<?,?>; Map<String,Object> user = map(access.get("user"));
                String sender = staff ? "staff" : "customer", actorId = staff ? s(user,"id") : "customer:" + s(current,"recordId");
                List<Map<String,Object>> messages = new ArrayList<>(maps(current.get("messages")));
                Map<String,Object> duplicate = messages.stream().filter(message -> clientMessageId.equals(s(message,"clientMessageId")) && actorId.equals(s(message,"actorId"))).findFirst().orElse(null);
                if (duplicate != null) return obj("message",publicMessage(duplicate),"latestSeq",current.get("latestSeq"));
                if (messages.size() >= 5000) throw fail("本机会话已达到演示容量，请联系管理员归档。",429);
                String messageText = text(truthy(body.get("text")) ? body.get("text") : "",2000,false);
                if (body.containsKey("sendCard") && !(body.get("sendCard") instanceof Boolean)) throw fail("订单卡片参数无效。");
                if (body.containsKey("card") || body.containsKey("recordId") || body.containsKey("fileIds")) throw fail("请使用当前会话的发送订单功能，不能指定其他客户的卡片或材料。");
                Map<String,Object> record = c.get(s(current,"kind"),s(current,"recordId"));
                if (s(current,"kind").equals("project") && b(record,"confidential") && !arr(body.get("files")).isEmpty()) throw fail("保密工程客服会话不接收设计资料附件。");
                List<Map<String,Object>> files = c.addFiles(truthy(body.get("files")) ? body.get("files") : List.of(),"conversation",s(current,"id"),false);
                if (messageText.isEmpty() && files.isEmpty() && !b(body,"sendCard")) throw fail("请输入消息、添加附件或发送当前订单卡片。");
                Map<String,Object> message = obj("id",id("MSG"),"seq",n(current,"latestSeq")+1,"sender",sender,"senderName",staff ? user.get("name") : record.get("contact"),
                        "text",messageText,"files",files,"card",b(body,"sendCard") ? cardFor(s(current,"kind"),record) : null,"at",now(),"clientMessageId",clientMessageId,"actorId",actorId);
                messages.add(message); current.put("messages",messages); current.put("latestSeq",message.get("seq")); current.put("updatedAt",message.get("at")); c.put("conversation",current);
                if(!staff && s(current,"kind").equals("order")) c.staff.notifyCustomerConversation(record,messageText);
                return obj("message",publicMessage(message),"latestSeq",message.get("seq"));
            });
            if (method.equals("POST") && "read".equals(conversationPath.group(2))) return c.atomic(() -> {
                Map<String,Object> current = c.get("conversation",s(conversation,"id"));
                int seq = integer(body.get("seq"),0,n(current,"latestSeq")); String field = access.get("user") instanceof Map<?,?> ? "readByStaff" : "readByCustomer";
                current.put(field,Math.max(n(current,field),seq)); c.put("conversation",current); return obj("conversation",cleanConversation(current));
            });
        }
        return null;
    }

    /** 只接受人工提供的实际参考区间与来源，空区间仍保持待询价。 */
    public static Object referencePrice(Object value) {
        if (value == null) return null;
        if (!(value instanceof Map<?,?>)) throw fail("参考价格格式无效。");
        Map<String,Object> input = map(value), result = new LinkedHashMap<>();
        for (String field : List.of("buyMin","buyMax","rentMonthlyMin","rentMonthlyMax")) {
            Object amount = input.get(field);
            if (amount == null || amount.equals("")) { result.put(field,null); continue; }
            if (!(amount instanceof Number number) || !Double.isFinite(number.doubleValue()) || number.doubleValue() <= 0 || number.doubleValue() > 1e12 || new BigDecimal(amount.toString()).stripTrailingZeros().scale() > 2) throw fail("参考价格必须为正数，最多两位小数。");
            result.put(field,amount);
        }
        for (String[] pair : List.of(new String[]{"buyMin","buyMax"},new String[]{"rentMonthlyMin","rentMonthlyMax"})) {
            Object min = result.get(pair[0]), max = result.get(pair[1]);
            if ((min == null) != (max == null) || (min != null && ((Number)max).doubleValue() < ((Number)min).doubleValue())) throw fail("参考价格范围需完整填写，且上限不能低于下限。");
        }
        if (result.values().stream().allMatch(Objects::isNull)) return null;
        result.putAll(obj("source",text(input.get("source"),300),"currency","CNY","updatedAt",now())); return result;
    }
}

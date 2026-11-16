package cn.sany.forge;

import static cn.sany.forge.J.*;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 客户账号及通用咨询使用独立令牌域，避免客户令牌取得工作人员权限。 */
public final class CustomerRoutes {
    private final Core c;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, CustomerSession> sessions = new ConcurrentHashMap<>();
    private final Map<String, Attempt> attempts = new ConcurrentHashMap<>();
    private record CustomerSession(String id, long expires) {}
    private static final class Attempt {
        int count;
        final long until;
        Attempt(long until) { this.until = until; }
    }

    public CustomerRoutes(Core c) { this.c = c; }

    private Map<String,Object> publicCustomer(Map<String,Object> customer) {
        return obj("id", customer.get("id"), "phone", customer.get("phone"),
                "active", customer.get("active"), "createdAt", customer.get("createdAt"));
    }

    private String mobile(Object value) {
        String phone = phoneKey(text(value, 30));
        if (!phone.matches("1[3-9]\\d{9}")) throw fail("请输入完整的11位手机号。");
        return phone;
    }

    public Map<String,Object> customer(Req req) { return customer(req, true); }

    public Map<String,Object> customer(Req req, boolean required) {
        String token = req.token();
        CustomerSession session = sessions.get(token);
        if (session == null || session.expires() < System.currentTimeMillis()) {
            sessions.remove(token);
            if (required || !token.isEmpty()) throw fail("客户登录已失效，请重新登录。", 401);
            return null;
        }
        Map<String,Object> customer = c.get("customer", session.id());
        if (customer == null || !b(customer, "active")) throw fail("客户账号已停用。", 403);
        return customer;
    }

    private Map<String,Object> session(Map<String,Object> customer) {
        long at = System.currentTimeMillis();
        sessions.entrySet().removeIf(entry -> entry.getValue().expires() < at);
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        sessions.put(token, new CustomerSession(s(customer,"id"), at + 8 * 3_600_000L));
        return obj("token", token, "customer", publicCustomer(customer));
    }

    private void revoke(String customerId) {
        sessions.entrySet().removeIf(entry -> entry.getValue().id().equals(customerId));
    }

    public void revokeAll() { sessions.clear(); }

    private void throttle(String key, int limit) {
        long at = System.currentTimeMillis();
        attempts.entrySet().removeIf(entry -> entry.getValue().until < at);
        Attempt attempt = attempts.computeIfAbsent(key, ignored -> new Attempt(at + 60_000));
        if (++attempt.count > limit) throw fail("操作过于频繁，请一分钟后重试。", 429);
    }

    public String customerType(Object value) {
        if (value == null) return null;
        if (!List.of("personal", "enterprise").contains(value)) throw fail("请选择个人或企业用户类型。");
        return (String) value;
    }

    public boolean belongsToCustomer(Map<String,Object> record, Map<String,Object> customer) {
        if (record == null) return false;
        // 客服代客户建单仍属于客户本人；是否由员工创建不能成为隐藏客户订单的条件。
        return Objects.equals(record.get("customerId"), customer.get("id")) ||
                (!truthy(record.get("customerId")) && phoneKey(record.get("phone")).equals(s(customer,"phone")));
    }

    private long unread(Map<String,Object> chat, String sender, String cursor) {
        return maps(chat.get("messages")).stream()
                .filter(message -> sender.equals(s(message,"sender")) && n(message,"seq") > n(chat,cursor)).count();
    }

    public Map<String,Object> chatAccess(Req req, Map<String,Object> chat) {
        if (sessions.containsKey(req.token())) {
            Map<String,Object> customer = customer(req);
            if (!Objects.equals(chat.get("customerId"), customer.get("id"))) throw fail("不能访问其他客户会话。",403);
            return obj("actor", "客户", "sender", "customer");
        }
        Map<String,Object> access = c.auth(req,"service");
        if(!s(map(access.get("user")),"id").equals(s(chat,"assigneeId"))) throw fail("不能访问其他客服负责的会话。",403);
        return obj("actor", access.get("actor"), "sender", "staff");
    }

    private long sequence(Object value) {
        try {
            double number = value == null ? 0 : value instanceof Boolean flag ? (flag ? 1 : 0) : Double.parseDouble(String.valueOf(value).isBlank() ? "0" : String.valueOf(value));
            if (!Double.isFinite(number) || number < 0 || number > 9_007_199_254_740_991D || Math.floor(number) != number) throw new NumberFormatException();
            return (long) number;
        } catch (RuntimeException error) { throw fail("消息游标无效。"); }
    }

    public Object handle(Req req, Map<String,Object> body) {
        String path = req.path(), method = req.method();
        if (!path.startsWith("/api/customer/")) return null;
        if (List.of("/api/customer/register","/api/customer/login").contains(path) && method.equals("POST")) {
            String number = mobile(body.get("phone"));
            throttle("auth:" + number,10);
            throttle("auth-global",100);
            if (path.endsWith("/register")) return c.atomic(() -> {
                if (!Objects.equals(body.get("password"),body.get("repeat"))) throw fail("两次输入的密码不一致。");
                if (c.all("customer").stream().anyMatch(customer -> number.equals(s(customer,"phone")))) throw fail("手机号已注册，请直接登录。",409);
                Map<String,Object> customer = obj("id",id("CU"),"phone",number,"password",c.passwordHash(body.get("password")),"active",true,"createdAt",now());
                c.put("customer",customer);
                c.audit("客户","注册客户账号",s(customer,"id"));
                return session(customer);
            });
            Map<String,Object> customer = c.all("customer").stream().filter(item -> number.equals(s(item,"phone"))).findFirst().orElse(null);
            if (customer == null || !b(customer,"active") || !c.verifyPassword(body.get("password"),s(customer,"password"))) throw fail("手机号或密码错误，或账号已停用。",401);
            return session(customer);
        }
        if (path.equals("/api/customer/logout") && method.equals("POST")) { sessions.remove(req.token()); return obj("ok",true); }
        if (path.equals("/api/customer/me") && method.equals("GET")) return obj("customer",publicCustomer(customer(req)));
        if (path.equals("/api/customer/password") && method.equals("POST")) return c.atomic(() -> {
            Map<String,Object> customer = customer(req);
            throttle("password:" + s(customer,"id"),10);
            if (!c.verifyPassword(body.get("currentPassword"),s(customer,"password"))) throw fail("原密码不正确。",401);
            if (!Objects.equals(body.get("password"),body.get("repeat"))) throw fail("两次输入的密码不一致。");
            customer.put("password",c.passwordHash(body.get("password")));
            c.put("customer",customer);
            revoke(s(customer,"id"));
            c.audit("客户","修改客户密码",s(customer,"id"));
            return obj("ok",true);
        });
        if (path.equals("/api/customer/accounts") && method.equals("GET")) {
            c.auth(req,"admin");
            return obj("customers",c.all("customer").stream().map(this::publicCustomer).toList());
        }
        Matcher account = Pattern.compile("^/api/customer/accounts/([\\w-]+)$").matcher(path);
        if (account.matches() && method.equals("POST")) return c.atomic(() -> {
            Map<String,Object> access = c.auth(req,"admin"), customer = c.get("customer",account.group(1));
            if (customer == null) throw fail("客户不存在。",404);
            if (!(body.get("active") instanceof Boolean)) throw fail("账号状态无效。");
            customer.put("active",body.get("active"));
            c.put("customer",customer); revoke(s(customer,"id"));
            c.audit(s(access,"actor"),b(customer,"active") ? "启用客户账号" : "停用客户账号",s(customer,"id"));
            return obj("customer",publicCustomer(customer));
        });
        if (path.equals("/api/customer/after-sales") && method.equals("GET")) {
            Map<String,Object> customer = customer(req);
            List<Map<String,Object>> tickets = c.all("ticket").stream()
                    .filter(ticket -> belongsToCustomer(c.get("order",s(ticket,"orderId")),customer))
                    .map(ticket -> obj("id",ticket.get("id"),"number",truthy(ticket.get("number")) ? ticket.get("number") : ticket.get("id"),
                            "orderId",ticket.get("orderId"),"title",truthy(map(ticket.get("product")).get("name")) ? map(ticket.get("product")).get("name") : "设备报修",
                            "issue",ticket.get("issue"),"status",ticket.get("status"),"createdAt",ticket.get("createdAt")))
                    .sorted(Comparator.comparing((Map<String,Object> item) -> s(item,"createdAt")).reversed()).toList();
            return obj("tickets",tickets);
        }
        if (path.equals("/api/customer/records") && method.equals("GET")) {
            Map<String,Object> customer = customer(req);
            List<Map<String,Object>> records = new ArrayList<>();
            for (String kind : List.of("order","project")) for (Map<String,Object> record : c.all(kind)) if (belongsToCustomer(record,customer)) {
                Object title = truthy(record.get("title")) ? record.get("title") : truthy(map(record.get("product")).get("name")) ? map(record.get("product")).get("name") : "设备订单";
                Map<String,Object> item = obj("kind",kind,"id",record.get("id"),"title",title,"status",record.get("status"),"createdAt",record.get("createdAt"));
                for (String field : List.of("number","mode","quantity")) if (record.containsKey(field)) item.put(field,record.get(field));
                records.add(item);
            }
            records.sort(Comparator.comparing((Map<String,Object> item) -> s(item,"createdAt")).reversed());
            return obj("records",records);
        }
        if (path.equals("/api/customer/record") && method.equals("POST")) {
            Map<String,Object> customer = customer(req);
            String kind = s(body,"kind");
            if (!List.of("order","project").contains(kind)) throw fail("记录类型无效。");
            Map<String,Object> record = c.get(kind,text(body.get("id"),100));
            if (!belongsToCustomer(record,customer)) throw fail("不能访问其他客户的记录。",403);
            Map<String,Object> response = obj("kind",kind); response.putAll(c.projects.receipt(record,kind)); return response;
        }
        if (path.equals("/api/customer/notifications") && method.equals("GET")) {
            Map<String,Object> customer = customer(req);
            Map<String,Object> support = c.all("supportChat").stream().filter(chat -> Objects.equals(chat.get("customerId"),customer.get("id"))).findFirst().orElse(null);
            List<Map<String,Object>> records = c.all("conversation").stream()
                    .filter(chat -> List.of("order","project").contains(s(chat,"kind")) && belongsToCustomer(c.get(s(chat,"kind"),s(chat,"recordId")),customer))
                    .map(chat -> obj("kind",chat.get("kind"),"id",chat.get("recordId"),"unread",unread(chat,"staff","readByCustomer"))).toList();
            return obj("supportUnread",support == null ? 0 : unread(support,"staff","readByCustomer"),"records",records);
        }
        Matcher read = Pattern.compile("^/api/customer/chats/([\\w-]+)/read$").matcher(path);
        if (read.matches() && method.equals("POST")) return c.atomic(() -> {
            Map<String,Object> chat = c.get("supportChat",read.group(1));
            if (chat == null) throw fail("会话不存在。",404);
            Map<String,Object> access = chatAccess(req,chat);
            String field = s(access,"sender").equals("customer") ? "readByCustomer" : "readByStaff";
            if (!body.containsKey("seq")) throw fail("消息游标无效。");
            long seq = sequence(body.get("seq")); List<Map<String,Object>> messages = maps(chat.get("messages"));
            long maximum = messages.isEmpty() ? 0 : n(messages.get(messages.size()-1),"seq");
            if (seq > maximum) throw fail("消息游标无效。");
            chat.put(field,Math.max(n(chat,field),seq)); c.put("supportChat",chat); return obj("ok",true);
        });
        if (path.equals("/api/customer/chat") && method.equals("POST")) return c.atomic(() -> {
            Map<String,Object> customer = customer(req);
            Map<String,Object> chat = c.all("supportChat").stream().filter(item -> Objects.equals(item.get("customerId"),customer.get("id"))).findFirst().orElse(null);
            if (chat == null) { chat = obj("id",id("CS"),"customerId",customer.get("id"),"createdAt",now(),"updatedAt",now(),"messages",new ArrayList<>()); c.put("supportChat",chat); }
            c.staff.dispatchChats();
            return obj("chat",obj("id",chat.get("id")));
        });
        if (path.equals("/api/customer/chats") && method.equals("GET")) {
            Map<String,Object> access = c.auth(req,"service");
            c.staff.dispatchChats();
            List<Map<String,Object>> chats = c.all("supportChat").stream().filter(chat -> s(map(access.get("user")),"id").equals(s(chat,"assigneeId"))).map(chat -> {
                Map<String,Object> owner = c.get("customer",s(chat,"customerId")); List<Map<String,Object>> messages = maps(chat.get("messages"));
                String phone=owner==null?"":s(owner,"phone");
                List<Map<String,Object>> customerOrders=c.all("order").stream().filter(o->Objects.equals(o.get("customerId"),chat.get("customerId"))||!phone.isEmpty()&&phoneKey(o.get("phone")).equals(phoneKey(phone)))
                        .sorted(Comparator.comparing((Map<String,Object> order)->s(order,"createdAt")).reversed()).toList();
                Map<String,Object> latestOrder=customerOrders.isEmpty()?null:customerOrders.get(0);
                Object customerName=latestOrder==null?"":truthy(latestOrder.get("customerName"))?latestOrder.get("customerName"):latestOrder.get("contact");
                return obj("id",chat.get("id"),"phone",owner == null ? "已停用客户" : owner.get("phone"),"customerName",customerName,"updatedAt",chat.get("updatedAt"),
                        "repeatCustomer",customerOrders.size()>1,"customerOrderCount",customerOrders.size(),"lastMessage",messages.isEmpty() ? "" : s(messages.get(messages.size()-1),"text"),"count",messages.size(),"unread",unread(chat,"customer","readByStaff"));
            }).sorted(Comparator.<Map<String,Object>,Boolean>comparing(item->b(item,"repeatCustomer")).reversed().thenComparing(Comparator.comparing((Map<String,Object> item)->s(item,"updatedAt")).reversed())).toList();
            return obj("chats",chats);
        }
        Matcher messagePath = Pattern.compile("^/api/customer/chats/([\\w-]+)/messages$").matcher(path);
        if (messagePath.matches()) {
            Map<String,Object> chat = c.get("supportChat",messagePath.group(1));
            if (chat == null) throw fail("会话不存在。",404);
            Map<String,Object> access = chatAccess(req,chat);
            if (method.equals("GET")) {
                long after = sequence(req.query("after"));
                return obj("messages",maps(chat.get("messages")).stream().filter(message -> n(message,"seq") > after).limit(200).toList());
            }
            if (method.equals("POST")) return c.atomic(() -> {
                Map<String,Object> current = c.get("supportChat",messagePath.group(1));
                String content = text(body.getOrDefault("text",""),2000,false), requestId = text(body.get("requestId"),100), sender = s(access,"sender");
                if(content.isEmpty()&&arr(body.get("files")).isEmpty()) throw fail("请输入文字或选择图片、文件。");
                List<Map<String,Object>> messages = new ArrayList<>(maps(current.get("messages")));
                Map<String,Object> duplicate = messages.stream().filter(message -> requestId.equals(s(message,"requestId")) && sender.equals(s(message,"sender"))).findFirst().orElse(null);
                if (duplicate != null) { if (!content.equals(s(duplicate,"text"))) throw fail("重复提交的消息内容不同。",409); return obj("message",duplicate); }
                throttle("chat:"+s(current,"id"),60);
                if (messages.size() >= 5000) throw fail("演示会话已达5000条上限。");
                Map<String,Object> message = obj("id",id("MSG"),"seq",messages.size()+1,"text",content,"sender",sender,"senderName",access.get("actor"),"requestId",requestId,"at",now());
                message.put("files",c.addFiles(body.getOrDefault("files",List.of()),"supportChat",s(current,"id"),false));
                messages.add(message); current.put("messages",messages); current.put("updatedAt",now()); c.put("supportChat",current);
                if(sender.equals("customer")) c.staff.notifySupportChat(current,content);
                c.audit(s(access,"actor"),"客服会话消息",s(current,"id"),content+" 附件数："+arr(message.get("files")).size());
                return obj("message",message);
            });
        }
        throw fail("客户接口不存在。",404);
    }
}

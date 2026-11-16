package cn.sany.forge;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static cn.sany.forge.J.*;

/**
 * 保持 V3 前端的租购、交付、售后和管理接口契约。
 * 状态及修订检查在事务内重新读取记录，防止 Java 多线程同时提交旧版本。
 */
public final class BusinessRoutes {
    private static final String[] ROLES = {"admin", "service", "reviewer"};
    private static final Pattern ORDER_PATH = Pattern.compile("^/api/orders/([\\w-]+)(?:/(transition|confirm))?$");
    private static final Pattern TICKET_PATH = Pattern.compile("^/api/tickets/([\\w-]+)(?:/(transition|review|accept))?$");
    private static final Pattern USER_PATH = Pattern.compile("^/api/admin/users/([\\w-]+)$");
    private static final Pattern IMAGE_PATH = Pattern.compile("^/api/product-images/([\\w-]+)$");
    private static final Pattern PRODUCT_PATH = Pattern.compile("^/api/admin/products/([\\w-]+)$");
    private static final Pattern FILE_PATH = Pattern.compile("^/api/files/([\\w-]+)$");
    private static final SecureRandom RANDOM = new SecureRandom();
    final Core c;

    public BusinessRoutes(Core c) { this.c = c; }

    public Object handle(Req req, Map<String, Object> body) {
        String path = req.path(), method = req.method();
        if (path.equals("/api/products") && method.equals("GET")) return obj("products", c.publicProducts());
        if (path.equals("/api/orders") && method.equals("POST")) return c.atomic(() -> createOrder(req, body));
        if (path.equals("/api/guest/phone-orders") && method.equals("POST")) return phoneOrders(req,body);
        if (path.equals("/api/guest/phone-order") && method.equals("POST")) return openPhoneOrder(req,body);
        if (path.equals("/api/guest/lookup") && method.equals("POST")) {
            Map<String, Object> order = c.projects.lookup("order", text(body.get("orderId"), 100));
            if (order == null || !Objects.equals(order.get("phone"), body.get("phone")) ||
                !(body.get("code") instanceof String) || !hash(body.get("code")).equals(s(order, "secretHash"))) {
                throw fail("订单号、电话或查询凭证不匹配。", 401);
            }
            return c.projects.receipt(order, "order");
        }
        if (path.equals("/api/orders") && method.equals("GET")) {
            c.auth(req, ROLES);
            return obj("orders", c.all("order").stream().map(BusinessRoutes::cleanOrder).toList());
        }
        Matcher orderMatch = ORDER_PATH.matcher(path);
        if (orderMatch.matches()) {
            String key = orderMatch.group(1), action = orderMatch.group(2);
            if (method.equals("POST")) return c.atomic(() -> transitionOrder(req, key, action, body));
            Map<String, Object> order = lookupOrder(key);
            c.ownOrder(req, s(order, "id"));
            if (method.equals("GET")) return obj("order", cleanOrder(order), "tickets", c.all("ticket").stream()
                .filter(ticket -> Objects.equals(ticket.get("orderId"), order.get("id"))).toList());
        }
        if (path.equals("/api/tickets") && method.equals("GET")) {
            c.auth(req, ROLES);
            return obj("tickets", c.all("ticket"));
        }
        if (path.equals("/api/tickets") && method.equals("POST")) return c.atomic(() -> createTicket(req, body));
        Matcher ticketMatch = TICKET_PATH.matcher(path);
        if (ticketMatch.matches()) {
            String key = ticketMatch.group(1), action = ticketMatch.group(2);
            if (method.equals("POST")) return c.atomic(() -> transitionTicket(req, key, action, body));
            Map<String, Object> ticket = requireTicket(key);
            c.ownOrder(req, s(ticket, "orderId"));
            if (method.equals("GET")) return obj("ticket", ticket);
        }
        if (path.equals("/api/staff")) {
            c.auth(req, ROLES);
            return obj("users", c.all("user").stream().filter(user -> b(user, "active")).map(c::publicUser).toList());
        }
        if (path.equals("/api/admin/users")) {
            Map<String, Object> access = c.auth(req, "admin");
            if (method.equals("GET")) return obj("users", c.all("user").stream().map(c::publicUser).toList());
            if (method.equals("POST")) return c.atomic(() -> createUser(body, access));
        }
        Matcher userMatch = USER_PATH.matcher(path);
        if (userMatch.matches() && method.equals("PATCH")) {
            String userId = userMatch.group(1);
            return c.atomic(() -> updateUser(req, userId, body));
        }
        /* 产品图片可公开读取，工单文件则必须经过独立的业务归属校验。 */
        if (path.equals("/api/admin/product-images") && method.equals("POST")) return c.atomic(() -> {
            Map<String, Object> access = c.auth(req, "admin");
            Map<String, Object> file = c.addFiles(List.of(obj("name", body.get("name"), "data", body.get("data"))),
                "product-image", id("IMAGE"), true).get(0);
            if (!s(file, "mime").startsWith("image/")) throw fail("商品照片只支持 JPG、PNG 或 WebP。");
            c.audit(s(access, "actor"), "上传产品图片", s(file, "id"));
            return obj("image", "/api/product-images/" + s(file, "id"), "file", file);
        });
        Matcher imageMatch = IMAGE_PATH.matcher(path);
        if (imageMatch.matches() && method.equals("GET")) {
            Map<String, Object> file = c.store.file(imageMatch.group(1));
            if (file == null || !s(file, "owner_kind").equals("product-image")) throw fail("产品图片不存在。", 404);
            return binary(file, false);
        }
        if (path.equals("/api/admin/products")) {
            Map<String, Object> access = c.auth(req, "admin");
            if (method.equals("GET")) return obj("products", c.products(), "catalog", c.loadJson("catalog-audit.json", obj()));
            if (method.equals("POST") || method.equals("PATCH")) return c.atomic(() -> saveProduct(method, body, access));
        }
        Matcher productMatch = PRODUCT_PATH.matcher(path);
        if (productMatch.matches() && method.equals("DELETE")) {
            String productId = productMatch.group(1);
            return c.atomic(() -> {
                Map<String, Object> access = c.auth(req, "admin");
                Map<String, Object> product = findProduct(c.products(), productId);
                if (product == null) throw fail("产品不存在。", 404);
                Map<String, Object> updated = copy(product);
                updated.putAll(obj("deleted", true, "published", false, "updatedAt", now()));
                c.put("product", updated);
                c.audit(s(access, "actor"), "移除在售产品（保留订单历史）", productId);
                return obj("ok", true);
            });
        }
        if (path.equals("/api/admin/audit")) {
            c.auth(req, "admin", "reviewer");
            return obj("events", c.store.auditEvents(300));
        }
        if (path.equals("/api/stats")) {
            c.auth(req, ROLES);
            List<Map<String, Object>> orders = c.all("order"), tickets = c.all("ticket"), projects = c.all("project");
            return obj("products", c.publicProducts().size(),
                "pendingOrders", orders.stream().filter(order -> s(order, "status").equals("submitted")).count(),
                "openTickets", tickets.stream().filter(ticket -> !s(ticket, "status").equals("closed")).count(),
                "pendingReview", tickets.stream().filter(ticket -> s(ticket, "status").equals("pending_review")).count(),
                "orders", orders.size(), "tickets", tickets.size(), "projects", projects.size(),
                "pendingProjects", projects.stream().filter(project -> List.of("submitted", "reviewing").contains(s(project, "status"))).count(),
                "conversations", c.all("conversation").size());
        }
        Matcher fileMatch = FILE_PATH.matcher(path);
        if (fileMatch.matches() && method.equals("GET")) return privateFile(req, fileMatch.group(1));
        return null;
    }

    private Map<String, Object> createOrder(Req req, Map<String, Object> body) {
        Map<String, Object> customer = c.customers.customer(req);
        Map<String, Object> product = findProduct(c.publicProducts(), s(body, "productId"));
        if (product == null) throw fail("产品已下架，请重新选择。", 404);
        if (b(product, "exhibitOnly")) throw fail("教学模型不作为商品下单，请在官网产品目录选择对应设备。");
        String mode = s(body, "mode");
        if (!List.of("buy", "rent").contains(mode)) throw fail("请选择购买或租赁。");
        byte[] secret = new byte[12];
        RANDOM.nextBytes(secret);
        String accessCode = Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
        if (body.containsKey("customerType") && body.get("customerType") == null) throw fail("请选择个人或企业用户类型。");
        Map<String, Object> order = obj("id", id("SO"), "number", c.documentNumber("SO"), "productId", product.get("id"),
            "product", obj("code", product.get("code"), "name", product.get("name"), "image", product.get("image"),
                "category", product.get("category"), "referencePrice", product.get("referencePrice")),
            "customerId", customer.get("id"), "customerType", c.customers.customerType(body.get("customerType")),
            "mode", mode, "quantity", integer(body.get("quantity"), 1, 999),
            "contact", text(body.get("contact"), 40), "phone", phone(body.get("phone")),
            "address", text(body.get("address"), 300), "date", date(body.get("date")),
            "duration", mode.equals("rent") ? integer(body.get("duration"), 1, 120) : null,
            "plan", mode.equals("buy") ? text(or(body.get("plan"), "待商议"), 60) : "",
            "notes", text(or(body.get("notes"), ""), 2000, false),
            "status", "submitted", "handoffStatus", "queued", "revision", 1, "secretHash", hash(accessCode), "createdAt", now(), "updatedAt", now());
        if (s(order, "address").length() < 8) throw fail("请填写包含省市区及详细地点的完整收货地址。");
        if (s(order, "date").compareTo(LocalDate.now(ZoneId.of("Asia/Shanghai")).toString()) < 0) throw fail("计划日期不能早于今天。");
        List<Map<String, Object>> files = c.addFiles(or(body.get("files"), List.of()), "order", s(order, "id"), false);
        order.put("files", files);
        order.put("attachments", files);
        order.put("history", List.of(obj("id", id("EV"), "from", null, "to", "submitted", "actor", "客户", "role", "customer",
            "note", "已提交租购申请，等待工作人员联系确认。", "files", files, "at", now())));
        c.put("order", order);
        /* 已经咨询过的客户优先回到原接待客服；没有有效会话归属时才进入公共轮询队列。 */
        c.staff.dispatchCustomerOrder(order, customer.get("id"));
        c.audit("客户", "提交租购申请", s(order, "id"));
        Map<String, Object> result = copy(c.projects.receipt(c.get("order", s(order, "id")), "order"));
        result.put("accessCode", accessCode);
        return result;
    }

    private Object phoneOrders(Req req,Map<String, Object> body) {
        var customer=c.customers.customer(req);
        c.checkPhoneQuery();
        String key = phoneKey(phone(body.get("phone")));
        List<Map<String, Object>> orders = c.all("order").stream()
            .filter(order -> c.customers.belongsToCustomer(order,customer)&&phoneKey(order.get("phone")).equals(key))
            .sorted((left, right) -> {
                int comparison = s(right, "createdAt").compareTo(s(left, "createdAt"));
                return comparison == 0 ? s(left, "id").compareTo(s(right, "id")) : comparison;
            }).map(order -> {
                Map<String, Object> product = map(order.get("product"));
                return obj("id", order.get("id"), "number", or(order.get("number"), order.get("id")),
                    "product", obj("code", product.get("code"), "name", product.get("name"), "image", product.get("image")),
                    "mode", order.get("mode"), "quantity", order.get("quantity"), "status", order.get("status"), "createdAt", order.get("createdAt"));
            }).toList();
        return obj("orders", orders);
    }

    private Object openPhoneOrder(Req req,Map<String, Object> body) {
        var customer=c.customers.customer(req);
        c.checkPhoneQuery();
        String key = phoneKey(phone(body.get("phone")));
        Map<String, Object> order = c.projects.lookup("order", text(body.get("orderId"), 100));
        if (order == null || !c.customers.belongsToCustomer(order,customer) || !phoneKey(order.get("phone")).equals(key)) throw fail("联系电话与订单不匹配，请重新查询。", 401);
        c.audit("客户", "通过联系电话打开订单（本机演示）", s(order, "id"));
        return obj("order", cleanOrder(order), "token", c.guestSession(s(order, "id")));
    }

    private Object transitionOrder(Req req, String key, String action, Map<String, Object> body) {
        Map<String, Object> order = lookupOrder(key);
        Map<String, Object> access = c.ownOrder(req, s(order, "id"));
        c.revision(order, body);
        String note = text(body.get("note"), 2000), next;
        Map<String, Object> extra = obj();
        List<Map<String, Object>> files;
        if ("confirm".equals(action)) {
            if (!truthy(access.get("orderId")) || !s(order, "status").equals("shipped") || !Boolean.TRUE.equals(body.get("confirmed"))) {
                throw fail("只有订单客户可确认收货。", 403);
            }
            next = "delivered";
            files = c.addFiles(body.get("files"), "order", s(order, "id"), true);
        } else {
            c.auth(req, "admin", "service");
            Map<String, List<String>> transitions = Map.of("submitted", List.of("confirmed", "cancelled"),
                "confirmed", List.of("preparing", "cancelled"), "preparing", List.of("shipped"));
            next = s(body, "status");
            if (!transitions.getOrDefault(s(order, "status"), List.of()).contains(next)) throw fail("不能跳过订单处理步骤。", 409);
            files = c.addFiles(body.get("files"), "order", s(order, "id"), true);
            if (next.equals("confirmed")) {
                double amount = asNumber(body.get("amount"));
                if (!Double.isFinite(amount) || amount <= 0 || amount > 1e12 || Math.abs(amount * 100 - Math.round(amount * 100)) > .001) {
                    throw fail("请填写有效的实际报价，最多两位小数。");
                }
                extra.put("quote", obj("amount", amount, "currency", "CNY", "note", "工作人员录入，尚不构成付款凭证"));
            }
            if (next.equals("shipped")) extra.put("delivery", obj("carrier", text(body.get("carrier"), 100), "tracking", text(body.get("tracking"), 100)));
        }
        Map<String, Object> updated = c.transition(order, next, access, note, files, extra);
        c.put("order", updated);
        c.audit(s(access, "actor"), "订单 " + s(order, "status") + " → " + next, s(order, "id"));
        return obj("order", cleanOrder(updated));
    }

    private Object createTicket(Req req, Map<String, Object> body) {
        Map<String, Object> order = c.get("order", text(body.get("orderId"), 100));
        if (order == null) throw fail("请先查询有效订单。", 404);
        Map<String, Object> access = c.ownOrder(req, s(order, "id"));
        if (!truthy(access.get("orderId"))) throw fail("请从订单客户入口提交报修。", 403);
        if (!s(order, "status").equals("delivered")) throw fail("设备收货后才能创建维保工单。");
        Map<String, Object> ticket = obj("id", id("WO"), "number", c.documentNumber("WO"), "orderId", order.get("id"),
            "product", order.get("product"), "contact", text(body.get("contact"), 40), "phone", phone(body.get("phone")),
            "address", text(body.get("address"), 300), "issue", text(body.get("issue"), 2000),
            "urgency", List.of("normal", "urgent").contains(s(body, "urgency")) ? body.get("urgency") : "normal",
            "status", "submitted", "assignee", null, "revision", 1, "createdAt", now(), "updatedAt", now());
        List<Map<String, Object>> files = c.addFiles(or(body.get("files"), List.of()), "ticket", s(ticket, "id"), false);
        ticket.put("history", List.of(obj("id", id("EV"), "from", null, "to", "submitted", "actor", "客户", "role", "customer",
            "note", ticket.get("issue"), "files", files, "at", now())));
        c.put("ticket", ticket);
        c.audit("客户", "提交维保工单", s(ticket, "id"));
        return obj("ticket", ticket);
    }

    private Object transitionTicket(Req req, String key, String action, Map<String, Object> body) {
        Map<String, Object> ticket = requireTicket(key);
        Map<String, Object> access = c.ownOrder(req, s(ticket, "orderId"));
        Map<String, Object> user = map(access.get("user"));
        c.revision(ticket, body);
        String note = text(body.get("note"), 2000), next;
        List<Map<String, Object>> files = c.addFiles(body.get("files"), "ticket", s(ticket, "id"), true);
        Map<String, Object> extra = obj();
        if ("review".equals(action)) {
            c.auth(req, "admin", "reviewer");
            if (!s(ticket, "status").equals("pending_review")) throw fail("此工单尚未提交审核。", 409);
            if (Objects.equals(ticket.get("assignee"), user.get("id")) || Objects.equals(ticket.get("completedBy"), user.get("id"))) {
                throw fail("不能审核自己处理的工单。", 403);
            }
            if (!List.of("approve", "reject").contains(s(body, "decision"))) throw fail("请选择审核结果。");
            next = s(body, "decision").equals("approve") ? "awaiting_customer" : "in_progress";
            extra.put("reviewer", user.get("id"));
        } else if ("accept".equals(action)) {
            if (!truthy(access.get("orderId")) || !s(ticket, "status").equals("awaiting_customer")) throw fail("只有客户可以完成验收。", 403);
            if (!List.of("accept", "return").contains(s(body, "decision"))) throw fail("请选择验收结果。");
            next = s(body, "decision").equals("accept") ? "closed" : "in_progress";
        } else {
            c.auth(req, "admin", "service");
            if (s(ticket, "status").equals("submitted") && s(body, "status").equals("assigned")) {
                Map<String, Object> assignee = c.get("user", s(body, "assignee"));
                if (assignee == null || !b(assignee, "active") || !s(assignee, "role").equals("service")) throw fail("请选择在用的售后服务账号。");
                next = "assigned";
                extra.putAll(obj("assignee", assignee.get("id"), "assigneeName", assignee.get("name")));
            } else {
                if (!Objects.equals(user.get("id"), ticket.get("assignee"))) throw fail("只有被指派的服务人员可以提交处理进度。", 403);
                next = Map.of("assigned", "in_progress", "in_progress", "pending_review").get(s(ticket, "status"));
                if (next == null || !next.equals(body.get("status"))) throw fail("不能跳过维修处理步骤。", 409);
                if (next.equals("pending_review")) extra.put("completedBy", user.get("id"));
            }
        }
        Map<String, Object> updated = c.transition(ticket, next, access, note, files, extra);
        c.put("ticket", updated);
        c.audit(s(access, "actor"), "工单 " + s(ticket, "status") + " → " + next, s(ticket, "id"));
        return obj("ticket", updated);
    }

    private Object createUser(Map<String, Object> body, Map<String, Object> access) {
        String username = text(body.get("username"), 40);
        if (!username.matches("[\\w.-]{3,40}")) throw fail("账号格式不正确。");
        if (c.all("user").stream().anyMatch(user -> s(user, "username").equals(username))) throw fail("账号已存在。", 409);
        if (!List.of(ROLES).contains(s(body, "role"))) throw fail("请选择账号角色。");
        Map<String, Object> user = obj("id", id("USR"), "username", username, "name", text(body.get("name"), 40),
            "role", body.get("role"), "password", c.passwordHash(body.get("password")), "active", true, "face", null, "createdAt", now());
        c.put("user", user);
        c.audit(s(access, "actor"), "创建员工账号", s(user, "id"));
        return obj("user", c.publicUser(user));
    }

    private Object updateUser(Req req, String userId, Map<String, Object> body) {
        Map<String, Object> access = c.auth(req, "admin"), user = c.get("user", userId);
        if (user == null) throw fail("账号不存在。", 404);
        String actorId = s(map(access.get("user")), "id");
        if (userId.equals(actorId) && Boolean.FALSE.equals(body.get("active"))) throw fail("不能停用当前账号。");
        if (s(user, "role").equals("admin") && Boolean.FALSE.equals(body.get("active")) &&
            c.all("user").stream().filter(row -> b(row, "active") && s(row, "role").equals("admin")).count() <= 1) {
            throw fail("至少保留一位在用管理员。");
        }
        if (body.get("active") instanceof Boolean) user.put("active", body.get("active"));
        if (Boolean.TRUE.equals(body.get("resetFace"))) {
            if (userId.equals(actorId)) throw fail("不能在当前会话重置自己的人脸。");
            user.put("face", null);
        }
        if (truthy(body.get("password"))) user.put("password", c.passwordHash(body.get("password")));
        user.put("authVersion", n(user, "authVersion") + 1);
        c.put("user", user);
        c.revokeUser(userId);
        c.audit(s(access, "actor"), "更新账号 / 重置身份验证", userId);
        return obj("user", c.publicUser(user));
    }

    private Object saveProduct(String method, Map<String, Object> body, Map<String, Object> access) {
        Map<String, Object> existing = truthy(body.get("id")) ? findProduct(c.products(), s(body, "id")) : null;
        if (method.equals("PATCH") && existing == null) throw fail("产品不存在。", 404);
        Map<String, Object> product = existing == null ? obj() : copy(existing);
        product.putAll(obj("id", existing == null ? id("CUSTOM") : existing.get("id"),
            "code", text(body.get("code"), 100), "name", text(body.get("name"), 150), "category", text(body.get("category"), 80),
            "subcategory", text(or(body.get("subcategory"), ""), 80, false), "summary", text(or(body.get("summary"), ""), 2000, false),
            "published", !Boolean.FALSE.equals(body.get("published")), "deleted", false,
            "custom", existing == null || existing.get("custom") == null ? true : existing.get("custom"),
            "updatedAt", now(), "modelKey", existing == null ? null : or(existing.get("modelKey"), null)));
        Object suppliedSpecs = or(body.get("specs"), List.of());
        if (!(suppliedSpecs instanceof List<?>) || arr(suppliedSpecs).size() > 50) throw fail("参数最多 50 项。");
        List<Map<String, Object>> specs = new ArrayList<>();
        for (Object value : arr(suppliedSpecs)) {
            if (!(value instanceof Map<?, ?>)) throw fail("产品参数格式无效。");
            Map<String, Object> spec = map(value);
            if (spec.get("value") == null) throw fail("产品参数格式无效。");
            specs.add(obj("name", text(spec.get("name"), 100), "value", text(String.valueOf(spec.get("value")), 200),
                "unit", text(or(spec.get("unit"), ""), 30, false)));
        }
        product.put("specs", specs);
        if (truthy(body.get("image"))) {
            String image = text(body.get("image"), 300);
            Matcher uploaded = IMAGE_PATH.matcher(image);
            boolean uploadedMatch = uploaded.matches();
            boolean asset = image.matches("assets/[\\w./-]+") && !List.of(image.split("/")).contains("..");
            if (!asset && !uploadedMatch) throw fail("请选择本地产品图片或上传新照片。");
            if (uploadedMatch) {
                Map<String, Object> file = c.store.file(uploaded.group(1));
                if (file == null || !s(file, "owner_kind").equals("product-image")) throw fail("上传图片不存在。");
            }
        }
        product.put("image", or(body.get("image"), existing == null ? "assets/brand/sany-user-reference.png" : or(existing.get("image"), "assets/brand/sany-user-reference.png")));
        product.put("sourceUrl", existing == null ? "" : or(existing.get("sourceUrl"), ""));
        if (body.containsKey("referencePrice")) product.put("referencePrice", ProjectRoutes.referencePrice(body.get("referencePrice")));
        c.put("product", product);
        c.audit(s(access, "actor"), existing == null ? "新增产品" : "编辑产品", s(product, "id"));
        return obj("product", product);
    }

    private Object privateFile(Req req, String fileId) {
        Map<String, Object> file = c.store.file(fileId);
        if (file == null || !List.of("order", "ticket", "project", "conversation", "supportChat").contains(s(file, "owner_kind"))) throw fail("材料不存在。", 404);
        String kind = s(file, "owner_kind"), ownerId = s(file, "owner_id");
        if (kind.equals("supportChat")) { var chat=c.get("supportChat",ownerId); if(chat==null) throw fail("会话不存在。",404); c.customers.chatAccess(req,chat); }
        else if (kind.equals("project")) c.projects.ownRecord(req, "project", ownerId);
        else if (kind.equals("conversation")) c.projects.conversationAccess(req, ownerId);
        else {
            String orderId = ownerId;
            if (kind.equals("ticket")) {
                Map<String, Object> ticket = c.get("ticket", ownerId);
                if (ticket == null) throw fail("材料不存在。", 404);
                orderId = s(ticket, "orderId");
            }
            c.ownOrder(req, orderId);
        }
        return binary(file, true);
    }

    private Map<String, Object> lookupOrder(String key) {
        Map<String, Object> order = c.projects.lookup("order", key);
        if (order == null) throw fail("订单不存在。", 404);
        return order;
    }

    private Map<String, Object> requireTicket(String key) {
        Map<String, Object> ticket = c.get("ticket", key);
        if (ticket == null) throw fail("工单不存在。", 404);
        return ticket;
    }

    private static Map<String, Object> cleanOrder(Map<String, Object> order) {
        Map<String, Object> result = copy(order);
        result.remove("secretHash");
        return result;
    }

    private static Map<String, Object> findProduct(List<Map<String, Object>> products, String key) {
        return products.stream().filter(product -> s(product, "id").equals(key)).findFirst().orElse(null);
    }

    private static Core.Binary binary(Map<String, Object> file, boolean attachment) {
        return new Core.Binary((byte[]) file.get("bytes"), s(file, "mime"), s(file, "name"), attachment);
    }

    private static Object or(Object value, Object fallback) { return truthy(value) ? value : fallback; }

    /** 报价沿用原接口的数字字符串兼容规则，但拒绝 NaN 和无穷值。 */
    private static double asNumber(Object value) {
        if (value == null) return 0;
        if (value instanceof Boolean booleanValue) return booleanValue ? 1 : 0;
        if (value instanceof Number numberValue) return numberValue.doubleValue();
        if (value instanceof String stringValue) {
            try { return stringValue.trim().isEmpty() ? 0 : Double.parseDouble(stringValue.trim()); }
            catch (NumberFormatException ignored) { return Double.NaN; }
        }
        return Double.NaN;
    }
}

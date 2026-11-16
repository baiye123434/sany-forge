package cn.sany.forge;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.*;
import java.util.*;
import java.util.regex.*;
import static cn.sany.forge.J.*;

/** 岗位工作流复用 records 的原订单 JSON、files 和 audit；不增表，不改数据库结构。 */
public class StaffRoutes {
    private final Core c;
    public static final Map<String,String> LABELS=Map.of("service","在线客服","reviewer","订单审核员","admin","超级管理员");
    private static final Set<String> ACTIVE=Set.of("pending_accept","in_handoff","rejected");
    private static final Set<String> REVIEW_ACTIVE=Set.of("pending_review");
    private static final Set<String> FULFILLMENT_ACTIVE=Set.of("pending_fulfillment","production_scheduled","inventory_allocated","ready_delivery");
    private static final long HEARTBEAT_MS=90000;
    public StaffRoutes(Core c) { this.c=c; }

    public List<String> permissions(String role) {
        return switch(role) {
            case "service" -> List.of("orders.view","orders.create","orders.accept","orders.handoff","orders.exception","orders.transfer","chat","presence");
            case "reviewer" -> List.of("orders.view","orders.review","audit.view");
            case "admin" -> List.of("orders.view","orders.fulfill","products.manage","users.manage","customers.manage","audit.view");
            default -> List.of();
        };
    }
    /** 旧页面与旧 API 同样受岗位边界约束，防止隐藏按钮后仍可绕过新工作流。 */
    public void enforceLegacy(Req req,Map<String,Object> user) {
        String p=req.path(),role=s(user,"role"); boolean write=!req.method().equals("GET");
        if(p.startsWith("/api/staff/")) return;
        boolean serviceConversation=role.equals("service")&&p.matches("/api/conversations(?:/.*)?");
        // 产品展览由超级管理员维护；接口自身仍会再次校验 admin 角色，其他岗位不能绕过。
        if(write&&p.equals("/api/admin/tools/content")) throw fail("管理岗位仅审核、配置权限和查看数据，不办理运营业务。",403);
        if(p.equals("/api/admin/tools/restore")||p.equals("/api/admin/tools/restore-preview")) throw fail("员工网页禁止恢复覆盖业务与审计记录；请使用离线运维流程。",403);
        boolean legacy=p.matches("/api/(orders|projects|tickets|conversations|followup)(/.*)?");
        if(legacy && write && !serviceConversation) throw fail("请在岗位工作台执行订单交接与审核；旧接口不再办理员工业务。",403);
        if(role.equals("service") && (p.equals("/api/orders")||p.equals("/api/tickets")||p.equals("/api/projects")||p.startsWith("/api/followup")||p.equals("/api/stats")||p.equals("/api/staff"))) throw fail("请在客服工作台查看本人分配工单。",403);
        if((p.startsWith("/api/customer/chats")||p.startsWith("/api/conversations"))&&!role.equals("service")) throw fail("当前岗位不能承接客户聊天。",403);
        if(p.equals("/api/admin/users")&&write || p.matches("/api/admin/users/.*")&&write) throw fail("请通过岗位授权管理创建或修改员工。",403);
    }
    private Map<String,Object> user(Req req) { return map(c.auth(req,Core.ROLES).get("user")); }
    private void allowed(Map<String,Object> user,String permission) { if(!permissions(s(user,"role")).contains(permission)) throw fail("当前岗位没有此操作权限。",403); }
    public boolean visible(Map<String,Object> user,Map<String,Object> order) {
        if(order==null) return false;
        String uid=s(user,"id"),state=status(order);
        return switch(s(user,"role")) {
            case "service" -> uid.equals(s(order,"assigneeId"));
            case "reviewer" -> uid.equals(s(order,"reviewAssigneeId"))||!truthy(order.get("reviewAssigneeId"))&&state.equals("pending_review");
            // 超管需要查看从客户咨询到生产交付的完整痕迹，而不是只看分给自己的终审单。
            case "admin" -> true;
            default -> false;
        };
    }
    public void requireVisible(Map<String,Object> user,Map<String,Object> order) { if(!visible(user,order)) throw fail("无权查看其他岗位或客服的工单。",403); }
    private Map<String,Object> requireOrder(Map<String,Object> user,String id) { var o=c.get("order",id); if(o==null) throw fail("订单不存在。",404); requireVisible(user,o); return o; }
    private String status(Map<String,Object> order) {
        String current=s(order,"handoffStatus");
        if(current.isEmpty()) {
            if(Set.of("shipped","delivered").contains(s(order,"status"))) return "shipped";
            if(s(order,"status").equals("cancelled")) return "cancelled";
            return truthy(order.get("assigneeId"))?"pending_accept":"queued";
        }
        // 升级旧五岗位数据时折叠财务和终审节点，避免历史订单从新工作台消失。
        return switch(current) {
            case "pending_finance","pending_final","approved" -> "pending_fulfillment";
            case "finance_rejected","final_rejected" -> "pending_review";
            case "returned" -> "rejected";
            default -> current;
        };
    }
    private Map<String,Object> clean(Map<String,Object> order) {
        var o=copy(order); o.remove("secretHash"); o.put("handoffStatus",status(o));
        String key=phoneKey(truthy(o.get("customerPhone"))?o.get("customerPhone"):o.get("phone"));
        long count=c.all("order").stream().filter(r->!key.isEmpty()&&key.equals(phoneKey(truthy(r.get("customerPhone"))?r.get("customerPhone"):r.get("phone")))).count();
        o.put("repeatCustomer",count>1); o.put("customerOrderCount",count); o.put("customerLabel",count>1?"复购客户":"新客户");
        if(!truthy(o.get("customerName"))) o.put("customerName",o.get("contact"));
        if(!truthy(o.get("customerPhone"))) o.put("customerPhone",o.get("phone"));
        return o;
    }
    private int urgency(Map<String,Object> order) { return switch(s(order,"urgency")) { case "urgent" -> 3; case "high" -> 2; case "low" -> 0; default -> 1; }; }
    private List<Map<String,Object>> visibleOrders(Map<String,Object> user) { return c.all("order").stream().filter(o->visible(user,o)).map(this::clean).sorted(Comparator.<Map<String,Object>,Boolean>comparing(o->b(o,"repeatCustomer")).reversed().thenComparing(Comparator.comparingInt(this::urgency).reversed()).thenComparing(o->s(o,"createdAt"))).toList(); }
    private Map<String,Object> session(Map<String,Object> u) { return obj("user",c.publicUser(u),"roles",c.assignedRoles(u).stream().map(r->obj("id",r,"label",LABELS.get(r))).toList(),"permissions",permissions(s(u,"role"))); }

    public Object handle(Req req,Map<String,Object> body) {
        String p=req.path(),method=req.method(); if(!p.startsWith("/api/staff/")) return null;
        var u=user(req); String uid=s(u,"id"),role=s(u,"role");
        if(p.equals("/api/staff/session")&&method.equals("GET")) return session(u);
        if(p.equals("/api/staff/select-role")&&method.equals("POST")) { c.selectRole(req,text(body.get("role"),40)); return session(user(req)); }
        if(p.equals("/api/staff/catalog")&&method.equals("GET")) return obj("products",c.publicProducts());
        if(p.equals("/api/staff/presence")) {
            allowed(u,"presence"); var state=presence(uid);
            if(method.equals("POST")) {
                String action=truthy(body.get("action"))?s(body,"action"):s(body,"status");
                if(!Set.of("online","offline","heartbeat").contains(action)) throw fail("在线状态无效。");
                /* 同一班次重复登录只刷新心跳，保留首次打卡时间；明确下班后再次上线才开启新班次。 */
                if(action.equals("online")) { if(!b(state,"online")||!b(state,"checkedIn")) { state.put("checkedInAt",now()); state.remove("checkedOutAt"); audit(u,"客服上线自动打卡",uid,""); } state.putAll(obj("online",true,"checkedIn",true,"employeeNumber",u.get("username"),"heartbeatAt",now())); }
                if(action.equals("offline")&&(b(state,"online")||b(state,"checkedIn"))) { state.putAll(obj("online",false,"checkedIn",false,"checkedOutAt",now())); audit(u,"客服下线打卡",uid,""); }
                if(action.equals("heartbeat")&&b(state,"online")&&b(state,"checkedIn")) state.put("heartbeatAt",now());
                c.put("staffPresence",state); dispatch(); dispatchChats();
            } else if(!method.equals("GET")) throw fail("方法无效。",405);
            state.put("online",eligible(u,state));
            return obj("presence",state,"message",b(state,"online")?"工号【"+s(u,"username")+"】客服已上线，系统已自动打卡":"客服已下线");
        }
        if(p.equals("/api/staff/users")) {
            allowed(u,"users.manage");
            if(method.equals("GET")) return obj("users",c.all("user").stream().map(c::publicUser).toList());
            if(method.equals("POST")) return saveUser(u,body);
        }
        if(p.equals("/api/staff/assignees")&&method.equals("GET")) { allowed(u,"orders.transfer"); return obj("users",online().stream().map(c::publicUser).toList()); }
        if(p.equals("/api/staff/dashboard")&&method.equals("GET")) {
            var orders=visibleOrders(u); String today=LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
            var stats=obj("queued",orders.stream().filter(o->status(o).equals("queued")).count(),"pendingAccept",orders.stream().filter(o->status(o).equals("pending_accept")).count(),"inHandoff",orders.stream().filter(o->status(o).equals("in_handoff")).count(),"rejected",orders.stream().filter(o->status(o).equals("rejected")).count(),"completedToday",orders.stream().filter(o->s(o,"handoffAt").startsWith(today)).count(),"exceptions",orders.stream().filter(o->truthy(o.get("exceptionNote"))&&!Set.of("shipped","pickup_ready").contains(status(o))).count(),"total",orders.size(),"pendingReview",orders.stream().filter(o->status(o).equals("pending_review")).count(),"pendingFulfillment",orders.stream().filter(o->status(o).equals("pending_fulfillment")).count(),"productionScheduled",orders.stream().filter(o->status(o).equals("production_scheduled")).count(),"inventoryAllocated",orders.stream().filter(o->status(o).equals("inventory_allocated")).count(),"readyDelivery",orders.stream().filter(o->status(o).equals("ready_delivery")).count(),"shipped",orders.stream().filter(o->status(o).equals("shipped")).count(),"pickupReady",orders.stream().filter(o->status(o).equals("pickup_ready")).count(),"totalAmount",orders.stream().map(o->o.get("totalAmount") instanceof Number?new BigDecimal(o.get("totalAmount").toString()):BigDecimal.ZERO).reduce(BigDecimal.ZERO,BigDecimal::add));
            return obj("stats",stats,"orders",orders.stream().limit(30).toList());
        }
        if(p.equals("/api/staff/orders")) {
            if(method.equals("POST")) { allowed(u,"orders.create"); return obj("order",create(u,body)); }
            if(method.equals("GET")) {
                String filter=req.query("status"),q=Objects.toString(req.query("q"),"").toLowerCase(Locale.ROOT);
                var rows=visibleOrders(u).stream().filter(o->filter==null||filter.isBlank()||filter.equals("all")||filter.equals(status(o)))
                    .filter(o->q.isEmpty()||(s(o,"number")+s(o,"customerName")+s(o,"customerPhone")+s(o,"salesNumber")+s(o,"assigneeNumber")+s(map(o.get("product")),"code")).toLowerCase(Locale.ROOT).contains(q))
                    .filter(o->!"true".equals(req.query("repeat"))||b(o,"repeatCustomer"))
                    .filter(o->!"true".equals(req.query("exception"))||truthy(o.get("exceptionNote"))).toList();
                int page=integer(req.query("page")==null?1:req.query("page"),1,100000),size=integer(req.query("pageSize")==null?20:req.query("pageSize"),1,100);
                return obj("orders",rows.stream().skip((long)(page-1)*size).limit(size).toList(),"total",rows.size(),"page",page,"pageSize",size);
            }
        }
        Matcher orderPath=Pattern.compile("^/api/staff/orders/([\\w-]+)(?:/(actions|messages|notes))?$").matcher(p);
        if(orderPath.matches()) {
            var order=requireOrder(u,orderPath.group(1)); String action=Objects.toString(orderPath.group(2),"");
            if(action.isEmpty()&&method.equals("GET")) return obj("order",clean(order));
            if(action.equals("actions")&&method.equals("POST")) return obj("order",change(u,order,body));
            if(action.equals("messages")) {
                allowed(u,"chat"); if(method.equals("GET")) return obj("messages",arr(order.get("messages")));
                if(method.equals("POST")) return obj("message",message(u,order,body));
            }
            if(action.equals("notes")&&method.equals("POST")) {
                allowed(u,"chat"); String note=text(body.get("text"),4000,false),request=text(body.get("requestId"),100);
                if(!requestDone(order,"note",uid,request)) { var notes=new ArrayList<>(maps(order.get("notesHistory"))); notes.add(obj("text",note,"actorId",uid,"actor",u.get("username"),"at",now(),"requestId",request)); order.put("notesHistory",notes); remember(order,"note",uid,request); c.put("order",order); audit(u,"保存订单备注",s(order,"number"),note); }
                return obj("ok",true);
            }
        }
        if(p.equals("/api/staff/notifications")&&method.equals("GET")) {
            var rows=c.all("staffNotification").stream().filter(n->uid.equals(s(n,"userId"))).sorted(Comparator.comparing((Map<String,Object> n)->s(n,"at")).reversed()).limit(100).toList(); return obj("notifications",rows);
        }
        if(p.equals("/api/staff/audit")&&method.equals("GET")) {
            allowed(u,"audit.view"); String employee=Objects.toString(req.query("employeeNumber"),""),order=Objects.toString(req.query("orderNumber"),""),from=Objects.toString(req.query("from"),""),to=Objects.toString(req.query("to"),"");
            var rows=c.store.auditEvents(10000).stream().filter(e->role.equals("admin")||s(e,"actor").startsWith(s(u,"username")+" · "))
                .filter(e->employee.isEmpty()||s(e,"actor").startsWith(employee+" · ")).filter(e->order.isEmpty()||s(e,"target").contains(order))
                .filter(e->from.isEmpty()||s(e,"at").compareTo(from)>=0).filter(e->to.isEmpty()||s(e,"at").compareTo(to+"T23:59:59.999Z")<=0).limit(1000).toList(); return obj("events",rows);
        }
        throw fail("岗位接口不存在或方法无效。",404);
    }

    private Object saveUser(Map<String,Object> actor,Map<String,Object> body) {
        List<String> roles=arr(body.get("roles")).stream().map(String::valueOf).distinct().toList();
        if(roles.size()!=1||!LABELS.keySet().containsAll(roles)) throw fail("每个员工账号只能授权一个岗位，请按分级职责创建独立账号。");
        String id=s(body,"id"); var user=id.isBlank()?null:c.get("user",id); if(!id.isBlank()&&user==null) throw fail("员工不存在。",404);
        if(user==null) {
            String username=text(body.get("username"),40); if(!username.matches("[\\w.-]{3,40}")) throw fail("工号使用3–40位字母、数字、点或下划线。");
            if(c.all("user").stream().anyMatch(r->username.equals(s(r,"username")))) throw fail("工号已存在。",409);
            user=obj("id",id("USR"),"username",username,"name",text(body.get("name"),40),"password",c.passwordHash(body.get("password")),"active",true,"createdAt",now());
        } else {
            if(s(user,"id").equals(s(actor,"id"))&&(!roles.contains("admin")||Boolean.FALSE.equals(body.get("active")))) throw fail("不能撤销当前管理员自己的管理权限。");
            if(body.containsKey("name")) user.put("name",text(body.get("name"),40));
            if(truthy(body.get("password"))) user.put("password",c.passwordHash(body.get("password")));
            if(body.containsKey("active")) { if(!(body.get("active") instanceof Boolean)) throw fail("账号状态无效。"); user.put("active",body.get("active")); }
            c.revokeUser(s(user,"id"));
        }
        user.put("roles",roles); user.put("role",roles.get(0)); c.put("user",user); audit(actor,"配置员工岗位权限",s(user,"username"),String.join(",",roles)); return obj("user",c.publicUser(user));
    }
    private Map<String,Object> presence(String id) { var p=c.get("staffPresence",id); return p==null?obj("id",id,"online",false,"checkedIn",false):p; }
    private boolean eligible(Map<String,Object> u,Map<String,Object> p) { try { return b(u,"active")&&c.assignedRoles(u).equals(List.of("service"))&&b(p,"online")&&b(p,"checkedIn")&&Instant.parse(s(p,"heartbeatAt")).toEpochMilli()>System.currentTimeMillis()-HEARTBEAT_MS; } catch(Exception e) { return false; } }
    private List<Map<String,Object>> online() { return c.all("user").stream().filter(u->eligible(u,presence(s(u,"id")))).sorted(Comparator.comparing(u->s(u,"username"))).toList(); }
    /** 每次只选一位在用的上一级处理人；同岗位多人时优先分配当前待办最少者。 */
    private Map<String,Object> nextRole(String role) {
        String field=switch(role) { case "reviewer" -> "reviewAssigneeId"; case "admin" -> "finalAssigneeId"; default -> throw new IllegalArgumentException("unsupported role"); };
        Set<String> states=switch(role) { case "reviewer" -> REVIEW_ACTIVE; case "admin" -> FULFILLMENT_ACTIVE; default -> Set.of(); };
        var users=c.all("user").stream().filter(u->b(u,"active")&&c.assignedRoles(u).equals(List.of(role))).toList();
        if(users.isEmpty()) throw fail("没有在用的"+LABELS.get(role)+"账号，不能向上一级递交。",409);
        return users.stream().min(Comparator.<Map<String,Object>>comparingLong(u->c.all("order").stream().filter(o->s(u,"id").equals(s(o,field))&&states.contains(status(o))).count()).thenComparing(u->s(u,"username"))).orElseThrow();
    }
    private void assignNext(Map<String,Object> order,String role,String title,String text) {
        var next=nextRole(role);
        String idField=switch(role) { case "reviewer" -> "reviewAssigneeId"; case "admin" -> "finalAssigneeId"; default -> throw new IllegalArgumentException("unsupported role"); };
        String numberField=switch(role) { case "reviewer" -> "reviewAssigneeNumber"; case "admin" -> "finalAssigneeNumber"; default -> throw new IllegalArgumentException("unsupported role"); };
        order.put(idField,next.get("id")); order.put(numberField,next.get("username")); notifyUser(s(next,"id"),title,text,order);
    }
    /** 先按当前待处理数量取最空闲组，再按持久轮询游标取人；全调用处于全局事务内。 */
    private Map<String,Object> nextService(String scope) {
        var users=online(); if(users.isEmpty()) return null;
        Map<String,Long> loads=new HashMap<>(); for(var u:users) loads.put(s(u,"id"),c.all("order").stream().filter(o->s(u,"id").equals(s(o,"assigneeId"))&&ACTIVE.contains(status(o))).count());
        long min=loads.values().stream().min(Long::compare).orElse(0L); var pool=users.stream().filter(u->loads.get(s(u,"id"))==min).toList();
        var state=c.get("settings","dispatch-"+scope); String last=state==null?"":s(state,"last"); int index=0; for(int i=0;i<pool.size();i++) if(s(pool.get(i),"id").equals(last)) index=(i+1)%pool.size();
        var u=pool.get(index); c.put("settings",obj("id","dispatch-"+scope,"last",u.get("id"))); return u;
    }
    private void assign(Map<String,Object> order,Map<String,Object> service,String note) { order.putAll(obj("assigneeId",service.get("id"),"assigneeNumber",service.get("username"),"handoffStatus","pending_accept","revision",n(order,"revision")+1)); event(order,null,"自动派单",note); c.put("order",order); notifyUser(s(service,"id"),"订单分配",s(order,"number")+" 已分配给你",order); }
    public void dispatch() { for(var o:c.all("order").stream().filter(o->status(o).equals("queued")).sorted(Comparator.comparing(o->s(o,"createdAt"))).toList()) { var u=nextService("orders"); if(u==null) break; assign(o,u,"按在岗在线客服负载和轮询规则分配。"); } }
    /**
     * 客户在咨询后下单时，优先把订单交给正在接待该客户的在线客服。
     * 只有原接待客服已离线或没有会话归属时才回到公共轮询，避免同一客户在聊天与订单间被拆给两个人。
     */
    public void dispatchCustomerOrder(Map<String,Object> order,Object customerId) {
        if(order==null||!status(order).equals("queued")) return;
        Map<String,Object> preferredChat=c.all("supportChat").stream()
                .filter(chat->Objects.equals(chat.get("customerId"),customerId)&&chatAssigneeOnline(chat))
                .max(Comparator.comparing(chat->s(chat,"updatedAt"))).orElse(null);
        if(preferredChat!=null) {
            Map<String,Object> service=c.get("user",s(preferredChat,"assigneeId"));
            if(service!=null) {
                assign(order,service,"客户从当前咨询会话提交订单，优先归属正在接待的客服。");
                return;
            }
        }
        dispatch();
    }
    private boolean chatAssigneeOnline(Map<String,Object> chat) {
        String assigneeId=s(chat,"assigneeId");
        if(assigneeId.isEmpty()) return false;
        Map<String,Object> assignee=c.get("user",assigneeId);
        return assignee!=null&&eligible(assignee,presence(assigneeId));
    }
    private Map<String,Object> latestUnreadCustomerMessage(Map<String,Object> chat) {
        List<Map<String,Object>> messages=maps(chat.get("messages"));
        for(int i=messages.size()-1;i>=0;i--) {
            Map<String,Object> message=messages.get(i);
            if(n(message,"seq")<=n(chat,"readByStaff")) break;
            if(s(message,"sender").equals("customer")) return message;
        }
        return null;
    }
    public void dispatchChats() {
        /* 客服下线后不能继续独占会话；有其他客服上线时，将未读咨询转交给当前在线人员。 */
        for(var chat:c.all("supportChat")) if(!chatAssigneeOnline(chat)) {
            var u=nextService("chat"); if(u==null) break;
            chat.put("assigneeId",u.get("id")); c.put("supportChat",chat);
            var unread=latestUnreadCustomerMessage(chat);
            if(unread!=null) notifySupportChat(chat,truthy(unread.get("text"))?s(unread,"text"):"客户发送了附件");
        }
    }
    private BigDecimal money(Object value) { try { if(value==null||value instanceof Boolean) throw new Exception(); var n=new BigDecimal(value.toString()); if(n.signum()<=0||n.scale()>2||n.compareTo(new BigDecimal("999999999999"))>0) throw new Exception(); return n.setScale(2,RoundingMode.UNNECESSARY); } catch(Exception e) { throw fail("金额须为大于0且最多两位小数的数字。"); } }
    private void fields(Map<String,Object> o,Map<String,Object> body) {
        if(truthy(o.get("mode"))&&!s(o,"mode").equals("buy")) throw fail("租赁订单不能转为设备销售交接单，请保留原租赁流程。",409);
        var product=c.publicProducts().stream().filter(p->s(p,"id").equals(s(body,"productId"))&&!b(p,"exhibitOnly")).findFirst().orElseThrow(()->fail("设备型号必须匹配已发布产品台账。"));
        int quantity=integer(body.get("quantity"),1,999); BigDecimal price=money(body.get("dealPrice")),quote=money(body.get("quotedPrice"));
        String urgency=s(body,"urgency"); if(urgency.isEmpty()) urgency="normal"; if(!Set.of("normal","urgent","high","low").contains(urgency)) throw fail("紧急等级无效。");
        o.putAll(obj("customerName",text(body.get("customerName"),100),"customerPhone",phone(body.get("customerPhone")),"productId",product.get("id"),"product",obj("code",product.get("code"),"name",product.get("name"),"image",product.get("image")),"quantity",quantity,"dealPrice",price,"quotedPrice",quote,"totalAmount",price.multiply(BigDecimal.valueOf(quantity)),"urgency",urgency,"notes",text(body.getOrDefault("notes",""),4000,false),"mode","buy"));
        o.put("contact",o.get("customerName")); o.put("phone",o.get("customerPhone"));
    }
    private Map<String,Object> create(Map<String,Object> u,Map<String,Object> body) {
        String request=text(body.get("requestId"),100); for(var existing:c.all("order")) if(request.equals(s(existing,"submitRequestId"))&&s(u,"id").equals(s(existing,"salesId"))) return clean(existing);
        var o=obj("id",id("SO"),"number",c.documentNumber("SO"),"createdAt",now(),"updatedAt",now(),"status","submitted","handoffStatus","in_handoff","revision",1,"salesId",u.get("id"),"salesNumber",u.get("username"),"assigneeId",u.get("id"),"assigneeNumber",u.get("username"),"submitRequestId",request,"history",new ArrayList<>(),"handoffHistory",new ArrayList<>()); fields(o,body);
        c.all("customer").stream().filter(customer->phoneKey(customer.get("phone")).equals(phoneKey(o.get("customerPhone")))).findFirst().ifPresent(customer->o.put("customerId",customer.get("id")));
        o.put("files",c.addFiles(body.getOrDefault("files",List.of()),"order",s(o,"id"),true)); o.put("attachments",o.get("files")); event(o,u,"客服建单","客服与客户确认需求后提交订单及相关材料。"); c.put("order",o); return clean(c.get("order",s(o,"id")));
    }
    private boolean requestDone(Map<String,Object> o,String action,String uid,String request) { return arr(o.get("processedRequests")).contains(uid+":"+action+":"+request); }
    private void remember(Map<String,Object> o,String action,String uid,String request) { var ids=new ArrayList<>(arr(o.get("processedRequests"))); ids.add(uid+":"+action+":"+request); o.put("processedRequests",ids); }
    private Map<String,Object> change(Map<String,Object> u,Map<String,Object> o,Map<String,Object> body) {
        String action=text(body.get("action"),40),request=text(body.get("requestId"),100),uid=s(u,"id"),state=status(o),note=text(body.getOrDefault("note",""),4000,false);
        String permission=switch(action) {
            case "accept" -> "orders.accept";
            case "handoff" -> "orders.handoff";
            case "exception" -> "orders.exception";
            case "approve","reject" -> "orders.review";
            case "schedule_production","allocate_inventory","complete_production","confirm_inventory","ship","pickup_ready","admin_reject" -> "orders.fulfill";
            case "transfer" -> "orders.transfer";
            default -> throw fail("未知操作。");
        };
        allowed(u,permission); if(requestDone(o,action,uid,request)) return clean(o); c.revision(o,body);
        switch(action) {
            case "accept" -> { if(!state.equals("pending_accept")) throw fail("订单不是待接手状态。",409); o.put("handoffStatus","in_handoff"); }
            case "handoff" -> {
                if(!Set.of("in_handoff","rejected").contains(state)) throw fail("当前状态不能递交审核。",409);
                if(!b(body,"quoteVerified")) throw fail("请核验成交价、报价附件和客户资料后勾选确认。");
                if(body.containsKey("dealPrice")) o.put("dealPrice",money(body.get("dealPrice")));
                if(body.containsKey("quotedPrice")) o.put("quotedPrice",money(body.get("quotedPrice")));
                BigDecimal deal=money(o.get("dealPrice")),quoted=money(o.get("quotedPrice"));
                if(deal.compareTo(quoted)!=0) throw fail("成交价与报价材料金额不一致，请先修正。");
                o.put("totalAmount",deal.multiply(BigDecimal.valueOf(integer(o.get("quantity"),1,999))));
                if(!arr(body.get("files")).isEmpty()) {
                    var files=new ArrayList<>(maps(o.get("files")));
                    files.addAll(c.addFiles(body.get("files"),"order",s(o,"id"),false));
                    o.put("files",files); o.put("attachments",files);
                }
                if(arr(o.get("files")).isEmpty()&&arr(o.get("attachments")).isEmpty()) throw fail("请上传报价单、合同草稿或订单确认材料。");
                o.putAll(obj("handoffStatus","pending_review","handoffAt",LocalDateTime.now(ZoneId.of("Asia/Shanghai")).toString(),"quoteVerifiedBy",u.get("username"),"exceptionNote",""));
                assignNext(o,"reviewer","待订单审核",s(o,"number")+" 客服已完成洽谈并提交订单材料");
            }
            case "exception" -> { if(!ACTIVE.contains(state)) throw fail("当前状态不能标记异常。",409); note=text(body.get("note"),4000); o.put("exceptionNote",note); }
            case "approve","reject" -> {
                if(!REVIEW_ACTIVE.contains(state)) throw fail("订单不在当前审核岗位。",409);
                if(truthy(o.get("reviewAssigneeId"))&&!uid.equals(s(o,"reviewAssigneeId"))) throw fail("订单已指定给其他审核账号。",403);
                if(action.equals("reject")) note=text(body.get("note"),4000);
                o.putAll(obj("handoffStatus",action.equals("approve")?"pending_fulfillment":"rejected","status",action.equals("approve")?"confirmed":"submitted","reviewAssigneeId",uid,"reviewAssigneeNumber",u.get("username"),"reviewerId",uid,"reviewerNumber",u.get("username"),"reviewResult",action,"reviewNote",note,"reviewedAt",now()));
                if(action.equals("approve")) assignNext(o,"admin","待履约处理",s(o,"number")+" 已通过订单审核，请选择排产或调取库存");
                else notifyUser(s(o,"assigneeId"),"订单审核退回",note,o);
            }
            case "admin_reject" -> {
                if(!state.equals("pending_fulfillment")) throw fail("只有待履约订单可以退回审核。",409);
                note=text(body.get("note"),4000); o.putAll(obj("handoffStatus","pending_review","status","submitted","fulfillmentNote",note));
                notifyUser(s(o,"reviewerId"),"超管退回订单审核",note,o);
            }
            case "schedule_production","allocate_inventory" -> {
                if(!state.equals("pending_fulfillment")) throw fail("订单尚未进入履约处理。",409);
                boolean production=action.equals("schedule_production");
                o.putAll(obj("handoffStatus",production?"production_scheduled":"inventory_allocated","status","preparing","fulfillmentMode",production?"production":"inventory","fulfillmentNote",note,"fulfilledBy",uid,"fulfilledByNumber",u.get("username"),"fulfillmentStartedAt",now()));
            }
            case "complete_production" -> {
                if(!state.equals("production_scheduled")) throw fail("订单不在生产排产环节。",409);
                o.putAll(obj("handoffStatus","ready_delivery","status","preparing","productionCompletedAt",now(),"fulfillmentNote",note));
            }
            case "confirm_inventory" -> {
                if(!state.equals("inventory_allocated")) throw fail("订单不在库存调取环节。",409);
                o.putAll(obj("handoffStatus","ready_delivery","status","preparing","inventoryConfirmedAt",now(),"fulfillmentNote",note));
            }
            case "ship","pickup_ready" -> {
                if(!state.equals("ready_delivery")) throw fail("生产或库存环节尚未完成。",409);
                boolean shipped=action.equals("ship");
                o.putAll(obj("handoffStatus",shipped?"shipped":"pickup_ready","status",shipped?"shipped":"pickup_ready","deliveryMethod",shipped?"shipping":"pickup","deliveryNote",note,"deliveryUpdatedAt",now()));
                notifyUser(s(o,"assigneeId"),shipped?"订单已发货":"订单可上门提货",s(o,"number")+" · "+note,o);
            }
            case "transfer" -> { if(!ACTIVE.contains(state)&&!state.equals("queued")) throw fail("审核中的订单不可转派。",409); note=text(body.get("note"),4000); String target=truthy(body.get("assigneeId"))?s(body,"assigneeId"):s(body,"targetId"); var receiver=online().stream().filter(x->s(x,"id").equals(target)).findFirst().orElseThrow(()->fail("接收客服必须在线在岗并完成打卡。")); assign(o,receiver,note); }
        }
        o.put("revision",n(o,"revision")+1); o.put("updatedAt",now()); remember(o,action,uid,request); event(o,u,action,note); c.put("order",o); dispatch(); return clean(c.get("order",s(o,"id")));
    }
    private Map<String,Object> message(Map<String,Object> u,Map<String,Object> o,Map<String,Object> body) {
        String text=text(body.getOrDefault("text",""),4000,false),request=text(body.get("requestId"),100); var messages=new ArrayList<>(maps(o.get("messages")));
        for(var m:messages) if(request.equals(s(m,"requestId"))&&s(u,"id").equals(s(m,"senderId"))) return m;
        if(text.isEmpty()&&arr(body.get("files")).isEmpty()) throw fail("请输入消息或选择附件。");
        var files=c.addFiles(body.getOrDefault("files",List.of()),"order",s(o,"id"),false);
        var m=obj("id",id("MSG"),"seq",messages.size()+1,"text",text,"files",files,"senderId",u.get("id"),"sender",u.get("role"),"senderName",u.get("username")+" · "+u.get("name"),"requestId",request,"at",now()); messages.add(m); o.put("messages",messages); c.put("order",o); audit(u,"发送订单沟通消息",s(o,"number"),text+" 附件数："+files.size()); notifyUser(s(u,"role").equals("service")?s(o,"salesId"):s(o,"assigneeId"),"订单沟通消息",text,o); return m;
    }
    private void systemMessage(Map<String,Object> o,Map<String,Object> u,String text) { var messages=new ArrayList<>(maps(o.get("messages"))); messages.add(obj("id",id("MSG"),"seq",messages.size()+1,"text",text,"sender","system","senderName",u.get("username"),"at",now(),"files",List.of())); o.put("messages",messages); }
    private void event(Map<String,Object> o,Map<String,Object> u,String action,String note) { var snapshot=obj(); for(String key:List.of("customerName","customerPhone","productId","quantity","dealPrice","quotedPrice","totalAmount","salesNumber","assigneeNumber","reviewAssigneeNumber","finalAssigneeNumber","exceptionNote","reviewNote","fulfillmentMode","fulfillmentNote","deliveryMethod","deliveryNote")) snapshot.put(key,o.get(key)); var history=new ArrayList<>(maps(o.get("handoffHistory"))); history.add(obj("id",id("EV"),"action",action,"status",status(o),"actorId",u==null?"system":u.get("id"),"actor",u==null?"系统":u.get("username"),"role",u==null?"system":u.get("role"),"note",note,"snapshot",snapshot,"at",now())); o.put("handoffHistory",history); String detail=note+" | "+c.json(snapshot); if(u==null)c.audit("系统","订单"+action,s(o,"number"),detail);else audit(u,"订单"+action,s(o,"number"),detail); }
    private void audit(Map<String,Object> u,String action,String target,String detail) { c.audit(s(u,"username")+" · "+s(u,"name"),action,target,detail); }
    private void notifyUser(String uid,String title,String text,Map<String,Object> o) { if(uid.isEmpty()) return; c.put("staffNotification",obj("id",id("NT"),"userId",uid,"title",title,"text",text,"orderId",o.get("id"),"orderNumber",o.get("number"),"at",now())); }
    /** 客户在订单会话发言时提醒该订单负责客服，不向管理员或其他客服广播。 */
    public void notifyCustomerConversation(Map<String,Object> order,String text) {
        if(order==null) return;
        if(s(order,"assigneeId").isEmpty()) { dispatch(); order=c.get("order",s(order,"id")); }
        String summary=text == null || text.isBlank() ? "客户发送了附件" : text;
        notifyUser(s(order,"assigneeId"),"客户订单消息",s(order,"number")+" · "+summary,order);
    }
    /** 普通在线咨询同样只提醒已分配的负责客服。 */
    public void notifySupportChat(Map<String,Object> chat,String text) {
        if(chat==null) return;
        if(!chatAssigneeOnline(chat)) { dispatchChats(); return; }
        String summary=text == null || text.isBlank() ? "客户发送了附件" : text;
        c.put("staffNotification",obj("id",id("NT"),"userId",chat.get("assigneeId"),"title","新的客户咨询","text",summary,"chatId",chat.get("id"),"at",now()));
    }
}

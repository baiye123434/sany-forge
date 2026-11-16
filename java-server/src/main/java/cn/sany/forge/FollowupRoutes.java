package cn.sany.forge;

import static cn.sany.forge.J.*;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 跟进任务独立于业务状态；完成跟进不会代替报价、发货、审核或客户验收。 */
public final class FollowupRoutes {
    private final Core c;
    private static final List<String> KINDS = List.of("project","order","ticket");
    private static final DateTimeFormatter MILLIS = new DateTimeFormatterBuilder().appendInstant(3).toFormatter();

    public FollowupRoutes(Core c) { this.c = c; }

    private String due(Object value) {
        if (!(value instanceof String time) || !time.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z")) throw fail("请填写有效的下次跟进时间。");
        Instant instant;
        try { instant = Instant.parse(time); if (!MILLIS.format(instant).equals(time)) throw new IllegalArgumentException(); }
        catch (RuntimeException error) { throw fail("请填写有效的下次跟进时间。"); }
        if (!instant.isAfter(Instant.now())) throw fail("下次跟进时间必须晚于当前时间。");
        return time;
    }

    private Map<String,Object> owner(Object ownerId, Map<String,Object> access) {
        Map<String,Object> user = ownerId instanceof String ? c.get("user",(String) ownerId) : null;
        if (user == null || !b(user,"active") || !List.of("admin","service").contains(s(user,"role"))) throw fail("请选择在用的管理员或服务人员负责跟进。");
        Map<String,Object> actor = map(access.get("user"));
        if (!s(actor,"role").equals("admin") && !Objects.equals(user.get("id"),actor.get("id"))) throw fail("服务人员只能为自己建立或调整跟进任务。",403);
        return user;
    }

    private Map<String,Object> source(String kind, Object recordId) {
        if (!KINDS.contains(kind)) throw fail("跟进对象必须是工程需求、订单或售后工单。");
        Map<String,Object> record = c.get(kind,text(recordId,100));
        if (record == null) throw fail("关联业务记录不存在。",404);
        return record;
    }

    private Map<String,Object> target(String kind, Map<String,Object> record) {
        Map<String,Object> product = map(record.get("product"));
        String title = kind.equals("project") ? s(record,"title") : s(product,"code") + " · " + (kind.equals("ticket") ? s(record,"issue") : s(product,"name"));
        return obj("kind",kind,"id",record.get("id"),"number",truthy(record.get("number")) ? record.get("number") : record.get("id"),"title",title,"status",record.get("status"));
    }

    private Map<String,Object> publicTask(Map<String,Object> task, String at) {
        Map<String,Object> result = copy(task); result.remove("requestId"); result.remove("requestHash");
        Map<String,Object> record = c.get(s(task,"kind"),s(task,"recordId")), user = c.get("user",s(task,"ownerId"));
        result.putAll(obj("ownerName",user == null ? "账号不存在" : user.get("name"),"ownerActive",user != null && b(user,"active"),
                "overdue",s(task,"status").equals("open") && s(task,"dueAt").compareTo(at) < 0,"target",record == null ? null : target(s(task,"kind"),record)));
        return result;
    }

    public Object handle(Req req, Map<String,Object> body) {
        String path = req.path(), method = req.method();
        if (!path.startsWith("/api/followups")) return null;
        Map<String,Object> access = c.auth(req,"admin","service","reviewer"), actor = map(access.get("user"));
        if (path.equals("/api/followups") && method.equals("GET")) {
            String at = now();
            List<Map<String,Object>> tasks = c.all("followup").stream().map(task -> publicTask(task,at))
                    .sorted(Comparator.comparing((Map<String,Object> task) -> s(task,"dueAt")).thenComparing(task -> s(task,"id"))).toList();
            List<Map<String,Object>> targets = new ArrayList<>();
            for (String kind : KINDS) for (Map<String,Object> record : c.all(kind)) targets.add(target(kind,record));
            return obj("tasks",tasks,"targets",targets,"asOf",at,"counts",obj(
                    "open",tasks.stream().filter(task -> s(task,"status").equals("open")).count(),
                    "overdue",tasks.stream().filter(task -> b(task,"overdue")).count(),
                    "mine",tasks.stream().filter(task -> s(task,"status").equals("open") && Objects.equals(task.get("ownerId"),actor.get("id"))).count(),
                    "done",tasks.stream().filter(task -> s(task,"status").equals("done")).count()));
        }
        if (path.equals("/api/followups") && method.equals("POST")) return c.atomic(() -> {
            c.auth(req,"admin","service");
            String requestId = text(body.get("requestId"),100);
            if (!requestId.matches("[\\w.-]+")) throw fail("提交标识无效。");
            String priority = truthy(body.get("priority")) ? String.valueOf(body.get("priority")) : "normal";
            String requestHash = hash(c.json(Arrays.asList(body.get("kind"),body.get("recordId"),body.get("ownerId"),body.get("action"),body.get("dueAt"),priority)));
            Map<String,Object> existing = c.all("followup").stream().filter(task -> Objects.equals(task.get("createdBy"),actor.get("id")) && requestId.equals(s(task,"requestId"))).findFirst().orElse(null);
            if (existing != null) {
                if (!requestHash.equals(s(existing,"requestHash"))) throw fail("此提交标识已用于其他内容，请重新打开表单。",409);
                return obj("task",publicTask(existing,now()));
            }
            source(s(body,"kind"),body.get("recordId"));
            Map<String,Object> assigned = owner(body.get("ownerId"),access);
            if (!List.of("normal","urgent").contains(priority)) throw fail("跟进优先级无效。");
            Map<String,Object> task = obj("id",id("FU"),"number",c.documentNumber("FU"),"kind",body.get("kind"),"recordId",body.get("recordId"),
                    "ownerId",assigned.get("id"),"action",text(body.get("action"),1000),"dueAt",due(body.get("dueAt")),"priority",priority,"status","open","revision",1,
                    "createdAt",now(),"createdBy",actor.get("id"),"requestId",requestId,"requestHash",requestHash);
            task.put("history",List.of(obj("action","created","actor",access.get("actor"),"actorId",actor.get("id"),"at",task.get("createdAt"),"note",task.get("action"),"dueAt",task.get("dueAt"),"ownerId",task.get("ownerId"))));
            c.put("followup",task); c.audit(s(access,"actor"),"建立业务跟进任务",s(task,"id"));
            return obj("task",publicTask(task,now()));
        });
        Matcher match = Pattern.compile("^/api/followups/([\\w-]+)/(complete|reschedule)$").matcher(path);
        if (match.matches() && method.equals("POST")) return c.atomic(() -> {
            c.auth(req,"admin","service");
            Map<String,Object> task = c.get("followup",match.group(1));
            if (task == null) throw fail("跟进任务不存在。",404);
            if (!s(actor,"role").equals("admin") && !Objects.equals(task.get("ownerId"),actor.get("id"))) throw fail("仅负责人或管理员可以处理此跟进。",403);
            c.revision(task,body);
            if (!s(task,"status").equals("open")) throw fail("已完成的跟进不能重复处理，请建立后续任务。",409);
            String at = now(), note = text(body.get("note"),2000);
            Map<String,Object> event = obj("action",match.group(2),"actor",access.get("actor"),"actorId",actor.get("id"),"at",at,"note",note);
            Map<String,Object> updated = copy(task); List<Map<String,Object>> history = new ArrayList<>(maps(task.get("history"))); history.add(event);
            updated.putAll(obj("revision",n(task,"revision")+1,"updatedAt",at,"history",history));
            if (match.group(2).equals("complete")) updated.putAll(obj("status","done","outcome",note,"completedAt",at,"completedBy",actor.get("id")));
            else {
                updated.put("ownerId",owner(body.get("ownerId"),access).get("id")); updated.put("dueAt",due(body.get("dueAt")));
                event.putAll(obj("previousDueAt",task.get("dueAt"),"dueAt",updated.get("dueAt"),"previousOwnerId",task.get("ownerId"),"ownerId",updated.get("ownerId")));
            }
            c.put("followup",updated); c.audit(s(access,"actor"),match.group(2).equals("complete") ? "完成业务跟进" : "调整业务跟进计划",s(task,"id"));
            return obj("task",publicTask(updated,at));
        });
        throw fail("跟进接口或操作不存在。",404);
    }
}

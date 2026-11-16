package cn.sany.forge;

import static cn.sany.forge.J.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;

/** 只验证迁移模块的协议与状态规则；真实 MySQL 事务和 HTTP 验收由集成测试覆盖。 */
class ServiceRoutesTest {
    private Core c;
    private CustomerRoutes customers;
    private ProjectRoutes projects;
    private FollowupRoutes followups;
    private final ObjectMapper json = new ObjectMapper();
    private final Map<String,Map<String,Map<String,Object>>> records = new LinkedHashMap<>();
    private final Map<String,Map<String,Object>> identities = new LinkedHashMap<>();
    private static final String PASSWORD = "route-tests-only-2026!";

    @BeforeEach void prepare() {
        c = mock(Core.class);
        when(c.assignedRoles(anyMap())).thenCallRealMethod();
        ReflectionTestUtils.setField(c,"staff",new StaffRoutes(c));
        byte[] key = new byte[32]; for (int i=0;i<32;i++) key[i] = (byte)(i+1);
        ReflectionTestUtils.setField(c,"faceKey",key);
        when(c.json(any())).thenAnswer(call -> json.writeValueAsString(call.getArgument(0)));
        when(c.parse(anyString())).thenAnswer(call -> json.readValue(call.getArgument(0,String.class),Object.class));
        when(c.get(anyString(),anyString())).thenAnswer(call -> {
            Map<String,Object> value = records.getOrDefault(call.getArgument(0),Map.of()).get(call.getArgument(1));
            return value == null ? null : cloneMap(value);
        });
        when(c.all(anyString())).thenAnswer(call -> records.getOrDefault(call.getArgument(0),Map.of()).values().stream().map(this::cloneMap).toList());
        doAnswer(call -> {
            Map<String,Object> value = call.getArgument(1);
            records.computeIfAbsent(call.getArgument(0),ignored -> new LinkedHashMap<>()).put(s(value,"id"),cloneMap(value)); return null;
        }).when(c).put(anyString(),anyMap());
        when(c.atomic(any())).thenAnswer(call -> ((Supplier<?>)call.getArgument(0)).get());
        when(c.auth(any(Req.class),any(String[].class))).thenAnswer(call -> {
            Req req = (Req)call.getRawArguments()[0]; String[] roles = (String[])call.getRawArguments()[1];
            Map<String,Object> access = identities.get(req.token());
            if (access == null) throw J.fail("未登录",401);
            if (roles.length > 0 && (!access.containsKey("user") || !Arrays.asList(roles).contains(s(map(access.get("user")),"role")))) throw J.fail("无权限",403);
            return cloneMap(access);
        });
        when(c.guestSession(anyString(),anyString())).thenAnswer(call -> {
            String id = call.getArgument(0), kind = call.getArgument(1), token = "guest-"+kind+"-"+id;
            identities.put(token,obj(kind.equals("project") ? "projectId" : "orderId",id,"actor","客户")); return token;
        });
        when(c.passwordHash(any())).thenAnswer(call -> {
            String password = text(call.getArgument(0),200); if (password.length()<10) throw J.fail("密码至少 10 位。"); return "test:"+hash(password);
        });
        when(c.verifyPassword(any(),anyString())).thenAnswer(call -> Objects.equals("test:"+hash(call.getArgument(0)),call.getArgument(1)));
        AtomicInteger sequence = new AtomicInteger();
        when(c.documentNumber(anyString())).thenAnswer(call -> call.getArgument(0)+"-20261027-"+String.format("%04d",sequence.incrementAndGet()));
        when(c.publicProducts()).thenReturn(List.of(obj("id","P1","code","DEMO","name","测试设备","category","测试分类","image","/sample.png","published",true)));
        when(c.addFiles(any(),anyString(),anyString(),anyBoolean())).thenAnswer(call -> {
            Object value = call.getArgument(0);
            if (!(value instanceof List<?> list) || list.size()>4) throw J.fail("附件无效"); return maps(value);
        });
        doAnswer(call -> { Map<String,Object> record=call.getArgument(0), body=call.getArgument(1); if(n(record,"revision")!=n(body,"revision")) throw J.fail("修订冲突",409); return null; }).when(c).revision(anyMap(),anyMap());
        when(c.transition(anyMap(),anyString(),anyMap(),anyString(),anyList(),anyMap())).thenAnswer(call -> {
            Map<String,Object> previous=call.getArgument(0), next=copy(previous); List<Map<String,Object>> history=new ArrayList<>(maps(previous.get("history")));
            history.add(obj("from",previous.get("status"),"to",call.getArgument(1),"note",call.getArgument(3),"files",call.getArgument(4)));
            next.putAll(call.getArgument(5)); next.putAll(obj("status",call.getArgument(1),"revision",n(previous,"revision")+1,"updatedAt",now(),"history",history)); return next;
        });
        for(String role:List.of("admin","service","reviewer")) {
            Map<String,Object> user=obj("id",role+"-id","role",role,"name",role,"active",true);
            c.put("user",user); identities.put(role,obj("user",user,"actor",role));
        }
        Map<String,Object> other=obj("id","other-id","role","service","name","other","active",true);
        c.put("user",other); identities.put("other",obj("user",other,"actor","other"));
        c.put("staffPresence",obj("id","service-id","online",true,"checkedIn",true,"heartbeatAt",now()));
        customers=new CustomerRoutes(c); projects=new ProjectRoutes(c); followups=new FollowupRoutes(c);
        ReflectionTestUtils.setField(c,"customers",customers); ReflectionTestUtils.setField(c,"projects",projects);
    }

    @SuppressWarnings("unchecked") private Map<String,Object> cloneMap(Map<String,Object> value) { return json.convertValue(value,Map.class); }
    private Req request(String method,String path,String token) {
        String[] parts=path.split("\\?",2); MockHttpServletRequest request=new MockHttpServletRequest(method,parts[0]);
        if(token!=null) request.addHeader("Authorization","Bearer "+token);
        if(parts.length==2) for(String pair:parts[1].split("&")) { String[] kv=pair.split("=",2); request.setParameter(kv[0],kv.length>1?kv[1]:""); }
        return new Req(request);
    }
    private void status(int expected,Runnable action) { assertEquals(expected,assertThrows(J.ApiException.class,action::run).status); }
    private Map<String,Object> customer(String phone) { return map(customers.handle(request("POST","/api/customer/register",null),obj("phone",phone,"password",PASSWORD,"repeat",PASSWORD))); }
    private Map<String,Object> project(String token) {
        return map(projects.handle(request("POST","/api/projects",token),obj("title","测试工程","contact","测试客户","phone","13800000001","confidential",true,"customerType","enterprise","items",List.of(obj("productId","P1","quantity",2)))));
    }

    @Test void customerIdentityAndMessageReceiptsRemainIsolated() {
        Map<String,Object> a=customer("13800000001"), b=customer("13800000002"); String token=s(a,"token"), other=s(b,"token");
        assertFalse(map(a.get("customer")).containsKey("password"));
        status(409,()->customer("+86 138-0000-0001"));
        Map<String,Object> chat=map(map(customers.handle(request("POST","/api/customer/chat",token),obj())).get("chat")); String base="/api/customer/chats/"+s(chat,"id");
        status(403,()->customers.handle(request("GET",base+"/messages",other),obj()));
        Map<String,Object> body=obj("text","咨询","requestId","request-1");
        customers.handle(request("POST",base+"/messages",token),body); customers.handle(request("POST",base+"/messages",token),body);
        status(409,()->customers.handle(request("POST",base+"/messages",token),obj("text","不同内容","requestId","request-1")));
        customers.handle(request("POST",base+"/messages","service"),obj("text","回复","requestId","request-2"));
        assertEquals(2,maps(map(customers.handle(request("GET",base+"/messages","service"),obj())).get("messages")).size());
        assertEquals(1,n(map(customers.handle(request("GET","/api/customer/notifications",token),obj())),"supportUnread"));
        customers.handle(request("POST",base+"/read",token),obj("seq",2)); customers.handle(request("POST",base+"/read",token),obj("seq",0));
        assertEquals(0,n(map(customers.handle(request("GET","/api/customer/notifications",token),obj())),"supportUnread"));
        customers.handle(request("POST","/api/customer/accounts/"+s(map(a.get("customer")),"id"),"admin"),obj("active",false));
        status(401,()->customers.handle(request("GET","/api/customer/me",token),obj()));
    }

    @Test void projectTransitionsAndConversationPaginationKeepOriginalContracts() {
        Map<String,Object> a=customer("13800000001"), result=project(s(a,"token")), project=map(result.get("project"));
        String projectPath="/api/projects/"+s(project,"id"), guest=s(result,"token");
        assertFalse(project.containsKey("secretHash"));
        assertEquals("enterprise",project.get("customerType"));
        status(403,()->projects.handle(request("POST",projectPath+"/review","service"),obj("revision",1,"status","reviewing","note","审核")));
        status(409,()->projects.handle(request("POST",projectPath+"/review","reviewer"),obj("revision",1,"status","accepted","note","跳步")));
        projects.handle(request("POST",projectPath+"/review","reviewer"),obj("revision",1,"status","needs_info","note","补充数量"));
        status(403,()->projects.handle(request("POST",projectPath+"/supplement","admin"),obj("revision",2,"notes","员工不能代填")));
        status(400,()->projects.handle(request("POST",projectPath+"/supplement",guest),obj("revision",2,"notes","保密项目附件","files",List.of(obj("name","test.png")))));
        Map<String,Object> amended=map(map(projects.handle(request("POST",projectPath+"/supplement",guest),obj("revision",2,"notes","数量确认"))).get("project"));
        assertEquals("submitted",amended.get("status")); assertEquals(3,n(amended,"revision"));
        status(409,()->projects.handle(request("POST",projectPath+"/review","reviewer"),obj("revision",2,"status","reviewing","note","旧版本")));
        Map<String,Object> conversation=map(map(projects.handle(request("POST","/api/conversations",guest),obj("kind","project","recordId",project.get("id")))).get("conversation"));
        String chatPath="/api/conversations/"+s(conversation,"id");
        Map<String,Object> sent=map(map(projects.handle(request("POST",chatPath+"/messages",guest),obj("clientMessageId","first","sendCard",true))).get("message"));
        assertFalse(sent.containsKey("actorId")); assertEquals(project.get("id"),map(sent.get("card")).get("recordId"));
        status(400,()->projects.handle(request("POST",chatPath+"/messages",guest),obj("clientMessageId","injected","text","伪造卡片","recordId","OTHER")));
        status(403,()->projects.handle(request("GET",chatPath,"reviewer"),obj()));
        Map<String,Object> stored=c.get("conversation",s(conversation,"id")); List<Map<String,Object>> messages=new ArrayList<>();
        for(int i=1;i<=204;i++) messages.add(obj("id","MSG-"+i,"seq",i,"sender","staff","text","测试消息","at",now()));
        stored.put("messages",messages); stored.put("latestSeq",204); c.put("conversation",stored);
        Map<String,Object> page=map(projects.handle(request("GET",chatPath+"?after=0",guest),obj()));
        assertEquals(200,maps(page.get("messages")).size()); assertEquals(200,n(page,"latestSeq")); assertEquals(true,page.get("hasMore"));
        Map<String,Object> tail=map(projects.handle(request("GET",chatPath+"?after=200",guest),obj()));
        assertEquals(4,maps(tail.get("messages")).size()); assertEquals(204,n(tail,"latestSeq")); assertEquals(false,tail.get("hasMore"));
    }

    @Test void nodeReceiptVectorRemainsReadableAndTamperingIsRejected() {
        /* 由原 Node crypto.hkdfSync/createCipheriv 生成，固定密钥 01..20 与 IV 00..0b。 */
        String legacy="AQABAgMEBQYHCAkKC45JnzCF3WsrxrG5E_OVkrM3-RytU4YmW8gfCPb8dKlyksmHYU3luCIt24lxiBMXCA5rZe8DYCQXOGxaM6kZA66nVDgQpx8VfbmOeQPo5b1kHC7CNb42TUsIVWKUXGunxYHbpnOhVPDFzDg9ARlA2Q";
        c.put("project",obj("id","PR-old","secretHash","old-record-hash","title","旧工程"));
        Map<String,Object> opened=map(projects.handle(request("POST","/api/guest/access",null),obj("key",legacy)));
        assertEquals("PR-old",map(opened.get("project")).get("id")); assertFalse(map(opened.get("project")).containsKey("secretHash"));
        Map<String,Object> reopened=map(projects.handle(request("POST","/api/guest/access",null),obj("key",opened.get("accessKey"))));
        assertEquals("project",reopened.get("kind"));
        status(401,()->projects.handle(request("POST","/api/guest/access",null),obj("key",legacy.substring(0,30)+"A"+legacy.substring(31))));
        c.put("project",obj("id","PR-old","secretHash","revoked-hash"));
        status(401,()->projects.handle(request("POST","/api/guest/access",null),obj("key",legacy)));
    }

    @Test void followupOwnershipIdempotencyAndRevisionRemainIndependentOfOrders() {
        c.put("order",obj("id","SO-one","number","SO-20261027-0001","product",obj("code","DEMO","name","设备"),"status","submitted"));
        Map<String,Object> plan=obj("kind","order","recordId","SO-one","ownerId","service-id","action","确认交付","dueAt","2099-01-01T00:00:00.000Z","priority","normal","requestId","plan-1");
        status(403,()->followups.handle(request("POST","/api/followups","reviewer"),plan));
        Map<String,Object> task=map(map(followups.handle(request("POST","/api/followups","admin"),plan)).get("task")); String id=s(task,"id");
        assertFalse(task.containsKey("requestHash")); assertFalse(task.containsKey("requestId"));
        assertEquals(id,s(map(map(followups.handle(request("POST","/api/followups","admin"),plan)).get("task")),"id"));
        Map<String,Object> changed=copy(plan); changed.put("action","其他内容");
        status(409,()->followups.handle(request("POST","/api/followups","admin"),changed));
        status(403,()->followups.handle(request("POST","/api/followups/"+id+"/complete","other"),obj("revision",1,"note","非负责人")));
        followups.handle(request("POST","/api/followups/"+id+"/reschedule","admin"),obj("revision",1,"note","改派","ownerId","other-id","dueAt","2099-02-01T00:00:00.000Z"));
        status(409,()->followups.handle(request("POST","/api/followups/"+id+"/complete","other"),obj("revision",1,"note","过期版本")));
        Map<String,Object> completed=map(map(followups.handle(request("POST","/api/followups/"+id+"/complete","other"),obj("revision",2,"note","已联系"))).get("task"));
        assertEquals("done",completed.get("status")); assertEquals(3,maps(completed.get("history")).size()); assertEquals("submitted",c.get("order","SO-one").get("status"));
        status(409,()->followups.handle(request("POST","/api/followups/"+id+"/complete","other"),obj("revision",3,"note","重复完成")));
        Map<String,Object> invalid=copy(plan); invalid.put("requestId","invalid-date"); invalid.put("dueAt","2099-02-30T00:00:00.000Z");
        status(400,()->followups.handle(request("POST","/api/followups","admin"),invalid));
    }

    @Test void pricesRejectStringsPartialRangesAndExcessPrecision() {
        assertNull(ProjectRoutes.referencePrice(null));
        assertNull(ProjectRoutes.referencePrice(obj("buyMin",null,"buyMax",null)));
        Map<String,Object> price=map(ProjectRoutes.referencePrice(obj("buyMin",10.25,"buyMax",20,"source","人工确认")));
        assertEquals("CNY",price.get("currency")); assertEquals(10.25,price.get("buyMin"));
        for(Map<String,Object> invalid:List.of(obj("buyMin","10","buyMax",20),obj("buyMin",10,"buyMax",null),obj("buyMin",20,"buyMax",10),obj("buyMin",10.001,"buyMax",20))) {
            invalid.put("source","测试"); status(400,()->ProjectRoutes.referencePrice(invalid));
        }
    }

    @Test void webHostAllowsOnlyLoopbackAndPrivateLanOnActualPort() {
        for(String host:List.of("127.0.0.1:8790","localhost:8790","10.0.0.8:8790","172.16.0.1:8790","172.31.255.254:8790","192.168.10.25:8790")) {
            assertTrue(WebController.allowedHost(host,8790),host);
        }
        for(String host:List.of("127.0.0.1:8080","172.15.1.1:8790","172.32.1.1:8790","192.169.1.1:8790","8.8.8.8:8790","service.example:8790","192.168.01.2:8790","192.168.1.300:8790")) {
            assertFalse(WebController.allowedHost(host,8790),host);
        }
    }
}

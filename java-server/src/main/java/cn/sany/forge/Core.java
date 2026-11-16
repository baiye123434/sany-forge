package cn.sany.forge;

import org.bouncycastle.crypto.generators.SCrypt;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import static cn.sany.forge.J.*;

/** Java 后端的公共服务。每个 API 事务先取得数据库锁，保留 V3 单线程顺序写入语义。 */
@Component
@DependsOn("dataSourceScriptDatabaseInitializer")
public class Core {
    public static final String VERSION="3.7.3";
    /** 超级管理员沿用 admin 内部标识；对外岗位只保留超管、客服和订单审核员。 */
    public static final String[] ROLES={"admin","service","reviewer"};
    public final StaffRoutes staff;
    public final Store store;
    public final Path dataDir,webRoot;
    public final byte[] faceKey;
    public final long started=System.currentTimeMillis();
    public final AtomicLong requests=new AtomicLong(),errors=new AtomicLong();
    public final ProjectRoutes projects;
    public final CustomerRoutes customers;
    public final FollowupRoutes followups;
    public final AdminRoutes admin;
    public final BusinessRoutes business;
    private final MaterialFiles materialFiles;
    private final TransactionTemplate tx;
    private final SecureRandom random=new SecureRandom();
    private final Map<String,Map<String,Object>> sessions=new ConcurrentHashMap<>(),challenges=new ConcurrentHashMap<>(),failures=new ConcurrentHashMap<>();
    private long phoneUntil;
    private int phoneCount;
    public record Binary(byte[] bytes,String mime,String filename,boolean attachment) {}

    public Core(Store store,PlatformTransactionManager manager) throws Exception {
        this.store=store; tx=new TransactionTemplate(manager);
        dataDir=Path.of(System.getenv().getOrDefault("SANY_PLATFORM_DATA",".data-java")).toAbsolutePath().normalize();
        webRoot=Path.of(System.getenv().getOrDefault("SANY_WEB_ROOT","../dist")).toAbsolutePath().normalize();
        Files.createDirectories(dataDir);
        Path key=dataDir.resolve("face.key");
        try { Files.write(key,randomBytes(32),StandardOpenOption.CREATE_NEW); } catch(FileAlreadyExistsException ignored) {}
        faceKey=Files.readAllBytes(key);
        if(faceKey.length!=32) throw new IllegalStateException("平台密钥长度错误，请保留数据目录。");
        admin=new AdminRoutes(this); customers=new CustomerRoutes(this); projects=new ProjectRoutes(this);
        followups=new FollowupRoutes(this); business=new BusinessRoutes(this); materialFiles=new MaterialFiles(this); staff=new StaffRoutes(this);
    }
    public Map<String,Object> get(String kind,String id) { return store.get(kind,id); }
    public List<Map<String,Object>> all(String kind) { return store.all(kind); }
    public void put(String kind,Map<String,Object> record) { store.put(kind,record); }
    public void delete(String kind,String id) { store.delete(kind,id); }
    public String json(Object value) { return store.json(value); }
    public Object parse(String value) { return store.parse(value); }
    public <T>T atomic(Supplier<T> operation) {
        return tx.execute(status->{ store.jdbc.queryForObject("SELECT id FROM mutation_lock WHERE id=1 FOR UPDATE",Integer.class); return operation.get(); });
    }
    public void audit(String actor,String action,String target) { audit(actor,action,target,""); }
    public void audit(String actor,String action,String target,String detail) { store.jdbc.update("INSERT INTO audit(actor,action,target,at,detail) VALUES(?,?,?,?,?)",actor,action,target,now(),detail); }
    public byte[] randomBytes(int count) { byte[] bytes=new byte[count]; random.nextBytes(bytes); return bytes; }
    public String randomToken(int count) { return HexFormat.of().formatHex(randomBytes(count)); }
    public String passwordHash(Object input) {
        text(input,200); String password=(String)input; if(password.length()<10) throw fail("密码至少 10 位。");
        String salt=randomToken(16);
        return salt+":"+HexFormat.of().formatHex(SCrypt.generate(password.getBytes(StandardCharsets.UTF_8),salt.getBytes(StandardCharsets.UTF_8),16384,8,1,32));
    }
    public boolean verifyPassword(Object input,String stored) {
        if(!(input instanceof String password)||password.length()>200) return false;
        try { String[] pieces=stored.split(":"); byte[] actual=SCrypt.generate(password.getBytes(StandardCharsets.UTF_8),pieces[0].getBytes(StandardCharsets.UTF_8),16384,8,1,32);
            return MessageDigest.isEqual(actual,HexFormat.of().parseHex(pieces[1]));
        } catch(Exception e) { return false; }
    }
    public Map<String,Object> publicUser(Map<String,Object> u) { return obj("id",u.get("id"),"username",u.get("username"),"employeeNumber",u.get("username"),"name",u.get("name"),"role",u.get("role"),"roles",assignedRoles(u),"active",u.get("active"),"faceEnrolled",truthy(u.get("face")),"capabilities",admin.capabilities(s(u,"role")),"createdAt",u.get("createdAt")); }
    public List<String> assignedRoles(Map<String,Object> u) { return u.get("roles") instanceof List ? arr(u.get("roles")).stream().map(String::valueOf).filter(r->Arrays.asList(ROLES).contains(r)).toList() : List.of(s(u,"role")); }
    /** 角色选择只改变本会话，不能提升账户的授权角色，也不能改变并行会话。 */
    public void selectRole(Req req,String role) { var access=auth(req,ROLES); var user=map(access.get("user")); if(!assignedRoles(user).contains(role)) throw fail("该账号未获此岗位授权。",403); sessions.get(req.token()).put("role",role); }
    public Map<String,Object> sessionFor(Map<String,Object> user) {
        return sessionFor(user,s(user,"role"));
    }
    public Map<String,Object> sessionFor(Map<String,Object> user,String role) {
        if(!assignedRoles(user).contains(role)) throw fail("该账号未获此岗位授权。",403);
        String token=randomToken(32); sessions.put(token,obj("userId",user.get("id"),"role",role,"enrollOnly",false,"expires",System.currentTimeMillis()+8*3600000L));
        return obj("token",token,"user",publicUser(user),"enrollOnly",false);
    }
    public String guestSession(String id) { return guestSession(id,"order"); }
    public String guestSession(String id,String kind) { String token=randomToken(32); sessions.put(token,obj(kind.equals("project")?"projectId":"orderId",id,"expires",System.currentTimeMillis()+8*3600000L)); return token; }
    public Map<String,Object> auth(Req req,String... allowed) {
        Map<String,Object> session=sessions.get(req.token());
        if(session==null||((Number)session.get("expires")).longValue()<System.currentTimeMillis()) { sessions.remove(req.token()); throw fail("请先登录，或使用订单查询凭证。",401); }
        Map<String,Object> access=copy(session);
        if(truthy(session.get("orderId"))||truthy(session.get("projectId"))) {
            if(truthy(session.get("orderId"))&&truthy(map(get("order",s(session,"orderId"))).get("salesId"))) throw fail("内部销售订单只能从岗位工作台访问。",403);
            if(allowed.length>0) throw fail("没有此操作权限。",403);
            access.put("actor","客户"); return access;
        }
        Map<String,Object> user=get("user",s(session,"userId"));
        if(user==null||!b(user,"active")||b(session,"enrollOnly")) throw fail("请先完成人脸录入与验证。",403);
        user=copy(user); String selected=s(session,"role");
        if(!assignedRoles(user).contains(selected)) throw fail("岗位授权已变更，请重新登录。",403);
        user.put("role",selected);
        if(allowed.length>0&&!Arrays.asList(allowed).contains(s(user,"role"))) throw fail("当前账号没有此操作权限。",403);
        admin.enforce(req,user); staff.enforceLegacy(req,user); access.put("user",user); access.put("actor",user.get("username")+" · "+user.get("name")); return access;
    }
    public Map<String,Object> ownOrder(Req req,String orderId) { Map<String,Object> access=auth(req); if(truthy(access.get("projectId"))||(truthy(access.get("orderId"))&&!Objects.equals(access.get("orderId"),orderId))) throw fail("不能访问其他订单。",403); if(access.get("user") instanceof Map) staff.requireVisible(map(access.get("user")),get("order",orderId)); return access; }
    public void revokeUser(String userId) { sessions.entrySet().removeIf(e->Objects.equals(e.getValue().get("userId"),userId)); challenges.entrySet().removeIf(e->Objects.equals(e.getValue().get("userId"),userId)); }
    public void revokeAll() { sessions.clear(); challenges.clear(); customers.revokeAll(); }
    private void expire() { long time=System.currentTimeMillis(); for(var collection:List.of(sessions,challenges)) collection.entrySet().removeIf(e->((Number)e.getValue().get("expires")).longValue()<=time); failures.entrySet().removeIf(e->((Number)e.getValue().get("until")).longValue()<=time); }
    public synchronized void checkPhoneQuery() { long time=System.currentTimeMillis(); if(phoneUntil<=time) { phoneUntil=time+60000; phoneCount=0; } if(++phoneCount>60) throw fail("电话查询过于频繁，请稍后再试。",429); }
    public Object loadJson(String file,Object fallback) { try { return parse(Files.readString(webRoot.resolve(file))); } catch(Exception e) { return fallback; } }
    public List<Map<String,Object>> products() {
        Object catalog=loadJson("catalog.json",obj("products",List.of()));
        List<Map<String,Object>> legacy=maps(loadJson("legacy-models.json",List.of()));
        Map<String,Object> models=new HashMap<>();
        for(var p:legacy) models.put(s(p,"code").replaceAll("\\s+","").toUpperCase(Locale.ROOT),p.get("modelKey"));
        Map<String,Map<String,Object>> result=new LinkedHashMap<>();
        for(var p:maps(catalog instanceof List?catalog:map(catalog).get("products"))) {
            var row=copy(p); row.put("modelKey",models.get(s(p,"code").replaceAll("\\s+","").toUpperCase(Locale.ROOT)));
            row.putAll(obj("published",true,"deleted",false,"custom",false)); result.put(s(p,"id"),row);
        }
        for(var p:legacy) { var row=copy(p); row.putAll(obj("published",true,"deleted",false,"custom",false)); result.put(s(p,"id"),row); }
        for(var p:all("product")) { var row=copy(result.getOrDefault(s(p,"id"),obj())); row.putAll(p); result.put(s(p,"id"),row); }
        return new ArrayList<>(result.values());
    }
    public List<Map<String,Object>> publicProducts() { return products().stream().filter(p->b(p,"published")&&!b(p,"deleted")).toList(); }
    public List<Map<String,Object>> addFiles(Object incoming,String kind,String id,boolean required) { return materialFiles.add(incoming,kind,id,required); }
    public Map<String,Object> transition(Map<String,Object> record,String status,Map<String,Object> access,String note,Object files,Map<String,Object> extra) {
        Map<String,Object> user=map(access.get("user"));
        Map<String,Object> event=obj("id",id("EV"),"from",record.get("status"),"to",status,"actor",access.get("actor"),"actorId",user.isEmpty()?"customer":user.get("id"),"role",user.isEmpty()?"customer":user.get("role"),"note",note,"files",files,"at",now());
        List<Object> history=new ArrayList<>(arr(record.get("history"))); history.add(event);
        Map<String,Object> result=copy(record); result.putAll(extra); result.putAll(obj("status",status,"revision",n(record,"revision")+1,"updatedAt",now(),"history",history)); return result;
    }
    public void revision(Map<String,Object> record,Map<String,Object> body) { if(!(body.get("revision") instanceof Number value)||!Double.isFinite(value.doubleValue())||n(record,"revision")!=value.doubleValue()) throw fail("记录已被更新，请刷新后再操作。",409); }
    public String documentNumber(String prefix) {
        if(!Set.of("SO","PR","WO","FU").contains(prefix)) throw fail("无效单据前缀");
        return atomic(()->{
            String day=LocalDate.now(ZoneId.of("Asia/Shanghai")).format(DateTimeFormatter.BASIC_ISO_DATE),stem=prefix+"-"+day+"-";
            int high=0;
            for(String number:store.jdbc.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(body,'$.number')) FROM records WHERE JSON_UNQUOTE(JSON_EXTRACT(body,'$.number')) LIKE ?",(rs,n)->rs.getString(1),stem+"%"))
                if(number.matches(java.util.regex.Pattern.quote(stem)+"[0-9]{4}")) high=Math.max(high,Integer.parseInt(number.substring(stem.length())));
            store.jdbc.update("INSERT INTO document_sequences(prefix,day,value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE value=GREATEST(value,VALUES(value))",prefix,day,high);
            if(store.jdbc.update("UPDATE document_sequences SET value=value+1 WHERE prefix=? AND day=? AND value<9999",prefix,day)!=1) throw fail("该类单据今日流水已达9999，请次日再创建。",409);
            int value=store.jdbc.queryForObject("SELECT value FROM document_sequences WHERE prefix=? AND day=?",Integer.class,prefix,day);
            return stem+String.format(Locale.ROOT,"%04d",value);
        });
    }
    private String encrypt(Object value) { try {
        byte[] iv=randomBytes(12); Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(faceKey,"AES"),new GCMParameterSpec(128,iv));
        byte[] result=cipher.doFinal(json(value).getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(iv)+":"+HexFormat.of().formatHex(Arrays.copyOfRange(result,result.length-16,result.length))+":"+Base64.getEncoder().encodeToString(Arrays.copyOf(result,result.length-16));
    } catch(Exception e) { throw new IllegalStateException(e); } }
    private Object decrypt(String input) { try {
        String[] parts=input.split(":"); Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(faceKey,"AES"),new GCMParameterSpec(128,HexFormat.of().parseHex(parts[0])));
        byte[] data=Base64.getDecoder().decode(parts[2]),tag=HexFormat.of().parseHex(parts[1]),joined=Arrays.copyOf(data,data.length+tag.length); System.arraycopy(tag,0,joined,data.length,tag.length);
        return parse(new String(cipher.doFinal(joined),StandardCharsets.UTF_8));
    } catch(Exception e) { throw fail("人脸档案无法解密，请联系管理员重置。",401); } }
    private List<Double> descriptor(Object value) {
        if(!(value instanceof List<?> list)||list.size()!=128) throw fail("人脸特征无效，请重新识别。");
        List<Double> result=new ArrayList<>(); for(Object item:arr(value)) { if(!(item instanceof Number n)||!Double.isFinite(n.doubleValue())||Math.abs(n.doubleValue())>3) throw fail("人脸特征无效，请重新识别。"); result.add(n.doubleValue()); } return result;
    }
    private double distance(List<Double> a,List<Double> b) { double sum=0; for(int i=0;i<128;i++) sum+=Math.pow(a.get(i)-b.get(i),2); return Math.sqrt(sum); }
    private Map<String,Object> challenge(Map<String,Object> user,boolean enroll,String role) {
        String token=randomToken(24); List<String> turns=random.nextBoolean()?List.of("left","right"):List.of("right","left");
        challenges.put(token,obj("userId",user.get("id"),"authVersion",n(user,"authVersion"),"enroll",enroll,"role",role,"turns",turns,"expires",System.currentTimeMillis()+120000));
        return obj("challenge",token,"turns",turns,"enroll",enroll,"expiresIn",120,"user",publicUser(user));
    }
    private Object authRoute(Req req,Map<String,Object> body) {
        String p=req.path();
        if(p.equals("/api/health")) return obj("ok",true,"app","sany-service-platform","version",VERSION,"storage","mysql","runtime","java");
        if(p.equals("/api/bootstrap")) return obj("version",VERSION,"setupNeeded",all("user").isEmpty(),"catalog",loadJson("catalog-audit.json",obj()),"roles",ROLES);
        if((p.equals("/api/setup")||p.equals("/api/register"))&&req.method().equals("POST")) {
            boolean setup=p.equals("/api/setup");
            if(setup&&!all("user").isEmpty()) throw fail("管理账号已经初始化。",409);
            if(!setup&&all("user").isEmpty()) throw fail("请先初始化超级管理员。",409);
            String username=text(body.get("username"),40); if(!username.matches("[\\w.-]{3,40}")) throw fail("账号使用 3–40 位字母、数字、下划线或点。");
            if(!setup&&!Objects.equals(body.get("password"),body.get("repeat"))) throw fail("两次输入的密码不一致。");
            if(all("user").stream().anyMatch(u->username.equals(u.get("username")))) throw fail("该账号已被注册，请换一个账号名。",409);
            String role=setup?"admin":text(body.get("role"),40);
            if(!Arrays.asList(ROLES).contains(role)) throw fail("请选择有效的申请岗位。");
            var user=obj("id",id("USR"),"username",username,"name",text(body.get("name"),40),"password",passwordHash(body.get("password")),"role",role,"roles",List.of(role),"active",setup,"face",null,"createdAt",now());
            put("user",user); audit(s(user,"name"),setup?"创建首位管理员":"提交员工注册申请",s(user,"id"));
            return setup?sessionFor(user):obj("pending",true,"message","注册申请已提交，请等待超级管理员核验并启用账号。");
        }
        if(p.equals("/api/login")&&req.method().equals("POST")) {
            String username=text(body.get("username"),40); var attempt=failures.get(username);
            if(attempt!=null&&((Number)attempt.get("until")).longValue()>System.currentTimeMillis()&&n(attempt,"count")>=5) throw fail("连续失败过多，请 5 分钟后再试。",429);
            var user=all("user").stream().filter(u->username.equals(u.get("username"))).findFirst().orElse(null);
            if(user==null||!b(user,"active")||!verifyPassword(body.get("password"),s(user,"password"))) {
                failures.put(username,obj("count",(attempt==null?0:n(attempt,"count"))+1,"until",System.currentTimeMillis()+300000)); throw fail("账号或密码不正确。",401);
            }
            String role=truthy(body.get("role"))?text(body.get("role"),40):s(user,"role");
            if(!assignedRoles(user).contains(role)) throw fail("该账号未获所选岗位授权。",403);
            failures.remove(username); if(!truthy(user.get("face"))) { audit(s(user,"name"),"账号密码与岗位验证通过（未录入人脸，免核验）",s(user,"id")); return sessionFor(user,role); }
            return challenge(user,false,role);
        }
        if(p.equals("/api/face/verify")&&req.method().equals("POST")) {
            var item=challenges.remove(s(body,"challenge"));
            if(item==null||((Number)item.get("expires")).longValue()<System.currentTimeMillis()) throw fail("识别挑战已失效，请重新输入账号密码。",401);
            var user=get("user",s(item,"userId")); if(user==null||!b(user,"active")) throw fail("账号不可用。",403);
            if(n(user,"authVersion")!=n(item,"authVersion")||b(item,"enroll")==truthy(user.get("face"))) throw fail("账号验证信息已更新，请重新输入账号密码。",401);
            if(!(body.get("samples") instanceof List)||arr(body.get("samples")).size()!=3) throw fail("请按提示完成正面及两次转头采集。");
            List<List<Double>> vectors=new ArrayList<>(); List<Double> yaws=new ArrayList<>();
            for(Object sample:arr(body.get("samples"))) {
                if(!(sample instanceof Map)) throw fail("人脸采集格式无效。"); var m=map(sample); vectors.add(descriptor(m.get("descriptor")));
                try { double yaw=Double.parseDouble(String.valueOf(m.get("yaw"))); if(!Double.isFinite(yaw)) throw new IllegalArgumentException(); yaws.add(yaw); } catch(Exception e) { throw fail("正面采集不合格，请重新识别。"); }
            }
            if(Math.abs(yaws.get(0))>.14) throw fail("正面采集不合格，请重新识别。");
            for(int i=0;i<2;i++) { String turn=String.valueOf(arr(item.get("turns")).get(i)); double yaw=yaws.get(i+1); if((turn.equals("left")&&yaw>-.17)||(turn.equals("right")&&yaw<.17)) throw fail("转头动作未完成，请重新识别。"); if(distance(vectors.get(0),vectors.get(i+1))>.5) throw fail("采集期间检测到身份不一致。"); }
            if(b(item,"enroll")) { if(!b(body,"consent")) throw fail("录入人脸前需要同意本机存储特征。"); user.put("face",encrypt(vectors.get(0))); user.put("authVersion",n(user,"authVersion")+1); put("user",user); revokeUser(s(user,"id")); audit(s(user,"name"),"录入本机人脸特征",s(user,"id")); }
            else if(distance(vectors.get(0),descriptor(decrypt(s(user,"face"))))>.48) throw fail("人脸与当前账号不匹配，请重新登录。",401);
            audit(s(user,"name"),"账号及人脸验证通过",s(user,"id")); return sessionFor(user,s(item,"role"));
        }
        if(p.equals("/api/me")) return obj("user",publicUser(map(auth(req,ROLES).get("user"))));
        if(p.equals("/api/logout")&&req.method().equals("POST")) { sessions.remove(req.token()); return obj("ok",true); }
        return null;
    }
    public Object route(Req req,Map<String,Object> body) {
        expire();
        return atomic(()->{
            Object result=staff.handle(req,body); if(result!=null) return result;
            result=admin.handle(req,body); if(result!=null) return result;
            result=customers.handle(req,body); if(result!=null) return result;
            result=followups.handle(req,body); if(result!=null) return result;
            result=projects.handle(req,body); if(result!=null) return result;
            result=authRoute(req,body); if(result!=null) return result;
            result=business.handle(req,body); if(result!=null) return result;
            throw fail("接口不存在。",404);
        });
    }
}

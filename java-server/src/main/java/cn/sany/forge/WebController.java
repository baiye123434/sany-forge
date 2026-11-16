package cn.sany.forge;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static cn.sany.forge.J.*;

@RestController
public class WebController {
    private final Core c;
    private static final Map<String,String> MIME=Map.ofEntries(Map.entry("html","text/html; charset=utf-8"),Map.entry("js","text/javascript; charset=utf-8"),Map.entry("css","text/css; charset=utf-8"),Map.entry("json","application/json; charset=utf-8"),Map.entry("svg","image/svg+xml"),Map.entry("png","image/png"),Map.entry("jpg","image/jpeg"),Map.entry("jpeg","image/jpeg"),Map.entry("webp","image/webp"),Map.entry("ico","image/x-icon"));
    public WebController(Core c) { this.c=c; }
    static boolean allowedHost(String host,int localPort) {
        if(host==null) return false;
        int separator=host.lastIndexOf(':');
        if(separator<=0||separator==host.length()-1||host.indexOf(':')!=separator) return false;
        int port; try { port=Integer.parseInt(host.substring(separator+1)); } catch(NumberFormatException error) { return false; }
        if(port!=localPort) return false;
        String name=host.substring(0,separator);
        if(name.equalsIgnoreCase("localhost")||name.equals("127.0.0.1")) return true;
        String[] parts=name.split("\\.",-1); if(parts.length!=4) return false;
        int[] octets=new int[4];
        for(int i=0;i<parts.length;i++) {
            if(!parts[i].matches("0|[1-9]\\d{0,2}")) return false;
            try { octets[i]=Integer.parseInt(parts[i]); } catch(NumberFormatException error) { return false; }
            if(octets[i]>255) return false;
        }
        // 只接受 RFC1918 私有网段，拒绝公网 Host 和域名，继续阻断 DNS 重绑定。
        return octets[0]==10||(octets[0]==172&&octets[1]>=16&&octets[1]<=31)||(octets[0]==192&&octets[1]==168);
    }
    @RequestMapping({"/","/**"})
    public ResponseEntity<?> handle(HttpServletRequest request) {
        c.requests.incrementAndGet(); HttpHeaders headers=new HttpHeaders();
        headers.set("X-Content-Type-Options","nosniff"); headers.set("Referrer-Policy","no-referrer"); headers.set("Cache-Control","no-store");
        try {
            Req req=new Req(request); String host=req.header("Host"),origin=req.header("Origin");
            if(!allowedHost(host,request.getLocalPort())) throw fail("请求来源无效。",403);
            if(origin!=null&&!origin.equals("http://"+host)) throw fail("不允许跨站请求。",403);
            if(req.path().startsWith("/api/")) {
                Map<String,Object> body=obj();
                if(!Set.of("GET","HEAD").contains(req.method())) {
                    String type=req.header("Content-Type"); if(type==null||!type.startsWith("application/json")) throw fail("请求必须使用 JSON。",415);
                    int limit=24*1024*1024; if(request.getContentLengthLong()>limit) throw fail("提交内容过大。",413);
                    byte[] bytes=request.getInputStream().readNBytes(limit+1); if(bytes.length>limit) throw fail("提交内容过大。",413);
                    Object parsed; try { parsed=c.parse(bytes.length==0?"{}":new String(bytes,StandardCharsets.UTF_8)); } catch(Exception e) { throw fail("JSON 内容无效。"); }
                    if(!(parsed instanceof Map)) throw fail("JSON 内容必须是对象。"); body=map(parsed);
                }
                Object result=c.route(req,body);
                if(result instanceof Core.Binary binary) {
                    headers.set("Content-Type",binary.mime());
                    if(binary.attachment()) headers.set("Content-Disposition","attachment; filename*=UTF-8''"+URLEncoder.encode(binary.filename(),StandardCharsets.UTF_8).replace("+","%20"));
                    return new ResponseEntity<>(binary.bytes(),headers,HttpStatus.OK);
                }
                headers.setContentType(MediaType.APPLICATION_JSON); return new ResponseEntity<>(result,headers,HttpStatus.OK);
            }
            String requested=req.path().equals("/")?"/index.html":URLDecoder.decode(req.path().replace("+","%2B"),StandardCharsets.UTF_8);
            Path target=c.webRoot.resolve("."+requested).normalize();
            if(!target.startsWith(c.webRoot)||!Files.isRegularFile(target)||!target.toRealPath().startsWith(c.webRoot.toRealPath())) throw fail("页面不存在。",404);
            String name=target.getFileName().toString(),extension=name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
            headers.set("Content-Type",MIME.getOrDefault(extension,"application/octet-stream"));
            return new ResponseEntity<>(new FileSystemResource(target),headers,HttpStatus.OK);
        } catch(ApiException e) { return new ResponseEntity<>(obj("error",e.getMessage()),headers,HttpStatusCode.valueOf(e.status)); }
        catch(Exception e) { c.errors.incrementAndGet(); org.slf4j.LoggerFactory.getLogger(getClass()).error("请求处理失败",e); return new ResponseEntity<>(obj("error","本地服务处理失败，请检查数据目录和运行日志。"),headers,HttpStatus.INTERNAL_SERVER_ERROR); }
    }
}

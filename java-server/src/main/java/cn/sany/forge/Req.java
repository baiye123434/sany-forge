package cn.sany.forge;
import jakarta.servlet.http.HttpServletRequest;

/** 只暴露业务路由需要的 HTTP 信息，不让业务模块持有响应流。 */
public record Req(HttpServletRequest request) {
    public String method() { return request.getMethod(); }
    public String path() { return request.getRequestURI(); }
    public String query(String key) { return request.getParameter(key); }
    public String header(String key) { return request.getHeader(key); }
    public String token() { String value=header("Authorization"); return value==null?"":value.replaceFirst("^Bearer ",""); }
}

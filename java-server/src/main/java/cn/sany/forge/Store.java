package cn.sany.forge;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.sany.forge.J.*;

/** MySQL 持久层只使用绑定参数；保留原 JSON 契约，旧记录迁移后无需重建业务历史。 */
@Component
public class Store {
    public final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public Store(JdbcTemplate jdbc,ObjectMapper mapper) { this.jdbc=jdbc; this.mapper=mapper; }
    public String json(Object value) { try { return mapper.writeValueAsString(value); } catch(Exception e) { throw new IllegalStateException(e); } }
    public Object parse(String value) { try { return mapper.readValue(value,Object.class); } catch(Exception e) { throw new IllegalStateException("JSON 解析失败",e); } }
    public Map<String,Object> get(String kind,String id) {
        List<String> values=jdbc.query("SELECT body FROM records WHERE kind=? AND id=?",(rs,n)->rs.getString(1),kind,id);
        return values.isEmpty()?null:map(parse(values.get(0)));
    }
    public List<Map<String,Object>> all(String kind) { return jdbc.query("SELECT body FROM records WHERE kind=? ORDER BY id",(rs,n)->map(parse(rs.getString(1))),kind); }
    public void put(String kind,Map<String,Object> value) { jdbc.update("INSERT INTO records(kind,id,body) VALUES(?,?,?) ON DUPLICATE KEY UPDATE body=VALUES(body)",kind,s(value,"id"),json(value)); }
    public void delete(String kind,String id) { jdbc.update("DELETE FROM records WHERE kind=? AND id=?",kind,id); }
    public Map<String,Object> file(String id) { List<Map<String,Object>> files=jdbc.queryForList("SELECT * FROM files WHERE id=?",id); return files.isEmpty()?null:files.get(0); }
    public List<Map<String,Object>> auditEvents(int limit) { return jdbc.queryForList("SELECT * FROM audit ORDER BY id DESC LIMIT ?",limit); }
}

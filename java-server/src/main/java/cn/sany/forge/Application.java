package cn.sany.forge;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.context.WebServerInitializedEvent;
import org.springframework.context.event.EventListener;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        // 导入只运行数据库上下文，不开启 HTTP；迁移成功或失败都会关闭连接池。
        var imports=java.util.Arrays.stream(args).filter(arg->arg.startsWith("--import-legacy=")).toList();
        if(!imports.isEmpty()) {
            if(imports.size()!=1 || imports.get(0).equals("--import-legacy=")) { System.err.println("请仅提供一次 --import-legacy=完整文件路径。"); System.exit(2); }
            var app=new SpringApplication(Application.class);
            app.setWebApplicationType(WebApplicationType.NONE);
            try(var context=app.run(args)) {
                var core=context.getBean(Core.class);
                var result=LegacyImporter.run(core,java.nio.file.Path.of(imports.get(0).substring("--import-legacy=".length())));
                System.out.println("SANY_IMPORT_COMPLETE="+core.json(result));
            } catch(Exception ex) {
                // 仅输出已脱敏的校验消息；底层数据库异常可能含用户记录，不能直接打印。
                System.err.println(ex instanceof J.ApiException ? ex.getMessage() : "旧数据导入失败，请检查独立数据库配置和迁移文件。");
                System.exit(1);
            }
            return;
        }
        var context=SpringApplication.run(Application.class,args);
        // 只有桌面启动器拥有的子进程监听管道；关闭最后一个窗口或父进程消失时优雅收尾。
        if("1".equals(System.getenv("SANY_MANAGED_PROCESS"))) {
            Thread shutdown=new Thread(()->{
                try { var reader=new java.io.BufferedReader(new java.io.InputStreamReader(System.in)); String line; while((line=reader.readLine())!=null) if(line.equals("SANY_SHUTDOWN")) break; }
                catch(java.io.IOException ignored) {} finally { context.close(); }
            },"desktop-lifecycle");
            shutdown.setDaemon(true); shutdown.start();
        }
    }
    /** 启动器只在数据库和 HTTP 服务均就绪后展示窗口，避免打开空白网页。 */
    @EventListener public void ready(WebServerInitializedEvent event) { System.out.println("SANY_JAVA_READY=http://127.0.0.1:"+event.getWebServer().getPort()); }
}

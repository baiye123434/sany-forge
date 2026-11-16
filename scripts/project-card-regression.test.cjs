const test=require('node:test'),assert=require('node:assert/strict');
const {createProjectService}=require('../server/project-service.cjs');
test('项目会话卡片兼容标准、旧演示及无图片设备清单',async()=>{
 for(const [items,image] of [[[{product:{image:'nested.png'}}],'nested.png'],[[{image:'legacy.png'}],'legacy.png'],[[{quantity:1}],''],[[],''],[undefined,'']]){
 const project={id:'PR-test',title:'测试项目',items};
 const conversation={id:'CHAT-test',kind:'project',recordId:project.id,messages:[]};
 const service=createProjectService({faceKey:Buffer.alloc(32),get:()=>project,all:kind=>kind==='conversation'?[conversation]:[],auth:()=>({role:'admin'})});
 const result=await service.route({method:'GET'},new URL('http://localhost/api/conversations'));
 assert.equal(result.conversations[0].record.image,image);
 }
});

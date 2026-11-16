'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),version='3.5.0';
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
pkg.version=version;pkg.build.directories.output='release/lifecycle-3.5.0';
for(const file of ['scripts/followup.test.cjs','scripts/followup-ui.test.cjs']) if(!pkg.scripts.test.includes(file)) pkg.scripts.test+=' '+file;
pkg.scripts['test:single']=pkg.scripts.test.replace('node --test ','node --test --test-isolation=none ');
pkg.scripts['test:browser']='node scripts/review-browser.cjs';
fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg,null,2)+'\n');
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));lock.version=version;lock.packages[''].version=version;
fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
for(const relative of ['server/platform.cjs','dist/index.html','启动网页版.cmd','启动网页版服务.cmd','打开三一装备作品展.html','../打开三一匠造.html']) {
  const file=path.resolve(root,relative);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('3.4.4',version));
}
const main=path.join(root,'dist/platform.js');
fs.writeFileSync(main,fs.readFileSync(main,'utf8').replace('首次登录待录入','未录入 · 密码登录').replace('重置人脸后需本人重新录入；请先确认身份，勿让其他人代录。','重置人脸后，该演示账号将改为密码登录；请先确认身份及操作目的。').replace('重置本机人脸特征，下次登录重新录入','重置本机人脸特征，改为密码登录'));
const cmd=path.join(root,'同步生成软件版.cmd');fs.writeFileSync(cmd,fs.readFileSync(cmd,'utf8').replace('release 和项目上两级的自用文件夹','release 和参赛作品根目录'));
console.log('已准备 3.5.0 跟进功能构建；原 3.4.4 程序保留。');

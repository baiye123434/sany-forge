'use strict';
function createNumbering(db){
 db.exec('CREATE TABLE IF NOT EXISTS document_sequences(prefix TEXT,day TEXT,value INTEGER NOT NULL,PRIMARY KEY(prefix,day))');
 return function number(prefix,date=new Date()){
  if(!['SO','PR','WO','FU'].includes(prefix))throw Error('无效单据前缀');
  const day=date.toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'}).replaceAll('-','');
  const stem=`${prefix}-${day}-`;
  const max=db.prepare("SELECT MAX(CAST(substr(json_extract(body,'$.number'),13) AS INTEGER)) value FROM records WHERE json_extract(body,'$.number') GLOB ?").get(stem+'[0-9][0-9][0-9][0-9]').value||0;
  db.prepare('INSERT INTO document_sequences(prefix,day,value) VALUES(?,?,?) ON CONFLICT(prefix,day) DO UPDATE SET value=MAX(value,excluded.value)').run(prefix,day,max);
  const row=db.prepare('UPDATE document_sequences SET value=value+1 WHERE prefix=? AND day=? AND value<9999 RETURNING value').get(prefix,day);
  if(!row)throw Object.assign(Error('该类单据今日流水已达9999，请次日再创建。'),{status:409});
  return stem+String(row.value).padStart(4,'0');
 };
}
module.exports={createNumbering};

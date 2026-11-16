// Isolated test customer for business-flow fixtures; auth-negative tests do not use this helper.
const crypto=require('node:crypto'),sessions=new Map();
module.exports=async function customerFixture(url){
 if(!sessions.has(url))sessions.set(url,(async()=>{const password=crypto.randomBytes(20).toString('hex'),phone='139'+String(crypto.randomInt(10000000,99999999));const response=await fetch(url+'/api/customer/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password,repeat:password})});if(!response.ok)throw Error('Test customer registration failed');return(await response.json()).token;})());
 return sessions.get(url);
};

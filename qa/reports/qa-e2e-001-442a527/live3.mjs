import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8813, UD='/tmp/mk-qa-e2e001-r3', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123'; fs.rmSync(UD,{recursive:true,force:true});
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1'},stdio:'ignore'});
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const A={'x-studio-app-token':tok}, AF={'x-studio-app-token':tok,cookie:'mk_session=deadbeef'};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const x=await P('/api/world/savings',{target_usd:4242},A); console.log('agent(app) creates',x.s,x.j.approvalId?'id':'');
const y=await P('/api/world/approvals/'+x.j.approvalId,{decision:'approve',password:PW},AF); console.log('N1 app token + fake cookie approves agent request =>',y.s,JSON.stringify(y.j).slice(0,160));
// expiry: force expires_at to now on a pending row, also legacy row
const z=await P('/api/world/savings',{target_usd:5},A);
srv.kill(); await new Promise(r=>setTimeout(r,800));
const {DatabaseSync}=await import('node:sqlite'); const d=new DatabaseSync(UD+'/studio.db');
d.prepare('update world_approvals set expires_at=? where id=?').run(new Date(Date.now()+1500).toISOString(),z.j.approvalId);
d.prepare("insert into world_approvals (id,at,action,tier,status,detail,requested_by) values ('LEG1','t','critical_settings','owner','approved','legacy','owner')").run();
d.prepare("insert into world_approvals (id,at,action,tier,status,detail,requested_by) values ('LEG2','t','critical_settings','owner','pending','legacy','owner@app')").run();
console.log('savings in db:',d.prepare("select v from meta where k='worldSavings'").get()?.v); d.close();
const srv2=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1'},stdio:'ignore'});
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
await new Promise(r=>setTimeout(r,1600));
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const c2={cookie:lr.headers.get('set-cookie').split(';')[0]};
console.log('expired approve =>',JSON.stringify((await P('/api/world/approvals/'+z.j.approvalId,{decision:'approve',password:PW},c2)).j));
console.log('legacy approved LEG1 use =>',JSON.stringify((await P('/api/world/savings',{target_usd:1,approvalId:'LEG1'},A)).j));
console.log('legacy pending LEG2 approve =>',JSON.stringify((await P('/api/world/approvals/LEG2',{decision:'approve',password:PW},c2)).j).slice(0,200));
srv2.kill();

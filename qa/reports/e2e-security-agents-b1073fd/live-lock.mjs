import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8836, UD='/tmp/mk-qa-lock', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123';
fs.rmSync(UD,{recursive:true,force:true});
const env={...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',
  MK_WORLD_PW_LOCK_MS:'120000', MK_WORLD_PW_DELAY_MS:'10'};
const start=async()=>{const s=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env,stdio:'ignore'});
  for(let i=0;i<80;i++){try{if((await fetch(B+'/api/health')).ok)return s}catch{} await new Promise(r=>setTimeout(r,200))} throw new Error('no boot')};
let srv=await start();
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const S={cookie}, A={'x-studio-app-token':tok};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j,ra:r.headers.get('retry-after')}};
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const a=(await P('/api/world/savings',{target_usd:1},A)).j.approvalId;
const st=[];
for(let i=0;i<7;i++){
  // wait out throttle
  for(;;){const x=await ap(a,S,'bad'); st.push(x.s+':'+x.j.code+(x.ra?':'+x.ra:'')); if(x.j.code!=='throttled')break; await new Promise(r=>setTimeout(r,(+x.ra||1)*1000+20));}
}
console.log('fail chain',st);
console.log('correct during lock',await ap(a,S));
// old session cannot clear: restart keeping same cookie
srv.kill(); await new Promise(r=>setTimeout(r,500));
srv=await start();
console.log('after restart old cookie',await ap(a,S));
// main login with password -> new session clears
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const c2={cookie:lr.headers.get('set-cookie').split(';')[0]};
console.log('after login new session',await ap(a,c2));
// table growth: many fake IPs impossible without real peer; note schema PK is user|IP string
const {DatabaseSync}=await import('node:sqlite'); const d=new DatabaseSync(UD+'/studio.db');
console.log('auth_fails',d.prepare('select * from world_auth_fails').all());
// migration from empty
const d0=new DatabaseSync(':memory:'); require('/workspace/mk/lib/world/schema.js').migrate(d0); require('/workspace/mk/lib/world/schema.js').migrate(d0);
console.log('tables',d0.prepare("select name from sqlite_master where type='table'").all().map(x=>x.name).join(','));
// kill switch
srv.kill();
env.MK_WORLD_OWNER_SELF_APPROVAL='0';
srv=await start();
const lr2=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const c3={cookie:lr2.headers.get('set-cookie').split(';')[0]};
const own=(await P('/api/world/savings',{target_usd:9},c3)).j.approvalId;
console.log('kill switch self',await ap(own,c3));
// sessionIssuedAt: client cannot set; verify body field ignored
console.log('done'); srv.kill();

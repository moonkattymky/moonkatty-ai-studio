import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8835, UD='/tmp/mk-qa-final5', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123';
fs.rmSync(UD,{recursive:true,force:true});
const env={...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',
  MK_WORLD_SELF_APPROVAL_WINDOW_MS:'2000', MK_WORLD_PW_LOCK_MS:'60000', MK_WORLD_PW_DELAY_MS:'50'};
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env,stdio:['ignore','pipe','pipe']});
let slog='';srv.stdout.on('data',d=>slog+=d);srv.stderr.on('data',d=>slog+=d);
for(let i=0;i<80;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const cookie=r0.headers.get('set-cookie').split(';')[0]; const sess=cookie.split('=')[1];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const S={cookie}, A={'x-studio-app-token':tok};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j,h:Object.fromEntries(r.headers)}};
const G=async(p,h=S)=>{const r=await fetch(B+p,{headers:{...h}});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const out=[]; const L=(n,x)=>out.push(n+' => '+x.s+' '+JSON.stringify(x.j).slice(0,200)+(x.h?.['retry-after']?' ra='+x.h['retry-after']:''));
L('M1 savings no confirm',await P('/api/world/savings',{target_usd:100},S));
L('M2 savings confirm:true',await P('/api/world/savings',{target_usd:200,confirm:true},S));
L('M3 paid_ads confirm',await P('/api/world/action',{action:'paid_ads',confirm:true},S));
L('M4 critical_settings confirm',await P('/api/world/action',{action:'critical_settings',confirm:true},S));
L('M5 fake_views confirm',await P('/api/world/action',{action:'fake_views',confirm:true},S));
const a1=await P('/api/world/savings',{target_usd:300},A);
L('N1a pure app',await ap(a1.j.approvalId,A));
L('N1b app+fake cookie',await ap(a1.j.approvalId,{...A,cookie:'mk_session=dead'}));
L('N1c app+real cookie',await ap(a1.j.approvalId,{...A,cookie}));
L('N1d empty token + session',await ap(a1.j.approvalId,{'x-studio-app-token':'',...S}));
L('N1e whitespace token + session',await ap(a1.j.approvalId,{'x-studio-app-token':'   ',...S}));
L('N1f empty Authorization + session',await ap(a1.j.approvalId,{authorization:'',...S}));
L('N1g empty x-api-key + session',await ap(a1.j.approvalId,{'x-api-key':'',...S}));
L('N1h Bearer session alone',await ap(a1.j.approvalId,{authorization:'Bearer '+sess}));
L('N1i cookie session approve app req',await ap(a1.j.approvalId,S));
L('R1 reuse /savings 999',await P('/api/world/savings',{target_usd:999,approvalId:a1.j.approvalId},A));
L('R1 reuse same params 300',await P('/api/world/savings',{target_usd:300,approvalId:a1.j.approvalId},A));
L('R1 re-approve',await ap(a1.j.approvalId,S));
L('ORD not_found',await ap('no-such-id',S));
const pend=await P('/api/world/savings',{target_usd:1},A);
const rj=await P('/api/world/approvals/'+pend.j.approvalId,{decision:'reject'},S); L('reject',rj);
L('ORD already_decided',await ap(pend.j.approvalId,S));
const own=await P('/api/world/savings',{target_usd:50},S);
L('SELF within window',await ap(own.j.approvalId,S));
const own2=await P('/api/world/savings',{target_usd:51},S);
await new Promise(r=>setTimeout(r,2100));
L('SELF outside window',await ap(own2.j.approvalId,S));
const ownApp=await P('/api/world/savings',{target_usd:52},A);
L('CROSS app-req session-approve',await ap(ownApp.j.approvalId,S));
const a2=await P('/api/world/savings',{target_usd:60},A);
const bf=[]; for(let i=0;i<8;i++){const x=await ap(a2.j.approvalId,S,'bad'+i); bf.push(x.s+(x.h?.['retry-after']?':'+x.h['retry-after']:'')); await new Promise(r=>setTimeout(r,80));}
out.push('N2 statuses: '+JSON.stringify(bf));
L('N2 correct while locked',await ap(a2.j.approvalId,S));
L('N2 XFF spoof still locked',await ap(a2.j.approvalId,{...S,'x-forwarded-for':'1.2.3.4'}));
// old session cannot reset: keep S while locked, try login with new session
srv.kill(); await new Promise(r=>setTimeout(r,800));
const {DatabaseSync}=await import('node:sqlite');
const d=new DatabaseSync(UD+'/studio.db');
out.push('auth_fails: '+JSON.stringify(d.prepare('select * from world_auth_fails').all()));
const row=d.prepare("select id,params_hash,payload_json,status from world_approvals where status='pending' and requested_by like '%@app' limit 1").get();
if(row){ d.prepare("update world_approvals set payload_json=? where id=?").run(JSON.stringify({kind:'savings',target_usd:999999}), row.id); out.push('tampered '+row.id); }
d.prepare("update world_approvals set expires_at=? where id=?").run(new Date(Date.now()-1000).toISOString(), own2.j.approvalId);
const nBefore=d.prepare('select count(*) c from world_approvals').get().c;
d.close();
const srv2=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env,stdio:'ignore'});
for(let i=0;i<80;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,250))}
// old cookie session (issued before lock) should NOT reset
L('N2 old session after restart (persist lock)',await ap(a2.j.approvalId,S));
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const c2={cookie:lr.headers.get('set-cookie').split(';')[0]};
L('N2 new login clears lock + approve',await ap(a2.j.approvalId,c2));
L('ORD expired',await ap(own2.j.approvalId,c2));
if(row) L('TAMPER payload',await ap(row.id,c2));
const j=await G('/api/world/journal',c2);
out.push('journal has owner_self_approval: '+JSON.stringify(j.j).includes('owner_self_approval'));
out.push('pw leaked: '+(JSON.stringify(j.j).includes(PW)||slog.includes(PW)));
// migration non-destructive
const d2=new DatabaseSync(UD+'/studio.db'); out.push('approvals after: '+d2.prepare('select count(*) c from world_approvals').get().c+' before was '+nBefore); d2.close();
// race consume
const a3=await P('/api/world/savings',{target_usd:70},A);
const rr=await Promise.all(Array.from({length:10},()=>ap(a3.j.approvalId,c2)));
out.push('race10: '+JSON.stringify(rr.map(x=>x.s).reduce((a,s)=>(a[s]=(a[s]||0)+1,a),{})));
console.log(out.join('\n')); srv2.kill();

import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8851, UD='/tmp/mk-qa-next', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123';
fs.rmSync(UD,{recursive:true,force:true});
const env={...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',
  MK_WORLD_PW_LOCK_MS:'120000', MK_WORLD_PW_DELAY_MS:'10'};
const boot=async()=>{const s=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env,stdio:'ignore'});
  for(let i=0;i<80;i++){try{if((await fetch(B+'/api/health')).ok)return s}catch{} await new Promise(r=>setTimeout(r,200));}
  throw new Error('boot fail')};
let srv=await boot();
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const S={cookie}, A={'x-studio-app-token':tok};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const out=[]; const L=(n,x)=>out.push(n+' => '+x.s+' '+JSON.stringify(x.j).slice(0,220));
// matrix
L('M1 savings',await P('/api/world/savings',{target_usd:100},S));
L('M2 confirm:true',await P('/api/world/savings',{target_usd:200,confirm:true},S));
L('M3 paid_ads',await P('/api/world/action',{action:'paid_ads',confirm:true},S));
L('M4 critical+confirm',await P('/api/world/action',{action:'critical_settings',confirm:true},S));
L('M5 fake_views',await P('/api/world/action',{action:'fake_views',confirm:true},S));
// F1
const f1=await P('/api/world/savings',{target_usd:300},A);
const id=f1.j.approvalId;
srv.kill(); await new Promise(r=>setTimeout(r,600));
const {DatabaseSync}=await import('node:sqlite');
let d=new DatabaseSync(UD+'/studio.db');
const before=d.prepare('select params_hash,payload_json,status,consumed_at from world_approvals where id=?').get(id);
d.prepare('update world_approvals set payload_json=? where id=?').run(JSON.stringify({kind:'savings',target_usd:999999}), id);
d.close();
srv=await boot();
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})});
const c2={cookie:lr.headers.get('set-cookie').split(';')[0]};
L('F1 approve tampered',await ap(id,c2));
d=new DatabaseSync(UD+'/studio.db');
out.push('F1 db after: '+JSON.stringify(d.prepare('select status,consumed_at,exec_status from world_approvals where id=?').get(id)));
d.close();
L('F1 reuse /savings original 300',await P('/api/world/savings',{target_usd:300,approvalId:id},A));
L('F1 reuse /savings 999999',await P('/api/world/savings',{target_usd:999999,approvalId:id},A));
L('F1 re-approve',await ap(id,c2));
// F2: active lock not purged / not trimmed
const a2=(await P('/api/world/savings',{target_usd:1},A)).j.approvalId;
for(let n=0;n<5;){const x=await ap(a2,c2,'bad'); if(x.j.code==='throttled'){await new Promise(r=>setTimeout(r,(+x.h||1)*20+50));continue;} n++; if(x.j.code==='locked')break;}
// fix loop - use retry-after from response
async function lockUser(sess){
  const id=(await P('/api/world/savings',{target_usd:Math.random()*100|0},A)).j.approvalId;
  const chain=[];
  for(let i=0;i<12;i++){
    const x=await fetch(B+'/api/world/approvals/'+id,{method:'POST',headers:{...J,...sess},body:JSON.stringify({decision:'approve',password:'bad'+i})});
    const j=await x.json(); const ra=x.headers.get('retry-after');
    chain.push(x.status+':'+j.code);
    if(j.code==='locked') return {id,chain};
    if(j.code==='throttled') await new Promise(r=>setTimeout(r,(+ra||1)*1000+30));
  }
  return {id,chain};
}
const L1=await lockUser(c2); out.push('lock chain: '+JSON.stringify(L1.chain));
L('F2 correct during lock',await ap(L1.id,c2));
// inject 25 unlocked decoy rows same IP + call purge via failed attempt as new keys - only one user though
// Simulate via DB: 25 unlocked rows + 1 active lock, then trigger pwPurge via API and pwIpTrim via new keys
srv.kill(); await new Promise(r=>setTimeout(r,500));
d=new DatabaseSync(UD+'/studio.db');
const now=Date.now();
const lockRow=d.prepare('select * from world_auth_fails').all();
out.push('locks before flood: '+JSON.stringify(lockRow));
for(let i=0;i<25;i++) d.prepare('INSERT OR REPLACE INTO world_auth_fails (user,fails,locked_until,next_at,updated_at) VALUES (?,?,0,?,?)').run('decoy'+i+'|127.0.0.1',1,now+60000,new Date().toISOString());
// also one stale unlocked that should purge
d.prepare('INSERT OR REPLACE INTO world_auth_fails (user,fails,locked_until,next_at,updated_at) VALUES (?,?,0,?,?)').run('stale|127.0.0.1',1,now-200000,new Date().toISOString());
out.push('count after flood: '+d.prepare('select count(*) c from world_auth_fails').get().c);
const ownerLock=lockRow.find(r=>r.user.startsWith('owner|'));
out.push('owner lock still in db pre-boot: '+JSON.stringify(ownerLock));
d.close();
srv=await boot();
// trigger purge on access
L('F2 still locked after flood+restart',await ap(L1.id,c2));
d=new DatabaseSync(UD+'/studio.db');
const after=d.prepare('select user,fails,locked_until from world_auth_fails').all();
out.push('rows after purge/access: '+after.length+' owner='+JSON.stringify(after.find(r=>r.user.startsWith('owner|'))));
out.push('active locks kept: '+after.filter(r=>r.locked_until>Date.now()).length);
out.push('decoy unlocked count: '+after.filter(r=>r.user.startsWith('decoy')).length);
// trim on new fail: create user2? can't easily. Simulate pwFail path by inserting when at cap - call approve wrong from owner (same key, no trim of lock)
// Directly invoke: if we add user2 via setUsers - skip, use SQL to verify trim SQL won't delete locked
const lockedKept=d.prepare("SELECT COUNT(*) n FROM world_auth_fails WHERE locked_until > ?").get(Date.now()).n;
d.prepare("DELETE FROM world_auth_fails WHERE user IN (SELECT user FROM world_auth_fails WHERE user LIKE '%|127.0.0.1' ESCAPE '\\' AND locked_until = 0 ORDER BY updated_at ASC LIMIT 100)").run();
out.push('after manual trim (unlocked only): locked still '+d.prepare("SELECT COUNT(*) n FROM world_auth_fails WHERE locked_until > ?").get(Date.now()).n+' owner='+JSON.stringify(d.prepare("select * from world_auth_fails where user like 'owner|%'").get()));
d.close();
L('F2 lock survives trim',await ap(L1.id,c2));
console.log(out.join('\n')); srv.kill();

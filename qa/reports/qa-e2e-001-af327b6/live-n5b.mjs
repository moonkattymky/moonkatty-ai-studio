import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8824, UD='/tmp/mk-qa-n5b', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123'; fs.rmSync(UD,{recursive:true,force:true});
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',PATH:'/workspace/fakebin:'+process.env.PATH,OPENCODE_BIN:'/workspace/fakebin/opencode',STUDIO_SECRET_KEY:'leak-me-please'},stdio:'ignore'});
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const before=fs.readdirSync('/tmp').filter(f=>f.startsWith('fake-opencode'));
const j=await (await fetch(B+'/api/jobs',{method:'POST',headers:{...J,cookie},body:JSON.stringify({type:'opencode_task',input:{prompt:'stay-alive'}})})).json();
await new Promise(r=>setTimeout(r,500));
const after=fs.readdirSync('/tmp').filter(f=>f.startsWith('fake-opencode')).filter(f=>!before.includes(f));
console.log('child logs:', after);
// find the sleeping process
const {execSync}=await import('child_process');
const ps=execSync("ps aux | grep fakebin/opencode | grep -v grep || true").toString();
console.log('ps before cancel:\n'+ps);
await fetch(B+'/api/jobs/'+j.jobId+'/cancel',{method:'POST',headers:{...J,cookie},body:'{}'});
await new Promise(r=>setTimeout(r,1000));
const ps2=execSync("ps aux | grep fakebin/opencode | grep -v grep || true").toString();
console.log('ps after cancel:\n'+ps2);
const st=await (await fetch(B+'/api/jobs/'+j.jobId,{headers:{cookie}})).json();
console.log('status',st.status,'error',st.error);
// check if child log eventually grows (still writing?) and env
if(after[0]) console.log(fs.readFileSync('/tmp/'+after[0],'utf8').slice(0,400));
// also check cancel via services path for render_segment / whether services.cancelJob would work
const j2=await (await fetch(B+'/api/jobs',{method:'POST',headers:{...J,cookie},body:JSON.stringify({type:'render_segment',input:{durationSec:5,script:'x'}})})).json();
await new Promise(r=>setTimeout(r,200));
await fetch(B+'/api/jobs/'+j2.jobId+'/cancel',{method:'POST',headers:{...J,cookie},body:'{}'});
await new Promise(r=>setTimeout(r,500));
const st2=await (await fetch(B+'/api/jobs/'+j2.jobId,{headers:{cookie}})).json();
console.log('render cancel status',st2.status);
const ps3=execSync("ps aux | grep ffmpeg | grep -v grep || true").toString();
console.log('ffmpeg after cancel:\n'+ps3.slice(0,300));
// prod flavor: runners still wired?
const {createRequire}=await import('module'); const req=createRequire(import.meta.url);
// read server.js flavor gate around services
const src=fs.readFileSync('/workspace/mk/server.js','utf8');
console.log('flavor gate for services/task runners:', /startTaskJob|opencode_task|IS_TEST.*jobs/.test(src), 'CFG.IS_TEST around services:', (src.match(/services = require[\s\S]{0,200}/)||[])[0]?.slice(0,100));
console.log('IS_TEST gates opencode_task?', /IS_TEST[\s\S]{0,80}opencode_task|opencode_task[\s\S]{0,80}IS_TEST/.test(src));
srv.kill(); execSync('pkill -f fakebin/opencode || true'); execSync('pkill -f fakebin/ffmpeg || true');

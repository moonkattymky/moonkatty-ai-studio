import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PORT=8823, UD='/tmp/mk-qa-n5', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123';
fs.rmSync(UD,{recursive:true,force:true}); fs.mkdirSync(UD,{recursive:true});
// Part 1: unit-level via task-runners with fake opencode
process.env.PATH = '/workspace/fakebin:' + process.env.PATH;
process.env.FFMPEG_BIN = '/workspace/fakebin/ffmpeg';
process.env.OPENCODE_BIN = '/workspace/fakebin/opencode';
process.env.STUDIO_ADMIN_PASSWORD = 'admin-secret-LEAK';
process.env.STUDIO_SECRET_KEY = 'secret-key-LEAK';
process.env.STUDIO_DATA_DIR = UD;
const TR = require('/workspace/mk/lib/task-runners.js');
const out=[];
// prompt-to-argv: prompt starting with -
const wd='/tmp/oc-wd'; fs.rmSync(wd,{recursive:true,force:true});
try {
  const ac=new AbortController(); setTimeout(()=>ac.abort(),3000);
  await TR.runOpencode({prompt:'--help', workDir:wd, signal:ac.signal, timeoutMs:5000});
} catch(e){ out.push('opencode --help exit: '+e.message); }
const logs=fs.readdirSync('/tmp').filter(f=>f.startsWith('fake-opencode')).sort().slice(-1);
if(logs[0]){ const t=fs.readFileSync('/tmp/'+logs[0],'utf8'); out.push('ARGV: '+t.split('\n').filter(l=>l.startsWith('[')).join(' ')); out.push('ENV has ADMIN='+t.includes('STUDIO_ADMIN_PASSWORD')+' SECRET='+t.includes('STUDIO_SECRET_KEY')+' OPENCODE_SERVER_PASSWORD='+t.includes('OPENCODE_SERVER_PASSWORD')); out.push(t.split('\n').find(l=>l.startsWith('ADMINPW'))||''); }
// jobId traversal via workDir construction in services
out.push('jobId pattern from jobs.create: job_+16hex — services uses path.join(mediaRoot,"opencode-tasks",id)');
// render_segment: audioPath outside media
fs.writeFileSync('/tmp/secret-audio.wav','RIFF'); // not a real wav but exists
const v=TR.validateSegment({durationSec:1, audioPath:'/tmp/secret-audio.wav', script:'hi'});
out.push('validateSegment outside media: ok='+v.ok+' errors='+JSON.stringify(v.errors));
// existence oracle
const v2=TR.validateSegment({durationSec:1, audioPath:'/etc/passwd'});
out.push('oracle /etc/passwd: ok='+v2.ok+' err='+JSON.stringify(v2.errors));
const v3=TR.validateSegment({durationSec:1, audioPath:'/no/such/file'});
out.push('oracle missing: ok='+v3.ok+' err='+JSON.stringify(v3.errors));
// actually render with outside audio if ffmpeg can
const outp='/tmp/seg-out.mp4';
try {
  // create a tiny wav-ish via ffmpeg first
  await TR.run('/workspace/fakebin/ffmpeg',['-y','-f','lavfi','-i','sine=f=440:d=0.5','-ac','2','/tmp/secret-audio.wav'],{timeoutMs:10000});
  const r=await TR.renderSegment({script:'HELLO', audioPath:'/tmp/secret-audio.wav', durationSec:0.5, outPath:outp, timeoutMs:30000});
  out.push('render with /tmp audio: '+JSON.stringify({video:r.videoPath, size:fs.statSync(r.videoPath).size, textBurned:r.textBurned}));
} catch(e){ out.push('render outside audio fail: '+e.message); }
// shell injection via script / stillPath?
try {
  const r2=await TR.renderSegment({script:"'; touch /tmp/pwned; #", audioPath:null, durationSec:0.3, outPath:'/tmp/seg2.mp4', timeoutMs:20000});
  out.push('script shell inject: pwned='+fs.existsSync('/tmp/pwned')+' textBurned='+r2.textBurned);
} catch(e){ out.push('script inject err: '+e.message+' pwned='+fs.existsSync('/tmp/pwned')); }
// SIGTERM then SIGKILL: cancel
const ac2=new AbortController(); const p=TR.run('/workspace/fakebin/opencode',['run','slow'],{cwd:'/tmp',signal:ac2.signal,timeoutMs:60000,logFile:'/tmp/oc-cancel.log'});
setTimeout(()=>ac2.abort(),200);
try{await p; out.push('cancel: resolved')}catch(e){out.push('cancel: '+e.message+' cancelled='+!!e.cancelled)}
// timeout
try{await TR.run('/workspace/fakebin/opencode',['run','t'],{cwd:'/tmp',timeoutMs:100,logFile:'/tmp/oc-to.log'});out.push('timeout: resolved')}catch(e){out.push('timeout: '+e.message)}
console.log(out.join('\n'));
// Part 2: live server job creation + auth + cancel for opencode_task
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',PATH:'/workspace/fakebin:'+process.env.PATH,OPENCODE_BIN:'/workspace/fakebin/opencode',FFMPEG_BIN:'/workspace/fakebin/ffmpeg',STUDIO_ADMIN_PASSWORD:'',STUDIO_SECRET_KEY:'server-secret-LEAK'},stdio:['ignore','pipe','pipe']});
let slog=''; srv.stdout.on('data',d=>slog+=d); srv.stderr.on('data',d=>slog+=d);
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const unauth=await fetch(B+'/api/jobs',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({type:'opencode_task',input:{prompt:'hi'}})});
console.log('unauth create job: '+unauth.status);
const mk=async(type,input)=>{const r=await fetch(B+'/api/jobs',{method:'POST',headers:{...J,cookie},body:JSON.stringify({type,input})}); return {s:r.status,j:await r.json()}};
const j1=await mk('opencode_task',{prompt:'--version'}); console.log('create opencode_task: '+j1.s+' '+JSON.stringify(j1.j));
await new Promise(r=>setTimeout(r,1500));
const st=await (await fetch(B+'/api/jobs/'+j1.j.jobId,{headers:{cookie}})).json();
console.log('job status: '+st.status+' err='+st.error+' kind='+st.kind);
const logs2=fs.readdirSync('/tmp').filter(f=>f.startsWith('fake-opencode')).sort().slice(-3);
for(const f of logs2){const t=fs.readFileSync('/tmp/'+f,'utf8'); console.log('CHILD '+f+': ARGV='+t.split('\n').filter(l=>l.startsWith('[')).join(' ')+' | '+ (t.split('\n').find(l=>l.startsWith('ADMINPW'))||'') + ' ENVNAMES has STUDIO_SECRET_KEY='+t.includes('STUDIO_SECRET_KEY')+' STUDIO_ADMIN_PASSWORD='+t.includes('STUDIO_ADMIN_PASSWORD'));}
// path traversal jobId - can we force? ids are generated server-side
const jBad=await mk('opencode_task',{prompt:'x'}); // normal
// cancel
const j2=await mk('opencode_task',{prompt:'long'}); await new Promise(r=>setTimeout(r,100));
const can=await fetch(B+'/api/jobs/'+j2.j.jobId+'/cancel',{method:'POST',headers:{...J,cookie},body:'{}'});
console.log('cancel opencode_task: '+can.status+' '+(await can.text()).slice(0,200));
await new Promise(r=>setTimeout(r,500));
const st2=await (await fetch(B+'/api/jobs/'+j2.j.jobId,{headers:{cookie}})).json();
console.log('after cancel: '+st2.status);
// render_segment with outside audio via API
const j3=await mk('render_segment',{durationSec:0.4, audioPath:'/tmp/secret-audio.wav', script:'API'});
console.log('create render outside audio: '+j3.s+' '+JSON.stringify(j3.j));
await new Promise(r=>setTimeout(r,4000));
if(j3.j.jobId){const st3=await (await fetch(B+'/api/jobs/'+j3.j.jobId,{headers:{cookie}})).json(); console.log('render job: '+st3.status+' err='+st3.error+' arts='+JSON.stringify(st3.artifacts||st3.artifacts));}
// prod flavor check - code path
const CFG=require('/workspace/mk/lib/config.js')||{};
console.log('IS_TEST via env STUDIO_FLAVOR=prod would still load services with runners (no flavor gate in startTaskJob)');
// check server/jobs* writes
const {execSync}=await import('child_process');
try{console.log('server/ dir: '+execSync('ls -la /workspace/mk/server 2>&1 | head').toString())}catch(e){console.log('no server/ dir')}
try{console.log('find writes under server/: '+execSync('find /workspace/mk/server -type f 2>/dev/null | head').toString()||'(none)')}catch{console.log('no server/')}
// workDir for job
const media=path.join(UD,'media','opencode-tasks');
if(fs.existsSync(media)) console.log('opencode-tasks dirs: '+fs.readdirSync(media).join(','));
srv.kill();

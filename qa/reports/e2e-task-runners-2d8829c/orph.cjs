const TR=require('/workspace/n5audit-e2bb/lib/task-runners.js'),cp=require('child_process');
const find=()=>cp.execFileSync('ps',['-eo','pid=,args=']).toString().split('\n').filter(l=>l.trim().split(/\s+/)[1]==='orphmark').map(l=>+l.trim().split(/\s+/)[0]);
const p=cp.spawn('bash',['-c','(setsid bash -c "exec -a orphmark sleep 300" &) ; sleep 300'],{detached:true,stdio:'ignore'});
setTimeout(()=>{const d=TR.descendants(p.pid);console.log(JSON.stringify({desc:d,orphan:find()}));try{process.kill(-p.pid,'SIGKILL')}catch{};for(const x of d)try{process.kill(x,'SIGKILL')}catch{};
setTimeout(()=>{const o=find();console.log('alive after kill:',o);for(const x of o)process.kill(x,'SIGKILL');},300)},500);

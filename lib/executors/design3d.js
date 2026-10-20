// 3D DESIGN agent pipeline (Stage A + B). Director assigns the task → this executor runs it as a resumable job:
//   preflight → params → agent (OpenCode server) → validate → build (Blender) → render (Blender, reopens .blend) → verify
// Every stage is checkpointed in the jobs table; after an app restart the job continues from the stage that was running.
'use strict';
const fs = require('fs'), path = require('path');
const policy = require('../policy.js'), SP = require('../scene-params.js'), { createClient } = require('../opencode-client.js');
const STAGES = ['preflight', 'params', 'agent', 'validate', 'build', 'render', 'verify'];
const STAGE_LABEL = { preflight: 'Проверка Blender и OpenCode', params: 'Параметры сцены', agent: 'Агент OpenCode', validate: 'Проверка параметров', build: 'Сборка сцены (.blend)', render: 'Повторное открытие и рендер PNG', verify: 'Проверка результата' };
const sleep = (ms, signal) => new Promise((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('Отменено'), { cancelled: true })); }, { once: true }); });
const env = (k, d) => +process.env[k] || d;
module.exports = function createDesign3d(ctx) {
  const { jobs, ws, blender, get, put, log, sec, ollamaStatus, ollamaJson } = ctx;
  const confirmWaiters = new Map(); // jobId -> resolve(bool)
  const T0 = () => ({ agentIdle: env('STUDIO_3D_AGENT_TIMEOUT_MS', 10 * 60e3), build: env('STUDIO_BLENDER_TIMEOUT_MS', 5 * 60e3), render: env('STUDIO_BLENDER_RENDER_TIMEOUT_MS', 15 * 60e3) });
  let curCp = {}; const T = () => { const t = T0(), cap = curCp.timeoutSec ? curCp.timeoutSec * 1000 : Infinity; return { agentIdle: Math.min(t.agentIdle, cap), build: Math.min(t.build, cap), render: Math.min(t.render, cap) }; };
  const ev = (j, level, msg, rule) => jobs.event(j.id, level, j.stage, msg, rule);
  const integ = id => get('integrations', id) || {};

  async function waitConfirm(j, pending, signal) {
    jobs.update(j.id, { status: 'waiting_confirmation', pending }); ev(j, 'warn', 'Требуется подтверждение: ' + pending.reason, pending.rule);
    const ok = await new Promise((resolve, reject) => { confirmWaiters.set(j.id, resolve); signal.addEventListener('abort', () => reject(Object.assign(new Error('Отменено'), { cancelled: true })), { once: true }); });
    confirmWaiters.delete(j.id); jobs.update(j.id, { status: 'running', pending: null }); ev(j, ok ? 'info' : 'warn', ok ? 'Подтверждено человеком' : 'Отклонено человеком', pending.rule); return ok;
  }
  function confirm(jobId, ok) { const w = confirmWaiters.get(jobId); if (!w) return false; w(!!ok); return true; }

  const S = {
    async preflight(j, t, cp) {
      const b = await blender.detect(integ('blender').path, { force: true });
      if (!b.ok) throw Object.assign(new Error(b.error + (b.tried?.length ? ' Проверено: ' + b.tried.slice(0, 4).join('; ') : '')), { blocked: true });
      ev(j, 'info', `Blender ${b.version} (${b.platform}/${b.arch}), Python ${b.python}, движки: ${b.engines.join(', ')}, GLB: ${b.gltf ? 'да' : 'нет'}, FBX: ${b.fbx ? 'да' : 'нет'}`);
      const it = ocItem(); const c = client(); const h = await c.health(); ev(j, 'info', `OpenCode server ${c.base} — healthy, версия ${h.version}${c.authed ? ' (Basic Auth, пароль из Keychain)' : ' (без пароля)'}`); void it;
      cp.blender = { bin: b.bin, version: b.version };
      if (!cp.projectId) { cp.projectId = t.projectId3d && ws.exists(t.projectId3d) ? t.projectId3d : 'p_' + t.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }
      if (t.reworkOf && !cp.reworkOf) Object.assign(cp, { reworkOf: t.reworkOf, comment: t.comment || '', baseVersion: t.baseVersion || null });
      if (t.presetParams && !cp.presetParams) Object.assign(cp, { presetParams: t.presetParams, skipAgent: !!t.skipAgent, baseVersion: t.baseVersion || null });
      if (!cp.version) { const v = ws.newVersion(cp.projectId); cp.version = v.version; cp.vdir = v.dir; ev(j, 'info', `Рабочая папка: projects3d/${cp.projectId}/${v.version}` + (v.prev ? ` (резервная копия ${v.prev} → backup/)` : '')); }
    },
    async params(j, t, cp) {
      if (cp.presetParams) { const v = SP.validate(cp.presetParams); if (!v.ok) throw new Error('Параметры перерендера не прошли проверку: ' + v.errors.join('; ')); cp.params = v.params; cp.paramsBy = 'controls';
        ev(j, 'info', `Параметры из панели управления (версия-основа ${cp.baseVersion || '—'}): свет ${v.params.lighting}, камера ${v.params.camera.distance}/${v.params.camera.height}/${v.params.camera.focal}, кадров ${v.params.animation.frames}`); return; }
      if (cp.reworkOf && t.baseParams) {
        let p = null, by = 'rework:rules'; const st0 = await ollamaStatus().catch(() => ({ ok: false }));
        if (st0.ok) { try { const r = await ollamaJson(`Измени параметры 3D-сцены по комментарию. Верни ТОЛЬКО полный JSON по схеме:\n${SP.SCHEMA_TEXT}\nТекущие параметры: ${JSON.stringify(t.baseParams)}\nКомментарий: ${cp.comment}`, j.signal); const v = SP.validate(r.json); if (v.ok) { p = v.params; by = 'rework:llm:' + r.model; } else ev(j, 'warn', 'Ollama вернула неверные параметры доработки: ' + v.errors.join('; ')); } catch (e) { if (e.cancelled || j.signal?.aborted) throw e; ev(j, 'warn', 'Ollama: ' + e.message); } }
        else ev(j, 'warn', 'Ollama недоступна — доработка по правилам (без ИИ)');
        if (!p) { const a = SP.applyComment(t.baseParams, cp.comment); const v = SP.validate(a.params); if (!v.ok) throw new Error('Доработка дала неверные параметры: ' + v.errors.join('; ')); p = v.params; ev(j, 'info', 'Изменено по комментарию: ' + (a.changed.join(', ') || 'ничего не распознано — параметры прежние')); }
        cp.params = p; cp.paramsBy = by; ev(j, 'info', `Доработка версии ${cp.baseVersion} по комментарию «${cp.comment}» (${by})`); return; }
      const text = `${t.title}\n${t.description || ''}`.trim(); let p = null, by = 'rules';
      const st = await ollamaStatus().catch(() => ({ ok: false, error: 'нет ответа' }));
      if (st.ok) {
        let errs = [];
        for (let i = 0; i < 2 && !p; i++) {
          try { const r = await ollamaJson(`Ты подбираешь параметры 3D-сцены для шаблона Blender. Ответь ТОЛЬКО JSON по схеме:\n${SP.SCHEMA_TEXT}\n${errs.length ? 'Исправь ошибки: ' + errs.join('; ') + '\n' : ''}Задача: ${text}`, j.signal);
            const v = SP.validate(r.json); if (v.ok) { p = v.params; by = 'llm:' + r.model; } else { errs = v.errors; ev(j, 'warn', 'Ollama вернула неверные параметры: ' + errs.join('; ')); }
          } catch (e) { if (e.cancelled || j.signal?.aborted) throw e; ev(j, 'warn', 'Ollama: ' + e.message); break; }
        }
      } else ev(j, 'warn', 'Ollama недоступна (' + st.error + ') — параметры по правилам (без ИИ)');
      if (!p) { const v = SP.validate(SP.fromText(text)); if (!v.ok) throw new Error('Правила дали неверные параметры: ' + v.errors.join('; ')); p = v.params; by = by.startsWith('llm') ? by : 'rules'; }
      cp.params = p; cp.paramsBy = by; ev(j, 'info', `Параметры (${by}): объект ${p.subject}, свет ${p.lighting}, движок ${p.render.engine} ${p.render.width}×${p.render.height}, кадров анимации ${p.animation.frames}`);
    },
    async agent(j, t, cp, signal) {
      if (cp.skipAgent) { fs.writeFileSync(path.join(cp.vdir, 'scene_params.json'), JSON.stringify(cp.params, null, 1)); ev(j, 'info', 'Перерендер по шаблону: параметры записаны студией, агент OpenCode не нужен', 'blender.template'); return; }
      const c = client(); const vdir = cp.vdir; const target = path.join(vdir, 'scene_params.json');
      const cfg = await c.config(vdir); const issues = policy.checkOpencodeConfig(cfg);
      if (issues.length) throw Object.assign(new Error('Конфигурация OpenCode server не соответствует политике студии: ' + issues.join('; ') + '. См. docs/INSTALL_MAC.md → «OpenCode server».'), { blocked: true });
      ev(j, 'info', 'Политика OpenCode проверена: bash/webfetch/external_directory = deny, edit = ask', 'oc.config');
      const model = parseModel(ocItem().model);
      if (fs.existsSync(target) && cp.sessionID && SP.validate(safeJson(target)).ok) { ev(j, 'info', 'Файл параметров уже записан агентом (продолжение после перезапуска)'); return; }
      if (!cp.sessionID) { const s = await c.createSession(vdir, '3D DESIGN: ' + t.title); cp.sessionID = s.id; jobs.update(j.id, { checkpoint: cp }); ev(j, 'info', 'Сессия OpenCode ' + s.id + ' создана (папка проекта)'); }
      else ev(j, 'info', 'Продолжение сессии OpenCode ' + cp.sessionID);
      const sid = cp.sessionID;
      const prompt = `Ты агент 3D DESIGN студии MOONKATTY. Задача пользователя: ${t.title}\n${t.description || ''}\n\n` +
        `Запиши ровно один файл с параметрами сцены для проверенного шаблона Blender. Не запускай команды, не создавай и не меняй другие файлы.\n` +
        `Значения можно уточнить под задачу, строго соблюдая схему: ${SP.SCHEMA_TEXT}\n\nFILE: ${target}\nCONTENT:\n\`\`\`json\n${JSON.stringify(cp.params, null, 1)}\n\`\`\`\n`;
      const sseAc = new AbortController(); const seen = new Set();
      c.events(vdir, e => { const p = e.properties || {}; if ((p.sessionID || p.info?.sessionID || p.part?.sessionID) !== sid) return;
        if (e.type === 'message.part.updated' && p.part?.type === 'tool' && ['completed', 'error'].includes(p.part.state?.status) && !seen.has(p.part.id)) { seen.add(p.part.id); ev(j, p.part.state.status === 'error' ? 'warn' : 'info', `OpenCode инструмент ${p.part.tool}: ${p.part.state.status}${p.part.state.error ? ' — ' + String(p.part.state.error).slice(0, 200) : ''}`); }
        if (e.type === 'session.error') ev(j, 'error', 'OpenCode: ' + JSON.stringify(p.error || {}).slice(0, 300)); }, sseAc.signal).catch(() => {});
      await c.promptAsync(vdir, sid, prompt, model); ev(j, 'info', 'Задание отправлено агенту' + (model ? ` (модель ${model.providerID}/${model.modelID})` : ' (модель по умолчанию сервера)'));
      const t0 = Date.now(); let lastAct = Date.now(), denials = 0, sawBusy = false; const handled = new Set();
      try {
        for (;;) {
          if (signal.aborted) { await c.abort(vdir, sid).catch(() => {}); throw Object.assign(new Error('Отменено'), { cancelled: true }); }
          jobs.heartbeat(j.id);
          for (const pr of (await c.permissions(vdir)) || []) {
            if (pr.sessionID !== sid || handled.has(pr.id)) continue; handled.add(pr.id); lastAct = Date.now();
            const files = [pr.metadata?.filepath, pr.metadata?.filePath, pr.metadata?.path].filter(Boolean); if (!files.length && ['read', 'glob', 'grep', 'list'].includes(pr.permission)) files.push(vdir);
            let d = policy.decide({ type: 'opencode.permission', permission: pr.permission, files, ws: vdir });
            if (d.decision === 'confirm') d = (await waitConfirm(j, { rule: d.rule, reason: d.reason, permission: pr.permission, files: files.map(f => path.relative(vdir, f)) }, signal)) ? { ...d, decision: 'allow' } : { ...d, decision: 'deny' };
            await c.reply(vdir, pr.id, d.decision === 'allow' ? 'once' : 'reject', d.decision === 'allow' ? undefined : d.reason);
            ev(j, d.decision === 'allow' ? 'info' : 'warn', `Разрешение OpenCode «${pr.permission}» ${files.map(f => path.relative(vdir, f) || '.').join(', ')} → ${d.decision === 'allow' ? 'разрешено' : 'ОТКЛОНЕНО: ' + d.reason}`, d.rule);
            if (d.decision !== 'allow' && ++denials >= 3) { await c.abort(vdir, sid).catch(() => {}); throw new Error('Агент OpenCode трижды запросил запрещённые действия — задание остановлено'); }
          }
          const st = ((await c.status(vdir)) || {})[sid];
          if (st && st.type !== 'idle') { sawBusy = true; lastAct = Date.now(); }
          else if (sawBusy || Date.now() - t0 > 4000) {
            const msgs = (await c.messages(vdir, sid)) || []; const last = [...msgs].reverse().find(m => m.info?.role === 'assistant');
            if (last && (last.info.time?.completed || last.info.error || last.info.finish)) {
              if (last.info.error) throw new Error('OpenCode: ' + c.scrub(JSON.stringify(last.info.error.data?.message || last.info.error.name || last.info.error).slice(0, 400)));
              const tools = msgs.flatMap(m => m.parts || []).filter(p => p.type === 'tool').map(p => `${p.tool}:${p.state?.status}`);
              ev(j, 'info', `Агент завершил работу. Инструменты: ${tools.join(', ') || 'нет'}`); break;
            }
          }
          if (Date.now() - lastAct > T().agentIdle) { await c.abort(vdir, sid).catch(() => {}); throw Object.assign(new Error(`Агент OpenCode не отвечает ${Math.round(T().agentIdle / 1000)} с — превышено время ожидания`), { timeout: true }); }
          await sleep(700, signal);
        }
      } finally { sseAc.abort(); }
      // Real enforcement: whatever the server reports, check what actually changed on disk.
      const files = walk(vdir).map(f => path.relative(vdir, f)).filter(f => !/^(logs|renders|exports|backup)(\/|$)/.test(f));
      const extra = files.filter(f => f !== 'scene_params.json'); if (extra.length) ev(j, 'warn', 'Агент создал лишние файлы (игнорируются): ' + extra.join(', '), 'fs.unexpected');
      if (!fs.existsSync(target)) throw new Error('Агент OpenCode не записал scene_params.json');
    },
    async validate(j, t, cp) {
      const raw = safeJson(path.join(cp.vdir, 'scene_params.json')); if (raw === undefined) throw new Error('scene_params.json — не JSON');
      const v = SP.validate(raw); if (!v.ok) throw new Error('Параметры от агента не прошли проверку схемы: ' + v.errors.join('; '));
      const changed = JSON.stringify(v.params) !== JSON.stringify(cp.params); cp.params = v.params;
      fs.writeFileSync(path.join(cp.vdir, 'logs', 'params.validated.json'), JSON.stringify(v.params, null, 1));
      ev(j, 'info', 'Параметры прошли проверку схемы' + (changed ? ' (агент уточнил значения)' : ''), 'params.schema');
    },
    async build(j, t, cp, signal) {
      const d = policy.decide({ type: 'blender.template' }); ev(j, 'info', 'Запуск шаблона scene_basic (build), Blender headless -b --python-exit-code', d.rule);
      const r = await blender.runTemplate(cp.blender.bin, 'scene_basic', 'build', path.join(cp.vdir, 'logs', 'params.validated.json'), cp.vdir, { signal, timeoutMs: T().build, onSpawn: pid => jobs.update(j.id, { pid }) });
      jobs.update(j.id, { pid: null });
      ev(j, 'info', `Сцена сохранена: scene.blend (${kb(path.join(cp.vdir, 'scene.blend'))}); объекты: ${r.objects.join(', ')}; материалы: ${r.materials.join(', ')}`);
    },
    async render(j, t, cp, signal) {
      ev(j, 'info', 'Повторное открытие scene.blend и рендер (' + cp.params.render.engine + ')');
      const hb = setInterval(() => jobs.heartbeat(j.id), 5000);
      try { const r = await blender.runTemplate(cp.blender.bin, 'scene_basic', 'render', path.join(cp.vdir, 'logs', 'params.validated.json'), cp.vdir, { signal, timeoutMs: T().render, onSpawn: pid => jobs.update(j.id, { pid }) });
        cp.files = r.files; cp.engine = r.engine; ev(j, 'info', `Рендер готов (${r.engine}): ${r.files.length} файл(ов)`); }
      finally { clearInterval(hb); jobs.update(j.id, { pid: null }); }
    },
    async verify(j, t, cp) {
      const png = path.join(cp.vdir, 'renders', 'preview.png'); const b = fs.existsSync(png) ? fs.readFileSync(png) : null;
      if (!b || b.length < 100 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('preview.png отсутствует или повреждён');
      const w = b.readUInt32BE(16), h = b.readUInt32BE(20); if (w !== cp.params.render.width || h !== cp.params.render.height) throw new Error(`Размер PNG ${w}×${h} не совпадает с заданным`);
      const arts = ['scene.blend', ...(cp.files || [])].filter(f => fs.existsSync(path.join(cp.vdir, f))).map(f => artifact(cp.vdir, f));
      jobs.update(j.id, { artifacts: arts.map(a => ({ ...a, project: cp.projectId, version: cp.version })) });
      ws.manifest(cp.projectId, { title: cp.params.title, versions: { [cp.version]: { at: new Date().toISOString(), taskId: t.id, jobId: j.id, parent: cp.baseVersion || null, comment: cp.comment || null, review: { decision: 'pending' }, paramsBy: cp.paramsBy, blender: cp.blender.version, engine: cp.engine, files: arts } } });
      ev(j, 'info', `Проверено: PNG ${w}×${h}, файлов ${arts.length}. Результат ждёт утверждения.`);
    }
  };
  function ocItem() { const it = integ('opencode'); return { url: it.url || 'http://127.0.0.1:4096', username: it.username, model: it.model }; }
  function client() { const it = ocItem(); return createClient({ url: it.url, username: it.username, sec }); }

  // Entry point used by the runner for the design3d agent. Resumes an existing unfinished job of the task.
  async function run(a, t, signal) {
    let j = jobs.byTask(t.id);
    if (!j || ['done', 'failed', 'cancelled', 'waiting_approval'].includes(j.status) && !t.retryRequested) j = jobs.create(t.id, '3d', STAGES[0]);
    if (t.retryRequested) { const cur = get('tasks', t.id); delete cur.retryRequested; put('tasks', cur); }
    const cp = j.checkpoint; curCp = cp; jobs.update(j.id, { status: 'running', error: null, attempt: j.attempt + 1 });
    ev(j, 'info', j.attempt ? `Продолжение задания (запуск №${j.attempt + 1}) с этапа «${STAGE_LABEL[j.stage] || j.stage}»` : 'Director назначил задачу агенту 3D DESIGN: ' + t.title);
    let i = Math.max(0, STAGES.indexOf(j.stage)); let stageAttempts = 0;
    while (i < STAGES.length) {
      const stage = STAGES[i]; j = jobs.update(j.id, { stage, checkpoint: cp }); j.signal = signal; ev(j, 'info', '▶ ' + STAGE_LABEL[stage]);
      try { await S[stage](j, t, cp, signal); jobs.update(j.id, { checkpoint: cp }); i++; stageAttempts = 0; }
      catch (e) {
        if (e.cancelled || signal.aborted) { if (jobs.get(j.id).status !== 'cancelled') { jobs.update(j.id, { status: 'queued', pid: null }); ev(j, 'warn', 'Агент остановлен — задание вернётся в очередь и продолжится с этого этапа'); } throw Object.assign(new Error('Отменено'), { cancelled: true }); }
        const transient = e.timeout || /Blender \((build|render)\) завершился/.test(e.message) || ['timeout', 'network'].includes(e.code);
        if (!e.blocked && transient && ++stageAttempts < j.maxAttempts && j.retries < j.maxRetries) {
          jobs.update(j.id, { retries: j.retries + 1 }); ev(j, 'warn', `Ошибка: ${e.message} — повтор ${stageAttempts + 1}/${j.maxAttempts}`); if (stage === 'agent') delete cp.sessionID; continue; }
        jobs.update(j.id, { status: e.blocked ? 'blocked' : 'failed', error: e.message, checkpoint: cp, pid: null }); ev(j, 'error', (e.blocked ? 'Заблокировано: ' : 'Ошибка: ') + e.message); throw e;
      }
    }
    jobs.update(j.id, { status: 'waiting_approval', stage: 'verify' });
    const rel = `projects3d/${cp.projectId}/${cp.version}`;
    return { status: 'waiting_approval', result: `3D-сцена готова (${cp.paramsBy === 'rules' ? 'параметры по правилам, без ИИ' : 'параметры: ' + cp.paramsBy}; агент OpenCode записал scene_params.json): ${rel}/scene.blend, превью ${rel}/renders/preview.png. Blender ${cp.blender.version}, ${cp.engine}.`, jobId: j.id };
  }
  function cancelJob(jobId) { const j = jobs.get(jobId); if (!j) return null; if (['done', 'failed', 'cancelled'].includes(j.status)) return j;
    jobs.update(jobId, { status: 'cancelled', pending: null }); jobs.event(jobId, 'warn', j.stage, 'Задание отменено пользователем'); const w = confirmWaiters.get(jobId); if (w) confirmWaiters.delete(jobId); return jobs.get(jobId); }
  return { run, confirm, cancelJob, STAGES, STAGE_LABEL, artifact };
};
function parseModel(m) { const s = String(m || '').trim(); const i = s.indexOf('/'); return i > 0 ? { providerID: s.slice(0, i), modelID: s.slice(i + 1) } : undefined; }
const KIND = f => /\.blend$/.test(f) ? 'blend' : /anim\//.test(f) ? 'frame' : /\.png$/.test(f) ? 'png' : /\.glb$/.test(f) ? 'glb' : /\.fbx$/.test(f) ? 'fbx' : 'file';
function artifact(vdir, f) { const p = path.join(vdir, f); return { name: f, path: p, size: fs.statSync(p).size, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'), kind: KIND(f) }; }
function safeJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } }
function walk(d) { const out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function kb(f) { try { return Math.round(fs.statSync(f).size / 1024) + ' КБ'; } catch { return '?'; } }

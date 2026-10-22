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
  function confirm(jobId, ok) { require('../feature-gate.js').assert3dAllowed('executor:design3d.confirm'); const w = confirmWaiters.get(jobId); if (!w) return false; w(!!ok); return true; }

  const S = {
    async preflight(j, t, cp) {
      const b = await blender.detect(integ('blender').path, { force: true });
      if (!b.ok) throw Object.assign(new Error(b.error + (b.tried?.length ? ' Проверено: ' + b.tried.slice(0, 4).join('; ') : '')), { blocked: true });
      ev(j, 'info', `Blender ${b.version} (${b.platform}/${b.arch}), Python ${b.python}, движки: ${b.engines.join(', ')}, GLB: ${b.gltf ? 'да' : 'нет'}, FBX: ${b.fbx ? 'да' : 'нет'}`);
      cp.opencodeDown = null;
      try {
        const c = client(); const h = await c.health();
        ev(j, 'info', `OpenCode server ${c.base} — healthy, версия ${h.version}${c.authed ? ' (Basic Auth, пароль из Keychain)' : ' (без пароля)'}`);
      } catch (e) {
        if (e.cancelled || j.signal?.aborted) throw e;
        if (['refused', 'timeout', 'network'].includes(e.code)) { cp.opencodeDown = e.message; ev(j, 'warn', 'OpenCode недоступен: ' + e.message + '. Задание продолжится: студия запишет уже проверенные параметры сама.', 'oc.fallback'); }
        else throw e;
      }
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
    // v1.2.3-test.1: the OpenCode agent gets NO tools at this step (no write/edit/bash, server config edit=deny). It returns
    // the scene parameters as JSON TEXT; the studio validates them against the strict schema and writes scene_params.json
    // itself, only inside the job's version folder (realpath check, no symlinks). One bounded retry on malformed JSON.
    async agent(j, t, cp, signal) {
      const vdir = cp.vdir; const target = path.join(vdir, 'scene_params.json');
      const rel = (name) => `projects3d/${cp.projectId}/${cp.version}/${name}`;
      const useFallback = (why) => {
        const extra = walk(vdir).map(f => path.relative(vdir, f)).filter(f => !/^(logs|renders|exports|backup)(\/|$)/.test(f));
        if (extra.length) throw Object.assign(new Error('Агент OpenCode создал файлы, хотя запись запрещена: ' + extra.join(', ') + ' — задание остановлено'), { security: true });
        const v = SP.validate(cp.params); if (!v.ok) throw new Error('Запасные параметры не прошли проверку: ' + v.errors.join('; '));
        writeParamsSafe(vdir, v.params); cp.params = v.params; cp.agentDone = true;
        cp.paramsBy = String(cp.paramsBy || 'rules').replace(/\+(opencode|fallback)$/, '') + '+fallback';
        ev(j, 'warn', 'Агент OpenCode не записал scene_params.json (' + String(why).slice(0, 400) + '). Студия записала проверенные параметры сама (запасной путь): ' + rel('scene_params.json'), 'oc.fallback');
      };
      // refused is also marked blocked by the HTTP client; that must not cancel the fallback.
      const down = e => !!(e && !e.cancelled && !e.security && e.code !== 'unauthorized' && ['refused', 'timeout', 'network'].includes(e.code));
      if (cp.skipAgent) { writeParamsSafe(vdir, cp.params); ev(j, 'info', 'Перерендер по шаблону: параметры записаны студией, агент OpenCode не нужен', 'blender.template'); return; }
      if (cp.agentDone && fs.existsSync(target) && SP.validate(safeJson(target)).ok) { ev(j, 'info', 'Параметры от агента уже записаны студией (продолжение после перезапуска)'); return; }
      if (cp.opencodeDown) { useFallback(cp.opencodeDown); return; }
      const c = client();
      const cfg = await c.config(vdir); const issues = policy.checkOpencodeConfig(cfg);
      if (issues.length) throw Object.assign(new Error('Конфигурация OpenCode server не соответствует политике студии: ' + issues.join('; ') + '. См. docs/INSTALL_MAC.md → «OpenCode server».'), { blocked: true });
      ev(j, 'info', `Политика OpenCode проверена: bash/webfetch/external_directory = deny, edit = ${policy.permVal(cfg, 'edit')}; на этом шаге инструменты агенту не выдаются — ответ только текстом JSON`, 'oc.config');
      const model = parseModel(ocItem().model || require('../studio-config.js').opencodeModel);
      let s;
      try { s = await c.createSession(vdir, '3D DESIGN: ' + t.title); }
      catch (e) { if (down(e)) { useFallback(e.message); return; } throw e; }
      cp.sessionID = s.id; jobs.update(j.id, { checkpoint: cp }); ev(j, 'info', 'Сессия OpenCode ' + s.id + ' создана (папка проекта, без инструментов записи)' + (model ? ` · модель ${model.providerID}/${model.modelID}` : ''));
      const sid = s.id; const handled = new Set(); let violations = 0; let errs = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const prompt = attempt === 1
          ? `Ты агент 3D DESIGN студии MOONKATTY. Задача пользователя: ${t.title}\n${t.description || ''}\n\n` +
            `НЕ вызывай никакие инструменты, не создавай и не меняй файлы, не запускай команды. Верни ТОЛЬКО JSON-объект параметров сцены для проверенного шаблона Blender — без пояснений, без путей к файлам.\n` +
            `Значения можно уточнить под задачу, строго соблюдая схему: ${SP.SCHEMA_TEXT}\n\nТЕКУЩИЕ ПАРАМЕТРЫ:\nCONTENT:\n\`\`\`json\n${JSON.stringify(cp.params, null, 1)}\n\`\`\`\n`
          : `Твой ответ не прошёл проверку: ${errs.join('; ')}. Верни ТОЛЬКО исправленный JSON-объект по схеме: ${SP.SCHEMA_TEXT}\nБез пояснений и без инструментов.\nCONTENT:\n\`\`\`json\n${JSON.stringify(cp.params, null, 1)}\n\`\`\`\n`;
        const nBefore = ((await c.messages(vdir, sid).catch(() => [])) || []).length;
        try { await c.promptAsync(vdir, sid, prompt, model, NO_TOOLS); }
        catch (e) { if (down(e)) { useFallback(e.message); return; } throw e; }
        ev(j, 'info', (attempt === 1 ? 'Задание отправлено агенту' : 'Повторный запрос агенту (1 из 1) — исправить JSON') + (model ? ` (модель ${model.providerID}/${model.modelID})` : ' (модель по умолчанию сервера)'));
        const t0 = Date.now(); let lastAct = Date.now(), sawBusy = false, answer = null, modelError = null;
        for (;;) {
          if (signal.aborted) { await c.abort(vdir, sid).catch(() => {}); throw Object.assign(new Error('Отменено'), { cancelled: true }); }
          jobs.heartbeat(j.id);
          // Any permission ask at this step is unexpected (no tools are granted): always rejected, never auto-approved.
          let perms; try { perms = (await c.permissions(vdir)) || []; }
          catch (e) { if (down(e)) { useFallback(e.message); return; } throw e; }
          for (const pr of perms) {
            if (pr.sessionID !== sid || handled.has(pr.id)) continue; handled.add(pr.id); lastAct = Date.now();
            const files = [pr.metadata?.filepath, pr.metadata?.filePath, pr.metadata?.path, ...(Array.isArray(pr.patterns) ? pr.patterns : [])].filter(x => typeof x === 'string' && x);
            const d = policy.decide({ type: 'opencode.permission', permission: pr.permission, files, ws: vdir });
            const why = d.decision === 'allow' ? 'на этом шаге агенту не разрешены никакие инструменты (параметры записывает студия)' : d.reason;
            await c.reply(vdir, pr.id, 'reject', why);
            ev(j, 'warn', `Разрешение OpenCode «${pr.permission}» ${files.map(f => path.isAbsolute(f) ? f : f).join(', ') || '—'} → ОТКЛОНЕНО: ${why}`, d.decision === 'allow' ? 'oc.notools' : d.rule);
            if (++violations >= 3) { await c.abort(vdir, sid).catch(() => {}); throw Object.assign(new Error('Агент OpenCode трижды запросил запрещённые действия — задание остановлено'), { security: true }); }
          }
          let st; try { st = ((await c.status(vdir)) || {})[sid]; }
          catch (e) { if (down(e)) { useFallback(e.message); return; } throw e; }
          if (st && st.type !== 'idle') { sawBusy = true; lastAct = Date.now(); }
          else if (sawBusy || Date.now() - t0 > 4000) {
            const msgs = ((await c.messages(vdir, sid)) || []).slice(nBefore); const last = [...msgs].reverse().find(m => m.info?.role === 'assistant');
            if (last && (last.info.time?.completed || last.info.error || last.info.finish)) {
              if (last.info.error) { modelError = c.scrub(JSON.stringify(last.info.error.data?.message || last.info.error.name || last.info.error).slice(0, 400)); break; }
              const toolParts = msgs.flatMap(m => m.parts || []).filter(p => p.type === 'tool');
              if (toolParts.length) { const names = toolParts.map(p => `${p.tool}:${p.state?.status}`); ev(j, 'warn', 'Агент пытался вызвать инструменты (запрещено на этом шаге): ' + names.join(', '), 'oc.notools');
                if (toolParts.some(p => p.state?.status === 'completed' && !['read', 'glob', 'grep', 'list'].includes(p.tool))) throw Object.assign(new Error('Агент OpenCode выполнил запрещённый инструмент (' + names.join(', ') + ') — задание остановлено'), { security: true }); }
              answer = msgs.filter(m => m.info?.role === 'assistant').flatMap(m => m.parts || []).filter(p => p.type === 'text').map(p => p.text || '').join('\n'); break;
            }
          }
          if (Date.now() - lastAct > T().agentIdle) { await c.abort(vdir, sid).catch(() => {}); useFallback(`нет ответа за ${Math.round(T().agentIdle / 1000)} с (таймаут). Проверьте, что Ollama запущена и модель загружена`); return; }
          await sleep(700, signal);
        }
        const extra = walk(vdir).map(f => path.relative(vdir, f)).filter(f => !/^(logs|renders|exports|backup)(\/|$)/.test(f));
        if (extra.length) throw Object.assign(new Error('Агент OpenCode создал файлы, хотя запись запрещена: ' + extra.join(', ') + ' — задание остановлено'), { security: true });
        if (modelError) { useFallback('Ошибка модели в OpenCode: ' + modelError); return; }
        if (!answer || !answer.trim()) errs = ['пустой ответ — модель не вернула текст'];
        else { const parsed = SP.extractJson(answer); if (!parsed.ok) errs = [parsed.error];
          else { const v = SP.validate(parsed.value); if (v.ok) { writeParamsSafe(vdir, v.params); cp.agentDone = true; cp.params = v.params; cp.paramsBy = String(cp.paramsBy || 'rules').replace(/\+fallback$/, '') + '+opencode';
              ev(j, 'info', 'Агент вернул параметры JSON; проверены по строгой схеме и записаны студией в ' + rel('scene_params.json'), 'fs.write.ws'); return; }
            errs = v.errors; } }
        ev(j, 'warn', `Ответ агента не принят (попытка ${attempt}/2): ${errs.join('; ').slice(0, 400)}`, 'oc.json');
        if (attempt === 2) { useFallback('не вернул корректный JSON параметров сцены после повторной попытки: ' + errs.join('; ') + '. Возможная причина — маленький контекст Ollama (по умолчанию 4096): задайте OLLAMA_CONTEXT_LENGTH=32768 и перезапустите Ollama'); return; }
      }
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
      ev(j, 'info', `Сцена сохранена: projects3d/${cp.projectId}/${cp.version}/scene.blend (${kb(path.join(cp.vdir, 'scene.blend'))}); объекты: ${r.objects.join(', ')}; материалы: ${r.materials.join(', ')}`);
    },
    async render(j, t, cp, signal) {
      ev(j, 'info', 'Повторное открытие scene.blend и рендер (' + cp.params.render.engine + ')');
      const hb = setInterval(() => jobs.heartbeat(j.id), 5000);
      try { const r = await blender.runTemplate(cp.blender.bin, 'scene_basic', 'render', path.join(cp.vdir, 'logs', 'params.validated.json'), cp.vdir, { signal, timeoutMs: T().render, onSpawn: pid => jobs.update(j.id, { pid }) });
        cp.files = r.files; cp.engine = r.engine; ev(j, 'info', `Рендер готов (${r.engine}): projects3d/${cp.projectId}/${cp.version}/renders/preview.png (${r.files.length} файл(ов))`); }
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
  function ocItem() { const it = integ('opencode'); return { url: it.url || require('../studio-config.js').opencodeUrl, username: it.username, model: it.model }; }
  function client() { const it = ocItem(); return createClient({ url: it.url, username: it.username, sec }); }

  // Entry point used by the runner for the design3d agent. Resumes an existing unfinished job of the task.
  async function run(a, t, signal) {
    require('../feature-gate.js').assert3dAllowed('executor:design3d.run'); // shared 3D gate — executor entry fails closed
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
    return { status: 'waiting_approval', result: `3D-сцена готова (${cp.paramsBy === 'rules' ? 'параметры по правилам, без ИИ' : 'параметры: ' + cp.paramsBy}; параметры проверены и записаны студией в scene_params.json): ${rel}/scene.blend, превью ${rel}/renders/preview.png. Blender ${cp.blender.version}, ${cp.engine}.`, jobId: j.id };
  }
  function cancelJob(jobId) { const j = jobs.get(jobId); if (!j) return null; if (['done', 'failed', 'cancelled'].includes(j.status)) return j;
    jobs.update(jobId, { status: 'cancelled', pending: null }); jobs.event(jobId, 'warn', j.stage, 'Задание отменено пользователем'); const w = confirmWaiters.get(jobId); if (w) confirmWaiters.delete(jobId); return jobs.get(jobId); }
  return { run, confirm, cancelJob, STAGES, STAGE_LABEL, artifact };
};
function parseModel(m) { const s = String(m || '').trim(); const i = s.indexOf('/'); return i > 0 ? { providerID: s.slice(0, i), modelID: s.slice(i + 1) } : undefined; }
const KIND = f => /\.blend$/.test(f) ? 'blend' : /anim\//.test(f) ? 'frame' : /\.png$/.test(f) ? 'png' : /\.glb$/.test(f) ? 'glb' : /\.fbx$/.test(f) ? 'fbx' : 'file';
function artifact(vdir, f) { const p = path.join(vdir, f); return { name: f, path: p, size: fs.statSync(p).size, sha256: require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'), kind: KIND(f) }; }
const NO_TOOLS = { write: false, edit: false, patch: false, multiedit: false, bash: false, webfetch: false, websearch: false, task: false, todowrite: false, skill: false };
// Writes scene_params.json ONLY inside the version folder: realpath containment, folder itself must not be a symlink,
// target must not be a symlink (O_NOFOLLOW), written via an exclusive temp file + rename.
function writeParamsSafe(vdir, params) {
  const v = SP.validate(params); if (!v.ok) throw new Error('Параметры не прошли строгую проверку: ' + v.errors.join('; '));
  try { fs.accessSync(vdir, fs.constants.W_OK); } catch { throw new Error('Нет права записи в рабочую папку проекта. Папка версии должна принадлежать владельцу (права 0700).'); }
  if (fs.lstatSync(vdir).isSymbolicLink()) throw new Error('Рабочая папка проекта — символическая ссылка; запись запрещена');
  const target = path.join(vdir, 'scene_params.json');
  if (!policy.inside(vdir, target)) throw new Error('Путь scene_params.json вне рабочей папки проекта — запись запрещена');
  try { if (fs.lstatSync(target).isSymbolicLink()) throw new Error('scene_params.json — символическая ссылка; запись запрещена'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const tmp = path.join(vdir, '.scene_params.' + process.pid + '.' + Date.now() + '.tmp');
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { fs.writeSync(fd, JSON.stringify(v.params, null, 1)); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, target);
  if (!policy.inside(vdir, target)) { fs.rmSync(target, { force: true }); throw new Error('scene_params.json оказался вне рабочей папки — удалён'); }
}
function safeJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } }
function walk(d) { const out = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function kb(f) { try { return Math.round(fs.statSync(f).size / 1024) + ' КБ'; } catch { return '?'; } }
module.exports.writeParamsSafe = writeParamsSafe;

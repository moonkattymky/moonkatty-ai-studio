// AI CEO. Plans work for the existing agents. Does not publish, spend, or rebuild Studio 2.
'use strict';
function dayKey(now) { return now.toISOString().slice(0, 10); }
function build({ goal, now, tasks }) {
  const day = dayKey(now);
  const open = (tasks || []).filter(t => t.source === 'ceo' && t.worldDay === day && !['done', 'cancelled'].includes(t.status));
  if (open.length) return { already: true, day, tasks: [], open: open.map(t => t.id) };
  const due = day + 'T23:59:59.000Z';
  const made = [];
  const add = (agentId, title, description, extra) => made.push(Object.assign({ agentId, title, description, priority: 'normal', status: 'queued', schedule: { type: 'none' }, source: 'ceo', worldDay: day, dueAt: due, kind: 'world', project: 'main' }, extra));
  add('revenue', 'Сводка выручки ' + day, 'Внутренний отчёт. Только подтверждённые выплаты. Оценки и начисления отдельно. Просмотры не считать.');
  add('growth', 'Сводка роста игры ' + day, 'Импорт или read-only. Пустые метрики оставлять как НЕТ ДАННЫХ.');
  add('marketing', 'Площадки ' + day + ' только чтение', 'Platform Read API. Не публиковать, не тратить, не подтверждать.');
  const summary = `План ${day}. Задачи у существующих агентов. NEWS не смешивается с основным каналом. Публикация и соцсети этим планом не вызываются.`;
  return { already: false, day, tasks: made, summary, goal: String(goal || '').slice(0, 2000) };
}
function review(tasks, now) {
  const t = now.getTime();
  const unfinished = (tasks || []).filter(x => x.source === 'ceo' && !['done', 'cancelled'].includes(x.status));
  const overdue = unfinished.filter(x => x.dueAt && new Date(x.dueAt).getTime() < t);
  const waiting = (tasks || []).filter(x => x.status === 'waiting_approval');
  return { unfinished: unfinished.length, overdue: overdue.map(x => ({ id: x.id, title: x.title, dueAt: x.dueAt })), waitingApproval: waiting.length, note: 'CEO не утверждает публикацию и не ставит статус published.' };
}
module.exports = { build, review, dayKey };

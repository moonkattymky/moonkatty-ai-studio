// Shared list of the 12 reference screens (order = reference contact sheet, 6×2).
export const SCREENS = [
  { n: 1, slug: 'glavnaya', hash: '#/home', title: 'Главная' },
  { n: 2, slug: 'ai-agenty', hash: '#/agents', title: 'AI-агенты' },
  { n: 3, slug: 'zadachi', hash: '#/tasks', title: 'Задачи' },
  { n: 4, slug: 'kontent', hash: '#/content', title: 'Контент' },
  { n: 5, slug: 'analitika', hash: '#/analytics', title: 'Аналитика' },
  { n: 6, slug: 'finansy', hash: '#/finance', title: 'Финансы' },
  { n: 7, slug: 'igry', hash: '#/games', title: 'Игры' },
  { n: 8, slug: 'novosti', hash: '#/news', title: 'MOONKATTY NEWS' },
  { n: 9, slug: 'sotsseti', hash: '#/social', title: 'Соцсети' },
  { n: 10, slug: 'uvedomleniya', hash: '#/notifications', title: 'Уведомления' },
  { n: 11, slug: 'nastroyki', hash: '#/settings', title: 'Настройки' },
  { n: 12, slug: 'eshche', hash: '#/more', title: 'Ещё' },
];
export const SUBS = [
  '#/agents/ceo', '#/agents/new', '#/tasks/t1', '#/tasks/new', '#/content/c1', '#/analytics/widget', '#/finance/yt', '#/finance/new',
  '#/games/manage', '#/games/players', '#/games/monetization', '#/news/e127', '#/news/e128', '#/social/youtube', '#/social/post/sp1',
  '#/notifications/n1', '#/settings/profile', '#/settings/devices', '#/settings/notif', '#/settings/integr', '#/settings/mac',
  '#/settings/look', '#/settings/help', '#/settings/about', '#/more/ideas', '#/more/docs', '#/more/team', '#/more/exp', '#/more/backup', '#/home/request',
];
export const BASE = process.env.AIC_URL || 'http://127.0.0.1:8690/';

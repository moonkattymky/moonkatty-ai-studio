/**
 * MOONKATTY AI CONTROL — DEMO DATA (Stage 1).
 *
 * EVERYTHING in this file is fictional demo data. Nothing here comes from a
 * real account or API. Stage 2 replaces this module with a read-only API
 * client that returns the same shapes (see README.md → «Этап 2»).
 *
 * Bilingual strings are objects { ru, en }; plain strings are language-neutral
 * (brand names, numbers).
 */

export const DEMO = true;
export const DATA_VERSION = 'demo-2026-10-21';

export const studio = {
  host: 'Mac mini',
  online: true,
  agentsTotal: 12,
  agentsActive: 8,
  tasksTotal: 24,
  tasksReview: 4,
  channels: 7,
  channelsGrowth: '+12%',
  revenueMonth: 3450,
  revenueGrowth: '+18%',
  currency: 'USD',
};

const ag = (id, name, role, status, activity, img, extra = {}) =>
  ({ id, name, role, status, activity, img, ...extra });

/* status: work | wait | off */
export const agents = [
  ag('ceo', 'AI CEO', { ru: 'Стратегия и развитие', en: 'Strategy & growth' }, 'work',
    { ru: 'Анализирует результаты', en: 'Analysing results' }, 'img/agent-ceo.webp',
    { crown: true, widget: 'spark', color: 'blue', icon: 'pulse', load: 72, done: 41,
      about: { ru: 'Главный агент: ставит цели, распределяет задачи и проверяет итоги недели.', en: 'Lead agent: sets goals, assigns tasks and reviews weekly results.' } }),
  ag('news', 'News Director', { ru: 'Новости и сценарии', en: 'News & scripts' }, 'work',
    { ru: 'Готовит следующий выпуск', en: 'Preparing the next episode' }, 'img/agent-news.webp',
    { widget: 'progress', progress: 68, color: 'cyan', icon: 'doc', load: 68, done: 27,
      about: { ru: 'Собирает темы, пишет сценарии и ведёт MOONKATTY NEWS.', en: 'Collects topics, writes scripts and runs MOONKATTY NEWS.' } }),
  ag('video', 'Video Producer', { ru: 'Создание и монтаж видео', en: 'Video creation & editing' }, 'work',
    { ru: 'Рендерит видео', en: 'Rendering video' }, 'img/agent-video.webp',
    { widget: 'progress', progress: 75, color: 'violet', icon: 'film', load: 81, done: 19,
      about: { ru: 'Монтирует ролики, делает превью и субтитры.', en: 'Edits clips, makes thumbnails and subtitles.' } }),
  ag('smm', 'Social Media Manager', { ru: 'Публикации и продвижение', en: 'Posting & promotion' }, 'work',
    { ru: 'Планирует контент', en: 'Planning content' }, 'img/agent-smm.webp',
    { widget: 'spark', color: 'gold', icon: 'send', load: 55, done: 63,
      about: { ru: 'Ведёт календарь публикаций во всех соцсетях.', en: 'Runs the posting calendar across all social networks.' } }),
  ag('games', 'Games Director', { ru: 'Игры и монетизация', en: 'Games & monetisation' }, 'work',
    { ru: 'Анализирует игроков', en: 'Analysing players' }, 'img/agent-games.webp',
    { widget: 'spark', color: 'green', icon: 'gamepad', load: 47, done: 22,
      about: { ru: 'Следит за MOONKATTY Game и New Horizons: события, награды, баланс.', en: 'Looks after MOONKATTY Game and New Horizons: events, rewards, balance.' } }),
  ag('revenue', 'Revenue Director', { ru: 'Финансы и аналитика', en: 'Finance & analytics' }, 'work',
    { ru: 'Проверяет доходы', en: 'Checking revenue' }, 'img/agent-revenue.webp',
    { widget: 'spark', color: 'blue', icon: 'coin', load: 38, done: 17,
      about: { ru: 'Сводит доходы по площадкам и ищет точки роста.', en: 'Consolidates revenue per platform and looks for growth.' } }),
  ag('trend', 'Trend Analyst', { ru: 'Анализ трендов', en: 'Trend analysis' }, 'work',
    { ru: 'Ищет новые темы', en: 'Looking for new topics' }, 'img/agent-trend.webp',
    { widget: 'spark', color: 'pink', icon: 'search', load: 61, done: 35,
      about: { ru: 'Мониторит тренды и предлагает темы для контента.', en: 'Monitors trends and suggests content topics.' } }),
  ag('research', 'Research Agent', { ru: 'Исследования и факты', en: 'Research & facts' }, 'work',
    { ru: 'Собирает информацию', en: 'Gathering information' }, 'img/agent-research.webp',
    { widget: 'spark', color: 'cyan', icon: 'db', load: 44, done: 51,
      about: { ru: 'Проверяет факты и готовит справки для сценариев.', en: 'Fact-checks and prepares briefs for scripts.' } }),
  ag('community', 'Community Manager', { ru: 'Комментарии и сообщество', en: 'Comments & community' }, 'wait',
    { ru: 'Ждёт новых комментариев', en: 'Waiting for comments' }, 'img/av-social.jpg',
    { widget: 'spark', color: 'violet', icon: 'chat', load: 12, done: 88,
      about: { ru: 'Отвечает на комментарии и модерирует сообщество.', en: 'Replies to comments and moderates the community.' } }),
  ag('brand', 'Brand Designer', { ru: 'Обложки и стиль', en: 'Covers & style' }, 'wait',
    { ru: 'Ожидает бриф', en: 'Waiting for a brief' }, 'img/av-brand.jpg',
    { widget: 'spark', color: 'gold', icon: 'brush', load: 8, done: 14,
      about: { ru: 'Делает обложки, баннеры и следит за фирменным стилем.', en: 'Makes covers and banners and keeps the brand consistent.' } }),
  ag('qa', 'QA Tester', { ru: 'Тестирование игр', en: 'Game testing' }, 'wait',
    { ru: 'Ожидает сборку', en: 'Waiting for a build' }, 'img/av-games.jpg',
    { widget: 'spark', color: 'green', icon: 'check', load: 5, done: 9,
      about: { ru: 'Проверяет игровые сборки перед публикацией.', en: 'Tests game builds before release.' } }),
  ag('translator', 'Translator', { ru: 'Переводы и локализация', en: 'Translation & localisation' }, 'off',
    { ru: 'Офлайн', en: 'Offline' }, 'img/av-news.jpg',
    { widget: 'spark', color: 'gray', icon: 'globe', load: 0, done: 31,
      about: { ru: 'Переводит контент на другие языки.', en: 'Translates content into other languages.' } }),
];

/* task status: review | work | ready | test | done ; tag colours map to CSS */
const tk = (id, tag, title, sub, status, when, img, action = 'play', agent = 'ceo') =>
  ({ id, tag, title, sub, status, when, img, action, agent });
const T = {
  video: { ru: 'Видео', en: 'Video', c: 'violet' },
  youtube: { ru: 'Youtube', en: 'YouTube', c: 'red' },
  social: { ru: 'Соцсети', en: 'Social', c: 'violet' },
  game: { ru: 'Игра', en: 'Game', c: 'teal' },
  analytics: { ru: 'Аналитика', en: 'Analytics', c: 'violet' },
  finance: { ru: 'Финансы', en: 'Finance', c: 'gold' },
};
export const taskTags = T;
const ago = (n, u) => ({ n, u }); // u: m | h | d
export const tasks = [
  tk('t1', 'video', { ru: 'Рекламный ролик', en: 'Promo clip' }, 'MOONKATTY Horizons', 'review', ago(12, 'm'), 'img/task-1.webp', 'play', 'video'),
  tk('t2', 'youtube', 'MOONKATTY NEWS', { ru: 'Вечерний выпуск', en: 'Evening episode' }, 'ready', null, 'img/task-2.webp', 'publish', 'news'),
  tk('t3', 'social', { ru: 'Серия постов', en: 'Post series' }, 'TikTok + Instagram', 'work', ago(2, 'h'), 'img/task-3.webp', 'publish', 'smm'),
  tk('t4', 'game', { ru: 'Обновление уровня', en: 'Level update' }, 'Horizons — Chapter 4', 'test', null, 'img/task-4.webp', 'play', 'games'),
  tk('t5', 'analytics', { ru: 'Отчёт по каналам', en: 'Channel report' }, { ru: 'Еженедельная аналитика', en: 'Weekly analytics' }, 'done', ago(3, 'h'), 'img/task-5.webp', 'play', 'trend'),
  tk('t6', 'finance', { ru: 'Проверка доходов', en: 'Revenue check' }, 'AdSense, Ads, In-game', 'work', ago(4, 'h'), 'img/task-6.webp', 'play', 'revenue'),
  tk('t7', 'video', { ru: 'Тизер Chapter 5', en: 'Chapter 5 teaser' }, 'MOONKATTY Horizons', 'review', ago(35, 'm'), 'img/task-1.webp', 'play', 'video'),
  tk('t8', 'youtube', { ru: 'Утренний выпуск', en: 'Morning episode' }, '#128', 'work', ago(1, 'h'), 'img/task-2.webp', 'publish', 'news'),
  tk('t9', 'social', { ru: 'Сторис: закулисье', en: 'Stories: behind the scenes' }, 'Instagram', 'review', ago(50, 'm'), 'img/task-3.webp', 'publish', 'smm'),
  tk('t10', 'game', { ru: 'Баланс наград', en: 'Reward balance' }, 'MOONKATTY Game', 'work', ago(5, 'h'), 'img/task-4.webp', 'play', 'games'),
  tk('t11', 'analytics', { ru: 'Удержание игроков', en: 'Player retention' }, 'New Horizons', 'work', ago(6, 'h'), 'img/task-5.webp', 'play', 'trend'),
  tk('t12', 'finance', { ru: 'Сводка за октябрь', en: 'October summary' }, { ru: 'Все источники', en: 'All sources' }, 'work', ago(7, 'h'), 'img/task-6.webp', 'play', 'revenue'),
  tk('t13', 'video', { ru: 'Шортс: 9 жизней', en: 'Short: 9 lives' }, 'YouTube Shorts', 'work', ago(8, 'h'), 'img/task-1.webp', 'play', 'video'),
  tk('t14', 'social', { ru: 'Анонс игры', en: 'Game announcement' }, 'Facebook', 'review', ago(1, 'h'), 'img/task-3.webp', 'publish', 'smm'),
  tk('t15', 'youtube', { ru: 'Крипто новости', en: 'Crypto news' }, '#129', 'work', ago(9, 'h'), 'img/task-2.webp', 'publish', 'news'),
  tk('t16', 'game', { ru: 'Ивент «Лунная ночь»', en: '“Moon Night” event' }, 'MOONKATTY Game', 'work', ago(10, 'h'), 'img/task-4.webp', 'play', 'games'),
  tk('t17', 'analytics', { ru: 'A/B тест обложек', en: 'Cover A/B test' }, 'YouTube', 'done', ago(1, 'd'), 'img/task-5.webp', 'play', 'trend'),
  tk('t18', 'research', { ru: 'Факты для выпуска', en: 'Facts for the episode' }, '#130', 'work', ago(11, 'h'), 'img/agent-research.webp', 'play', 'research'),
  tk('t19', 'social', { ru: 'Ответы на комментарии', en: 'Reply to comments' }, 'TikTok', 'done', ago(1, 'd'), 'img/task-3.webp', 'publish', 'community'),
  tk('t20', 'video', { ru: 'Субтитры EN', en: 'EN subtitles' }, { ru: 'Вечерний выпуск', en: 'Evening episode' }, 'work', ago(12, 'h'), 'img/task-1.webp', 'play', 'translator'),
  tk('t21', 'finance', { ru: 'Telegram Ads отчёт', en: 'Telegram Ads report' }, 'Telegram', 'done', ago(2, 'd'), 'img/task-6.webp', 'play', 'revenue'),
  tk('t22', 'game', { ru: 'Сборка 1.3 — тесты', en: 'Build 1.3 — tests' }, 'New Horizons', 'work', ago(13, 'h'), 'img/task-4.webp', 'play', 'qa'),
  tk('t23', 'analytics', { ru: 'Рост аудитории', en: 'Audience growth' }, { ru: 'Все каналы', en: 'All channels' }, 'done', ago(2, 'd'), 'img/task-5.webp', 'play', 'ceo'),
  tk('t24', 'social', { ru: 'Обложки для Reels', en: 'Reels covers' }, 'Instagram', 'done', ago(3, 'd'), 'img/task-3.webp', 'publish', 'brand'),
];
T.research = { ru: 'Факты', en: 'Facts', c: 'teal' };

/* content: kind video|post|draft ; state review|published|draft */
export const content = [
  { id: 'c1', kind: 'video', state: 'review', img: 'img/content-1.webp', title: 'MOONKATTY NEW HORIZONS', dur: '01:12', platform: 'YouTube', agent: 'video' },
  { id: 'c2', kind: 'video', state: 'review', img: 'img/content-2.webp', title: 'MOONKATTY NEWS DAILY UPDATE', dur: '12:36', platform: 'YouTube', agent: 'news' },
  { id: 'c3', kind: 'video', state: 'review', img: 'img/content-3.webp', title: 'SOON BIG UPDATE', dur: '00:45', platform: 'TikTok', agent: 'video' },
  { id: 'c4', kind: 'video', state: 'review', img: 'img/content-4.webp', title: '9 LIVES ONE MOON', dur: '01:08', platform: 'Instagram', agent: 'video' },
  { id: 'c5', kind: 'video', state: 'published', img: 'img/cover-news-fb.jpg', title: 'MOONKATTY NEWS #126', dur: '11:02', platform: 'Facebook', agent: 'news' },
  { id: 'c6', kind: 'video', state: 'published', img: 'img/preview.jpg', title: 'MOONKATTY — Studio', dur: '00:30', platform: 'YouTube', agent: 'video' },
  { id: 'c7', kind: 'post', state: 'published', img: 'img/cover-mk-ig.jpg', title: 'PLAY · EARN · EXPLORE', platform: 'Instagram', agent: 'smm' },
  { id: 'c8', kind: 'post', state: 'published', img: 'img/cover-mk-fb.jpg', title: 'GAMES · CRYPTO · COMMUNITY', platform: 'Facebook', agent: 'smm' },
  { id: 'c9', kind: 'post', state: 'published', img: 'img/cover-news-ig.jpg', title: 'MOONKATTY NEWS', platform: 'Instagram', agent: 'smm' },
  { id: 'c10', kind: 'post', state: 'draft', img: 'img/game-banner.webp', title: 'NEW HORIZONS — Chapter 5', platform: 'X', agent: 'smm' },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 'p' + (i + 1), kind: 'post', state: i < 6 ? 'published' : 'draft',
    img: ['img/cover-mk-ig.jpg', 'img/cover-mk-fb.jpg', 'img/cover-news-ig.jpg'][i % 3],
    title: 'MOONKATTY POST #' + (101 + i), platform: ['Instagram', 'Facebook', 'TikTok'][i % 3], agent: 'smm',
  })),
  { id: 'd1', kind: 'draft', state: 'draft', img: 'img/hero.webp', title: 'MOONKATTY — 9 LIVES', platform: 'YouTube', agent: 'video' },
];

export const analytics = {
  periods: ['7', '30', '90', 'year'],
  byPeriod: {
    '7':    { views: '1.1M', viewsG: '+9%',  subs: '31K',  subsG: '+6%',  rev: 820,   revG: '+7%',  players: '12.1K', playersG: '+11%', growth: '+6%' },
    '30':   { views: '4.8M', viewsG: '+27%', subs: '129K', subsG: '+19%', rev: 3450,  revG: '+18%', players: '42.7K', playersG: '+32%', growth: '+19%' },
    '90':   { views: '12.9M', viewsG: '+41%', subs: '318K', subsG: '+33%', rev: 9120, revG: '+29%', players: '96.4K', playersG: '+57%', growth: '+38%' },
    'year': { views: '41.2M', viewsG: '+120%', subs: '1.1M', subsG: '+96%', rev: 31800, revG: '+84%', players: '288K', playersG: '+140%', growth: '+96%' },
  },
  platforms: [
    { id: 'youtube', name: 'YouTube', v: '1.2M', color: '#ef4444', series: [20, 34, 30, 52, 44, 60, 55, 72, 66, 88] },
    { id: 'tiktok', name: 'TikTok', v: '980K', color: '#f4f4f5', series: [12, 18, 26, 22, 34, 30, 41, 38, 46, 50] },
    { id: 'instagram', name: 'Instagram', v: '620K', color: '#d946ef', series: [8, 16, 22, 30, 26, 36, 33, 40, 44, 42] },
    { id: 'facebook', name: 'Facebook', v: '410K', color: '#38bdf8', series: [6, 10, 14, 12, 20, 18, 22, 26, 24, 28] },
    { id: 'telegram', name: 'Telegram', v: '320K', color: '#2dd4bf', series: [4, 8, 10, 14, 12, 18, 16, 20, 22, 26] },
    { id: 'x', name: 'X (Twitter)', v: '280K', color: '#facc15', series: [3, 6, 8, 7, 11, 10, 13, 12, 15, 14] },
  ],
  audience: [4, 6, 5, 9, 12, 10, 14, 13, 18, 16, 22, 20, 27, 31],
};

export const finance = {
  byPeriod: {
    '7':    { total: 820,   growth: '+7%',  bars: [3, 4, 3, 5, 4, 6, 5] },
    '30':   { total: 3450,  growth: '+18%', bars: [2, 3, 2, 2, 4, 6, 4, 7, 8, 7, 10, 11] },
    '90':   { total: 9120,  growth: '+29%', bars: [3, 4, 5, 4, 6, 7, 6, 8, 9, 10, 11, 12] },
    'year': { total: 31800, growth: '+84%', bars: [2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 11, 12] },
  },
  sources: [
    { id: 'yt', name: 'YouTube Ads', icon: 'youtube', amount: 1280, growth: '+22%', share: 62 },
    { id: 'tt', name: 'TikTok Creator Fund', icon: 'tiktok', amount: 640, growth: '+15%', share: 48 },
    { id: 'tg', name: 'Telegram Ads', icon: 'telegram', amount: 420, growth: '+18%', share: 40 },
    { id: 'ig', name: 'In-game Purchases', icon: 'gamepad', amount: 780, growth: '+35%', share: 72 },
    { id: 'xm', name: 'X Monetization', icon: 'x', amount: 330, growth: '+12%', share: 36 },
  ],
  currencies: ['USD', 'EUR', 'ILS'],
  rates: { USD: 1, EUR: 0.92, ILS: 3.7 },
};

export const games = {
  mk: {
    id: 'mk', name: 'MOONKATTY Game', img: 'img/preview.jpg',
    stats: { active: '8.9K', activeG: '+14%', fresh: '1.7K', freshG: '+21%', time: 22, timeG: '+9%' },
  },
  nh: {
    id: 'nh', name: 'New Horizons', img: 'img/game-banner.webp',
    stats: { active: '12.4K', activeG: '+28%', fresh: '3.1K', freshG: '+45%', time: 28, timeG: '+36%' },
  },
  sections: [
    { id: 'manage', icon: 'game-manage', color: 'violet', title: { ru: 'Управление игрой', en: 'Game management' }, sub: { ru: 'События, награды, обновления', en: 'Events, rewards, updates' } },
    { id: 'players', icon: 'bars', color: 'teal', title: { ru: 'Статистика игроков', en: 'Player stats' }, sub: { ru: 'Онлайн, регионы, удержание', en: 'Online, regions, retention' } },
    { id: 'monetization', icon: 'coin-v', color: 'gold', title: { ru: 'Монетизация', en: 'Monetisation' }, sub: { ru: 'Магазин, покупки, реклама', en: 'Store, purchases, ads' } },
  ],
  events: [
    { ru: 'Ивент «Лунная ночь» — 24 окт', en: '“Moon Night” event — Oct 24' },
    { ru: 'Награды за 7 дней входа', en: '7-day login rewards' },
    { ru: 'Обновление 1.3 — Chapter 5', en: 'Update 1.3 — Chapter 5' },
  ],
  regions: [
    { name: { ru: 'Европа', en: 'Europe' }, share: 38 },
    { name: { ru: 'СНГ', en: 'CIS' }, share: 27 },
    { name: { ru: 'Азия', en: 'Asia' }, share: 19 },
    { name: { ru: 'Америка', en: 'Americas' }, share: 16 },
  ],
  store: [
    { name: { ru: 'Набор «Космо-кот»', en: '“Cosmo Cat” bundle' }, sold: 412, price: 4.99 },
    { name: { ru: 'Лунные кристаллы ×500', en: 'Moon crystals ×500' }, sold: 1290, price: 1.99 },
    { name: { ru: 'Без рекламы', en: 'No ads' }, sold: 233, price: 2.99 },
  ],
};

export const news = {
  current: {
    id: 'e127', no: 127, title: { ru: 'Вечерний выпуск', en: 'Evening episode' }, dur: 12, state: 'ready',
    img: 'img/news-hero.webp',
    script: { ru: 'Главные новости дня от MOONKATTY NEWS: обновление New Horizons, рост аудитории YouTube на 18% и анонс ивента «Лунная ночь».',
              en: 'Top stories from MOONKATTY NEWS: the New Horizons update, YouTube audience up 18% and the “Moon Night” event announcement.' },
  },
  next: [
    { id: 'e128', no: 128, title: { ru: 'Утренний выпуск', en: 'Morning episode' }, when: { ru: 'Завтра 09:00', en: 'Tomorrow 09:00' }, state: 'work', img: 'img/ep-1.webp' },
    { id: 'e129', no: 129, title: { ru: 'Крипто новости', en: 'Crypto news' }, when: { ru: '21 окт 18:00', en: 'Oct 21 18:00' }, state: 'plan', img: 'img/ep-2.webp' },
    { id: 'e130', no: 130, title: { ru: 'Технологии AI', en: 'AI technology' }, when: { ru: '22 окт 10:00', en: 'Oct 22 10:00' }, state: 'draft', img: 'img/ep-3.webp' },
  ],
  scripts: [
    { id: 's1', title: { ru: 'Сценарий #128 — утро', en: 'Script #128 — morning' }, words: 840 },
    { id: 's2', title: { ru: 'Сценарий #129 — крипто', en: 'Script #129 — crypto' }, words: 1120 },
  ],
  topics: [
    { ru: 'Рост AI-студий в 2026', en: 'AI studios growing in 2026' },
    { ru: 'Лунные миссии и игры', en: 'Lunar missions and games' },
    { ru: 'Telegram-мини-приложения', en: 'Telegram mini apps' },
  ],
  plan: [
    { day: { ru: 'Пн', en: 'Mon' }, items: 2 }, { day: { ru: 'Вт', en: 'Tue' }, items: 2 }, { day: { ru: 'Ср', en: 'Wed' }, items: 1 },
    { day: { ru: 'Чт', en: 'Thu' }, items: 2 }, { day: { ru: 'Пт', en: 'Fri' }, items: 3 }, { day: { ru: 'Сб', en: 'Sat' }, items: 1 }, { day: { ru: 'Вс', en: 'Sun' }, items: 0 },
  ],
};

export const social = {
  platforms: [
    { id: 'youtube', name: 'YouTube', followers: '129K', growth: '+19%' },
    { id: 'tiktok', name: 'TikTok', followers: '84K', growth: '+24%' },
    { id: 'instagram', name: 'Instagram', followers: '51K', growth: '+11%' },
    { id: 'facebook', name: 'Facebook', followers: '23K', growth: '+6%' },
    { id: 'x', name: 'X', followers: '17K', growth: '+4%' },
  ],
  posts: [
    { id: 'sp1', platform: 'tiktok', title: { ru: 'Новый ролик', en: 'New clip' }, state: 'scheduled', when: { ru: '21 окт 12:00', en: 'Oct 21 12:00' } },
    { id: 'sp2', platform: 'instagram', title: { ru: 'Пост с картинкой', en: 'Image post' }, state: 'scheduled', when: { ru: '21 окт 14:00', en: 'Oct 21 14:00' } },
    { id: 'sp3', platform: 'youtube', title: { ru: 'Превью и описание', en: 'Thumbnail & description' }, state: 'work', when: null },
    { id: 'sp4', platform: 'x', name: 'X (Twitter)', title: { ru: 'Новость', en: 'News post' }, state: 'published', when: { ru: '20 окт 18:00', en: 'Oct 20 18:00' } },
    { id: 'sp5', platform: 'facebook', title: { ru: 'Анонс игры', en: 'Game announcement' }, state: 'scheduled', when: { ru: '22 окт 11:00', en: 'Oct 22 11:00' } },
    { id: 'sp6', platform: 'tiktok', title: { ru: 'Закулисье студии', en: 'Studio backstage' }, state: 'published', when: { ru: '19 окт 20:00', en: 'Oct 19 20:00' } },
  ],
  ideas: [
    { ru: 'Челлендж «9 жизней»', en: '“9 lives” challenge' },
    { ru: 'Коллаборация с игровым блогером', en: 'Collab with a gaming creator' },
    { ru: 'Серия «Кот-астронавт отвечает»', en: '“Astronaut cat answers” series' },
  ],
};

/* type colours: red video, orange growth, violet player, green money, pink error, teal done, gold update/reminder */
export const notifications = [
  { id: 'n1', type: 'video', cat: 'important', icon: 'play', color: 'red', title: { ru: 'Видео готово', en: 'Video ready' }, text: { ru: 'MOONKATTY NEWS — выпуск готов к проверке', en: 'MOONKATTY NEWS — episode ready for review' }, ago: ago(12, 'm'), link: '#/content/c2' },
  { id: 'n2', type: 'growth', cat: 'all', icon: 'growth', color: 'orange', title: { ru: 'Рост аудитории', en: 'Audience growth' }, text: { ru: 'YouTube +18% за последние 7 дней', en: 'YouTube +18% over the last 7 days' }, ago: ago(45, 'm'), link: '#/analytics' },
  { id: 'n3', type: 'player', cat: 'all', icon: 'gamepad', color: 'violet', title: { ru: 'Новый игрок', en: 'New players' }, text: { ru: '1 000 новых игроков в Horizons', en: '1,000 new players in Horizons' }, ago: ago(1, 'h'), link: '#/games' },
  { id: 'n4', type: 'money', cat: 'finance', icon: 'dollar', color: 'green', title: { ru: 'Доход', en: 'Revenue' }, text: { ru: 'Получен платёж $420 (Telegram Ads)', en: 'Payment received: $420 (Telegram Ads)' }, ago: ago(2, 'h'), link: '#/finance' },
  { id: 'n5', type: 'error', cat: 'important', icon: 'x', color: 'pink', title: { ru: 'Ошибка', en: 'Error' }, text: { ru: 'Не удалось опубликовать пост в X', en: 'Failed to publish a post to X' }, ago: ago(3, 'h'), link: '#/social/x' },
  { id: 'n6', type: 'done', cat: 'system', icon: 'check', color: 'teal', title: { ru: 'Задача завершена', en: 'Task completed' }, text: { ru: 'Аналитика каналов готова', en: 'Channel analytics is ready' }, ago: ago(4, 'h'), link: '#/tasks/t5' },
  { id: 'n7', type: 'update', cat: 'system', icon: 'update', color: 'gold', title: { ru: 'Обновление', en: 'Update' }, text: { ru: 'Новая версия игры загружена', en: 'New game version uploaded' }, ago: ago(5, 'h'), link: '#/games' },
  { id: 'n8', type: 'reminder', cat: 'important', icon: 'bell', color: 'gold', title: { ru: 'Напоминание', en: 'Reminder' }, text: { ru: 'Проверить запланированные публикации', en: 'Check the scheduled posts' }, ago: ago(8, 'h'), link: '#/social' },
];

export const devices = [
  { id: 'macmini', name: 'Mac mini', role: { ru: 'Основной узел студии', en: 'Main studio node' }, online: true, cpu: 34, ram: 61, disk: 48, uptime: { ru: '6 д 4 ч', en: '6 d 4 h' } },
  { id: 'macbook', name: 'MacBook', role: { ru: 'Монитор-узел', en: 'Monitor node' }, online: true, cpu: 12, ram: 40, disk: 55, uptime: { ru: '2 д 1 ч', en: '2 d 1 h' } },
  { id: 'imac', name: 'iMac', role: { ru: 'Новостной узел', en: 'News node' }, online: false, cpu: 0, ram: 0, disk: 71, uptime: { ru: '—', en: '—' } },
  { id: 'iphone', name: 'iPhone', role: { ru: 'Этот пульт', en: 'This remote' }, online: true, cpu: null, ram: null, disk: null, uptime: { ru: '—', en: '—' } },
];

export const integrations = [
  { id: 'youtube', name: 'YouTube' }, { id: 'tiktok', name: 'TikTok' }, { id: 'telegram', name: 'Telegram' },
  { id: 'instagram', name: 'Instagram' }, { id: 'facebook', name: 'Facebook' }, { id: 'x', name: 'X' },
];

export const ideas = [
  { id: 'i1', title: { ru: 'Ежедневный шортс с котом-астронавтом', en: 'Daily short with the astronaut cat' }, done: false },
  { id: 'i2', title: { ru: 'Chapter 5 для New Horizons', en: 'Chapter 5 for New Horizons' }, done: false },
  { id: 'i3', title: { ru: 'Telegram-канал MOONKATTY NEWS EN', en: 'MOONKATTY NEWS EN Telegram channel' }, done: true },
  { id: 'i4', title: { ru: 'Мерч: наклейки «9 Lives»', en: 'Merch: “9 Lives” stickers' }, done: false },
];

export const documents = [
  { id: 'doc1', title: { ru: 'Контракт с блогером (шаблон)', en: 'Creator contract (template)' }, kind: 'PDF', size: '220 KB' },
  { id: 'doc2', title: { ru: 'Бренд-бук MOONKATTY', en: 'MOONKATTY brand book' }, kind: 'PDF', size: '4.1 MB' },
  { id: 'doc3', title: { ru: 'Заметки: план на ноябрь', en: 'Notes: November plan' }, kind: 'MD', size: '6 KB' },
];

export const experiments = [
  { id: 'x1', title: { ru: 'Авто-субтитры на 5 языков', en: 'Auto subtitles in 5 languages' }, on: true },
  { id: 'x2', title: { ru: 'AI-обложки A/B', en: 'AI cover A/B' }, on: false },
  { id: 'x3', title: { ru: 'Голосовой бриф для агентов', en: 'Voice brief for agents' }, on: false },
];

export const faq = [
  { q: { ru: 'Это реальные данные?', en: 'Is this real data?' }, a: { ru: 'Нет. Этап 1 — прототип: все цифры и списки — DEMO. Реальные данные появятся на этапе 2 (только чтение).', en: 'No. Stage 1 is a prototype: every number and list is DEMO. Real data arrives in stage 2 (read-only).' } },
  { q: { ru: 'Что делает «Одобрить»?', en: 'What does “Approve” do?' }, a: { ru: 'Сейчас — только меняет локальное DEMO-состояние на этом устройстве. Ничего никуда не отправляется.', en: 'For now it only changes local DEMO state on this device. Nothing is sent anywhere.' } },
  { q: { ru: 'Как установить на iPhone?', en: 'How do I install it on iPhone?' }, a: { ru: 'Откройте в Safari → «Поделиться» → «На экран „Домой“». На этапе 3 — через Tailscale HTTPS.', en: 'Open in Safari → Share → Add to Home Screen. In stage 3 — via Tailscale HTTPS.' } },
];

export const appInfo = { name: 'MOONKATTY AI CONTROL', version: '1.0', stage: 1 };

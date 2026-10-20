'use strict';
const { AGENTS } = require('./constants');
const { StudioError } = require('./errors');

const KNOWN = new Set(AGENTS);

/**
 * Превращает уже проверенную сессию сервера в участника.
 * Это не вход и не проверка пароля: пароль и токен сюда передавать нельзя.
 * Сессию обязан проверить код dev #3 (cookie / app-token) до вызова.
 * session: { user, exp? } — форма getSession из server.js веток macos-app / opencode-auth.
 */
function principalFromSession(session, opts = {}) {
  if (!session || typeof session !== 'object') return null;
  if ('password' in session || 'token' in session || 'authorization' in session) {
    throw new StudioError('SECRET_REJECTED', 'В отображение сессии нельзя передавать пароль или токен', { retryable: false });
  }
  if (typeof session.user !== 'string' || !session.user.trim()) return null;
  if (session.exp != null && Number(session.exp) < Date.now()) return null;
  const user = session.user.trim().slice(0, 64);
  if (opts.agentId) {
    if (!KNOWN.has(opts.agentId)) {
      throw new StudioError('PERMISSION_DENIED', 'Неизвестный агент: ' + opts.agentId, { retryable: false });
    }
    return { id: opts.agentId, role: 'agent', agentId: opts.agentId, user };
  }
  return { id: user, role: 'owner', user };
}

function normalizePrincipal(principal) {
  if (!principal || (principal.role !== 'owner' && principal.role !== 'agent')) {
    throw new StudioError('PERMISSION_DENIED', 'Нет участника или роль неизвестна', { retryable: false });
  }
  if (principal.role === 'agent') {
    if (!principal.agentId || principal.agentId !== principal.id || !KNOWN.has(principal.agentId)) {
      throw new StudioError('PERMISSION_DENIED', 'Агент указан неверно', { retryable: false });
    }
  }
  return principal;
}

module.exports = { principalFromSession, normalizePrincipal };

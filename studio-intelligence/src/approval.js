'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/**
 * Единый интерфейс утверждения и неизменяемый журнал — контракт без записи.
 * Таблицы аудита нет: история появится, когда владелец подтвердит реализацию.
 * request/decide не исполняются и не могут включить autoExecute.
 */
function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректное утверждение', { retryable: false, details: { errors } });
}

function validateRequest(request) {
  const errors = validate('approval-request', request);
  if (errors.length) validation(errors);
  if (request.autoExecute !== false || request.requiredRole !== 'owner' || request.status !== 'pending') {
    validation(['Запрос утверждения не может исполняться сам и не может быть уже решён']);
  }
  return request;
}

function validateEvent(event) {
  const errors = validate('approval-event', event);
  if (errors.length) validation(errors);
  if (event.action === 'approved' && event.actorRole !== 'owner') {
    validation(['Утвердить может только владелец']);
  }
  return event;
}

function request() {
  throw new StudioError('NOT_IMPLEMENTED', 'Интерфейс утверждения описан контрактом и ничего не исполняет.', { retryable: false });
}

function decide() {
  throw new StudioError('NOT_IMPLEMENTED', 'Решение по утверждению не записывается: журнала аудита ещё нет.', { retryable: false });
}

module.exports = { validateRequest, validateEvent, request, decide };

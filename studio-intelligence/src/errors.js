'use strict';

/** Ошибки модуля. Код стабилен для других веток; текст — для человека. */
class StudioError extends Error {
  constructor(code, message, { retryable = false, details = {} } = {}) {
    super(message);
    this.name = 'StudioError';
    this.code = code;
    this.retryable = !!retryable;
    this.details = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details
    };
  }
}

module.exports = { StudioError };

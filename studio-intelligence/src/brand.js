'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/**
 * Реестр бренда — только контракт.
 * Оригинального кота нельзя подменить без утверждения владельца, и эта проверка ещё не исполняется.
 */
const RULES = Object.freeze({
  namespace: 'moonkatty_project',
  substitutionPolicy: 'owner_approval_required',
  autoExecute: false,
  kinds: Object.freeze(['cat_image', 'master_model', 'texture', 'animation', 'logo', 'color', 'style_rule']),
  originalCat: Object.freeze({
    locked: true,
    substituteWithoutOwner: false
  })
});

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректный объект бренда', { retryable: false, details: { errors } });
}

function validateAsset(asset) {
  const errors = validate('brand-asset', asset);
  if (errors.length) validation(errors);
  if (asset.kind === 'cat_image' && asset.locked !== true) {
    validation(['Оригинальное изображение кота должно быть заблокировано от подмены']);
  }
  if (asset.autoExecute !== false || asset.substitutionPolicy !== 'owner_approval_required') {
    validation(['Подмена бренда без владельца запрещена']);
  }
  return asset;
}

function validateCheck(request) {
  const errors = validate('brand-check', request);
  if (errors.length) validation(errors);
  if (request.action === 'substitute') {
    return Object.assign({}, request, { requiresOwnerApproval: true, autoExecute: false });
  }
  return request;
}

function check() {
  throw new StudioError('NOT_IMPLEMENTED', 'Проверка соответствия бренду описана контрактом и ещё не выполняется.', { retryable: false });
}

function register() {
  throw new StudioError('NOT_IMPLEMENTED', 'Реестр бренда ещё не хранит записи. Утверждённые правила можно положить в память как decision после решения владельца.', { retryable: false });
}

module.exports = { RULES, validateAsset, validateCheck, check, register };

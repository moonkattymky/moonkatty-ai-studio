'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/**
 * Реестр бренда хранит утверждённые файлы владельца.
 * Проверка сходства и подмена оригинала не исполняются.
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

function createBrand({ assets }) {
  function register({ principal, asset }) {
    const clean = validateAsset(asset);
    return assets.registerBrand({ principal, asset: clean });
  }

  function check() {
    throw new StudioError('NOT_IMPLEMENTED', 'Проверка сходства и подмена бренда не выполняются. Реестр только хранит утверждённый оригинал.', { retryable: false });
  }

  return { RULES, validateAsset, validateCheck, check, register };
}

module.exports = { RULES, validateAsset, validateCheck, createBrand };

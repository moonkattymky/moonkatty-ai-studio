'use strict';

/**
 * Accounts - Get, 21 October 2026.
 * https://learn.microsoft.com/en-us/rest/api/cognitiveservices/accountmanagement/accounts/get
 * GET .../providers/Microsoft.CognitiveServices/accounts/{accountName}?api-version=2024-10-01
 * The response field sku.name is the pricing tier (F0 or S0 for Speech).
 * The call needs a Microsoft Entra token for Azure Resource Manager.
 * The Speech subscription key cannot make it, and this client does not call it.
 */
const SKU_DOC_URL = 'https://learn.microsoft.com/en-us/rest/api/cognitiveservices/accountmanagement/accounts/get';
const SKU_API_VERSION = '2024-10-01';

function skuReadRequest({ subscriptionId, resourceGroup, accountName } = {}) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(subscriptionId || ''))) {
    throw new Error('Azure Speech sku check needs a subscription id. Refusing to run.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/.test(String(resourceGroup || '')) || !/^[A-Za-z0-9][A-Za-z0-9._()-]{0,89}$/.test(String(accountName || ''))) {
    throw new Error('Azure Speech sku check needs a resource group and account name. Refusing to run.');
  }
  return {
    method: 'GET',
    url: `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${accountName}?api-version=${SKU_API_VERSION}`,
    doc: SKU_DOC_URL,
    skuField: 'sku.name',
  };
}

module.exports = { SKU_DOC_URL, SKU_API_VERSION, skuReadRequest };

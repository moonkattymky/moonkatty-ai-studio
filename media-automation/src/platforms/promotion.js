'use strict';
/**
 * Marketing API boost plan — DRAFT ONLY. This module never calls the network and has no "execute" path.
 * A plan needs owner approval (via ApprovalCenter) AND an explicit budget. Even when approved, it only returns the
 * request bodies a human would submit in Ads Manager; campaigns are drafted with status PAUSED.
 */
const crypto = require('crypto');
function draftBoostPlan({ platform, postRef, budget, objective = 'OUTCOME_ENGAGEMENT', days = 3, targeting = { geo_locations: { countries: ['IL'] } } }) {
  if (!['facebook', 'instagram'].includes(platform)) throw new Error('boost only for facebook/instagram');
  if (!postRef) throw new Error('postRef required');
  const b = budget || {}; const hasBudget = Number.isFinite(b.amount) && b.amount > 0 && /^[A-Z]{3}$/.test(b.currency || '');
  const creative = platform === 'instagram' ? { source_instagram_media_id: postRef } : { object_story_id: postRef };
  return { id: 'boost_' + crypto.createHash('sha256').update(`${platform}|${postRef}|${JSON.stringify(b)}`).digest('hex').slice(0, 12), kind: 'promotion', platform, status: 'draft',
    requiresOwnerApproval: true, autoSpend: false, budget: hasBudget ? { amount: b.amount, currency: b.currency, type: 'lifetime', days } : null,
    blockers: [...(hasBudget ? [] : ['budget missing']), 'owner approval missing', 'ads_management permission + ad account not connected'],
    requests: [{ path: '/act_{AD_ACCOUNT_ID}/campaigns', body: { objective, status: 'PAUSED', special_ad_categories: [] } },
      { path: '/act_{AD_ACCOUNT_ID}/adsets', body: { lifetime_budget: hasBudget ? Math.round(b.amount * 100) : null, targeting, status: 'PAUSED' } },
      { path: '/act_{AD_ACCOUNT_ID}/adcreatives', body: creative }, { path: '/act_{AD_ACCOUNT_ID}/ads', body: { status: 'PAUSED' } }] };
}
/** Reflect an ApprovalCenter decision on the plan. Still no spend: returns 'approved_manual_launch'. */
function reviewBoostPlan(plan, approvalItem) {
  const p = { ...plan, blockers: plan.blockers.filter(x => x !== 'owner approval missing') };
  if (!approvalItem || approvalItem.status !== 'approved') return { ...plan };
  return { ...p, status: p.budget ? 'approved_manual_launch' : 'draft', approvedBy: approvalItem.history?.slice(-1)[0]?.by || null };
}
const toApprovalItem = plan => ({ id: plan.id, kind: 'promotion', title: `Boost ${plan.platform} ${plan.budget ? plan.budget.amount + ' ' + plan.budget.currency : '(no budget)'}`, meta: { plan } });
function launch() { throw new Error('auto-spend disabled: promotions are launched manually by the owner in Ads Manager'); }
module.exports = { draftBoostPlan, reviewBoostPlan, toApprovalItem, launch };

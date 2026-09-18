import { randomUUID } from 'node:crypto';
import { Resource, tables } from 'harper';

const {
  Accounts,
  Cards,
  SpendPolicies,
  Transactions,
  AuthorizationDecisions,
} = tables;

const DEMO_ACCOUNT_ID = 'account-maya';
const DEMO_CARD_ID = 'card-maya-4242';
const DEMO_POLICY_ID = 'policy-maya-default';
const DEMO_CURRENCY = 'USD';
const DEMO_ACTOR = 'rinku';

const DEMO_ACCOUNT = {
  id: DEMO_ACCOUNT_ID,
  customerName: 'Maya Chen',
  currency: DEMO_CURRENCY,
  availableLimitCents: 200000,
  dailyLimitCents: 250000,
  dailySpentCents: 0,
  status: 'active',
  updatedBy: DEMO_ACTOR,
};

const DEMO_CARD = {
  id: DEMO_CARD_ID,
  accountId: DEMO_ACCOUNT_ID,
  lastFour: '4242',
  status: 'active',
  updatedBy: DEMO_ACTOR,
};

const DEMO_POLICY = {
  id: DEMO_POLICY_ID,
  accountId: DEMO_ACCOUNT_ID,
  maxTransactionCents: 100000,
  blockedCategories: JSON.stringify(['gambling']),
  active: true,
  updatedBy: DEMO_ACTOR,
};

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function parseBody(body) {
  return body && typeof body === 'object' ? body : {};
}

function now() {
  return new Date().toISOString();
}

function parseJsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function normalizePayment(payload) {
  const amount = Number(payload.amountCents);
  return {
    requestId: typeof payload.requestId === 'string' && payload.requestId ? payload.requestId : `req_${randomUUID().slice(0, 8)}`,
    accountId: typeof payload.accountId === 'string' ? payload.accountId.trim() : '',
    cardId: typeof payload.cardId === 'string' ? payload.cardId.trim() : '',
    amountCents: Number.isSafeInteger(amount) ? amount : NaN,
    currency: typeof payload.currency === 'string' ? payload.currency.trim().toUpperCase() : '',
    merchant: typeof payload.merchant === 'string' ? payload.merchant.trim() : '',
    merchantCategory: typeof payload.merchantCategory === 'string' ? payload.merchantCategory.trim().toLowerCase() : '',
    idempotencyKey: typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey.trim() : '',
    actor: DEMO_ACTOR,
  };
}

function makeRule(name, label, passed, detail, status = passed ? 'passed' : 'failed') {
  return { name, label, passed, status, detail };
}

async function first(iterable) {
  for await (const item of iterable) return item;
  return null;
}

async function clearTable(table) {
  for await (const record of table.search({})) await table.delete(record.id);
}

async function createDecision({ payment, transactionId = null, decision, reasonCode, reason, rules, amountCents, beforeAvailable, afterAvailable }) {
  const id = `decision-${randomUUID().slice(0, 12)}`;
  await AuthorizationDecisions.put({
    id,
    transactionId,
    accountId: payment.accountId || 'unknown',
    cardId: payment.cardId || null,
    decision,
    reasonCode,
    reason,
    evaluatedRules: JSON.stringify(rules),
    amountCents: Number.isSafeInteger(amountCents) && amountCents > 0 ? amountCents : 0,
    beforeAvailableLimitCents: Number.isSafeInteger(beforeAvailable) ? beforeAvailable : 0,
    afterAvailableLimitCents: Number.isSafeInteger(afterAvailable) ? afterAvailable : 0,
    actor: payment.actor,
    createdAt: now(),
  });
  return id;
}

async function findDuplicate(accountId, idempotencyKey) {
  if (!accountId || !idempotencyKey) return null;
  return first(Transactions.search({ conditions: [
    { attribute: 'accountId', value: accountId },
    { attribute: 'idempotencyKey', value: idempotencyKey },
  ] }));
}

function samePayment(transaction, payment) {
  return transaction.amountCents === payment.amountCents
    && transaction.currency === payment.currency
    && transaction.cardId === payment.cardId
    && transaction.merchant === (payment.merchant || 'Demo merchant')
    && transaction.merchantCategory === (payment.merchantCategory || 'retail');
}

async function replayDuplicate(payment, result, duplicate) {
  if (!samePayment(duplicate, payment)) {
    fail('The idempotency key was already used for a different payment.', 409);
  }
  const existingDecision = await findDecision(duplicate.id);
  return {
    ...result,
    allowed: duplicate.status === 'approved',
    decision: duplicate.status === 'approved' ? 'APPROVED' : 'DECLINED',
    reasonCode: 'DUPLICATE_TRANSACTION',
    reason: 'Duplicate request replayed the original transaction safely.',
    transactionId: duplicate.id,
    decisionId: existingDecision?.id || null,
    duplicate: true,
    originalDecision: existingDecision ? {
      decision: existingDecision.decision,
      reasonCode: existingDecision.reasonCode,
      createdAt: existingDecision.createdAt,
    } : null,
    rules: existingDecision ? parseJsonList(existingDecision.evaluatedRules) : [],
    beforeAvailableLimitCents: existingDecision?.beforeAvailableLimitCents ?? result.beforeAvailableLimitCents,
    afterAvailableLimitCents: existingDecision?.afterAvailableLimitCents ?? result.afterAvailableLimitCents,
    tablesWritten: [],
  };
}

async function findDecision(transactionId) {
  return first(AuthorizationDecisions.search({ conditions: [{ attribute: 'transactionId', value: transactionId }] }));
}

function resultBase(payment) {
  return {
    allowed: false,
    decision: 'DECLINED',
    reasonCode: 'INVALID_REQUEST',
    reason: 'Payment could not be evaluated.',
    payment,
    actor: payment.actor,
    rules: [],
    beforeAvailableLimitCents: 0,
    afterAvailableLimitCents: 0,
    tablesRead: ['Accounts', 'Cards', 'SpendPolicies', 'Transactions'],
    tablesWritten: ['AuthorizationDecisions'],
  };
}

async function decline(payment, result, reasonCode, reason, rule) {
  result.reasonCode = reasonCode;
  result.reason = reason;
  if (rule) result.rules.push(rule);
  const transactionId = payment.accountId && payment.cardId && Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0
    ? `txn-${randomUUID().slice(0, 12)}`
    : null;

  if (transactionId) {
    await Transactions.put({
      id: transactionId,
      idempotencyKey: payment.idempotencyKey || `declined-${transactionId}`,
      accountId: payment.accountId,
      cardId: payment.cardId,
      amountCents: payment.amountCents,
      currency: payment.currency || DEMO_CURRENCY,
      merchant: payment.merchant || 'Unknown merchant',
      merchantCategory: payment.merchantCategory || 'unknown',
      status: 'declined',
      actor: payment.actor,
      createdAt: now(),
    });
    result.transactionId = transactionId;
    result.tablesWritten = ['Transactions', 'AuthorizationDecisions'];
  }

  result.decisionId = await createDecision({
    payment,
    transactionId,
    decision: 'DECLINED',
    reasonCode,
    reason,
    rules: result.rules,
    amountCents: Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0 ? payment.amountCents : 0,
    beforeAvailable: result.beforeAvailableLimitCents,
    afterAvailable: result.afterAvailableLimitCents,
  });
  return result;
}

async function authorizePayment(payload) {
  const payment = normalizePayment(payload);
  const result = resultBase(payment);
  const account = payment.accountId ? await Accounts.get(payment.accountId) : null;
  const card = payment.cardId ? await Cards.get(payment.cardId) : null;
  const policy = account ? await first(SpendPolicies.search({ conditions: [{ attribute: 'accountId', value: account.id }, { attribute: 'active', value: true }] })) : null;

  result.account = account ? {
    id: account.id,
    customerName: account.customerName,
    availableLimitCents: account.availableLimitCents,
    dailyLimitCents: account.dailyLimitCents,
    dailySpentCents: account.dailySpentCents,
    status: account.status,
  } : null;
  result.beforeAvailableLimitCents = account?.availableLimitCents ?? 0;
  result.afterAvailableLimitCents = result.beforeAvailableLimitCents;

  if (!account) return decline(payment, result, 'ACCOUNT_NOT_FOUND', 'The account is not registered in Harper.', makeRule('account-active', 'Account is active', false, 'No account record found.'));
  const duplicate = await findDuplicate(account.id, payment.idempotencyKey);
  if (duplicate) return replayDuplicate(payment, result, duplicate);

  result.rules.push(makeRule('account-active', 'Account is active', account.status === 'active', account.status === 'active' ? 'Account is active.' : `Account status is ${account.status}.`));
  if (account.status !== 'active') return decline(payment, result, 'ACCOUNT_SUSPENDED', 'The account is suspended.', null);

  const cardMatches = Boolean(card && card.accountId === account.id);
  result.rules.push(makeRule('card-active', 'Card belongs to account and is active', cardMatches && card.status === 'active', !card ? 'No card record found.' : !cardMatches ? 'Card belongs to another account.' : card.status === 'active' ? `Card ending ${card.lastFour} is active.` : `Card is ${card.status}.`));
  if (!card) return decline(payment, result, 'CARD_NOT_FOUND', 'The card is not registered in Harper.', null);
  if (!cardMatches) return decline(payment, result, 'CARD_NOT_FOUND', 'The card does not belong to this account.', null);
  if (card.status !== 'active') return decline(payment, result, 'CARD_FROZEN', 'The card is frozen by the operator.', null);

  const validAmount = Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0;
  result.rules.push(makeRule('amount-valid', 'Amount is a positive integer in cents', validAmount, validAmount ? `${money(payment.amountCents)} received.` : 'Amount must be a positive whole number of cents.'));
  if (!validAmount) return decline(payment, result, 'INVALID_AMOUNT', 'The payment amount is invalid.', null);

  const currencyMatches = payment.currency === account.currency;
  result.rules.push(makeRule('currency-match', 'Currency matches account', currencyMatches, currencyMatches ? payment.currency : `Account accepts ${account.currency}.`));
  if (!currencyMatches) return decline(payment, result, 'CURRENCY_MISMATCH', `Currency ${payment.currency || '—'} does not match the account currency.`, null);

  const blockedCategories = parseJsonList(policy?.blockedCategories);
  const categoryAllowed = Boolean(policy?.active) && !blockedCategories.includes(payment.merchantCategory);
  result.rules.push(makeRule('category-allowed', 'Merchant category is allowed', categoryAllowed, blockedCategories.includes(payment.merchantCategory) ? `${payment.merchantCategory} is blocked by policy.` : 'Merchant category is allowed.'));
  if (!policy || !policy.active) return decline(payment, result, 'CATEGORY_BLOCKED', 'No active spend policy is available.', null);
  if (!categoryAllowed) return decline(payment, result, 'CATEGORY_BLOCKED', `Merchant category ${payment.merchantCategory} is blocked by policy.`, null);

  const withinTransactionLimit = payment.amountCents <= policy.maxTransactionCents;
  result.rules.push(makeRule('transaction-limit', 'Payment is within transaction limit', withinTransactionLimit, withinTransactionLimit ? `${money(payment.amountCents)} is below ${money(policy.maxTransactionCents)}.` : `${money(payment.amountCents)} exceeds ${money(policy.maxTransactionCents)}.`));
  if (!withinTransactionLimit) return decline(payment, result, 'TRANSACTION_LIMIT_EXCEEDED', `Payment exceeds the ${money(policy.maxTransactionCents)} transaction limit.`, null);

  const remainingDaily = account.dailyLimitCents - account.dailySpentCents;
  const withinDailyLimit = payment.amountCents <= remainingDaily;
  result.rules.push(makeRule('daily-limit', 'Payment is within remaining daily limit', withinDailyLimit, withinDailyLimit ? `${money(remainingDaily)} remains today.` : `Only ${money(remainingDaily)} remains today.`));
  if (!withinDailyLimit) return decline(payment, result, 'DAILY_LIMIT_EXCEEDED', `Payment exceeds the remaining daily limit of ${money(remainingDaily)}.`, null);

  const withinAvailableLimit = payment.amountCents <= account.availableLimitCents;
  result.rules.push(makeRule('available-limit', 'Payment is within available account limit', withinAvailableLimit, withinAvailableLimit ? `${money(account.availableLimitCents)} is available.` : `Only ${money(account.availableLimitCents)} is available.`));
  if (!withinAvailableLimit) return decline(payment, result, 'AVAILABLE_LIMIT_EXCEEDED', `Payment exceeds the available account limit of ${money(account.availableLimitCents)}.`, null);

  result.rules.push(makeRule('idempotency', 'Request has not been processed before', true, 'New idempotency key.'));

  const transactionId = `txn-${randomUUID().slice(0, 12)}`;
  const decisionRules = result.rules;
  const afterAvailable = account.availableLimitCents - payment.amountCents;
  const afterDailySpent = account.dailySpentCents + payment.amountCents;
  const timestamp = now();

  // Harper automatically wraps HTTP Resource handlers in a transaction. The
  // account counter, transaction, and decision therefore commit together.
  const accountResource = await Accounts.update(account.id);
  accountResource.subtractFrom('availableLimitCents', payment.amountCents);
  accountResource.addTo('dailySpentCents', payment.amountCents);
  accountResource.updatedBy = payment.actor;
  accountResource.updatedAt = timestamp;
  await accountResource.save();

  await Transactions.put({
    id: transactionId,
    idempotencyKey: payment.idempotencyKey,
    accountId: payment.accountId,
    cardId: payment.cardId,
    amountCents: payment.amountCents,
    currency: payment.currency,
    merchant: payment.merchant || 'Demo merchant',
    merchantCategory: payment.merchantCategory || 'retail',
    status: 'approved',
    actor: payment.actor,
    createdAt: timestamp,
  });

  const decisionId = await createDecision({
    payment,
    transactionId,
    decision: 'APPROVED',
    reasonCode: 'APPROVED',
    reason: 'Payment approved by Pitsky Guard on Harper.',
    rules: decisionRules,
    amountCents: payment.amountCents,
    beforeAvailable: account.availableLimitCents,
    afterAvailable,
  });

  return {
    ...result,
    allowed: true,
    decision: 'APPROVED',
    reasonCode: 'APPROVED',
    reason: 'Payment approved by Pitsky Guard on Harper.',
    transactionId,
    decisionId,
    afterAvailableLimitCents: afterAvailable,
    afterDailySpentCents: afterDailySpent,
    account: {
      ...result.account,
      availableLimitCents: afterAvailable,
      dailySpentCents: afterDailySpent,
    },
    tablesWritten: ['Accounts', 'Transactions', 'AuthorizationDecisions'],
  };
}

async function currentState() {
  const account = await Accounts.get(DEMO_ACCOUNT_ID);
  const card = await Cards.get(DEMO_CARD_ID);
  const policy = await SpendPolicies.get(DEMO_POLICY_ID);
  const decisions = [];
  for await (const decision of AuthorizationDecisions.search({})) decisions.push(decision);
  const transactions = [];
  for await (const transaction of Transactions.search({})) transactions.push(transaction);
  decisions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  transactions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const transactionById = new Map(transactions.map((item) => [item.id, item]));
  const approved = decisions.filter((item) => item.decision === 'APPROVED').length;
  const exposure = decisions.reduce((sum, item) => sum + Math.max(0, Number(item.amountCents || 0)), 0);
  return {
    account,
    card,
    policy: policy ? { ...policy, blockedCategories: parseJsonList(policy.blockedCategories) } : null,
    metrics: {
      accounts: account ? 1 : 0,
      decisions: decisions.length,
      approvalRate: decisions.length ? Math.round((approved / decisions.length) * 100) : 0,
      exposureGuardedCents: exposure,
    },
    decisions: decisions.slice(0, 12).map((item) => ({
      ...item,
      merchant: transactionById.get(item.transactionId)?.merchant || 'Request validation',
      evaluatedRules: parseJsonList(item.evaluatedRules),
    })),
    transactions: transactions.slice(0, 12),
  };
}

export class DemoSeed extends Resource {
  static path = '/api/demo-seed';

  allowCreate() {
    return true;
  }

  async post() {
    await Promise.all([
      clearTable(Accounts),
      clearTable(Cards),
      clearTable(SpendPolicies),
      clearTable(Transactions),
      clearTable(AuthorizationDecisions),
    ]);
    const timestamp = now();
    await Accounts.put({ ...DEMO_ACCOUNT, updatedAt: timestamp });
    await Cards.put({ ...DEMO_CARD, updatedAt: timestamp });
    await SpendPolicies.put({ ...DEMO_POLICY, updatedAt: timestamp });
    return { seeded: true, actor: DEMO_ACTOR, state: await currentState(), message: 'Demo account, card, policy, and audit state reset in Harper by rinku.' };
  }
}

export class PaymentAuthorize extends Resource {
  static path = '/payments/authorize';

  allowCreate() {
    return true;
  }

  async post(body) {
    const payment = parseBody(await body);
    if (!payment.idempotencyKey) fail('idempotencyKey is required.');
    return authorizePayment(payment);
  }
}

export class PaymentCardStatus extends Resource {
  static path = '/payments/card-status';

  allowCreate() {
    return true;
  }

  async post(body) {
    const payload = parseBody(await body);
    const cardId = payload.cardId || DEMO_CARD_ID;
    const status = payload.status === 'frozen' ? 'frozen' : payload.status === 'active' ? 'active' : null;
    if (!status) fail('status must be active or frozen.');
    const card = await Cards.get(cardId);
    if (!card) fail('Card not found.', 404);
    await Cards.patch(cardId, { status, updatedBy: DEMO_ACTOR, updatedAt: now() });
    return { updated: true, actor: DEMO_ACTOR, card: { ...card, status, updatedBy: DEMO_ACTOR }, harper: { table: 'Cards', operation: 'PATCH' } };
  }
}

export class PaymentPolicyAction extends Resource {
  static path = '/payments/policy-action';

  allowCreate() {
    return true;
  }

  async post(body) {
    const payload = parseBody(await body);
    const policyId = payload.policyId || DEMO_POLICY_ID;
    const policy = await SpendPolicies.get(policyId);
    if (!policy) fail('Policy not found.', 404);
    const categories = parseJsonList(policy.blockedCategories);
    let updates;
    if (payload.action === 'lower-limit') updates = { maxTransactionCents: 25000 };
    else if (payload.action === 'raise-limit') updates = { maxTransactionCents: 100000 };
    else if (payload.action === 'block-category') updates = { blockedCategories: JSON.stringify([...new Set([...categories, payload.category || 'gambling'])]) };
    else if (payload.action === 'unblock-category') updates = { blockedCategories: JSON.stringify(categories.filter((item) => item !== (payload.category || 'gambling'))) };
    else fail('action must be lower-limit, raise-limit, block-category, or unblock-category.');
    updates.updatedBy = DEMO_ACTOR;
    updates.updatedAt = now();
    await SpendPolicies.patch(policyId, updates);
    return { updated: true, actor: DEMO_ACTOR, policy: { ...policy, ...updates, blockedCategories: parseJsonList(updates.blockedCategories || policy.blockedCategories) }, harper: { table: 'SpendPolicies', operation: 'PATCH' } };
  }
}

export class PaymentState extends Resource {
  static path = '/payments/state';

  allowRead() {
    return true;
  }

  async get() {
    return currentState();
  }
}

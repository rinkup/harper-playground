const state = {
  seeded: false,
  scenario: 'valid',
  current: null,
  lastResult: null,
  lastSync: null,
  isAuthorizing: false,
  expandedDecisionId: null,
};

const DEMO_ACTOR = 'rinku';

const $ = (selector) => document.querySelector(selector);

const themeController = window.pitskyTheme;
const themeSelect = $('#theme-select');
if (themeController && themeSelect) {
  themeController.apply(themeController.getPreference());
  themeSelect.addEventListener('change', () => themeController.apply(themeSelect.value, true));
  const followSystemTheme = () => {
    if (themeController.getPreference() === 'system') themeController.apply('system');
  };
  if (themeController.media.addEventListener) themeController.media.addEventListener('change', followSystemTheme);
  else themeController.media.addListener(followSystemTheme);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(typeof payload === 'string' ? payload : payload.message || 'Request failed');
  return payload;
}

function showNotice(message, isError = false) {
  const notice = $('#notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function money(cents) {
  return `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relativeTime(iso) {
  if (!iso) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function animateValue(selector, target, formatter = (value) => String(Math.round(value))) {
  const element = $(selector);
  if (!element) return;
  if (target === null || target === undefined || !Number.isFinite(Number(target))) {
    window.cancelAnimationFrame(element._valueFrame);
    delete element.dataset.numericValue;
    element.textContent = target ?? '—';
    return;
  }
  const next = Number(target);
  const previous = Number(element.dataset.numericValue);
  const start = Number.isFinite(previous) ? previous : 0;
  window.cancelAnimationFrame(element._valueFrame);
  if (start === next) {
    element.textContent = formatter(next);
    return;
  }
  const startedAt = performance.now();
  const duration = 560;
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - ((1 - progress) ** 3);
    element.textContent = formatter(start + ((next - start) * eased));
    if (progress < 1) element._valueFrame = window.requestAnimationFrame(step);
  };
  element.dataset.numericValue = String(next);
  element._valueFrame = window.requestAnimationFrame(step);
}

function decisionTone(item) {
  const reasonCode = String(item?.reasonCode || '').toUpperCase();
  if (item?.duplicate || reasonCode === 'DUPLICATE_TRANSACTION') return 'duplicate';
  if (reasonCode === 'CARD_FROZEN') return 'frozen';
  if (reasonCode === 'CATEGORY_BLOCKED') return 'category';
  if (reasonCode.includes('LIMIT')) return 'limit';
  return item?.decision === 'APPROVED' || item?.allowed === true ? 'approved' : 'declined';
}

function renderSparkline(selector, values, tone = 'green') {
  const element = $(selector);
  if (!element) return;
  const points = values.length ? values : [0];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const coords = points.map((value, index) => {
    const x = points.length === 1 ? 2 : 2 + ((index / (points.length - 1)) * 76);
    const y = 22 - (((value - min) / range) * 18);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = coords[coords.length - 1].split(',');
  element.innerHTML = `<svg viewBox="0 0 80 24" role="img" aria-label="Recent ${tone} trend"><path class="sparkline-area" d="M ${coords.join(' L ')} L 78,24 L 2,24 Z"></path><polyline class="sparkline-line" points="${coords.join(' ')}"></polyline><circle class="sparkline-dot" cx="${last[0]}" cy="${last[1]}" r="2.5"></circle></svg>`;
  element.dataset.tone = tone;
}

function runFlowAnimation() {
  const strip = $('.flow-strip');
  if (!strip) return;
  strip._flowTimers?.forEach((timer) => window.clearTimeout(timer));
  const nodes = [...strip.querySelectorAll('.flow-node')];
  nodes.forEach((node, index) => {
    node.style.setProperty('--flow-index', index);
    node.classList.remove('is-live', 'is-complete');
  });
  strip.querySelectorAll('.flow-arrow').forEach((arrow, index) => arrow.style.setProperty('--flow-index', index + 1));
  strip.classList.remove('is-running');
  void strip.offsetWidth;
  strip.classList.add('is-running');
  const timers = nodes.map((node, index) => window.setTimeout(() => {
    nodes.forEach((item, itemIndex) => {
      item.classList.toggle('is-live', itemIndex === index);
      item.classList.toggle('is-complete', itemIndex < index);
    });
  }, index * 280));
  timers.push(window.setTimeout(() => {
    nodes.forEach((node) => node.classList.remove('is-live', 'is-complete'));
    strip.classList.remove('is-running');
    strip._flowTimers = [];
  }, (nodes.length * 280) + 850));
  strip._flowTimers = timers;
}

function scenarioDefaults(scenario) {
  const defaults = {
    valid: { amount: '450.00', merchant: 'Juniper Market', category: 'grocery', key: 'demo-valid-001' },
    limit: { amount: '1250.00', merchant: 'Northwind Travel', category: 'travel', key: `demo-limit-${Date.now()}` },
    frozen: { amount: '100.00', merchant: 'Juniper Market', category: 'grocery', key: `demo-frozen-${Date.now()}` },
    category: { amount: '40.00', merchant: 'Lucky Play', category: 'gambling', key: `demo-category-${Date.now()}` },
    duplicate: { amount: '450.00', merchant: 'Juniper Market', category: 'grocery', key: 'demo-valid-001' },
  };
  return defaults[scenario] || defaults.valid;
}

async function setScenario(scenario) {
  state.scenario = scenario;
  document.querySelectorAll('.scenario-button').forEach((button) => button.classList.toggle('selected', button.dataset.scenario === scenario));
  const values = scenarioDefaults(scenario);
  $('#amount-input').value = values.amount;
  $('#merchant-input').value = values.merchant;
  $('#category-input').value = values.category;
  $('#idempotency-input').value = values.key;
  renderRequestPreview();
  if (scenario === 'duplicate') showNotice('Replay the valid payment key. Load demo and approve Valid payment first.', false);
  if (scenario === 'frozen' && state.seeded && state.current?.card?.status !== 'frozen') await changeCardStatus('frozen');
  if (scenario !== 'frozen' && state.seeded && state.current?.card?.status === 'frozen') await changeCardStatus('active');
}

function paymentPayload() {
  const amount = Number($('#amount-input').value);
  return {
    requestId: `req_${Date.now().toString(36)}`,
    accountId: $('#account-input').value.trim(),
    cardId: $('#card-input').value,
    amountCents: Math.round(amount * 100),
    currency: $('#currency-input').value,
    merchant: $('#merchant-input').value.trim(),
    merchantCategory: $('#category-input').value,
    idempotencyKey: $('#idempotency-input').value.trim(),
    actor: DEMO_ACTOR,
  };
}

function isValidAmountCents(amountCents) {
  return Number.isSafeInteger(amountCents) && amountCents > 0;
}

function invalidAmountMessage() {
  return 'Invalid amount — enter a value greater than $0.00. Harper will leave the account unchanged.';
}

function renderRequestPreview() {
  const payload = paymentPayload();
  $('#request-preview').textContent = `POST /payments/authorize  ·  actor ${DEMO_ACTOR}  ·  ${payload.accountId || 'account—'}  ·  ${money(payload.amountCents)}  ·  ${payload.merchantCategory || 'category—'}`;
}

function requestAssessment(current) {
  const account = current.account;
  const payload = paymentPayload();
  if (!account) return { kind: 'waiting', status: 'WAITING', before: 0, after: 0, note: 'Load the demo to preview the account change.' };
  const before = Number(account.availableLimitCents || 0);
  const duplicate = (current.transactions || []).find((item) => item.accountId === payload.accountId && item.idempotencyKey === payload.idempotencyKey);
  if (duplicate) return { kind: 'replay', status: 'REPLAY', before, after: before, note: 'Same account and idempotency key already exist. Authorize will replay the original outcome without a second charge.' };
  if (account.status !== 'active') return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: 'Account is suspended. Harper will deny before writing an account change.' };
  if (!isValidAmountCents(payload.amountCents)) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: invalidAmountMessage() };
  if (current.card?.status !== 'active') return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: 'Card is frozen. Harper will deny before writing an account change.' };
  if (payload.currency !== account.currency) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: `Currency mismatch. This account accepts ${account.currency}, so the limit will not move.` };
  const blockedCategories = current.policy?.blockedCategories || [];
  if (blockedCategories.includes(payload.merchantCategory)) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: `${payload.merchantCategory} is blocked by the spend policy, so the limit will not move.` };
  if (current.policy && payload.amountCents > current.policy.maxTransactionCents) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: `${money(payload.amountCents)} exceeds the ${money(current.policy.maxTransactionCents)} transaction limit, so the limit will not move.` };
  const remainingDaily = Number(account.dailyLimitCents || 0) - Number(account.dailySpentCents || 0);
  if (payload.amountCents > remainingDaily) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: `${money(payload.amountCents)} exceeds the ${money(Math.max(0, remainingDaily))} remaining daily limit, so the limit will not move.` };
  if (payload.amountCents > before) return { kind: 'blocked', status: 'BLOCKED', before, after: before, note: `${money(payload.amountCents)} exceeds the ${money(before)} available account limit, so the limit will not move.` };
  return { kind: 'approval', status: 'EXPECTED APPROVAL', before, after: before - payload.amountCents, note: `If approved, Harper will commit ${money(payload.amountCents)} and reduce available limit by the same amount.` };
}

function renderRequestImpact(current) {
  const assessment = requestAssessment(current);
  const status = $('#request-impact-status');
  const scenarioCopy = $('#scenario-explanation-copy');
  const impact = $('#request-impact');
  const scenario = $('#scenario-explanation');
  impact.dataset.scenario = state.scenario;
  scenario.dataset.scenario = state.scenario;
  status.textContent = assessment.status;
  status.className = `request-impact-status ${assessment.kind}`;
  $('#request-impact-before').textContent = current.account ? money(assessment.before) : '—';
  $('#request-impact-after').textContent = current.account ? money(assessment.after) : '—';
  $('#request-impact-note').textContent = assessment.note;
  impact.className = `request-impact ${assessment.kind}`;
  scenarioCopy.textContent = assessment.note;
  scenario.className = `scenario-explanation ${assessment.kind}`;
  const amountInput = $('#amount-input');
  const amountError = $('#amount-error');
  const invalidAmount = !isValidAmountCents(paymentPayload().amountCents);
  amountInput.classList.toggle('input-invalid', invalidAmount);
  amountInput.setAttribute('aria-invalid', String(invalidAmount));
  amountError.hidden = !invalidAmount;
  amountError.textContent = 'Enter an amount greater than $0.00.';
  const duplicate = (current.transactions || []).some((item) => item.accountId === paymentPayload().accountId && item.idempotencyKey === paymentPayload().idempotencyKey);
  $('#idempotency-note').textContent = duplicate ? 'Already processed for this account — replay will not charge twice.' : 'New key for this account — this request can create a transaction.';
}

function render() {
  const current = state.current || { metrics: {}, decisions: [], account: null, card: null, policy: null };
  const metrics = current.metrics || {};
  animateValue('#account-count', metrics.accounts ?? null);
  animateValue('#decision-count', metrics.decisions ?? null);
  animateValue('#approval-rate', metrics.decisions ? metrics.approvalRate : null, (value) => `${Math.round(value)}%`);
  animateValue('#exposure-guarded', metrics.decisions ? metrics.exposureGuardedCents : null, (value) => money(value));
  $('#audit-count').textContent = `${metrics.decisions || 0} decision${metrics.decisions === 1 ? '' : 's'}`;
  const requestButton = $('#request-button');
  requestButton.disabled = !state.seeded || state.isAuthorizing;
  requestButton.classList.toggle('is-busy', state.isAuthorizing);
  requestButton.setAttribute('aria-busy', String(state.isAuthorizing));
  requestButton.innerHTML = state.isAuthorizing ? '<span class="button-spinner" aria-hidden="true"></span>Authorizing…' : 'Authorize <span>→</span>';
  $('#reset-button').disabled = !state.seeded;
  const cardFrozen = current.card?.status === 'frozen';
  $('#freeze-card').disabled = !state.seeded || cardFrozen;
  $('#unfreeze-card').disabled = !state.seeded || !cardFrozen;
  $('#freeze-card').classList.toggle('active-control', cardFrozen);
  $('#unfreeze-card').classList.toggle('active-control', state.seeded && !cardFrozen);
  $('#freeze-card').setAttribute('aria-pressed', String(cardFrozen));
  $('#unfreeze-card').setAttribute('aria-pressed', String(state.seeded && !cardFrozen));
  $('#lower-limit').disabled = !state.seeded;
  $('#raise-limit').disabled = !state.seeded;
  const lowerLimitActive = Number(current.policy?.maxTransactionCents) <= 25000;
  const raiseLimitActive = Number(current.policy?.maxTransactionCents) >= 100000;
  $('#lower-limit').classList.toggle('active-control', lowerLimitActive);
  $('#raise-limit').classList.toggle('active-control', raiseLimitActive);
  $('#lower-limit').setAttribute('aria-pressed', String(lowerLimitActive));
  $('#raise-limit').setAttribute('aria-pressed', String(raiseLimitActive));
  $('#card-status').textContent = current.card?.status?.toUpperCase() || '—';
  $('#card-status').className = current.card?.status === 'active' ? 'status-active' : 'status-frozen';
  $('#policy-limit').textContent = current.policy ? money(current.policy.maxTransactionCents) : '—';
  const decisions = current.decisions || [];
  const chronological = [...decisions].reverse();
  let approvals = 0;
  let exposure = 0;
  const approvalTrend = chronological.map((item) => {
    if (item.decision === 'APPROVED') approvals += 1;
    return Math.round((approvals / (chronological.indexOf(item) + 1)) * 100);
  });
  const exposureTrend = chronological.map((item) => {
    exposure += Math.max(0, Number(item.amountCents || 0));
    return exposure;
  });
  renderSparkline('#approval-sparkline', approvalTrend, 'approval');
  renderSparkline('#exposure-sparkline', exposureTrend, 'exposure');
  renderAccountState(current);
  renderRequestPreview();
  renderRequestImpact(current);
  renderDecisions(decisions);
  renderResult();
}

async function loadState() {
  state.current = await api('/payments/state');
  state.seeded = Boolean(state.current.account);
  state.lastSync = new Date();
  render();
}

function renderAccountState(current) {
  const account = current.account;
  const card = current.card;
  const policy = current.policy;
  if (!account) {
    $('#account-name').textContent = 'Load demo account';
    $('#account-id').textContent = '—';
    animateValue('#available-limit', null);
    animateValue('#daily-spend', null);
    $('#daily-copy').textContent = 'No Harper state loaded.';
    $('#daily-bar').style.width = '0%';
    $('#available-ring').style.setProperty('--ring-progress', '0%');
    $('#card-last-four').textContent = '—';
    $('#card-status').className = 'status-frozen';
    $('#last-sync').textContent = 'Waiting for demo state';
    $('#state-delta-value').textContent = '—';
    $('#delta-bar').style.width = '0%';
    $('#state-delta-copy').textContent = 'Run a payment to see whether the available limit changes.';
    $('#state-panel').dataset.tone = 'waiting';
    return;
  }
  const availableRatio = account.availableLimitCents / 200000;
  const dailyRatio = account.dailyLimitCents ? account.dailySpentCents / account.dailyLimitCents : 0;
  $('#account-name').textContent = account.customerName;
  $('#account-id').textContent = account.id;
  animateValue('#available-limit', account.availableLimitCents, (value) => money(value));
  animateValue('#daily-spend', account.dailySpentCents, (value) => money(value));
  $('#daily-copy').textContent = `${money(Math.max(0, account.dailyLimitCents - account.dailySpentCents))} remaining of ${money(account.dailyLimitCents)} today.`;
  $('#daily-bar').style.width = `${Math.max(0, Math.min(100, dailyRatio * 100))}%`;
  $('#available-ring').style.setProperty('--ring-progress', `${Math.max(0, Math.min(100, availableRatio * 100))}%`);
  $('#card-last-four').textContent = card?.lastFour || '—';
  $('#last-sync').textContent = state.lastSync ? `Actor: ${account.updatedBy || DEMO_ACTOR} · synced ${relativeTime(state.lastSync.toISOString())}` : `Actor: ${DEMO_ACTOR}`;
  $('#state-panel').dataset.cardStatus = card?.status || 'unknown';
  $('#state-panel').dataset.policyLimit = policy?.maxTransactionCents || '';
  const latest = (current.decisions || [])[0];
  $('#state-panel').dataset.tone = card?.status === 'frozen' ? 'frozen' : decisionTone(latest || { decision: 'APPROVED' });
  const delta = latest ? Number(latest.afterAvailableLimitCents || 0) - Number(latest.beforeAvailableLimitCents || 0) : 0;
  $('#state-delta-value').textContent = latest ? (delta < 0 ? `−${money(Math.abs(delta))}` : delta > 0 ? `+${money(delta)}` : '$0.00') : '—';
  $('#delta-bar').style.width = `${Math.max(0, Math.min(100, Math.abs(delta) / 200000 * 100))}%`;
  $('#state-delta-copy').textContent = latest ? `${latest.decision === 'APPROVED' ? 'Approved' : 'No account write'} · ${latest.reasonCode} · ${relativeTime(latest.createdAt)}` : 'Run a payment to see whether the available limit changes.';
  $('#state-delta').className = `state-delta ${delta < 0 ? 'changed' : 'unchanged'}`;
  $('#state-delta').dataset.tone = latest ? decisionTone(latest) : 'waiting';
}

function pulse(selector) {
  const element = $(selector);
  if (!element) return;
  element.classList.remove('state-flash');
  void element.offsetWidth;
  element.classList.add('state-flash');
}

function renderDecisions(decisions) {
  const container = $('#decisions');
  const drawer = $('#audit-detail-drawer');
  const auditPanel = $('#audit');
  auditPanel.classList.toggle('has-expanded', Boolean(state.expandedDecisionId));
  if (!decisions.length) {
    container.className = 'decisions empty-state';
    container.textContent = 'No decisions yet. Run a payment to create an audit record.';
    drawer.hidden = true;
    return;
  }
  container.className = 'decisions';
  container.innerHTML = decisions.slice(0, 10).map((item) => {
    const approved = item.decision === 'APPROVED';
    const tone = decisionTone(item);
    const expanded = state.expandedDecisionId === item.id;
    const ruleSummary = (item.evaluatedRules || []).map((rule) => `${rule.passed ? '✓' : '×'} ${rule.label}`).join(' · ');
    return `<article class="decision-card ${approved ? 'allowed' : 'denied'} tone-${tone} ${expanded ? 'expanded' : ''}" data-decision-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-expanded="${expanded}">
      <div class="decision-icon">${approved ? '✓' : '×'}</div>
      <div class="decision-main"><strong>${approved ? 'APPROVED' : 'DECLINED'} · ${escapeHtml(item.merchant || item.reasonCode)}</strong><small>${money(item.amountCents)} · ${escapeHtml(item.reasonCode)} · by ${escapeHtml(item.actor || DEMO_ACTOR)} · ${relativeTime(item.createdAt)}</small></div>
      <div class="decision-cache"><span>AVAILABLE</span>${money(item.beforeAvailableLimitCents)} → ${money(item.afterAvailableLimitCents)}</div>
      <div class="decision-chevron" aria-hidden="true">⌄</div>
      <div class="decision-detail" ${expanded ? '' : 'hidden'}>
        <div><span>TRANSACTION</span><code>${escapeHtml(item.transactionId || 'not created')}</code></div>
        <div><span>ACCOUNT</span><code>${escapeHtml(item.accountId || '—')}</code></div>
        <div><span>ACTOR</span><code>${escapeHtml(item.actor || DEMO_ACTOR)}</code></div>
        <div><span>RULES EVALUATED</span><small>${escapeHtml(ruleSummary || 'No rule detail returned.')}</small></div>
        <div><span>DECISION DETAIL</span><small>${escapeHtml(item.reason || item.reasonCode || '—')} · ${escapeHtml(item.createdAt || '—')}</small></div>
      </div>
    </article>`;
  }).join('');
  const expandedItem = decisions.find((item) => item.id === state.expandedDecisionId);
  if (!expandedItem) {
    drawer.hidden = true;
    return;
  }
  const expandedTone = decisionTone(expandedItem);
  const expandedRules = (expandedItem.evaluatedRules || []).map((rule) => `<span class="drawer-rule ${rule.passed ? 'passed' : 'failed'}">${rule.passed ? '✓' : '×'} ${escapeHtml(rule.label)}</span>`).join('');
  drawer.hidden = false;
  drawer.className = `audit-detail-drawer tone-${expandedTone}`;
  drawer.innerHTML = `<div class="drawer-heading"><div><span class="eyebrow">DECISION DETAIL</span><strong>${expandedItem.decision === 'APPROVED' ? 'APPROVED' : 'DECLINED'} · ${escapeHtml(expandedItem.merchant || expandedItem.reasonCode)}</strong></div><span class="drawer-live">HARPER RECORD</span></div><div class="drawer-grid"><div><span>TRANSACTION</span><code>${escapeHtml(expandedItem.transactionId || 'not created')}</code></div><div><span>ACCOUNT</span><code>${escapeHtml(expandedItem.accountId || '—')}</code></div><div><span>ACTOR</span><code>${escapeHtml(expandedItem.actor || DEMO_ACTOR)}</code></div><div><span>AMOUNT</span><code>${money(expandedItem.amountCents)}</code></div><div><span>AVAILABLE</span><code>${money(expandedItem.beforeAvailableLimitCents)} → ${money(expandedItem.afterAvailableLimitCents)}</code></div></div><div class="drawer-rules"><span>RULES EVALUATED</span><div>${expandedRules || '<span class="drawer-rule">No rule detail returned.</span>'}</div></div><p>${escapeHtml(expandedItem.reason || expandedItem.reasonCode || '—')} · actor ${escapeHtml(expandedItem.actor || DEMO_ACTOR)} · ${escapeHtml(expandedItem.createdAt || '—')}</p>`;
}

function resultValue(result) {
  if (result.duplicate) return 'The original result was returned. The account was not charged again.';
  if (result.allowed) return 'Harper updated the available limit and saved the transaction and decision.';
  return 'The request was stopped before the available limit changed. The reason was saved for review.';
}

function renderResult() {
  const result = state.lastResult;
  if (!result) {
    $('#result-empty').hidden = false;
    $('#result-content').hidden = true;
    return;
  }
  $('#result-empty').hidden = true;
  $('#result-content').hidden = false;
  const approved = result.allowed === true;
  const tone = decisionTone(result);
  $('#result-panel').dataset.tone = tone;
  const badge = $('#decision-badge');
  badge.textContent = approved ? 'APPROVED' : 'DECLINED';
  badge.className = `decision-badge ${approved ? 'allowed' : 'denied'} tone-${tone}`;
  $('#result-reason').textContent = result.reasonCode === 'INVALID_AMOUNT' ? 'Invalid amount. Enter a value greater than $0.00.' : result.reason;
  $('#result-value').textContent = resultValue(result);
  $('#result-amount').textContent = money(result.payment?.amountCents);
  $('#result-before').textContent = money(result.beforeAvailableLimitCents);
  $('#result-after').textContent = money(result.afterAvailableLimitCents);
  const balanceChanged = Number(result.beforeAvailableLimitCents) !== Number(result.afterAvailableLimitCents);
  const balanceNote = result.duplicate
    ? 'No account change — the same idempotency key replayed the original decision safely.'
    : balanceChanged
      ? `Account changed — ${money(Math.abs(Number(result.beforeAvailableLimitCents) - Number(result.afterAvailableLimitCents)))} deducted from the available limit.`
      : `No account change — ${result.reasonCode} stopped the request before exposure was updated.`;
  $('#balance-change-note').textContent = balanceNote;
  $('#balance-change-note').className = `balance-change-note ${balanceChanged ? 'changed' : 'unchanged'}`;
  $('#result-transaction').textContent = result.transactionId || 'not created';
  $('#result-decision').textContent = result.decisionId || '—';
  $('#result-actor').textContent = result.actor || result.payment?.actor || DEMO_ACTOR;
  $('#tables-written').textContent = result.tablesWritten?.length ? result.tablesWritten.join(' · ') : 'none — replay only';
  $('#rule-list').innerHTML = (result.rules || []).map((rule) => `<div class="rule-row ${rule.passed ? 'passed' : 'failed'}"><span>${rule.passed ? '✓' : '×'}</span><strong>${escapeHtml(rule.label)}</strong><small>${escapeHtml(rule.detail)}</small></div>`).join('');
  const visual = $('#decision-visual');
  visual.className = `decision-visual ${approved ? 'approved' : 'declined'} tone-${tone}`;
  $('#decision-orb-icon').textContent = approved ? '✓' : '×';
  $('#decision-orb-label').textContent = approved ? 'APPROVED' : 'DECLINED';
  $('#decision-orb-sub').textContent = result.duplicate ? 'safe idempotent replay' : (approved ? 'state committed' : result.reasonCode);
  $('#path-rules').className = `path-node ${approved ? 'passed' : 'blocked'}`;
  $('#path-rules-copy').textContent = approved ? 'all checks passed' : result.reasonCode;
  $('#path-account').className = `path-node ${approved ? 'passed' : 'blocked'}`;
  $('#path-account-copy').textContent = approved ? 'limit updated' : 'no change';
  $('#path-audit').className = 'path-node passed';
  const pathNodes = document.querySelectorAll('.decision-path .path-node');
  pathNodes.forEach((node, index) => node.style.setProperty('--path-index', index));
}

async function runRequest() {
  if (!state.seeded || state.isAuthorizing) {
    showNotice('Load the demo first to create Harper account and policy state.', true);
    return;
  }
  const payload = paymentPayload();
  if (!payload.idempotencyKey) {
    showNotice('Add an idempotency key so retries can be recognized.', true);
    return;
  }
  if (!isValidAmountCents(payload.amountCents)) {
    $('#amount-input').focus();
    showNotice(invalidAmountMessage(), true);
    return;
  }
  state.isAuthorizing = true;
  runFlowAnimation();
  render();
  try {
    const result = await api('/payments/authorize', { method: 'POST', body: JSON.stringify(payload) });
    state.lastResult = result;
    await loadState();
    state.isAuthorizing = false;
    render();
    const visual = $('#decision-visual');
    visual?.classList.add('is-resolving');
    window.setTimeout(() => visual?.classList.remove('is-resolving'), 1200);
    pulse('#state-panel');
    pulse('#result-panel');
    pulse('#audit');
    pulse('.metric-accent');
    const notice = result.reasonCode === 'INVALID_AMOUNT'
      ? 'Invalid amount — enter a value greater than $0.00. No account balance was changed.'
      : result.allowed
        ? (result.duplicate ? 'Replay returned the original approval without a second charge.' : 'Payment approved and account exposure updated in Harper.')
        : `Payment declined — ${result.reason}`;
    showNotice(notice, !result.allowed);
  } catch (error) {
    state.isAuthorizing = false;
    render();
    showNotice(error.message, true);
  }
}

async function seedDemo() {
  try {
    await api('/api/demo-seed', { method: 'POST', body: JSON.stringify({}) });
    state.lastResult = null;
    state.scenario = 'valid';
    document.querySelectorAll('.scenario-button').forEach((button) => button.classList.toggle('selected', button.dataset.scenario === 'valid'));
    await setScenario('valid');
    await loadState();
    pulse('#state-panel');
    showNotice('Demo loaded: Harper account, card, policy, and empty audit state are ready.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function changeCardStatus(status) {
  try {
    await api('/payments/card-status', { method: 'POST', body: JSON.stringify({ cardId: $('#card-input').value, status }) });
    await loadState();
    pulse('#state-panel');
    showNotice(`Card state changed to ${status.toUpperCase()} in Harper. Run the same payment again.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function changePolicy(action) {
  try {
    await api('/payments/policy-action', { method: 'POST', body: JSON.stringify({ action }) });
    await loadState();
    pulse('#state-panel');
    showNotice(action === 'lower-limit' ? 'Harper policy lowered the transaction limit to $250.' : 'Harper policy restored the transaction limit to $1,000.');
  } catch (error) {
    showNotice(error.message, true);
  }
}

document.querySelectorAll('.scenario-button').forEach((button) => button.addEventListener('click', () => setScenario(button.dataset.scenario)));
$('#seed-demo').addEventListener('click', seedDemo);
$('#reset-button').addEventListener('click', seedDemo);
$('#request-button').addEventListener('click', runRequest);
$('#freeze-card').addEventListener('click', () => changeCardStatus('frozen'));
$('#unfreeze-card').addEventListener('click', () => changeCardStatus('active'));
$('#lower-limit').addEventListener('click', () => changePolicy('lower-limit'));
$('#raise-limit').addEventListener('click', () => changePolicy('raise-limit'));
$('#decisions').addEventListener('click', (event) => {
  const card = event.target.closest('.decision-card');
  if (!card) return;
  state.expandedDecisionId = state.expandedDecisionId === card.dataset.decisionId ? null : card.dataset.decisionId;
  renderDecisions(state.current?.decisions || []);
});
$('#decisions').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const card = event.target.closest('.decision-card');
  if (!card) return;
  event.preventDefault();
  state.expandedDecisionId = state.expandedDecisionId === card.dataset.decisionId ? null : card.dataset.decisionId;
  renderDecisions(state.current?.decisions || []);
});
['#account-input', '#amount-input', '#currency-input', '#merchant-input', '#category-input', '#idempotency-input'].forEach((selector) => $(selector).addEventListener('input', () => {
  renderRequestPreview();
  if (state.current) renderRequestImpact(state.current);
}));
['#currency-input', '#category-input'].forEach((selector) => $(selector).addEventListener('change', () => {
  renderRequestPreview();
  if (state.current) renderRequestImpact(state.current);
}));

loadState().catch(() => showNotice('Load the demo data to connect this Harper component.', true));
window.setInterval(() => {
  if (state.seeded && !document.hidden) loadState().catch(() => {});
}, 5000);

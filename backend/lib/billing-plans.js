export const DEFAULT_CURRENCY = 'NZD';
export const DEFAULT_GST_BASIS_POINTS = 1500;

export const PAYMENT_FEE_MODES = [
  'merchant_absorbs',
  'pass_to_customer_at_cost',
];

export const TRENNEN_BILLING_PLANS = [
  {
    id: 'community',
    name: 'Free Pilot',
    monthly_price_cents: 0,
    currency: DEFAULT_CURRENCY,
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: null,
    quote_overage_price_cents: null,
    trial_days: 0,
    setup_fee_cents: 0,
    checkout_enabled: true,
    checkout_fee_basis_points: 500,
    checkout_fee_monthly_cap_cents: 0,
    allow_overages: true,
    branding_required: false,
    active: true,
    purpose: 'Free production pilot with Stripe Connect checkout and a 5% Trennen platform fee included in customer totals.',
    contract_type: 'free',
  },
];

export function normalisePlanId(planId) {
  const value = String(planId || '').trim().toLowerCase();
  if (value === 'suspended') return 'suspended';
  return 'community';
}

export function defaultPlanById(planId) {
  const id = normalisePlanId(planId);
  return TRENNEN_BILLING_PLANS.find(plan => plan.id === id) || TRENNEN_BILLING_PLANS[0];
}

function boolInt(value) {
  return value ? 1 : 0;
}

export function planRowFromDefault(plan = defaultPlanById('community')) {
  return {
    id: plan.id,
    name: plan.name,
    monthly_price_cents: plan.monthly_price_cents,
    currency: plan.currency || DEFAULT_CURRENCY,
    gst_rate_basis_points: plan.gst_rate_basis_points ?? DEFAULT_GST_BASIS_POINTS,
    quote_allowance: plan.quote_allowance,
    quote_overage_price_cents: plan.quote_overage_price_cents,
    trial_days: plan.trial_days || 0,
    setup_fee_cents: plan.setup_fee_cents || 0,
    checkout_enabled: boolInt(plan.checkout_enabled),
    checkout_fee_basis_points: plan.checkout_fee_basis_points || 0,
    checkout_fee_monthly_cap_cents: plan.checkout_fee_monthly_cap_cents || 0,
    allow_overages: boolInt(plan.allow_overages),
    branding_required: boolInt(plan.branding_required),
    active: plan.active === false ? 0 : 1,
  };
}

export function publicPlan(plan = {}) {
  return {
    id: plan.id,
    name: plan.name,
    monthly_price_cents: plan.monthly_price_cents,
    currency: plan.currency || DEFAULT_CURRENCY,
    gst_rate_basis_points: plan.gst_rate_basis_points ?? DEFAULT_GST_BASIS_POINTS,
    quote_allowance: plan.quote_allowance,
    quote_overage_price_cents: plan.quote_overage_price_cents,
    trial_days: plan.trial_days || 0,
    setup_fee_cents: plan.setup_fee_cents || 0,
    checkout_enabled: !!plan.checkout_enabled,
    checkout_fee_basis_points: plan.checkout_fee_basis_points || 0,
    checkout_fee_monthly_cap_cents: plan.checkout_fee_monthly_cap_cents || 0,
    allow_overages: !!plan.allow_overages,
    branding_required: !!plan.branding_required,
    active: plan.active !== false && plan.active !== 0,
  };
}

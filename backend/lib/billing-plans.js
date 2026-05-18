export const DEFAULT_GST_BASIS_POINTS = 1500;

export const PAYMENT_FEE_MODES = [
  'merchant_absorbs',
  'pass_to_customer_at_cost',
  'bank_transfer_only',
];

export const TRENNEN_BILLING_PLANS = [
  {
    id: 'community',
    name: 'Community',
    monthly_price_cents: 0,
    currency: 'NZD',
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: 3,
    quote_overage_price_cents: null,
    trial_days: 0,
    setup_fee_cents: 0,
    checkout_enabled: false,
    checkout_fee_basis_points: 0,
    checkout_fee_monthly_cap_cents: 0,
    allow_overages: false,
    branding_required: true,
    active: true,
  },
  {
    id: 'starter',
    name: 'Starter',
    monthly_price_cents: 2900,
    currency: 'NZD',
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: 25,
    quote_overage_price_cents: 100,
    trial_days: 14,
    setup_fee_cents: 0,
    checkout_enabled: true,
    checkout_fee_basis_points: 100,
    checkout_fee_monthly_cap_cents: 2900,
    allow_overages: true,
    branding_required: false,
    active: true,
  },
  {
    id: 'growth',
    name: 'Growth',
    monthly_price_cents: 7900,
    currency: 'NZD',
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: 250,
    quote_overage_price_cents: 50,
    trial_days: 14,
    setup_fee_cents: 0,
    checkout_enabled: true,
    checkout_fee_basis_points: 100,
    checkout_fee_monthly_cap_cents: 7900,
    allow_overages: true,
    branding_required: false,
    active: true,
  },
  {
    id: 'scale',
    name: 'Scale',
    monthly_price_cents: 14900,
    currency: 'NZD',
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: 5000,
    quote_overage_price_cents: 5,
    trial_days: 14,
    setup_fee_cents: 0,
    checkout_enabled: true,
    checkout_fee_basis_points: 0,
    checkout_fee_monthly_cap_cents: 0,
    allow_overages: true,
    branding_required: false,
    active: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly_price_cents: null,
    currency: 'NZD',
    gst_rate_basis_points: DEFAULT_GST_BASIS_POINTS,
    quote_allowance: null,
    quote_overage_price_cents: null,
    trial_days: 0,
    setup_fee_cents: 0,
    checkout_enabled: true,
    checkout_fee_basis_points: 0,
    checkout_fee_monthly_cap_cents: 0,
    allow_overages: true,
    branding_required: false,
    active: false,
  },
];

export function normalisePlanId(planId) {
  const value = String(planId || '').trim().toLowerCase();
  if (value === 'pro') return 'starter';
  if (TRENNEN_BILLING_PLANS.some(plan => plan.id === value)) return value;
  return 'starter';
}

export function defaultPlanById(planId) {
  const id = normalisePlanId(planId);
  return TRENNEN_BILLING_PLANS.find(plan => plan.id === id) || TRENNEN_BILLING_PLANS[1];
}

function boolInt(value) {
  return value ? 1 : 0;
}

export function planRowFromDefault(plan = defaultPlanById('starter')) {
  return {
    id: plan.id,
    name: plan.name,
    monthly_price_cents: plan.monthly_price_cents,
    currency: plan.currency || 'NZD',
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
    currency: plan.currency || 'NZD',
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

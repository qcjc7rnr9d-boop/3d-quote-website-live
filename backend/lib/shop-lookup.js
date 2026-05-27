export const DEMO_SHOP_SLUG = 'trennen';
export const LEGACY_DEMO_SHOP_SLUG = 'mahi3d';

export function normaliseShopSlug(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (value === LEGACY_DEMO_SHOP_SLUG) return DEMO_SHOP_SLUG;
  return value;
}

export function getShopBySlug(db, slug, { includeSuspended = false } = {}) {
  const canonicalSlug = normaliseShopSlug(slug);
  if (!canonicalSlug) return null;
  const sql = includeSuspended
    ? 'SELECT * FROM shops WHERE slug = ?'
    : "SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'";
  const canonical = db.prepare(sql).get(canonicalSlug);
  if (canonical) return canonical;
  if (canonicalSlug === DEMO_SHOP_SLUG) {
    const legacy = db.prepare(sql).get(LEGACY_DEMO_SHOP_SLUG);
    return legacy ? { ...legacy, slug: DEMO_SHOP_SLUG } : null;
  }
  return null;
}

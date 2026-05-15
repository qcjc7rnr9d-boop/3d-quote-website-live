(function attachMaterialFilters(root) {
  function keyFor(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rating(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n > 5 ? n : n * 20));
  }

  function textFor(material) {
    return [
      material?.name,
      material?.category,
      ...(Array.isArray(material?.tags) ? material.tags : []),
      ...(Array.isArray(material?.bestFor) ? material.bestFor : []),
      ...(Array.isArray(material?.best_for) ? material.best_for : []),
    ].map(keyFor).join(' ');
  }

  function materialMatchesFilter(material, filter) {
    if (!material) return false;
    if (!filter || filter === 'all') return true;
    if (filter === 'recommended') return !!material.recommended;
    if (!filter.startsWith('tag:')) return true;
    const target = keyFor(filter.slice(4));
    const values = [material.category, ...(Array.isArray(material.tags) ? material.tags : [])].map(keyFor);
    return values.includes(target);
  }

  function relevanceScore(material, filter) {
    if (!material) return 0;
    const target = filter && filter.startsWith('tag:') ? keyFor(filter.slice(4)) : keyFor(filter);
    const ratings = material.ratings || {};
    const text = textFor(material);
    const name = keyFor(material.name);

    if (target === 'outdoor') {
      let score = rating(ratings.outdoorUse);
      if (name === 'asa') score += 70;
      else if (/\basa\b/.test(name)) score += 45;
      if (/\bpvdf\b/.test(name)) score += 25;
      if (/\bpetg\b|\bpctg\b|\bpp\b|polypropylene|\btpc\b/.test(name)) score += 12;
      if (/\bsls\b|\bpa11\b|\bpa12\b|\bnylon\b/.test(name)) score += 4;
      return score;
    }

    if (target === 'strong') return rating(ratings.strength);
    if (target === 'flexible') return rating(ratings.flexibility);
    if (target === 'smooth finish' || target === 'smooth') return rating(ratings.detail);
    if (target === 'engineering') {
      return (rating(ratings.strength) * 0.45) + (rating(ratings.heatResistance) * 0.45) + (rating(ratings.outdoorUse) * 0.1);
    }
    if (target === 'low cost') {
      const price = Number(material.minCharge || material.basePrice || material.ratePerCm3 || 0);
      return price > 0 ? 100 - Math.min(100, price * 8) : 0;
    }
    if (target === 'support') return /\bsupport\b|pva|bvoh|hips|breakaway/.test(text) ? 100 : 0;
    if (target === 'aesthetic') return /\baesthetic\b|silk|matte|wood|marble|stone|metal|glow|pvb/.test(text) ? 100 : rating(ratings.detail);

    return 0;
  }

  function sortMaterialsForFilter(materials, filter) {
    const rows = Array.isArray(materials) ? materials : [];
    if (!filter || filter === 'all') return rows;
    return rows
      .map((material, index) => ({ material, index, score: relevanceScore(material, filter) }))
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .map(row => row.material);
  }

  root.TrennenMaterialFilters = {
    keyFor,
    materialMatchesFilter,
    relevanceScore,
    sortMaterialsForFilter,
  };
})(typeof window !== 'undefined' ? window : globalThis);

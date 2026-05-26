import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEW_PACK_PUBLIC_BASE = '/assets/material-placeholders/fdm-review-pack-v1';
const REVIEW_PACK_INDEX = join(
  __dirname,
  '../../assets/material-placeholders/fdm-review-pack-v1/index.json'
);

function loadDefaultImageMap() {
  const index = JSON.parse(readFileSync(REVIEW_PACK_INDEX, 'utf8'));
  const entries = Array.isArray(index.entries) ? index.entries : [];
  return entries.reduce((map, entry) => {
    if (!entry?.key || !entry?.imageUrl || entry.status !== 'approved-review') return map;
    map[entry.key] = {
      image_url: `${REVIEW_PACK_PUBLIC_BASE}/${entry.imageUrl}`,
      image_alt: `Example ${entry.displayName || entry.key} FDM printed part`,
      locked_default_image: true,
    };
    return map;
  }, {});
}

export const DEFAULT_MATERIAL_IMAGES = Object.freeze(loadDefaultImageMap());

export function getDefaultMaterialImage(libraryKey) {
  if (!libraryKey) return null;
  return DEFAULT_MATERIAL_IMAGES[String(libraryKey)] || null;
}

export function withDefaultMaterialImage(material) {
  if (!material) return material;
  const defaultImage = getDefaultMaterialImage(material.key || material.libraryKey);
  if (!defaultImage) return material;
  return {
    ...material,
    image_url: material.image_url || defaultImage.image_url,
    image_alt: material.image_alt || defaultImage.image_alt,
    locked_default_image: defaultImage.locked_default_image,
    default_image_url: defaultImage.image_url,
    default_image_alt: defaultImage.image_alt,
  };
}

import { MATERIAL_LIBRARY } from '../lib/material-library.js';
import {
  getDefaultMaterialImage,
  resolveDefaultMaterialImageFields,
  withDefaultMaterialImage,
} from '../lib/material-default-images.js';

let failures = 0;

function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`✕ ${message}`);
    return;
  }
  console.log(`✓ ${message}`);
}

const fdmMaterials = MATERIAL_LIBRARY.filter(material => material.category === 'FDM');

for (const material of fdmMaterials) {
  const defaultImage = getDefaultMaterialImage(material.key);
  expect(Boolean(defaultImage?.image_url), `${material.key} has a default image URL`);
  expect(defaultImage?.locked_default_image === true, `${material.key} is marked as a locked default image`);
}

const plaDefault = getDefaultMaterialImage('pla');
const suggestedPla = withDefaultMaterialImage({ key: 'pla', displayName: 'PLA' });
expect(suggestedPla.image_url === plaDefault.image_url, 'library suggestions expose default image URL');
expect(suggestedPla.image_alt === plaDefault.image_alt, 'library suggestions expose default image alt');
expect(suggestedPla.locked_default_image === true, 'library suggestions expose locked default flag');

const blankCreate = resolveDefaultMaterialImageFields({ name: 'PLA', image_url: '', image_alt: '', properties: {} });
expect(blankCreate.image_url === plaDefault.image_url, 'new matching material with blank image receives default image');
expect(blankCreate.image_alt === plaDefault.image_alt, 'new matching material with blank image receives default alt');
expect(blankCreate.locked_default_image === true, 'new matching material reports locked default image use');

const propertyCreate = resolveDefaultMaterialImageFields({
  name: 'Custom house filament',
  image_url: null,
  image_alt: null,
  properties: { libraryKey: 'petg' },
});
expect(propertyCreate.image_url === getDefaultMaterialImage('petg').image_url, 'libraryKey match receives default image');

const customCreate = resolveDefaultMaterialImageFields({
  name: 'PLA',
  image_url: '/uploads/material-assets/1/custom.png',
  image_alt: 'Custom PLA example',
  properties: {},
});
expect(customCreate.image_url === '/uploads/material-assets/1/custom.png', 'custom image URL is preserved on create');
expect(customCreate.image_alt === 'Custom PLA example', 'custom image alt is preserved on create');
expect(customCreate.locked_default_image === false, 'custom image is not reported as locked default');

if (failures) process.exit(1);
console.log('Material default image smoke checks passed.');

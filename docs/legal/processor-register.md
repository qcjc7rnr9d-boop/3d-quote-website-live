# Processor Register

Source of truth: `backend/lib/compliance/processors.json`.

The register currently tracks Stripe, transactional email delivery, AWS Lightsail/server storage, optional Shopify, and optional shipping-provider integrations. Each entry records purpose, data categories, active/optional status, overseas-processing status, and operational notes.

Review this register before enabling any new provider, analytics script, object-storage region, support desk, accounting export, or shipping integration. Privacy Act principle 12 requires care when personal information is disclosed outside New Zealand or to overseas organisations: https://www.privacy.org.nz/privacy-principles/12/

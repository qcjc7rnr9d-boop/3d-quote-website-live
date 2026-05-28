# Shop Provisioning Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate a safe per-shop quote-flow install package and email it to the shop owner when a new store is created.

**Architecture:** Do not create a separate backend or code copy per shop. Provision each shop through a unique slug, settings row, approved iframe origins, generated install snippets, and central platform reporting. The shared Trennen backend remains the authority for pricing, checkout, orders, Stripe Connect, platform fees, audit logs, and sales visibility.

**Tech Stack:** Express, SQLite, Nodemailer/Resend mailer abstraction, platform admin session auth, existing embed widget, smoke-test scripts.

---

### Task 1: Add Shop Install Package Builder

**Files:**
- Create: `backend/lib/shop-provisioning.js`
- Test: `backend/scripts/shop-provisioning-smoke.js`

- [ ] **Step 1: Write the failing test**

Create `backend/scripts/shop-provisioning-smoke.js` and import `buildShopInstallPackage`, `normaliseShopSlug`, `renderShopInstallEmail`, and `saveShopEmbedOrigins` from `../lib/shop-provisioning.js`. Assert that the helper creates a script snippet, iframe fallback, admin links, approved origins, and no secrets.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
node scripts/shop-provisioning-smoke.js
```

Expected: fail with `ERR_MODULE_NOT_FOUND` for `backend/lib/shop-provisioning.js`.

- [ ] **Step 3: Implement helper**

Create `backend/lib/shop-provisioning.js` with:

- `normaliseShopSlug(value)`
- `normaliseProvisioningOrigins(input)`
- `saveShopEmbedOrigins(db, shopId, originsInput)`
- `readShopEmbedOrigins(db, shopId)`
- `buildShopInstallPackage(shop, options)`
- `renderShopInstallEmail(shop, install)`
- `sendShopInstallEmail(shop, install)`

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend
npm run shop:provisioning-smoke
```

Expected: `Shop provisioning smoke checks passed.`

### Task 2: Wire Platform Store Creation

**Files:**
- Modify: `backend/routes/platform.js`
- Modify: `platform/admin.html`
- Test: `backend/scripts/shop-provisioning-smoke.js`

- [ ] **Step 1: Add route expectations to the smoke**

Assert `routes/platform.js` imports `buildShopInstallPackage`, calls `sendShopInstallEmail`, returns `install_email_sent`, and exposes `POST /api/platform/shops/:id/install-email`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm run shop:provisioning-smoke
```

Expected: fail because platform shop creation has no install package or resend endpoint.

- [ ] **Step 3: Implement platform integration**

Update `POST /api/platform/shops` to:

- normalise slug safely
- accept `website_origin` or `embed_allowed_origins`
- save approved origins
- build an install package
- send the install email unless `send_install_email === false`
- return `install`, `install_email_sent`, and `install_email`

Add `POST /api/platform/shops/:id/install-email` to resend the install email from the saved shop settings.

- [ ] **Step 4: Update Platform Admin UI**

Add:

- `newWebsiteOrigin`
- `newSendInstallEmail`
- `installCode`
- `copyInstallCodeBtn`
- install email status copy

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
cd backend
npm run shop:provisioning-smoke
```

Expected: `Shop provisioning smoke checks passed.`

### Task 3: Keep Embed Routing And Legacy Alias Safe

**Files:**
- Modify: `backend/server.js`
- Modify: `backend/scripts/embed-sizing-smoke.js`

- [ ] **Step 1: Add failing alias coverage**

In `backend/scripts/embed-sizing-smoke.js`, request `/embed/quote?shop=mahi3d` when the canonical Trennen demo shop exists and assert status `200`.

- [ ] **Step 2: Run test to verify it fails if direct slug lookup is used**

Run:

```bash
cd backend
npm run embed:smoke
```

Expected before implementation: legacy alias can fail if `/embed/quote` queries `shops.slug` directly.

- [ ] **Step 3: Implement canonical shop lookup**

Update `backend/server.js` to use `getShopBySlug(db, slug)` for embed frame-ancestor lookup and `/embed/quote`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend
npm run embed:smoke
npm run demo:alias-smoke
```

Expected: both pass.

### Task 4: Document Shop Onboarding

**Files:**
- Create: `docs/deployment/shop-provisioning-onboarding.md`

- [ ] **Step 1: Add install instructions**

Document the recommended script:

```html
<script src="https://app.trennen.co.nz/embed/v1/widget.js" data-shop="SHOP_SLUG"></script>
```

Document the iframe fallback:

```html
<iframe src="https://app.trennen.co.nz/index.html?shop=SHOP_SLUG&embed=1" style="width:100%;border:0;min-height:760px;"></iframe>
```

- [ ] **Step 2: Add Trennen and legacy Mahi3D snippets**

Include canonical `data-shop="trennen"` and legacy `data-shop="mahi3d"` examples.

- [ ] **Step 3: Add security checklist**

Document approved origins, Stripe Connect, real shop content, test checkout, and platform visibility.

### Task 5: Verification

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add smoke script**

Add:

```json
"shop:provisioning-smoke": "node scripts/shop-provisioning-smoke.js"
```

Include `npm run shop:provisioning-smoke` in `qa:full`.

- [ ] **Step 2: Run focused checks**

Run:

```bash
cd backend
npm run check
npm run shop:provisioning-smoke
npm run embed:smoke
npm run demo:alias-smoke
npm run saas-launch:smoke
```

Expected: all pass.

- [ ] **Step 3: Run platform reporting smoke against a matching local server**

Run:

```bash
cd backend
PORT=3100 NODE_ENV=development BASE_URL=http://127.0.0.1:3100 SESSION_SECRET=dev-secret-change-me JWT_SECRET=shop-provisioning-jwt PLATFORM_CONFIG_ENCRYPTION_KEY=shop-provisioning-key npm start
SMOKE_BASE_URL=http://127.0.0.1:3100 SESSION_SECRET=dev-secret-change-me npm run platform:smoke
```

Expected: `Platform reporting smoke checks passed.`

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

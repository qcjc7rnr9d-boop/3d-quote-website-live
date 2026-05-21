import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectVisible(page, selector, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  assert(await el.isVisible(), `${label} should be visible`);
  return el;
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 1, `${label} should not horizontally overflow, saw ${overflow}px`);
}

function expectedHeroInnerInset(viewportWidth) {
  return Math.round(Math.min(64, Math.max(32, viewportWidth * 0.038)));
}

function assertInsideHeroFrame(metrics, label) {
  const innerInset = expectedHeroInnerInset(metrics.viewportWidth);
  assert(metrics.h1Left >= metrics.heroLeft + innerInset - 1, `${label} headline should have at least ${innerInset}px breathing room inside the hero frame`);
  assert(metrics.subtitleLeft >= metrics.heroLeft + innerInset - 1, `${label} subtitle should have at least ${innerInset}px breathing room inside the hero frame`);
  assert(metrics.ctaLeft >= metrics.heroLeft + innerInset - 1, `${label} CTA row should have at least ${innerInset}px breathing room inside the hero frame`);
  assert(metrics.stripLeft >= metrics.heroLeft + innerInset - 1, `${label} proof strip should have at least ${innerInset}px breathing room inside the hero frame`);
}

async function assertHeroNarrowViewportComfort(page, label) {
  const metrics = await page.evaluate(() => {
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const subtitle = document.querySelector('.hero-subtitle')?.getBoundingClientRect();
    const cta = document.querySelector('.hero-actions a[href="onboarding.html"]')?.getBoundingClientRect();
    const strip = document.querySelector('.studio-strip')?.getBoundingClientRect();
    const hero = document.querySelector('.hero')?.getBoundingClientRect();
    const stripColumns = getComputedStyle(document.querySelector('.studio-strip')).gridTemplateColumns
      .split(' ')
      .filter(Boolean);
    return {
      h1Left: h1?.left || 0,
      h1Right: h1?.right || 0,
      h1Height: h1?.height || 0,
      subtitleLeft: subtitle?.left || 0,
      ctaLeft: cta?.left || 0,
      ctaRight: cta?.right || 0,
      ctaBottom: cta?.bottom || 0,
      stripColumns: stripColumns.length,
      stripLeft: strip?.left || 0,
      stripRight: strip?.right || 0,
      heroLeft: hero?.left || 0,
      heroRight: hero?.right || 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const minGutter = Math.round(Math.min(96, Math.max(24, metrics.viewportWidth * 0.05)));
  assert(metrics.heroLeft >= minGutter - 1, `${label} hero stage should respect the safe left gutter`);
  assert(metrics.heroRight <= metrics.viewportWidth - minGutter + 1, `${label} hero stage should respect the safe right gutter`);
  assert(metrics.h1Left >= minGutter - 1, `${label} headline should not press against the left edge`);
  assert(metrics.h1Right <= metrics.viewportWidth - minGutter + 1, `${label} headline should not clip against the right edge`);
  assert(metrics.ctaLeft >= minGutter - 1 && metrics.ctaRight <= metrics.viewportWidth - minGutter + 1, `${label} CTA should respect the safe gutter`);
  assert(metrics.ctaBottom > 0 && metrics.ctaBottom <= metrics.viewportHeight, `${label} should keep Start free above the fold`);
  assert(metrics.h1Height <= metrics.viewportHeight * 0.38, `${label} headline should not dominate the first screen`);
  if (metrics.viewportWidth <= 700) {
    assert(metrics.stripColumns === 1, `${label} proof strip should stack into one readable column, got ${metrics.stripColumns}`);
  }
  assert(metrics.stripLeft >= minGutter - 1 && metrics.stripRight <= metrics.viewportWidth - minGutter + 1, `${label} proof strip should respect the safe gutter`);
  assertInsideHeroFrame(metrics, label);
}

async function assertHeroPartialWindowLayout(page, label) {
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.hero')?.getBoundingClientRect();
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const subtitle = document.querySelector('.hero-subtitle')?.getBoundingClientRect();
    const cta = document.querySelector('.hero-actions a[href="onboarding.html"]')?.getBoundingClientRect();
    const strip = document.querySelector('.studio-strip')?.getBoundingClientRect();
    const desk = document.querySelector('.operator-desk')?.getBoundingClientRect();
    const heroColumns = getComputedStyle(document.querySelector('.hero')).gridTemplateColumns
      .split(' ')
      .filter(Boolean);
    return {
      heroColumns: heroColumns.length,
      heroLeft: hero?.left || 0,
      heroRight: hero?.right || 0,
      h1Left: h1?.left || 0,
      h1Right: h1?.right || 0,
      h1Height: h1?.height || 0,
      subtitleLeft: subtitle?.left || 0,
      h1FontSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) || 0,
      ctaLeft: cta?.left || 0,
      ctaBottom: cta?.bottom || 0,
      stripLeft: strip?.left || 0,
      deskTop: desk?.top || 9999,
      deskWidth: desk?.width || 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const safeGutter = 36;
  assert(metrics.heroColumns === 1, `${label} should use a single-column partial-window hero, got ${metrics.heroColumns} columns`);
  assert(metrics.heroLeft >= safeGutter - 1, `${label} hero should have at least ${safeGutter}px left gutter, got ${metrics.heroLeft}px`);
  assert(metrics.viewportWidth - metrics.heroRight >= safeGutter - 1, `${label} hero should have a balanced right gutter`);
  assert(metrics.h1Left >= safeGutter - 1, `${label} headline should not sit close to the left edge`);
  assert(metrics.h1Right <= metrics.viewportWidth - safeGutter + 1, `${label} headline should stay inside the safe gutter`);
  assert(metrics.h1FontSize <= 54, `${label} headline font should calm down for partial-window Safari, got ${metrics.h1FontSize}px`);
  assert(metrics.h1Height <= metrics.viewportHeight * 0.34, `${label} headline should not dominate the partial-window viewport`);
  assert(metrics.ctaLeft >= safeGutter - 1, `${label} Start free CTA should align with the safe gutter`);
  assert(metrics.ctaBottom > 0 && metrics.ctaBottom <= metrics.viewportHeight, `${label} should keep Start free above the fold`);
  assert(metrics.deskTop < metrics.viewportHeight, `${label} should keep product art visible in the first viewport`);
  assert(metrics.deskWidth > 0, `${label} should render product art with measurable width`);
  assertInsideHeroFrame(metrics, label);
}

async function assertHeroCompactDesktopComfort(page, label) {
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.hero')?.getBoundingClientRect();
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const subtitle = document.querySelector('.hero-subtitle')?.getBoundingClientRect();
    const cta = document.querySelector('.hero-actions a[href="onboarding.html"]')?.getBoundingClientRect();
    const strip = document.querySelector('.studio-strip')?.getBoundingClientRect();
    const desk = document.querySelector('.operator-desk')?.getBoundingClientRect();
    return {
      heroLeft: hero?.left || 0,
      heroRight: hero?.right || 0,
      h1Left: h1?.left || 0,
      h1Right: h1?.right || 0,
      subtitleLeft: subtitle?.left || 0,
      h1FontSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize) || 0,
      ctaLeft: cta?.left || 0,
      ctaBottom: cta?.bottom || 0,
      stripLeft: strip?.left || 0,
      deskTop: desk?.top || 9999,
      deskWidth: desk?.width || 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const safeGutter = 40;
  assert(metrics.heroLeft >= safeGutter - 1, `${label} hero should have at least ${safeGutter}px left gutter, got ${metrics.heroLeft}px`);
  assert(metrics.viewportWidth - metrics.heroRight >= safeGutter - 1, `${label} hero should have a balanced right gutter`);
  assert(metrics.h1Left >= safeGutter - 1, `${label} headline should not sit close to the left edge`);
  assert(metrics.h1Right <= metrics.viewportWidth - safeGutter + 1, `${label} headline should stay inside the safe gutter`);
  assert(metrics.h1FontSize <= 58, `${label} headline should be calmer than the wide desktop hero, got ${metrics.h1FontSize}px`);
  assert(metrics.ctaBottom > 0 && metrics.ctaBottom <= metrics.viewportHeight, `${label} should keep Start free above the fold`);
  assert(metrics.deskTop < metrics.viewportHeight, `${label} should keep product art visible in the first viewport`);
  assert(metrics.deskWidth > 0, `${label} should render product art with measurable width`);
  assertInsideHeroFrame(metrics, label);
}

async function assertHeroWideDesktopBalance(page, label) {
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.hero')?.getBoundingClientRect();
    const h1 = document.querySelector('h1')?.getBoundingClientRect();
    const subtitle = document.querySelector('.hero-subtitle')?.getBoundingClientRect();
    const eyebrow = document.querySelector('.hero .eyebrow')?.getBoundingClientRect();
    const cta = document.querySelector('.hero-actions a[href="onboarding.html"]')?.getBoundingClientRect();
    const strip = document.querySelector('.studio-strip')?.getBoundingClientRect();
    const desk = document.querySelector('.operator-desk')?.getBoundingClientRect();
    const quote = document.querySelector('.slab-quote')?.getBoundingClientRect();
    const admin = document.querySelector('.slab-admin')?.getBoundingClientRect();
    const feeCard = document.querySelector('.desk-card-fees')?.getBoundingClientRect();
    return {
      heroTop: hero?.top || 0,
      heroLeft: hero?.left || 0,
      heroRight: hero?.right || 0,
      h1Top: h1?.top || 9999,
      h1Left: h1?.left || 0,
      subtitleLeft: subtitle?.left || 0,
      eyebrowTop: eyebrow?.top || 9999,
      ctaLeft: cta?.left || 0,
      ctaBottom: cta?.bottom || 0,
      stripLeft: strip?.left || 0,
      deskTop: desk?.top || 9999,
      deskRight: desk?.right || 0,
      deskWidth: desk?.width || 0,
      quoteRight: quote?.right || 0,
      adminRight: admin?.right || 0,
      feeCardRight: feeCard?.right || 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  const safeGutter = metrics.viewportWidth >= 2400 ? 72 : 56;
  assert(metrics.heroLeft >= safeGutter - 1, `${label} hero should have an intentional wide-screen left gutter`);
  assert(metrics.viewportWidth - metrics.heroRight >= safeGutter - 1, `${label} hero should have an intentional wide-screen right gutter`);
  assert(metrics.h1Left >= metrics.heroLeft - 1, `${label} headline should sit inside the hero stage`);
  assert(metrics.eyebrowTop <= metrics.viewportHeight * 0.11, `${label} should not leave a large empty band above the hero copy`);
  assert(metrics.h1Top <= metrics.viewportHeight * 0.15, `${label} headline should begin near the first visual third`);
  assert(metrics.ctaBottom > 0 && metrics.ctaBottom <= metrics.viewportHeight, `${label} should keep Start free above the fold`);
  assert(metrics.deskTop < metrics.viewportHeight * 0.2, `${label} product art should start high enough to balance the copy`);
  assert(metrics.deskWidth > 0, `${label} should render product art with measurable width`);
  assert(metrics.quoteRight <= metrics.deskRight + 1, `${label} quote slab should not clip past the product stage`);
  assert(metrics.adminRight <= metrics.deskRight + 1, `${label} admin slab should not clip past the product stage`);
  assert(metrics.feeCardRight <= metrics.deskRight + 1, `${label} checkout card should not clip past the product stage`);
  assertInsideHeroFrame(metrics, label);
}

async function assertImageReady(page, selector, label) {
  const image = await expectVisible(page, selector, label);
  const ready = await image.evaluate(img => img.complete && img.naturalWidth >= 900 && img.naturalHeight >= 600);
  assert(ready, `${label} should load with useful dimensions`);
}

async function assertHomepageLayoutRhythm(page, label) {
  const metrics = await page.evaluate(() => {
    const rectFor = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height,
      };
    };
    const styleColumns = selector => getComputedStyle(document.querySelector(selector)).gridTemplateColumns
      .split(' ')
      .filter(Boolean)
      .length;
    const storyPin = document.querySelector('.story-pin');
    const sectionHeading = document.querySelector('.showcase .section-heading')?.getBoundingClientRect();
    const demoPanel = document.querySelector('.showcase .demo-panel')?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hero: rectFor('.hero'),
      intro: rectFor('.studio-intro'),
      problem: rectFor('.problem'),
      story: rectFor('.story'),
      showcase: rectFor('.showcase'),
      pricing: rectFor('#pricing'),
      demo: rectFor('#demo'),
      faq: rectFor('#faq'),
      footer: rectFor('.site-footer'),
      storyPinPosition: storyPin ? getComputedStyle(storyPin).position : '',
      pricingColumns: styleColumns('.pricing-grid'),
      demoColumns: styleColumns('.demo-layout'),
      faqItems: document.querySelectorAll('.faq-item').length,
      faqAnswers: document.querySelectorAll('.faq-answer').length,
      nestedFaqAnswers: document.querySelectorAll('.faq-answer .faq-answer').length,
      showcaseHeadingHeight: sectionHeading?.height || 0,
      showcasePanelGap: demoPanel && sectionHeading ? demoPanel.top - sectionHeading.bottom : 0,
    };
  });

  assert(metrics.nestedFaqAnswers === 0, `${label} should not have nested FAQ answer wrappers`);
  assert(metrics.faqItems === 7 && metrics.faqAnswers === 7, `${label} should render one FAQ answer per question`);
  assert(metrics.showcasePanelGap >= 28, `${label} showcase heading should not collide with the product demo panel`);

  if (metrics.viewportWidth >= 1081) {
    assert(metrics.hero.height <= Math.min(880, metrics.viewportHeight * 0.92), `${label} hero should not leave a huge empty first-screen poster, saw ${Math.round(metrics.hero.height)}px`);
    assert(metrics.story.height <= metrics.viewportHeight * 2.85, `${label} workflow story should be shorter and less empty, saw ${Math.round(metrics.story.height)}px`);
    assert(metrics.pricingColumns >= 2, `${label} pricing should scan in multiple columns on desktop/laptop`);
    assert(metrics.demoColumns >= 2, `${label} demo form should use a balanced two-column layout on desktop/laptop`);
  } else if (metrics.viewportWidth >= 861) {
    assert(metrics.hero.height <= Math.min(1060, metrics.viewportHeight * 1.22), `${label} partial-window hero should not turn into an oversized stacked poster, saw ${Math.round(metrics.hero.height)}px`);
    assert(metrics.story.height <= metrics.viewportHeight * 2.85, `${label} partial-window workflow should be shorter and less empty, saw ${Math.round(metrics.story.height)}px`);
    assert(metrics.pricingColumns === 2, `${label} pricing should stay two columns in partial-window layouts`);
  } else {
    const mobileHeroLimit = metrics.viewportWidth <= 520 ? metrics.viewportHeight * 1.8 : metrics.viewportHeight * 1.35;
    assert(metrics.hero.height <= mobileHeroLimit, `${label} mobile/tablet hero should not feel oversized, saw ${Math.round(metrics.hero.height)}px`);
    assert(metrics.intro.height <= 650, `${label} studio intro panels should be tighter on stacked layouts, saw ${Math.round(metrics.intro.height)}px`);
    assert(metrics.pricingColumns === 1, `${label} pricing should stack into one readable column on narrow layouts`);
    assert(metrics.demoColumns === 1, `${label} demo form should stack on narrow layouts`);
  }
}

async function assertOnboardingLaunchPage(page) {
  const onboardingUrl = new URL('/onboarding.html', base).toString();
  const response = await page.goto(onboardingUrl, { waitUntil: 'domcontentloaded' });
  assert(response && response.status() < 500, `Onboarding page returned ${response?.status() || 'no response'}`);
  await page.waitForLoadState('load');
  await assertNoHorizontalOverflow(page, 'Onboarding page');

  const title = await page.title();
  assert(/Trennen/i.test(title), 'Onboarding title should use Trennen branding');

  const bodyText = await page.locator('body').innerText();
  const html = await page.content();
  assert(!bodyText.includes('mahi3d'), 'Onboarding page should not show legacy mahi3d public branding');
  for (const oldCopy of ['RF DEWI', '5% per transaction', 'YOUR_PLATFORM_CLIENT_ID']) {
    assert(!html.includes(oldCopy), `Onboarding page should remove legacy setup copy: ${oldCopy}`);
  }

  for (const expected of [
    'Start free',
    'Choose your plan',
    'Community',
    'NZ$0',
    'Starter',
    'NZ$29 + GST',
    'Growth',
    'NZ$129 + GST',
    'Scale',
    'NZ$899 + GST',
    'Card checkout: 0.5%',
    'capped at NZ$29/month',
    'capped at NZ$79/month',
    'Bank transfer',
    'Stripe/payment fees are separate',
  ]) {
    assert(bodyText.includes(expected), `Onboarding page should include ${expected}`);
  }

  const homeHref = await page.locator('a[href="index.html"]').first().getAttribute('href');
  assert(homeHref === 'index.html', 'Onboarding page should include a clear link back to Trennen home');
  assert(await page.locator('input[name="website"]').count() === 1, 'Onboarding form should include a honeypot field');

  const desktopCta = await page.locator('a, button').filter({ hasText: /start free/i }).first().boundingBox();
  const viewport = page.viewportSize();
  assert(desktopCta && desktopCta.y + desktopCta.height <= (viewport?.height || 900), 'Desktop onboarding page should keep a Start free action above the fold');

  await page.keyboard.press('Tab');
  const focusVisible = await page.evaluate(() => {
    const active = document.activeElement;
    return !!active && active !== document.body && active.matches('a, button, input, select, textarea');
  });
  assert(focusVisible, 'Onboarding page should expose keyboard-focusable controls');

  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto(onboardingUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await assertNoHorizontalOverflow(page, 'Mobile onboarding page');
  const mobileCta = await page.locator('a, button').filter({ hasText: /start free/i }).first().boundingBox();
  assert(mobileCta && mobileCta.y < 760, 'Mobile onboarding page should keep a Start free action above the fold');

  await page.goto(onboardingUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#shop-setup').scrollIntoViewIfNeeded();
  await page.locator('#onboarding-form button[type="submit"]').click();
  await expectVisible(page, '#onboarding-form [data-field-error="name"]', 'onboarding name validation error');
  await expectVisible(page, '#onboarding-form [data-field-error="email"]', 'onboarding email validation error');

  let onboardingPayload = null;
  await page.route('**/api/sales/demo-request', async route => {
    onboardingPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 456, delivery: { status: 'queued' } }),
    });
  });

  await page.fill('#onboarding-name', 'Morgan Lee');
  await page.fill('#onboarding-email', 'morgan@printworks.example');
  await page.fill('#onboarding-company', 'PrintWorks Studio');
  await page.selectOption('#onboarding-volume', '1-25');
  await page.selectOption('#onboarding-plan', 'Community');
  await page.selectOption('#onboarding-payment', 'Bank transfer first');
  await page.fill('#onboarding-message', 'We want to start with customer quote intake.');
  await page.locator('#onboarding-form button[type="submit"]').click();
  const onboardingSuccess = await expectVisible(page, '#onboarding-success', 'onboarding success state');
  assert(/setup request is in/i.test(await onboardingSuccess.textContent()), 'Onboarding form should show a setup success state');
  assert(onboardingPayload?.name === 'Morgan Lee', 'Onboarding form should submit the contact name');
  assert(onboardingPayload?.email === 'morgan@printworks.example', 'Onboarding form should submit the work email');
  assert(onboardingPayload?.company === 'PrintWorks Studio', 'Onboarding form should submit the company');
  assert(onboardingPayload?.monthlyQuoteVolume === '1-25', 'Onboarding form should submit monthly quote volume');
  assert(/Plan: Community/i.test(onboardingPayload?.message || ''), 'Onboarding form should include selected plan in the submitted message');
  assert(/Payment path: Bank transfer first/i.test(onboardingPayload?.message || ''), 'Onboarding form should include selected payment path in the submitted message');
  await page.unroute('**/api/sales/demo-request');
}

async function assertAdminLoginLaunchPage(page) {
  const adminUrl = new URL('/admin/login.html', base).toString();
  const response = await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  assert(response && response.status() < 500, `Admin login page returned ${response?.status() || 'no response'}`);
  await page.waitForLoadState('load');
  await assertNoHorizontalOverflow(page, 'Admin login page');

  const title = await page.title();
  assert(/Trennen Admin/i.test(title), 'Admin login title should use Trennen admin branding');
  const bodyText = await page.locator('body').innerText();
  for (const expected of [
    /Operator portal/i,
    /Sign in to manage quote intake/i,
    /Back to Trennen home/i,
    /Shop admin access/i,
    /Quotes, orders, pricing, and customer context stay together\./i,
  ]) {
    assert(expected.test(bodyText), `Admin login page should include ${expected}`);
  }
  assert(await page.locator('a[href="../index.html"]').count() >= 1, 'Admin login page should link back to the Trennen homepage');
  assert(await page.locator('#email').count() === 1 && await page.locator('#password').count() === 1, 'Admin login form should keep email and password fields');
  assert(await page.locator('a[href="forgot-password.html"]').count() === 1, 'Admin login page should keep forgot password path');

  await page.setViewportSize({ width: 390, height: 860 });
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');
  await assertNoHorizontalOverflow(page, 'Mobile admin login page');
  const signIn = await page.locator('button').filter({ hasText: /sign in/i }).first().boundingBox();
  assert(signIn && signIn.y < 820, 'Mobile admin login should keep the sign-in action reachable');
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert(response && response.status() < 500, `Homepage returned ${response?.status() || 'no response'}`);
  await page.waitForLoadState('networkidle');
  assert(pageErrors.length === 0, `Homepage runtime errors: ${pageErrors.join('; ')}`);

  const title = await page.title();
  assert(/Trennen/i.test(title) && /3D Printing Quoting Software/i.test(title), 'Homepage title should use launch SEO branding');

  const brandScriptCount = await page.locator('script[src*="brand.js"]').count();
  assert(brandScriptCount === 0, 'Sales homepage must not load brand.js');

  const stylesheetCount = await page.locator('link[href="assets/sales.css"]').count();
  assert(stylesheetCount === 1, 'Sales homepage should load assets/sales.css');

  const scriptCount = await page.locator('script[src="assets/sales.js"]').count();
  assert(scriptCount === 1, 'Sales homepage should load assets/sales.js');

  const h1 = await expectVisible(page, 'h1', 'hero headline');
  assert(/messy print requests/i.test(await h1.textContent()), 'Hero headline should describe the messy-request-to-professional-quote outcome');

  const primaryCta = await expectVisible(page, '.hero-actions a[href="onboarding.html"]', 'Start free CTA');
  assert(/start free/i.test(await primaryCta.textContent()), 'Primary CTA should be Start free');
  await assertOnboardingLaunchPage(page);
  await assertAdminLoginLaunchPage(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const secondaryHref = await page.locator('a[data-sales-quote-demo]').first().getAttribute('href');
  assert(secondaryHref === 'quote.html?shop=mahi3d&demoStart=1', 'Demo CTA should point to a clean-start quote demo');
  await page.locator('a[data-sales-quote-demo]').first().click();
  await page.waitForURL(/quote\.html\?shop=mahi3d&demo=1/, { timeout: 7000 });
  await expectVisible(page, '#quoteStart', 'upload-first quote demo start screen');
  const demoStartHeadline = await page.locator('#quoteStart h1').textContent();
  assert(/Your 3D file,\s*priced instantly/i.test(demoStartHeadline || ''), 'Demo CTA should land on the upload-first quote headline');
  assert(await page.locator('.main-grid').evaluate(el => getComputedStyle(el).display) === 'none', 'Demo CTA should not land in the quote-review grid');
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  assert(await page.locator('.site-footer a[href="terms.html"]').count() === 1, 'Sales footer should link to Trennen terms without a shop slug');
  assert(await page.locator('.site-footer a[href="privacy.html"]').count() === 1, 'Sales footer should link to Trennen privacy without a shop slug');

  for (const anchor of ['#product', '#workflow', '#pricing', '#faq', '#demo']) {
    const exists = await page.locator(anchor).count();
    assert(exists === 1, `Sales homepage should expose ${anchor} as a navigation target`);
    const marginTop = await page.locator(anchor).evaluate(el => getComputedStyle(el).scrollMarginTop);
    assert(parseFloat(marginTop) >= 60, `${anchor} should have sticky-header scroll margin`);
  }

  await assertImageReady(page, '.slab-quote img', 'real quote capture');
  await assertImageReady(page, '.slab-admin img', 'real admin capture');
  await assertImageReady(page, '.layer-pricing img', 'real pricing capture');

  assert(await page.locator('[data-story]').count() === 1, 'Homepage should include the scroll product story');
  const storyMedia = await expectVisible(page, '.story-film', 'scroll story media');
  await page.waitForFunction(() => {
    const media = document.querySelector('.story-film');
    if (!media) return false;
    if (media.tagName === 'IMG') return media.complete && media.naturalWidth >= 900 && media.naturalHeight >= 500;
    return media.readyState >= 1 && media.videoWidth >= 900 && media.videoHeight >= 500;
  }, null, { timeout: 5000 });
  const mediaReady = await storyMedia.evaluate(media => {
    if (media.tagName === 'IMG') return media.complete && media.naturalWidth >= 900 && media.naturalHeight >= 500;
    return media.readyState >= 1 && media.videoWidth >= 900 && media.videoHeight >= 500;
  });
  assert(mediaReady, 'Scroll story media should load with useful dimensions');

  await page.evaluate(() => {
    const video = document.querySelector('video.story-film');
    if (video) video.currentTime = 0;
    window.scrollTo(0, document.querySelector('[data-story]').offsetTop + 900);
  });
  await page.waitForFunction(() => {
    const video = document.querySelector('.story-film');
    if (!video) return false;
    if (video.tagName === 'IMG') return getComputedStyle(document.querySelector('.depth-stage')).getPropertyValue('--focus-depth') !== '';
    return video.currentTime > 0.2;
  }, null, { timeout: 5000 });

  const pricingText = await page.locator('#pricing').innerText();
  for (const expected of ['NZ$0', 'NZ$29', 'NZ$129', 'NZ$899', '+ GST', 'Platform fee capped at NZ$29/month', 'Platform fee capped at NZ$79/month']) {
    assert(pricingText.includes(expected), `Pricing should include ${expected}`);
  }
  assert(/does not mark up card processing fees/i.test(pricingText), 'Pricing should explain processing fee pass-through');
  assert(await page.locator('[data-pricing-plan]').count() >= 4, 'Pricing CTAs should be instrumented');

  await page.evaluate(() => { window.dataLayer = []; });
  await page.locator('[data-demo-tab="pay"]').click();
  await page.locator('.faq-question').first().click();
  const trackedEvents = await page.evaluate(() => window.dataLayer.map(item => item.event));
  assert(trackedEvents.includes('demo_step_change'), 'Demo step changes should emit an analytics event');
  assert(trackedEvents.includes('faq_open'), 'FAQ opens should emit an analytics event');

  assert(await page.locator('#demo-form').count() === 1, 'Secondary demo form should exist');
  assert(await page.locator('#demo-form input[name="website"]').count() === 1, 'Demo form should include a honeypot field');
  assert(await page.locator('#uploadZone').count() === 0, 'Legacy homepage upload zone should be removed');

  await page.locator('#demo-form button[type="submit"]').click();
  await expectVisible(page, '#demo-form [data-field-error="name"]', 'name validation error');
  await expectVisible(page, '#demo-form [data-field-error="email"]', 'email validation error');

  await page.fill('#demo-name', 'Alex Taylor');
  await page.fill('#demo-email', 'not-an-email');
  await page.fill('#demo-company', 'LayerWorks');
  await page.selectOption('#demo-volume', '26-100');
  await page.fill('#demo-message', 'We quote a lot of FDM parts and need a better intake flow.');
  await page.locator('#demo-form button[type="submit"]').click();
  const emailError = await expectVisible(page, '#demo-form [data-field-error="email"]', 'invalid email validation error');
  assert(/valid work email/i.test(await emailError.textContent()), 'Invalid email should show a specific validation message');

  let submittedPayload = null;
  await page.route('**/api/sales/demo-request', async route => {
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, id: 123, delivery: { status: 'queued' } }),
    });
  });

  await page.fill('#demo-email', 'alex@layerworks.example');
  await page.locator('#demo-form button[type="submit"]').click();
  const success = await expectVisible(page, '#demo-success', 'demo form success state');
  assert(/request is in/i.test(await success.textContent()), 'Demo form success should confirm the request was submitted');
  assert(submittedPayload?.name === 'Alex Taylor', 'Demo form should submit the contact name');
  assert(submittedPayload?.email === 'alex@layerworks.example', 'Demo form should submit the work email');
  assert(submittedPayload?.company === 'LayerWorks', 'Demo form should submit the company');
  assert(submittedPayload?.monthlyQuoteVolume === '26-100', 'Demo form should submit monthly quote volume');
  assert(/better intake flow/i.test(submittedPayload?.message || ''), 'Demo form should submit the message');

  await assertNoHorizontalOverflow(page, 'Desktop homepage');

  for (const [label, viewport] of [
    ['Full-screen homepage 1920', { width: 1920, height: 1080 }],
    ['Wide homepage', { width: 2560, height: 1320 }],
    ['Full-screen homepage 2560', { width: 2560, height: 1440 }],
    ['Desktop homepage', { width: 1440, height: 900 }],
    ['MacBook-sized homepage', { width: 1280, height: 800 }],
    ['Narrow laptop homepage', { width: 1024, height: 768 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await assertNoHorizontalOverflow(page, label);
    const laptopMetrics = await page.evaluate(() => {
      const hero = document.querySelector('.hero')?.getBoundingClientRect();
      const h1 = document.querySelector('h1')?.getBoundingClientRect();
      const cta = document.querySelector('.hero-actions a[href="onboarding.html"]')?.getBoundingClientRect();
      const desk = document.querySelector('.operator-desk')?.getBoundingClientRect();
      return {
        heroWidth: hero?.width || 0,
        h1Top: h1?.top || 9999,
        ctaBottom: cta?.bottom || 0,
        deskTop: desk?.top || 9999,
        deskWidth: desk?.width || 0,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    assert(laptopMetrics.ctaBottom > 0 && laptopMetrics.ctaBottom <= laptopMetrics.viewportHeight, `${label} should keep Start free above the fold`);
    assert(laptopMetrics.deskTop < laptopMetrics.viewportHeight, `${label} should keep product art visible in the first viewport`);
    assert(laptopMetrics.h1Top < laptopMetrics.viewportHeight * 0.42, `${label} should keep hero copy near the top third`);
    assert(laptopMetrics.heroWidth >= laptopMetrics.viewportWidth * 0.75, `${label} should not render as a narrow centered card`);
    assert(laptopMetrics.deskWidth > 0, `${label} should render product art with measurable width`);
    if (viewport.width >= 1600) {
      await assertHeroWideDesktopBalance(page, label);
    }
    await assertHomepageLayoutRhythm(page, label);
  }

  for (const [label, viewport] of [
    ['Compact desktop homepage 1180', { width: 1180, height: 800 }],
    ['Compact desktop homepage 1280', { width: 1280, height: 800 }],
    ['Compact desktop homepage 1366', { width: 1366, height: 860 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await assertNoHorizontalOverflow(page, label);
    await assertHeroCompactDesktopComfort(page, label);
    await assertHomepageLayoutRhythm(page, label);
  }

  await page.setViewportSize({ width: 390, height: 860 });
  await assertNoHorizontalOverflow(page, 'Mobile homepage');
  await page.locator('.nav-toggle').click();
  const mobileOpen = await page.locator('.site-nav').evaluate(nav => nav.classList.contains('is-open'));
  assert(mobileOpen, 'Mobile navigation should open from the toggle');
  await page.locator('.site-nav a[href="#product"]').click();
  await page.waitForFunction(() => !document.querySelector('.site-nav')?.classList.contains('is-open'));
  const mobileClosed = await page.locator('.site-nav').evaluate(nav => nav.classList.contains('is-open'));
  assert(!mobileClosed, 'Mobile navigation should close after tapping an anchor link');
  await expectVisible(page, '.hero-actions a[href="onboarding.html"]', 'mobile Start free CTA');

  for (const [label, viewport] of [
    ['Safari partial homepage 900', { width: 900, height: 760 }],
    ['Safari partial homepage 980', { width: 980, height: 760 }],
    ['Safari partial homepage 1040', { width: 1040, height: 820 }],
    ['Safari partial homepage 1080', { width: 1080, height: 820 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await assertNoHorizontalOverflow(page, label);
    await assertHeroPartialWindowLayout(page, label);
    await assertHomepageLayoutRhythm(page, label);
  }

  for (const [label, viewport] of [
    ['Screenshot-width homepage', { width: 560, height: 900 }],
    ['Tall narrow Safari homepage', { width: 605, height: 1354 }],
    ['Small tablet homepage', { width: 700, height: 900 }],
    ['Tiny mobile homepage', { width: 360, height: 740 }],
    ['Mobile homepage', { width: 390, height: 860 }],
    ['Large mobile homepage', { width: 430, height: 932 }],
    ['Narrow tablet/browser homepage', { width: 768, height: 900 }],
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');
    await assertNoHorizontalOverflow(page, label);
    await assertHeroNarrowViewportComfort(page, label);
    await assertHomepageLayoutRhythm(page, label);
  }

  const reducedContext = await browser.newContext({
    viewport: { width: 390, height: 860 },
    reducedMotion: 'reduce',
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(base, { waitUntil: 'domcontentloaded' });
  const storyPosition = await reducedPage.locator('.story-pin').evaluate(el => getComputedStyle(el).position);
  assert(storyPosition !== 'sticky', 'Reduced-motion story should not use pinned scroll choreography');
  await assertNoHorizontalOverflow(reducedPage, 'Reduced-motion homepage');
  await reducedContext.close();

  console.log('Sales homepage smoke checks passed.');
} finally {
  await browser.close();
}

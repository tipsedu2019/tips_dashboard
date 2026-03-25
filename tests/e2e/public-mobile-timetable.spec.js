import { expect, test } from '@playwright/test';
import { createE2EMockData } from '../../src/testing/e2e/mockAppData.js';

const e2eUrl = (path = '/') => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('view', 'public');
  params.set('e2e', '1');

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

const MOCK_STATE_STORAGE_KEY = 'tips:e2e:mock-data-service:state:v1';
const FIXED_NOW_ISO = '2026-03-25T12:00:00+09:00';

const buildPublicMultiMonthState = () => {
  const state = createE2EMockData();
  const multiMonthPlan = {
    version: 2,
    selectedDays: [1, 3, 5],
    globalSessionCount: 12,
    billingPeriods: [
      {
        id: 'billing-math-feb',
        month: 2,
        label: 'Feb Plan',
        startDate: '2026-02-02',
        endDate: '2026-02-27',
        color: '#4f8a73',
      },
      {
        id: 'billing-math-mar',
        month: 3,
        label: 'Mar Plan',
        startDate: '2026-03-02',
        endDate: '2026-03-30',
        color: '#4a7a9f',
      },
      {
        id: 'billing-math-apr',
        month: 4,
        label: 'Apr Plan',
        startDate: '2026-04-01',
        endDate: '2026-04-29',
        color: '#6d63a7',
      },
    ],
    textbooks: [
      {
        textbookId: 'textbook-2',
        order: 0,
        role: 'main',
      },
    ],
  };

  state.classes = (state.classes || []).map((item) => {
    if (item.id !== 'class-2') {
      return item;
    }

    return {
      ...item,
      name: 'Math Multi Month',
      className: 'Math Multi Month',
      schedule: 'Mon Wed Fri 17:00-19:00',
      teacher: 'Park Teacher',
      classroom: 'Main Building 6',
      room: 'Main Building 6',
      startDate: '2026-02-02',
      endDate: '2026-04-29',
      schedulePlan: multiMonthPlan,
    };
  });

  return state;
};

async function seedPublicMultiMonthState(page) {
  const state = buildPublicMultiMonthState();

  await page.addInitScript(
    ({ fixedNow, state, storageKey }) => {
      const fixedTime = new Date(fixedNow).valueOf();
      const RealDate = Date;

      class MockDate extends RealDate {
        constructor(...args) {
          super(...(args.length === 0 ? [fixedTime] : args));
        }

        static now() {
          return fixedTime;
        }

        static parse(value) {
          return RealDate.parse(value);
        }

        static UTC(...args) {
          return RealDate.UTC(...args);
        }
      }

      globalThis.Date = MockDate;
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    },
    {
      fixedNow: FIXED_NOW_ISO,
      state,
      storageKey: MOCK_STATE_STORAGE_KEY,
    },
  );
}

async function openPublicDetailModal(page) {
  const cards = page.locator('[data-testid^="public-class-card-"]');
  await expect(cards.first()).toBeVisible();
  await cards.first().locator('.public-landing-card-main').click();

  const modal = page.getByTestId('class-schedule-plan-modal');
  await expect(modal).toBeVisible();
  return modal;
}

function getLiveClassPlanPreview(modal) {
  return modal.locator(
    '.class-plan-sheet-public-stack > div:not(.class-plan-share-capture) .class-plan-preview',
  );
}

test.describe('public mobile timetable', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('renders the toss-style public landing shell', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    await expect(page.getByTestId('public-class-list-view')).toBeVisible();
    await expect(page.getByTestId('public-mobile-topbar')).toBeVisible();
    await expect(page.getByTestId('public-subject-tabs')).toBeVisible();
    await expect(page.getByTestId('public-grade-tabs')).toBeVisible();
    await expect(page.getByTestId('public-card-list')).toBeVisible();
    await expect(page.getByTestId('public-bottom-nav')).toBeVisible();
  });

  test('filters the public class cards from the search bar', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    await page.getByTestId('public-class-search-input').fill('zz-not-found-2026');
    await expect(page.getByTestId('public-empty-state')).toBeVisible();
  });

  test('restores the active grade after clearing a no-results search', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const activeGradeTab = page.locator('.public-landing-tab-row-grade .public-landing-pill-tab.is-active:not([disabled])');
    const initialGradeLabel = ((await activeGradeTab.textContent()) || '').trim();

    expect(initialGradeLabel).not.toBe('');

    await page.getByTestId('public-class-search-input').fill('zz-not-found-2026');
    await expect(page.getByTestId('public-empty-state')).toBeVisible();

    await page.getByTestId('public-class-search-input').fill('');
    await expect(page.getByTestId('public-empty-state')).toHaveCount(0);
    await expect(page.locator('.public-landing-tab-row-grade .public-landing-pill-tab.is-active')).toHaveText(initialGradeLabel);
  });

  test('uses a native horizontally scrollable grade rail on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(e2eUrl('/'));

    const gradeTabs = page.getByTestId('public-grade-tabs');
    const gradeScroller = gradeTabs.locator('.tds-tab__scroller');

    await expect(gradeTabs).toBeVisible();
    await expect(gradeScroller).toBeVisible();
    await expect(page.getByTestId('public-grade-tabs-scroll-right')).toHaveCount(0);

    const canScroll = await gradeScroller.evaluate((node) => node.scrollWidth > node.clientWidth);
    if (canScroll) {
      const initialScrollLeft = await gradeScroller.evaluate((node) => node.scrollLeft);
      await gradeScroller.evaluate((node) => {
        node.scrollTo({ left: node.scrollWidth, behavior: 'instant' });
      });

      await expect
        .poll(async () => gradeScroller.evaluate((node) => node.scrollLeft))
        .toBeGreaterThan(initialScrollLeft);
    }
  });

  test('keeps the mobile top and bottom bars anchored without horizontal overflow on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(e2eUrl('/'));

    const topbar = page.getByTestId('public-mobile-topbar');
    const bottomNav = page.getByTestId('public-bottom-nav');

    const fixedBarStyles = await page.evaluate(() => {
      const topbarElement = document.querySelector('[data-testid="public-mobile-topbar"]');
      const bottomNavElement = document.querySelector('[data-testid="public-bottom-nav"]');
      const topbarStyle = topbarElement ? window.getComputedStyle(topbarElement) : null;
      const bottomNavStyle = bottomNavElement ? window.getComputedStyle(bottomNavElement) : null;
      return {
        topbarBackdropFilter: topbarStyle?.backdropFilter ?? '',
        bottomNavBackdropFilter: bottomNavStyle?.backdropFilter ?? '',
      };
    });

    expect(fixedBarStyles.topbarBackdropFilter).toMatch(/^(none)?$/);
    expect(fixedBarStyles.bottomNavBackdropFilter).toMatch(/^(none)?$/);

    const initialTopbarBox = await topbar.boundingBox();
    const initialBottomNavBox = await bottomNav.boundingBox();

    expect(initialTopbarBox).not.toBeNull();
    expect(initialBottomNavBox).not.toBeNull();
    expect(Math.abs(initialTopbarBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialTopbarBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(initialBottomNavBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((initialBottomNavBox.y + initialBottomNavBox.height) - 844)).toBeLessThanOrEqual(1);

    await page.evaluate(() => window.scrollTo({ top: 640, behavior: 'auto' }));

    const scrolledTopbarBox = await topbar.boundingBox();
    const scrolledBottomNavBox = await bottomNav.boundingBox();

    expect(scrolledTopbarBox).not.toBeNull();
    expect(scrolledBottomNavBox).not.toBeNull();
    expect(Math.abs(scrolledTopbarBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(scrolledTopbarBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(scrolledBottomNavBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((scrolledBottomNavBox.y + scrolledBottomNavBox.height) - 844)).toBeLessThanOrEqual(1);

    const viewportMetrics = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));

    expect(viewportMetrics.documentWidth).toBe(viewportMetrics.viewportWidth);
    expect(viewportMetrics.bodyWidth).toBe(viewportMetrics.viewportWidth);
  });

  test('switches bottom tabs and returns to classes', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    await page.getByTestId('public-bottom-nav-home').click();
    await expect(page.getByTestId('public-placeholder-home')).toBeVisible();

    await page.getByTestId('public-bottom-nav-classes').click();
    await expect(page.getByTestId('public-card-list')).toBeVisible();
  });

  test('opens review and score links in a new window while keeping the class page visible', async ({ page }) => {
    await page.addInitScript(() => {
      window.__publicExternalOpenCalls = [];
      window.open = (...args) => {
        window.__publicExternalOpenCalls.push(args);
        return { closed: false, focus() {} };
      };
    });

    await page.goto(e2eUrl('/'));

    await page.getByTestId('public-bottom-nav-reviews').click();
    await page.getByTestId('public-bottom-nav-scores').click();

    const openCalls = await page.evaluate(() => window.__publicExternalOpenCalls);
    expect(openCalls).toHaveLength(2);
    expect(openCalls[0][0]).toContain('map.naver.com');
    expect(openCalls[0][0]).toContain('placePath=%2Freview');
    expect(openCalls[1][0]).toContain('tipsedu.notion.site');
    await expect(page.getByTestId('public-card-list')).toBeVisible();
    await expect(page.locator('.public-bottom-nav-button.is-active').filter({ hasText: '수업' })).toBeVisible();
  });

  test('deselects the active subject to show all subjects for the selected grade', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const subjectTab = page.getByTestId('public-subject-tab-수학');

    await expect(subjectTab).toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('수학 · 중3');
    await expect(page.getByTestId('public-card-list')).toContainText('수학 · 중3');

    await subjectTab.click();

    await expect(subjectTab).not.toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('전체 과목 · 중3');
    await expect(page.getByTestId('public-card-list')).toContainText('수학 · 중3');
  });

  test('deselects the active grade to show the selected subject across all grades and removes the recommendation label', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const gradeTab = page.getByTestId('public-grade-tab-중3');

    await expect(page.locator('.public-landing-sort-label')).toHaveCount(0);
    await expect(gradeTab).toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-title')).toHaveText('중3 수업');

    await gradeTab.click();

    await expect(gradeTab).not.toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('수학 · 전체 학년');
    await expect(page.locator('.public-landing-section-title')).toHaveText('수학 수업');
    await expect(page.getByTestId('public-card-list')).toContainText('수학');
  });

  test('adds classes to planner and opens planner sheet', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();

    await expect(page.getByTestId('public-planner-cta')).toBeVisible();
    await page.getByTestId('public-planner-cta').click();
    await expect(page.getByTestId('public-planner-sheet')).toBeVisible();
  });

  test('keeps the english subject badge tinted on public class cards', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    await page.getByTestId('public-subject-tab-영어').click();

    const badgeStyle = await page.evaluate(() => {
      const badge = document.querySelector(
        '.public-landing-card .public-landing-card-eyebrow-row .tds-badge',
      );

      if (!(badge instanceof HTMLElement)) {
        return null;
      }

      const style = getComputedStyle(badge);
      return {
        text: badge.textContent?.trim() || '',
        background: style.backgroundColor || '',
        color: style.color || '',
      };
    });

    expect(badgeStyle).not.toBeNull();
    expect(badgeStyle?.text).toContain('영어');
    expect(badgeStyle?.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(badgeStyle?.color).not.toBe('rgb(25, 31, 40)');
  });

  test('keeps subject badges visible and the remove action inside each selected planner card on mobile', async ({
    page,
  }) => {
    await page.goto(e2eUrl('/'));

    let plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();

    await page.getByTestId('public-subject-tab-수학').click();
    plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();

    await page.getByTestId('public-planner-cta').click();
    await expect(page.getByTestId('public-planner-sheet')).toBeVisible();

    const selectedMetrics = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.public-planner-selected-item')];
      return items.map((item) => {
        const badge =
          item.querySelector('.public-planner-selected-subject-badge') ||
          item.querySelector('.tds-badge');
        const removeButton = item.querySelector('.public-planner-selected-remove');
        const itemRect = item.getBoundingClientRect();
        const buttonRect = removeButton?.getBoundingClientRect();
        const badgeStyle = badge ? getComputedStyle(badge) : null;
        return {
          badgeText: badge?.textContent?.trim() || '',
          badgeBackground: badgeStyle?.backgroundColor || '',
          badgeColor: badgeStyle?.color || '',
          itemWidth: itemRect.width,
          itemScrollWidth: item.scrollWidth,
          buttonRight: buttonRect?.right ?? 0,
          itemRight: itemRect.right,
        };
      });
    });

    expect(selectedMetrics.length).toBeGreaterThanOrEqual(2);
    selectedMetrics.forEach((metric) => {
      expect(metric.itemWidth).toBeGreaterThan(0);
      expect(metric.itemScrollWidth).toBeLessThanOrEqual(metric.itemWidth + 1);
      expect(metric.buttonRight).toBeLessThanOrEqual(metric.itemRight + 1);
    });

    const englishBadge = selectedMetrics.find((metric) => metric.badgeText.includes('영어'));
    expect(englishBadge).toBeTruthy();
    expect(englishBadge?.badgeBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(englishBadge?.badgeColor).not.toBe('rgb(255, 255, 255)');
  });

  test('shows subject-count summary text in the floating planner CTA', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    let plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();

    const cta = page.getByTestId('public-planner-cta');
    await expect(cta).toContainText('내 시간표 수학 1개');
    await expect(cta).toContainText('중3 수업 시간표 · 이미지 공유 가능');
  });

  test('renders fee and capacity as icon meta rows and keeps the card action compact', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const card = page.locator('[data-testid^="public-class-card-"]').first();
    await expect(card).toBeVisible();

    const metrics = await card.evaluate((node) => {
      const metaItems = node.querySelectorAll('.public-landing-card-meta-grid .public-landing-card-meta-item');
      const footer = node.querySelector('.public-landing-card-footer');
      const price = node.querySelector('.public-landing-card-meta-item-price span')?.textContent || '';
      const capacity = node.querySelector('.public-landing-card-meta-item-capacity span')?.textContent || '';

      return {
        metaItemCount: metaItems.length,
        price,
        capacity,
        footerPosition: footer ? getComputedStyle(footer).position : 'missing',
      };
    });

    expect(metrics.metaItemCount).toBeGreaterThanOrEqual(4);
    expect(metrics.price).toMatch(/\d{1,3}(,\d{3})*원|수업료 문의/);
    expect(metrics.capacity).toContain('정원');
    expect(metrics.footerPosition).toBe('static');
  });

  test('keeps the planner summary area non-sticky on mobile', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();
    await page.getByTestId('public-planner-cta').click();
    await expect(page.getByTestId('public-planner-sheet')).toBeVisible();

    const stickyPosition = await page.evaluate(() => {
      const node = document.querySelector('.public-planner-sticky-top');
      return node ? getComputedStyle(node).position : 'missing';
    });

    expect(stickyPosition).not.toBe('sticky');
  });

  test('opens the public detail sheet with the class plan branding', async ({ page }) => {
    await seedPublicMultiMonthState(page);
    await page.goto(e2eUrl('/'));

    const sheet = await openPublicDetailModal(page);
    const livePreview = getLiveClassPlanPreview(sheet);
    await expect(livePreview.getByText('TIPS CLASS PLAN')).toBeVisible();
    await expect(livePreview.locator('.class-plan-preview-subtitle')).toHaveCount(0);
    await expect(livePreview.locator('.class-plan-preview-month-filter')).toBeVisible();
    await expect(sheet.getByText('TIPS DASHBOARD')).toHaveCount(0);
    await expect(sheet.locator('.class-schedule-modal-secondary-action')).toBeVisible();
    await expect(sheet.locator('.class-schedule-modal-primary-action')).toBeVisible();
  });

  test('defaults the class plan month filter to the current and upcoming months and filters the preview in sync', async ({
    page,
  }) => {
    await seedPublicMultiMonthState(page);
    await page.goto(e2eUrl('/'));

    const modal = await openPublicDetailModal(page);
    const livePreview = getLiveClassPlanPreview(modal);
    const filter = livePreview.locator('.class-plan-preview-month-filter');
    await expect(filter).toBeVisible();

    const defaultMonthHeadings = await livePreview.locator('.class-plan-month-heading').allTextContents();
    expect(defaultMonthHeadings).toHaveLength(2);
    expect(defaultMonthHeadings.some((text) => /2026\D*2/.test(text))).toBeFalsy();
    expect(defaultMonthHeadings.some((text) => /2026\D*3/.test(text))).toBeTruthy();
    expect(defaultMonthHeadings.some((text) => /2026\D*4/.test(text))).toBeTruthy();

    const defaultPeriodBadges = await livePreview
      .locator('.class-plan-preview-badge.is-period')
      .allTextContents();
    expect(defaultPeriodBadges).toHaveLength(2);
    expect(defaultPeriodBadges.some((text) => /3\D*13/.test(text))).toBeTruthy();
    expect(defaultPeriodBadges.some((text) => /4\D*13/.test(text))).toBeTruthy();
    expect(defaultPeriodBadges.some((text) => /2\D*12/.test(text))).toBeFalsy();

    await filter.locator('.tds-checkbox-menu__trigger').click();
    const monthOptions = filter.locator('.tds-checkbox-menu__list .tds-checkbox-menu__option');

    await expect(monthOptions).toHaveCount(3);
    await expect(monthOptions.nth(0)).toHaveAttribute('aria-checked', 'false');
    await expect(monthOptions.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(monthOptions.nth(2)).toHaveAttribute('aria-checked', 'true');

    await monthOptions.nth(0).click();
    await monthOptions.nth(2).click();

    await expect(monthOptions.nth(0)).toHaveAttribute('aria-checked', 'true');
    await expect(monthOptions.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(monthOptions.nth(2)).toHaveAttribute('aria-checked', 'false');

    const filteredMonthHeadings = await livePreview.locator('.class-plan-month-heading').allTextContents();
    expect(filteredMonthHeadings).toHaveLength(2);
    expect(filteredMonthHeadings.some((text) => /2026\D*2/.test(text))).toBeTruthy();
    expect(filteredMonthHeadings.some((text) => /2026\D*3/.test(text))).toBeTruthy();
    expect(filteredMonthHeadings.some((text) => /2026\D*4/.test(text))).toBeFalsy();

    const filteredPeriodBadges = await livePreview
      .locator('.class-plan-preview-badge.is-period')
      .allTextContents();
    expect(filteredPeriodBadges).toHaveLength(2);
    expect(filteredPeriodBadges.some((text) => /2\D*12/.test(text))).toBeTruthy();
    expect(filteredPeriodBadges.some((text) => /3\D*13/.test(text))).toBeTruthy();
    expect(filteredPeriodBadges.some((text) => /4\D*13/.test(text))).toBeFalsy();

    const filteredSessionHeaders = await livePreview
      .locator('.class-plan-session-group-header strong')
      .allTextContents();
    expect(filteredSessionHeaders).toHaveLength(2);
    expect(filteredSessionHeaders.some((text) => /2026\D*2/.test(text))).toBeTruthy();
    expect(filteredSessionHeaders.some((text) => /2026\D*3/.test(text))).toBeTruthy();
    expect(filteredSessionHeaders.some((text) => /2026\D*4/.test(text))).toBeFalsy();
  });

  test('removes the duplicate mobile summary chrome and keeps the public detail body scrollable', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const sheet = page.getByTestId('class-schedule-plan-modal');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('.class-schedule-modal-mobile-summary')).toHaveCount(0);

    await page.evaluate(() => {
      const stack = document.querySelector('.class-plan-sheet-public-stack');
      if (!(stack instanceof HTMLElement)) {
        return;
      }

      const filler = document.createElement('div');
      filler.setAttribute('data-testid', 'public-detail-scroll-sentinel');
      filler.textContent = 'scroll target';
      filler.style.height = '1600px';
      filler.style.borderRadius = '20px';
      filler.style.background = 'rgba(37, 99, 235, 0.08)';
      filler.style.border = '1px dashed rgba(37, 99, 235, 0.24)';
      filler.style.display = 'grid';
      filler.style.placeItems = 'center';
      filler.style.fontWeight = '700';
      filler.style.color = '#1d4ed8';
      stack.appendChild(filler);
    });

    const scrollResult = await page.evaluate(() => {
      const content = document.querySelector('.class-plan-sheet-content.is-public');
      const body = document.querySelector('.bottom-sheet-body');
      if (!(content instanceof HTMLElement) || !(body instanceof HTMLElement)) {
        return null;
      }

      const before = body.scrollTop;
      body.scrollTo({ top: body.scrollHeight, behavior: 'auto' });

      return {
        contentOverflowY: getComputedStyle(content).overflowY,
        before,
        after: body.scrollTop,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
      };
    });

    expect(scrollResult).not.toBeNull();
    expect(scrollResult.contentOverflowY).toBe('visible');
    expect(scrollResult.scrollHeight).toBeGreaterThan(scrollResult.clientHeight);
    expect(scrollResult.after).toBeGreaterThan(scrollResult.before);
    await expect(page.getByTestId('public-detail-scroll-sentinel')).toBeInViewport();
  });

  test('keeps the public detail portrait header minimal', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.bottom-sheet-subtitle')).toHaveCount(0);
    await expect(modal.locator('.class-plan-sheet-summary')).toHaveCount(0);

    const headerStyle = await page.evaluate(() => {
      const header = document.querySelector('.class-plan-bottom-sheet--public .bottom-sheet-header');
      return header ? getComputedStyle(header).borderBottomWidth : null;
    });

    expect(headerStyle).toBe('0px');
  });

  test('shows image save and PDF share buttons in the public detail portrait header', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.bottom-sheet-handle')).toHaveCount(0);
    await expect(modal.getByTestId('class-plan-download-button')).toHaveText('이미지 저장');
    await expect(modal.getByTestId('class-plan-pdf-share-button')).toHaveText('PDF 공유');
  });

  test('downloads the public class plan image without showing a capture error toast on mobile', async ({
    page,
  }) => {
    await seedPublicMultiMonthState(page);
    await page.goto(e2eUrl('/'));
    const modal = await openPublicDetailModal(page);

    const filter = modal.locator('.class-plan-preview-month-filter');
    await filter.locator('.tds-checkbox-menu__trigger').click();
    const monthOptions = filter.locator('.tds-checkbox-menu__list .tds-checkbox-menu__option');
    await monthOptions.nth(2).click();
    await expect(monthOptions.nth(2)).toHaveAttribute('aria-checked', 'false');

    const downloadButton = modal.getByTestId('class-plan-download-button');
    await expect(downloadButton).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadPromise;

    await expect(downloadButton).toBeEnabled();
    await expect(page.locator('.toast-item.is-error')).toHaveCount(0);
    expect(download.suggestedFilename()).toMatch(/class-plan-.*\.png$/);
  });

  test('prepares a portrait high-resolution share capture and keeps the add CTA blue on mobile', async ({
    page,
  }) => {
    await seedPublicMultiMonthState(page);
    await page.goto(e2eUrl('/'));

    const modal = await openPublicDetailModal(page);

    const filter = modal.locator('.class-plan-preview-month-filter');
    await filter.locator('.tds-checkbox-menu__trigger').click();
    const monthOptions = filter.locator('.tds-checkbox-menu__list .tds-checkbox-menu__option');
    await monthOptions.nth(2).click();
    await expect(monthOptions.nth(2)).toHaveAttribute('aria-checked', 'false');

    const addButton = modal.locator('.class-schedule-modal-secondary-action');
    await expect(addButton).toBeVisible();
    await expect(page.getByTestId('class-plan-share-capture')).toHaveCount(1);

    const captureMetrics = await page.evaluate(() => {
      const addCta = document.querySelector(
        '[data-testid="class-schedule-plan-modal"] .class-schedule-modal-secondary-action',
      );
      const capture = document.querySelector('[data-testid="class-plan-share-capture"]');
      const captureCard = capture?.querySelector('.public-landing-card');
      const layout = capture?.querySelector('[data-testid="class-plan-preview-layout"]');
      const shareSurface = capture?.querySelector('.class-plan-preview-surface');
      const sessionPanel = capture?.querySelector('.class-plan-session-panel');
      const monthFilter = capture?.querySelector('.class-plan-preview-month-filter');
      const monthHeadings = [
        ...capture?.querySelectorAll('.class-plan-month-heading') || [],
      ].map((node) => node.textContent?.trim() || '');
      return {
        addBackground: addCta ? getComputedStyle(addCta).backgroundColor : '',
        captureCardCount: captureCard ? 1 : 0,
        columnCount: layout
          ? getComputedStyle(layout).gridTemplateColumns.trim().split(/\s+/).length
          : 0,
        captureWidth: capture?.getBoundingClientRect().width ?? 0,
        captureHeight: shareSurface?.getBoundingClientRect().height ?? 0,
        filterCount: monthFilter ? 1 : 0,
        monthHeadings,
        sharePadding: shareSurface ? getComputedStyle(shareSurface).paddingLeft : '',
        shareRadius: shareSurface ? getComputedStyle(shareSurface).borderTopLeftRadius : '',
        shareBackground: shareSurface ? getComputedStyle(shareSurface).backgroundColor : '',
        shareShadow: shareSurface ? getComputedStyle(shareSurface).boxShadow : '',
        sessionPanelWidth: sessionPanel?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(captureMetrics.addBackground).toBe('rgb(49, 130, 246)');
    expect(captureMetrics.captureCardCount).toBe(1);
    expect(captureMetrics.columnCount).toBe(2);
    expect(captureMetrics.captureWidth).toBeGreaterThanOrEqual(900);
    expect(captureMetrics.captureWidth).toBeLessThanOrEqual(980);
    expect(captureMetrics.captureHeight).toBeGreaterThan(captureMetrics.captureWidth);
    expect(captureMetrics.filterCount).toBe(0);
    expect(captureMetrics.monthHeadings).toHaveLength(1);
    expect(captureMetrics.monthHeadings[0]).toMatch(/2026\D*3/);
    expect(captureMetrics.sharePadding).not.toBe('0px');
    expect(captureMetrics.shareRadius).not.toBe('0px');
    expect(captureMetrics.shareBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(captureMetrics.shareShadow).not.toBe('none');
    expect(captureMetrics.sessionPanelWidth).toBeGreaterThan(0);
  });

  test('keeps the public detail landscape header minimal on compact screens', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.class-plan-desktop-header-title')).toHaveText('수업 계획');
    await expect(modal.locator('.class-plan-desktop-header-subtitle')).toHaveCount(0);
    await expect(modal.locator('.class-plan-desktop-header-tags')).toHaveCount(0);
    await expect(modal.locator('.class-plan-desktop-header-meta')).toHaveCount(0);
    await expect(modal.locator('.class-plan-sheet-summary')).toHaveCount(0);

    const headerStyle = await page.evaluate(() => {
      const header = document.querySelector('.class-plan-desktop-header.is-public-detail');
      return header ? getComputedStyle(header).borderBottomWidth : null;
    });

    expect(headerStyle).toBe('0px');
  });

  test('shows image save and PDF share buttons in the public detail compact header', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('class-plan-download-button')).toHaveText('이미지 저장');
    await expect(modal.getByTestId('class-plan-pdf-share-button')).toHaveText('PDF 공유');
  });

  test('keeps the public detail desktop header minimal on pc screens', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.class-plan-desktop-header-title')).toHaveText('수업 계획');
    await expect(modal.locator('.class-plan-desktop-header-subtitle')).toHaveCount(0);
    await expect(modal.locator('.class-plan-desktop-header-tags')).toHaveCount(0);
    await expect(modal.locator('.class-plan-desktop-header-meta')).toHaveCount(0);
    await expect(modal.locator('.class-plan-sheet-summary')).toHaveCount(0);

    await expect(modal.getByTestId('class-plan-download-button')).toHaveText('이미지 저장');
    await expect(modal.getByTestId('class-plan-pdf-share-button')).toHaveText('PDF 공유');

    const headerStyle = await page.evaluate(() => {
      const header = document.querySelector('.class-plan-desktop-header.is-public-detail');
      return header ? getComputedStyle(header).borderBottomWidth : null;
    });

    expect(headerStyle).toBe('0px');
  });

  test('uses the shared fill CTA styling for the planner add button on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();

    const addButton = modal.locator('.class-schedule-modal-secondary-action');
    await expect(addButton).toBeVisible();
    await expect(addButton).toHaveClass(/tds-button--style-fill/);
  });

  test('keeps the planner toast visible with a go-to action after adding a class', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await plannerButtons.first().click();

    const toast = page.locator('.toast-item').filter({ hasText: '내 시간표에 수업을 담았어요.' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: '보러가기' })).toBeVisible();

    await page.waitForTimeout(3200);
    await expect(toast).toBeVisible();
  });

  test('uses the updated removal copy when taking a class back out of the planner', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const firstCard = page.locator('[data-testid^="public-class-card-"]').first();
    await expect(firstCard).toBeVisible();

    const title = (await firstCard.locator('.public-landing-card-title').textContent())?.trim() || '수업';
    const toggleButton = firstCard.locator('[data-testid^="public-card-toggle-"]');

    await toggleButton.click();
    await toggleButton.click();

    await expect(page.locator('.toast-item').filter({ hasText: `${title} 수업을 내 시간표에서 뺐습니다.` })).toBeVisible();
  });

  test('lets the floating planner CTA clear items and does not show the top lock banner', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await plannerButtons.first().click();

    const enabledGrades = page.locator('[data-testid^="public-grade-tab-"]:not([disabled])');
    const enabledGradeCount = await enabledGrades.count();

    if (enabledGradeCount > 1) {
      await enabledGrades.nth(1).click();
      await expect(page.locator('.public-planner-lock-banner')).toHaveCount(0);
    }

    await expect(page.getByTestId('public-planner-clear')).toBeVisible();
    await page.getByTestId('public-planner-clear').click();
    await expect(page.getByTestId('public-planner-cta')).toHaveCount(0);
  });

  test('anchors planner toast above the floating CTA without wrapper chrome', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();

    const metrics = await page.evaluate(() => {
      const toast = document.querySelector('.toast-item');
      const cta = document.querySelector('.public-planner-floating-shell');

      if (!(toast instanceof HTMLElement) || !(cta instanceof HTMLElement)) {
        return null;
      }

      const toastRect = toast.getBoundingClientRect();
      const ctaRect = cta.getBoundingClientRect();

      return {
        wrapperBackground: getComputedStyle(toast).backgroundColor,
        wrapperBoxShadow: getComputedStyle(toast).boxShadow,
        toastBottom: toastRect.bottom,
        ctaTop: ctaRect.top,
      };
    });

    expect(metrics).not.toBeNull();
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(metrics.wrapperBackground);
    expect(metrics.wrapperBoxShadow).toBe('none');
    expect(metrics.toastBottom).toBeLessThanOrEqual(metrics.ctaTop - 8);
  });

  test('supports horizontal drag on the mobile planner timetable preview', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await expect(plannerButtons.first()).toBeVisible();
    await plannerButtons.first().click();
    await page.getByTestId('public-planner-cta').click();
    await expect(page.getByTestId('public-planner-sheet')).toBeVisible();

    const dragResult = await page.evaluate(() => {
      const sheetBody = document.querySelector(
        '[data-testid="public-planner-sheet"] .bottom-sheet-body',
      );
      const shell = document.querySelector('.public-planner-preview-grid .timetable-grid-shell');

      if (
        !(sheetBody instanceof HTMLElement) ||
        !(shell instanceof HTMLElement) ||
        typeof PointerEvent !== 'function'
      ) {
        return null;
      }

      const rect = shell.getBoundingClientRect();
      const startX = rect.right - 24;
      const endX = rect.left + 24;
      const y = rect.top + Math.min(120, rect.height / 2);
      const before = shell.scrollLeft;
      const pointerId = 1;

      shell.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX: startX,
        clientY: y,
        isPrimary: true,
        buttons: 1,
      }));

      shell.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX: endX,
        clientY: y,
        isPrimary: true,
        buttons: 1,
      }));

      shell.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        clientX: endX,
        clientY: y,
        isPrimary: true,
      }));

      return {
        bodyClientWidth: sheetBody.clientWidth,
        bodyScrollWidth: sheetBody.scrollWidth,
        shellOverflowX: getComputedStyle(shell).overflowX,
        before,
        after: shell.scrollLeft,
        scrollWidth: shell.scrollWidth,
        clientWidth: shell.clientWidth,
      };
    });

    expect(dragResult).not.toBeNull();
    expect(dragResult.bodyScrollWidth).toBeLessThanOrEqual(dragResult.bodyClientWidth + 1);
    expect(['auto', 'scroll']).toContain(dragResult.shellOverflowX);
    expect(dragResult.scrollWidth).toBeGreaterThan(dragResult.clientWidth);
    expect(dragResult.after).toBeGreaterThan(dragResult.before + 20);
  });
});

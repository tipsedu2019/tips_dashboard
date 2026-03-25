import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/') => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('view', 'public');
  params.set('e2e', '1');

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

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
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const sheet = page.getByTestId('class-schedule-plan-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('class-plan-preview').getByText('CLASS PLAN')).toBeVisible();
    await expect(sheet.getByText('TIPS DASHBOARD')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: '내 시간표에 담기' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: '상담하기' })).toBeVisible();
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

  test('shows only a share icon in the public detail portrait header', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('.bottom-sheet-handle')).toHaveCount(0);
    await expect(modal.getByText('이미지 저장')).toHaveCount(0);

    const shareButton = modal.getByTestId('class-plan-share-button');
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toHaveText('');
  });

  test('prepares a two-column high-resolution share capture and keeps the add CTA blue on mobile', async ({
    page,
  }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();

    const addButton = modal.locator('.class-schedule-modal-secondary-action');
    await expect(addButton).toBeVisible();
    await expect(page.getByTestId('class-plan-share-capture')).toHaveCount(1);

    const captureMetrics = await page.evaluate(() => {
      const addCta = document.querySelector(
        '[data-testid="class-schedule-plan-modal"] .class-schedule-modal-secondary-action',
      );
      const capture = document.querySelector('[data-testid="class-plan-share-capture"]');
      const layout = capture?.querySelector('[data-testid="class-plan-preview-layout"]');
      const shareSurface = capture?.querySelector('.class-plan-preview-surface');
      return {
        addBackground: addCta ? getComputedStyle(addCta).backgroundColor : '',
        columnCount: layout
          ? getComputedStyle(layout).gridTemplateColumns.trim().split(/\s+/).length
          : 0,
        minCaptureWidth: capture?.getBoundingClientRect().width ?? 0,
        sharePadding: shareSurface ? getComputedStyle(shareSurface).paddingLeft : '',
      };
    });

    expect(captureMetrics.addBackground).toBe('rgb(49, 130, 246)');
    expect(captureMetrics.columnCount).toBeGreaterThanOrEqual(2);
    expect(captureMetrics.minCaptureWidth).toBeGreaterThanOrEqual(1200);
    expect(captureMetrics.sharePadding).not.toBe('0px');
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

  test('shows only a share icon in the public detail compact header', async ({ page }) => {
    await page.setViewportSize({ width: 932, height: 430 });
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const modal = page.getByTestId('class-schedule-plan-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByText('이미지 저장')).toHaveCount(0);

    const shareButton = modal.getByTestId('class-plan-share-button');
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toHaveText('');
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

    const shareButton = modal.getByTestId('class-plan-share-button');
    await expect(shareButton).toBeVisible();
    await expect(shareButton).toHaveText('');

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
      const shell = document.querySelector('.public-planner-preview-grid .timetable-grid-shell');

      if (!(shell instanceof HTMLElement) || typeof PointerEvent !== 'function') {
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
        before,
        after: shell.scrollLeft,
        scrollWidth: shell.scrollWidth,
        clientWidth: shell.clientWidth,
      };
    });

    expect(dragResult).not.toBeNull();
    expect(dragResult.scrollWidth).toBeGreaterThan(dragResult.clientWidth);
    expect(dragResult.after).toBeGreaterThan(dragResult.before + 20);
  });
});

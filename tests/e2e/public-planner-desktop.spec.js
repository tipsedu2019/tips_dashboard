import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/') => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('view', 'public');
  params.set('e2e', '1');

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

async function openPlannerSheet(page) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(e2eUrl('/'));

  const firstCard = page.locator('[data-testid^="public-class-card-"]').first();
  await expect(firstCard).toBeVisible();

  const cardMeta = await firstCard.evaluate((card) => {
    const values = [...card.querySelectorAll('.public-landing-card-meta-grid .public-landing-card-meta-item span')]
      .map((node) => node.textContent?.trim() || '')
      .filter(Boolean);

    return {
      teacher: values[0] || '',
      room: values[1] || '',
    };
  });

  await firstCard.locator('[data-testid^="public-card-toggle-"]').click();
  await page.locator('.public-desktop-planner-panel .btn.btn-primary').click();
  await expect(page.getByTestId('public-planner-sheet')).toBeVisible();

  return cardMeta;
}

async function addEnglishAndMathToPlanner(page) {
  let plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
  await expect(plannerButtons.first()).toBeVisible();
  await plannerButtons.first().click();

  await page.getByTestId('public-subject-tab-수학').click();
  plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
  await expect(plannerButtons.first()).toBeVisible();
  await plannerButtons.first().click();
}

test.use({
  viewport: { width: 1600, height: 1100 },
  hasTouch: false,
  isMobile: false,
});

test.describe('public planner desktop sheet', () => {
  test('hides the desktop section description and shows subject-count planner summary', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(e2eUrl('/'));

    await expect(page.locator('.public-landing-section-description')).toHaveCount(0);

    await addEnglishAndMathToPlanner(page);

    const plannerPanel = page.locator('.public-desktop-planner-panel');
    await expect(plannerPanel).toContainText('내 시간표 영어 1개, 수학 1개');
    await expect(plannerPanel).toContainText('중3 수업 시간표 · 이미지 공유 가능');
  });

  test('lifts the desktop planner panel on hover', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto(e2eUrl('/'));

    const plannerPanel = page.locator('.public-desktop-planner-panel');
    await expect(plannerPanel).toBeVisible();

    const beforeHover = await plannerPanel.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        transform: style.transform,
      };
    });

    await plannerPanel.hover();
    await page.waitForTimeout(120);

    const afterHover = await plannerPanel.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
        transform: style.transform,
      };
    });

    expect(afterHover.borderColor).not.toBe(beforeHover.borderColor);
    expect(afterHover.boxShadow).not.toBe(beforeHover.boxShadow);
    expect(afterHover.transform).not.toBe(beforeHover.transform);
  });

  test('shows teacher and classroom metadata in selected summary and preview chips', async ({ page }) => {
    const cardMeta = await openPlannerSheet(page);

    const selectedMeta = page.locator('[data-testid="public-planner-selected-meta"]').first();
    const chipMeta = page.locator('[data-testid="public-planner-preview-chip-meta"]').first();

    await expect(selectedMeta).toContainText(cardMeta.teacher);
    await expect(selectedMeta).toContainText(cardMeta.room);
    await expect(chipMeta).toContainText(cardMeta.teacher);
    await expect(chipMeta).toContainText(cardMeta.room);
  });

  test('fits monday through sunday without horizontal scroll on desktop', async ({ page }) => {
    await openPlannerSheet(page);

    const layoutMetrics = await page.evaluate(() => {
      const gridShell = document.querySelector('.public-planner-readonly-timetable');
      const headerCells = [...document.querySelectorAll('.public-planner-preview-grid .timetable-header-cell')]
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean);

      return {
        gridClientWidth: gridShell?.clientWidth ?? 0,
        gridScrollWidth: gridShell?.scrollWidth ?? 0,
        lastHeader: headerCells[headerCells.length - 1] || '',
      };
    });

    expect(layoutMetrics.gridClientWidth).toBeGreaterThan(0);
    expect(layoutMetrics.gridScrollWidth).toBeLessThanOrEqual(layoutMetrics.gridClientWidth + 1);
    expect(layoutMetrics.lastHeader).toBe('일');
  });

  test('renders opaque timetable blocks in the planner preview', async ({ page }) => {
    await openPlannerSheet(page);

    const blockStyle = await page.evaluate(() => {
      const block = document.querySelector('.public-planner-preview-grid .timetable-block');
      if (!block) {
        return null;
      }

      const background = getComputedStyle(block).backgroundColor || '';
      const rgbaMatch = background.match(/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\s*\)/i);

      return {
        background,
        alpha: rgbaMatch ? Number(rgbaMatch[1]) : 1,
      };
    });

    expect(blockStyle).not.toBeNull();
    expect(blockStyle?.alpha).toBe(1);
  });
});

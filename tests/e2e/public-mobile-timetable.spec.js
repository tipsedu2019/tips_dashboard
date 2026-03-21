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
    expect(openCalls[1][0]).toContain('tipsedu.notion.site');
    await expect(page.getByTestId('public-card-list')).toBeVisible();
    await expect(page.locator('.public-bottom-nav-button.is-active').filter({ hasText: '수업' })).toBeVisible();
  });

  test('deselects the active subject to show all subjects for the selected grade', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const subjectTab = page.getByTestId('public-subject-tab-영어');

    await expect(subjectTab).toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('영어 · 중3');
    await expect(page.getByTestId('public-card-list')).toContainText('영어 · 중3');
    await expect(page.getByTestId('public-card-list')).not.toContainText('수학 · 중3');

    await subjectTab.click();

    await expect(subjectTab).not.toHaveClass(/is-active/);
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('전체 과목 · 중3');
    await expect(page.getByTestId('public-card-list')).toContainText('영어 · 중3');
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
    await expect(page.locator('.public-landing-section-kicker')).toHaveText('영어 · 전체 학년');
    await expect(page.locator('.public-landing-section-title')).toHaveText('영어 수업');
    await expect(page.getByTestId('public-card-list')).toContainText('영어');
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

  test('opens the public detail sheet with the class plan branding', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('[data-testid^="public-class-card-"]');
    await expect(cards.first()).toBeVisible();
    await cards.first().locator('.public-landing-card-main').click();

    const sheet = page.getByTestId('class-schedule-plan-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('CLASS PLAN')).toBeVisible();
    await expect(sheet.getByText('TIPS DASHBOARD')).toHaveCount(0);
  });

  test('keeps the planner toast visible with a go-to action after adding a class', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    await plannerButtons.first().click();

    const toast = page.locator('.toast-item').filter({ hasText: '수업바구니에 수업을 담았어요.' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: '보러가기' })).toBeVisible();

    await page.waitForTimeout(3200);
    await expect(toast).toBeVisible();
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
});

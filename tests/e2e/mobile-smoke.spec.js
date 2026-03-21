import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/', { publicView = false } = {}) => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('e2e', '1');
  if (publicView) {
    params.set('view', 'public');
  }

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

async function waitForPublicLandingResults(page) {
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="public-empty-state"]') ||
          document.querySelector('[data-testid^="public-class-card-"]')
      ),
    null,
    { timeout: 8_000 }
  );
}

test.describe('mobile smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('renders the public landing shell on mobile', async ({ page }) => {
    await page.goto(e2eUrl('/', { publicView: true }));

    await expect(page.getByTestId('public-mobile-topbar')).toBeVisible();
    await expect(page.getByTestId('public-class-search-input')).toBeVisible();
    await expect(page.getByTestId('public-logo-button')).toBeVisible();
    await expect(page.getByTestId('public-subject-tabs')).toBeVisible();
    await expect(page.getByTestId('public-grade-tabs')).toBeVisible();
    await expect(page.getByTestId('public-card-list')).toBeVisible();
    await expect(page.getByTestId('public-bottom-nav')).toBeVisible();
  });

  test('mobile public bottom nav swaps placeholder tabs', async ({ page }) => {
    await page.goto(e2eUrl('/', { publicView: true }));

    await page.getByTestId('public-bottom-nav-home').click();
    await expect(page.getByTestId('public-placeholder-home')).toBeVisible();

    await page.getByTestId('public-bottom-nav-classes').click();
    await expect(page.getByTestId('public-card-list')).toBeVisible();
  });

  test('searching to a missing result shows the empty state', async ({ page }) => {
    await page.goto(e2eUrl('/', { publicView: true }));

    const search = page.getByTestId('public-class-search-input');
    await search.fill('zz-not-found-2026');

    await expect(page.getByTestId('public-empty-state')).toBeVisible();
  });

  test('public class card opens the mobile schedule sheet', async ({ page }) => {
    await page.goto(e2eUrl('/', { publicView: true }));
    await waitForPublicLandingResults(page);

    const cards = page.locator('[data-testid^="public-class-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      await expect(page.getByTestId('public-empty-state')).toBeVisible();
      return;
    }

    await cards.first().locator('.public-landing-card-main').click();
    await expect(page.getByTestId('class-schedule-plan-sheet')).toBeVisible();
  });

  test('planner CTA opens after adding a class', async ({ page }) => {
    await page.goto(e2eUrl('/', { publicView: true }));
    await waitForPublicLandingResults(page);

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    const count = await plannerButtons.count();

    if (count === 0) {
      await expect(page.getByTestId('public-empty-state')).toBeVisible();
      return;
    }

    await plannerButtons.first().click();
    await expect(page.getByTestId('public-planner-cta')).toBeVisible();
  });

  test('mobile academic hub switcher opens from the calendar tab', async ({ page }) => {
    await page.goto(e2eUrl('/?role=staff'));

    await page.getByTestId('mobile-nav-academic-calendar').click();
    await expect(page.getByTestId('mobile-academic-switcher')).toBeVisible();

    await page.getByTestId('mobile-academic-tab-roadmap').click();
    await expect(page.getByTestId('roadmap-mobile-summary')).toBeVisible();
  });

  test('mobile class list cards can open the plan sheet', async ({ page }) => {
    await page.goto(e2eUrl('/?role=staff'));

    await page.getByTestId('mobile-nav-timetable').click();

    const firstCard = page.locator('[data-testid^="data-list-mobile-card-"]').first();
    await expect(firstCard).toBeVisible();

    await firstCard.getByRole('button', { name: '상세 보기' }).click();

    const detailModal = page.locator('.modal-overlay').last();
    await detailModal.locator('button').nth(3).click();
    await expect(detailModal.getByRole('button', { name: '크게 보기' })).toBeVisible();
    await detailModal.getByRole('button', { name: '크게 보기' }).click();

    await expect(page.getByTestId('class-schedule-plan-sheet')).toBeVisible();
  });
});

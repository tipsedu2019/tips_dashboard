import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/') => `${path.includes('?') ? `${path}&` : `${path}?`}e2e=1`;

test.describe('mobile smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('renders the public timetable shell on mobile', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    await expect(page.getByText('팁스영어수학학원 수업시간표')).toBeVisible();
    await expect(page.getByPlaceholder('수업명, 선생님, 강의실 검색')).toBeVisible();
    await expect(page.getByRole('button', { name: '직원 로그인' })).toBeVisible();

    const subjectButtons = page.locator('.public-filter-button-grid-subject .h-segment-btn');
    await expect(subjectButtons.first()).toBeVisible();
  });

  test('searching to a missing result shows the empty state', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const search = page.getByPlaceholder('수업명, 선생님, 강의실 검색');
    await search.fill('zz-not-found-2026');

    await expect(page.getByText('조건에 맞는 수업이 없습니다.')).toBeVisible();
  });

  test('public class card opens the mobile schedule sheet', async ({ page }) => {
    await page.goto(e2eUrl('/'));

    const cards = page.locator('.public-class-card');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      await expect(page.getByText('조건에 맞는 수업이 없습니다.')).toBeVisible();
      return;
    }

    await cards.first().click();
    await expect(page.getByTestId('class-schedule-plan-sheet')).toBeVisible();
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

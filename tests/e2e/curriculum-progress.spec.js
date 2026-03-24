import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/') => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('e2e', '1');

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

async function openCurriculumProgress(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(e2eUrl('/?role=staff'));
  await page.getByTestId('mobile-nav-curriculum-roadmap').click();
  await expect(page.getByTestId('curriculum-progress-command-bar')).toBeVisible();
}

test.describe('curriculum progress workspace', () => {
  test('sorts class cards by visible class name', async ({ page }) => {
    await openCurriculumProgress(page);

    const titles = (await page
      .locator('.curriculum-progress-entry__card .public-landing-card-title')
      .allTextContents())
      .map((value) => value.trim())
      .filter(Boolean);

    expect(titles.length).toBeGreaterThan(1);

    const expected = [...titles].sort((left, right) =>
      left.localeCompare(right, 'ko', { numeric: true, sensitivity: 'base' }),
    );

    expect(titles).toEqual(expected);
  });

  test('seeds the official class name field from the visible class title', async ({ page }) => {
    await openCurriculumProgress(page);

    const firstTitle = (
      (await page
        .locator('.curriculum-progress-entry__card .public-landing-card-title')
        .first()
        .textContent()) || ''
    ).trim();

    expect(firstTitle).not.toBe('');
    expect(firstTitle).not.toContain('[');

    await page.locator('.curriculum-progress-entry__status-actions .btn-secondary').first().click();
    await expect(page.getByTestId('class-schedule-plan-modal')).toBeVisible();

    const officialNameInput = page.getByLabel('공식 수업명');
    await expect(officialNameInput).toHaveValue(firstTitle);
    await expect(officialNameInput).not.toHaveValue(/\[/);
  });

  test('saves schedule changes from the class design modal', async ({ page }) => {
    await openCurriculumProgress(page);

    await page.locator('.curriculum-progress-entry__status-actions .btn-secondary').first().click();
    await expect(page.getByTestId('class-schedule-plan-modal')).toBeVisible();

    const saveButton = page.getByTestId('class-plan-save-button');
    await expect(saveButton).toBeDisabled();

    const countOptions = page.locator('[data-testid="planner-controls-column"] button').filter({
      hasText: '9회',
    });
    await countOptions.first().click();

    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(saveButton).toBeDisabled();
  });
});

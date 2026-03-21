import { expect, test } from '@playwright/test';

const e2eUrl = (path = '/') => {
  const [pathWithoutHash, hash = ''] = path.split('#');
  const [pathname, query = ''] = pathWithoutHash.split('?');
  const params = new URLSearchParams(query);

  params.set('e2e', '1');

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ''}`;
};

test.describe('global toss ui refresh', () => {
  test('applies toss design system tokens to the internal app shell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl('/?role=staff'));

    const shell = page.getByTestId('app-shell-root');
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute('data-design-system', 'toss-refresh');

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        primary: style.getPropertyValue('--ui-primary').trim().toLowerCase(),
        accent: style.getPropertyValue('--accent-color').trim().toLowerCase(),
        canvas: style.getPropertyValue('--bg-base').trim().toLowerCase(),
      };
    });

    expect(tokens.primary).toBe('#3182f6');
    expect(tokens.accent).toBe('#3182f6');
    expect(tokens.canvas).toBe('#f4f6fb');
  });

  test('exposes shared shell wrappers across stats, timetable, and data manager', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl('/?role=staff'));

    await expect(page.getByTestId('stats-dashboard-shell')).toBeVisible();

    await page.getByTestId('sidebar-nav-timetable').click();
    await expect(page.getByTestId('shell-timetable-section')).toBeVisible();
    await expect(page.getByTestId('class-list-workspace-shell')).toBeVisible();

    await page.getByTestId('sidebar-nav-data-manager').click();
    await expect(page.getByTestId('data-manager-shell')).toBeVisible();
    await expect(page.getByTestId('data-manager-toolbar')).toBeVisible();
  });
});

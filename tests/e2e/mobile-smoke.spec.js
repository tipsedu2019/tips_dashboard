import { expect, test } from "@playwright/test";

const e2eUrl = (path = "/", { publicView = false } = {}) => {
  const [pathWithoutHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = pathWithoutHash.split("?");
  const params = new URLSearchParams(query);

  params.set("e2e", "1");
  if (publicView) {
    params.set("view", "public");
  }

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
};

async function waitForPublicLandingResults(page) {
  await page.waitForFunction(
    () =>
      Boolean(
        document.querySelector('[data-testid="public-empty-state"]') ||
        document.querySelector('[data-testid^="public-class-card-"]'),
      ),
    null,
    { timeout: 8_000 },
  );
}

test.describe("mobile smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test("renders the public landing shell on mobile", async ({ page }) => {
    await page.goto(e2eUrl("/", { publicView: true }));

    await expect(page.getByTestId("public-mobile-topbar")).toBeVisible();
    await expect(page.getByTestId("public-class-search-input")).toBeVisible();
    await expect(page.getByTestId("public-logo-button")).toBeVisible();
    await expect(page.getByTestId("public-subject-tabs")).toBeVisible();
    await expect(page.getByTestId("public-grade-tabs")).toBeVisible();
    await expect(page.getByTestId("public-card-list")).toBeVisible();
    await expect(page.getByTestId("public-bottom-nav")).toBeVisible();
  });

  test("mobile public bottom nav swaps placeholder tabs", async ({ page }) => {
    await page.goto(e2eUrl("/", { publicView: true }));

    await page.getByTestId("public-bottom-nav-home").click();
    await expect(page.getByTestId("public-placeholder-home")).toBeVisible();

    await page.getByTestId("public-bottom-nav-classes").click();
    await expect(page.getByTestId("public-card-list")).toBeVisible();
  });

  test("searching to a missing result shows the empty state", async ({
    page,
  }) => {
    await page.goto(e2eUrl("/", { publicView: true }));

    const search = page.getByTestId("public-class-search-input");
    await search.fill("zz-not-found-2026");

    await expect(page.getByTestId("public-empty-state")).toBeVisible();
  });

  test("public class card opens the mobile schedule sheet", async ({
    page,
  }) => {
    await page.goto(e2eUrl("/", { publicView: true }));
    await waitForPublicLandingResults(page);

    const cards = page.locator('[data-testid^="public-class-card-"]');
    const cardCount = await cards.count();

    if (cardCount === 0) {
      await expect(page.getByTestId("public-empty-state")).toBeVisible();
      return;
    }

    await cards.first().locator(".public-landing-card-main").click();
    await expect(page.getByTestId("class-schedule-plan-sheet")).toBeVisible();
  });

  test("planner CTA opens after adding a class", async ({ page }) => {
    await page.goto(e2eUrl("/", { publicView: true }));
    await waitForPublicLandingResults(page);

    const plannerButtons = page.locator('[data-testid^="public-card-toggle-"]');
    const count = await plannerButtons.count();

    if (count === 0) {
      await expect(page.getByTestId("public-empty-state")).toBeVisible();
      return;
    }

    await plannerButtons.first().click();
    await expect(page.getByTestId("public-planner-cta")).toBeVisible();
  });

  test("mobile academic views use the bottom nav without a duplicate top switcher", async ({
    page,
  }) => {
    await page.goto(e2eUrl("/", { publicView: true }));
    const publicNavHeight = await page
      .getByTestId("public-bottom-nav")
      .evaluate((node) => node.getBoundingClientRect().height);

    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-academic-calendar").click();
    await expect(page.getByTestId("mobile-academic-switcher")).toHaveCount(0);
    await expect(page.getByTestId("app-bottom-nav-logout")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-floating-actions")).toBeVisible();

    const utilityMetrics = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="app-bottom-nav"]');
      const theme = document.querySelector(
        '[data-testid="app-bottom-nav-theme"]',
      );
      const publicButton = document.querySelector(
        '[data-testid="app-bottom-nav-public"]',
      );
      const navRect = nav?.getBoundingClientRect();
      const themeRect = theme?.getBoundingClientRect();
      const publicRect = publicButton?.getBoundingClientRect();

      return {
        navHeight: navRect?.height ?? 0,
        navRight: navRect?.right ?? 0,
        themeLeft: themeRect?.left ?? 0,
        publicLeft: publicRect?.left ?? 0,
        themeTop: themeRect?.top ?? 0,
        publicTop: publicRect?.top ?? 0,
      };
    });

    expect(
      Math.abs(utilityMetrics.navHeight - publicNavHeight),
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(utilityMetrics.themeLeft - utilityMetrics.publicLeft),
    ).toBeLessThanOrEqual(4);
    expect(
      Math.abs(utilityMetrics.navRight - utilityMetrics.publicLeft - 40),
    ).toBeLessThanOrEqual(16);
    expect(utilityMetrics.themeTop).toBeLessThan(utilityMetrics.publicTop);

    await page.getByTestId("mobile-nav-curriculum-roadmap").click();
    await expect(page.getByTestId("curriculum-roadmap-placeholder")).toBeVisible();
  });

  test("mobile dashboard hides the heavy data management menus", async ({
    page,
  }) => {
    await page.goto(e2eUrl("/?role=staff"));

    await expect(page.getByTestId("mobile-nav-students-manager")).toHaveCount(0);
    await expect(page.getByTestId("mobile-nav-classes-manager")).toHaveCount(0);
    await expect(page.getByTestId("mobile-nav-textbooks-manager")).toHaveCount(0);
  });

  test("mobile class list cards can open the plan sheet", async ({ page }) => {
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();

    const firstCard = page
      .locator('[data-testid^="data-list-mobile-card-"]')
      .first();
    await expect(firstCard).toBeVisible();

    const detailButton = page
      .locator('[data-testid^="data-list-mobile-card-detail-"]')
      .first();
    if (await detailButton.count()) {
      await detailButton.evaluate((node) =>
        node.scrollIntoView({ block: "center", inline: "nearest" }),
      );
      await detailButton.click();
    } else {
      const landingCardMain = firstCard.locator(".public-landing-card-main");
      if (await landingCardMain.count()) {
        await landingCardMain.click({ force: true });
      } else {
        await firstCard
          .getByRole("button", { name: "상세 보기" })
          .click({ force: true });
      }
    }

    const detailModal = page.locator(".modal-overlay").last();
    await expect(detailModal).toBeVisible();
    await detailModal.getByRole("button", { name: "상세 정보" }).click();
    await expect(
      detailModal.getByRole("button", { name: "크게 보기" }),
    ).toBeVisible();
    await detailModal.getByRole("button", { name: "크게 보기" }).click();
    await expect(page.getByTestId("class-schedule-plan-sheet")).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toHaveCSS("opacity", "0");
  });

  test("mobile stats dashboard can scroll when content exceeds the viewport", async ({
    page,
  }) => {
    await page.goto(e2eUrl("/?role=staff"));

    const shell = page.getByTestId("stats-dashboard-shell");
    await expect(shell).toBeVisible();

    const initialMetrics = await page.evaluate(() => {
      const doc = document.documentElement;

      return {
        clientHeight: doc.clientHeight,
        scrollHeight: doc.scrollHeight,
      };
    });

    expect(initialMetrics.scrollHeight).toBeGreaterThan(
      initialMetrics.clientHeight,
    );

    await page.evaluate(
      (maxScrollTop) => {
        window.scrollTo({ top: maxScrollTop, behavior: "auto" });
      },
      Math.max(0, initialMetrics.scrollHeight - initialMetrics.clientHeight),
    );
    await page.waitForTimeout(120);

    const scrollState = await page.evaluate(() => {
      const dashboard = document.querySelector(
        '[data-testid="stats-dashboard-shell"]',
      );
      return {
        scrollY: window.scrollY,
        shellTop: dashboard?.getBoundingClientRect().top ?? 0,
      };
    });

    expect(scrollState.scrollY).toBeGreaterThan(0);
    expect(scrollState.shellTop).toBeLessThan(0);
  });
});

import { expect, test } from "@playwright/test";

const e2eUrl = (path = "/") => {
  const [pathWithoutHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = pathWithoutHash.split("?");
  const params = new URLSearchParams(query);

  params.set("e2e", "1");

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
};

test.describe("global toss ui refresh", () => {
  test("applies toss design system tokens to the internal app shell", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(e2eUrl("/?role=staff"));

    const shell = page.getByTestId("app-shell-root");
    await expect(shell).toBeVisible();
    await expect(shell).toHaveAttribute("data-design-system", "toss-refresh");

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const shellStyle = getComputedStyle(
        document.querySelector('[data-testid="app-shell-root"]'),
      );
      const mainStyle = getComputedStyle(
        document.querySelector(".main-content"),
      );
      return {
        primary: style.getPropertyValue("--ui-primary").trim().toLowerCase(),
        accent: style.getPropertyValue("--accent-color").trim().toLowerCase(),
        canvas: style.getPropertyValue("--bg-base").trim().toLowerCase(),
        maxWidth: shellStyle.maxWidth,
        scrollbarGutter: mainStyle.scrollbarGutter,
      };
    });

    expect(tokens.primary).toBe("#3182f6");
    expect(tokens.accent).toBe("#3182f6");
    expect(tokens.canvas).toBe("#f2f4f6");
    expect(tokens.maxWidth).toBe("none");
    expect(tokens.scrollbarGutter).toBe("auto");
  });

  test("exposes shared shell wrappers across stats, timetable, and standalone manager views", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl("/?role=staff"));

    await expect(page.getByTestId("stats-dashboard-shell")).toBeVisible();

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();
    await expect(page.getByTestId("timetable-headless-toolbar")).toBeVisible();

    await page.getByTestId("mobile-nav-classes-manager").click();
    await expect(page.getByTestId("classes-manager-shell")).toBeVisible();

    await page.getByTestId("mobile-nav-textbooks-manager").click();
    await expect(page.getByTestId("textbooks-manager-shell")).toBeVisible();
  });

  test("uses a unified dashboard bottom menu and removes legacy dashboard chrome on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl("/?role=staff"));

    await expect(page.getByTestId("dashboard-shell-topbar")).toHaveCount(0);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.getByTestId("app-bottom-nav")).toBeVisible();
    await expect(page.getByTestId("app-bottom-nav-theme")).toBeVisible();
    await expect(page.getByTestId("app-bottom-nav-public")).toBeVisible();
    await expect(page.getByTestId("app-bottom-nav-logout")).toBeVisible();
    await expect(
      page.getByTestId("mobile-nav-curriculum-roadmap"),
    ).toBeVisible();
    await expect(page.getByTestId("mobile-nav-students-manager")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-classes-manager")).toBeVisible();
    await expect(page.getByTestId("mobile-nav-textbooks-manager")).toBeVisible();

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();

    await page.getByTestId("mobile-nav-students-manager").click();
    await expect(page.getByTestId("students-manager-shell")).toBeVisible();
  });

  test("shows the public bottom nav on desktop too", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl("/?view=public"));

    await expect(page.getByTestId("public-mobile-topbar")).toBeVisible();
    await expect(page.getByTestId("public-bottom-nav")).toBeVisible();

    const publicNavMetrics = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="public-bottom-nav"]');
      const buttons = Array.from(
        document.querySelectorAll('[data-testid^="public-bottom-nav-"]'),
      );
      const navRect = nav?.getBoundingClientRect();
      const buttonRects = buttons.map((button) =>
        button.getBoundingClientRect(),
      );
      const groupLeft = Math.min(...buttonRects.map((rect) => rect.left));
      const groupRight = Math.max(...buttonRects.map((rect) => rect.right));

      return {
        navBottom: navRect?.bottom ?? 0,
        navHeight: navRect?.height ?? 0,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        groupCenter: (groupLeft + groupRight) / 2,
        groupWidth: groupRight - groupLeft,
      };
    });

    expect(
      Math.abs(publicNavMetrics.navBottom - publicNavMetrics.viewportHeight),
    ).toBeLessThanOrEqual(2);
    expect(publicNavMetrics.navHeight).toBeLessThanOrEqual(58);
    expect(
      Math.abs(
        publicNavMetrics.groupCenter - publicNavMetrics.viewportWidth / 2,
      ),
    ).toBeLessThanOrEqual(24);
    expect(publicNavMetrics.groupWidth).toBeLessThan(
      publicNavMetrics.viewportWidth * 0.65,
    );

    await page.getByTestId("public-bottom-nav-home").click();
    await expect(page.getByTestId("public-placeholder-home")).toBeVisible();
  });

  test("keeps dashboard actions integrated inside the fixed bottom menu on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));
    await expect(page.getByTestId("app-shell-root")).toBeVisible();

    const dashboardShellMetrics = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="app-bottom-nav"]');
      const actions = document.querySelector(
        '[data-testid="dashboard-bottom-nav-actions"]',
      );
      const leading = document.querySelector(
        '[data-testid="dashboard-bottom-nav-leading"]',
      );
      const navGrid = document.querySelector(
        ".dashboard-shell-bottom-nav-grid",
      );
      const main = document.querySelector(".main-content");
      const sidebar = document.querySelector(".sidebar");
      const topbar = document.querySelector(
        '[data-testid="dashboard-shell-topbar"]',
      );
      const navRect = nav?.getBoundingClientRect();
      const actionRect = actions?.getBoundingClientRect();
      const leadingRect = leading?.getBoundingClientRect();
      const gridRect = navGrid?.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const themeButtonRect = document
        .querySelector('[data-testid="app-bottom-nav-theme"]')
        ?.getBoundingClientRect();
      const publicButtonRect = document
        .querySelector('[data-testid="app-bottom-nav-public"]')
        ?.getBoundingClientRect();

      return {
        hasSidebar: Boolean(sidebar),
        hasTopbar: Boolean(topbar),
        navBottom: navRect?.bottom ?? 0,
        navHeight: navRect?.height ?? 0,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        leadingLeft: leadingRect?.left ?? 0,
        actionTop: actionRect?.top ?? 0,
        actionRight: actionRect?.right ?? 0,
        gridBottom: gridRect?.bottom ?? 0,
        gridCenter: gridRect ? gridRect.left + gridRect.width / 2 : 0,
        mainWidth: mainRect?.width ?? 0,
        themeButtonWidth: themeButtonRect?.width ?? 0,
        themeButtonHeight: themeButtonRect?.height ?? 0,
        publicButtonWidth: publicButtonRect?.width ?? 0,
        publicButtonHeight: publicButtonRect?.height ?? 0,
      };
    });

    expect(dashboardShellMetrics.hasSidebar).toBe(false);
    expect(dashboardShellMetrics.hasTopbar).toBe(false);
    expect(
      Math.abs(
        dashboardShellMetrics.navBottom - dashboardShellMetrics.viewportHeight,
      ),
    ).toBeLessThanOrEqual(2);
    expect(dashboardShellMetrics.navHeight).toBeLessThanOrEqual(58);
    expect(dashboardShellMetrics.mainWidth).toBeGreaterThan(
      dashboardShellMetrics.viewportWidth * 0.9,
    );
    expect(dashboardShellMetrics.leadingLeft).toBeLessThanOrEqual(24);
    expect(
      Math.abs(
        dashboardShellMetrics.gridCenter -
          dashboardShellMetrics.viewportWidth / 2,
      ),
    ).toBeLessThanOrEqual(24);
    expect(
      Math.abs(
        dashboardShellMetrics.actionRight - dashboardShellMetrics.viewportWidth,
      ),
    ).toBeLessThanOrEqual(40);
    expect(dashboardShellMetrics.actionTop).toBeLessThan(
      dashboardShellMetrics.gridBottom,
    );
    expect(dashboardShellMetrics.themeButtonWidth).toBeCloseTo(40, 0);
    expect(dashboardShellMetrics.themeButtonHeight).toBeCloseTo(40, 0);
    expect(dashboardShellMetrics.publicButtonWidth).toBeCloseTo(40, 0);
    expect(dashboardShellMetrics.publicButtonHeight).toBeCloseTo(40, 0);
  });

  test("removes the duplicate class list tab from timetable and keeps teacher classroom filters expanded", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();
    await expect(page.getByTestId("dashboard-class-filter-tabs")).toHaveCount(
      0,
    );

    await expect(
      page.getByRole("button", { name: "수업 시간표" }),
    ).toHaveCount(0);

    const classListFilterMetrics = await page.evaluate(() => {
      const teacherGrid = document.querySelector(
        ".timetable-unified-filter-section-teacher .timetable-unified-filter-chip-grid",
      );
      const classroomGrid = document.querySelector(
        ".timetable-unified-filter-section-classroom .timetable-unified-filter-chip-grid",
      );
      const filterShell = document.querySelector(
        '[data-testid="timetable-unified-filter"]',
      );
      const filterStyle = filterShell ? getComputedStyle(filterShell) : null;
      return {
        teacherOverflowY: teacherGrid
          ? getComputedStyle(teacherGrid).overflowY
          : null,
        classroomOverflowY: classroomGrid
          ? getComputedStyle(classroomGrid).overflowY
          : null,
        filterBorderTopWidth: filterStyle?.borderTopWidth ?? null,
        filterBoxShadow: filterStyle?.boxShadow ?? null,
      };
    });

    expect(classListFilterMetrics.teacherOverflowY).toBe("visible");
    expect(classListFilterMetrics.classroomOverflowY).toBe("visible");
    expect(classListFilterMetrics.filterBorderTopWidth).toBe("0px");
    expect(classListFilterMetrics.filterBoxShadow).toBe("none");
  });
});

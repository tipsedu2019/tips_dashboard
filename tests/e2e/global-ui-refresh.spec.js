import { expect, test } from "@playwright/test";

const e2eUrl = (path = "/") => {
  const [pathWithoutHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = pathWithoutHash.split("?");
  const params = new URLSearchParams(query);

  params.set("e2e", "1");

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
};

test.describe("global toss ui refresh", () => {
  test("allows localhost role previews to boot the internal shell without an explicit e2e flag", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/?role=staff");

    await expect(page.getByTestId("app-shell-root")).toBeVisible();
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.getByTestId("app-bottom-nav")).toBeVisible();

    await page.getByTestId("mobile-nav-curriculum-roadmap").click();
    await expect(page.getByTestId("curriculum-progress-command-bar")).toBeVisible();
  });

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

  test("keeps the recent desktop bottom taskbar navigation instead of the old sidebar", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(e2eUrl("/?role=staff"));

    await expect(page.getByTestId("dashboard-shell-topbar")).toHaveCount(0);
    await expect(page.locator(".sidebar")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-sidebar-nav")).toHaveCount(0);
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

  test("matches the desktop main bottom nav height to the public bottom nav height", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });

    await page.goto(e2eUrl("/?view=public"));
    await expect(page.getByTestId("public-bottom-nav")).toBeVisible();

    const publicNavHeight = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="public-bottom-nav"]');
      return nav?.getBoundingClientRect().height ?? 0;
    });

    await page.goto(e2eUrl("/?role=staff"));
    await expect(page.getByTestId("app-bottom-nav")).toBeVisible();

    const desktopNavHeight = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="app-bottom-nav"]');
      return nav?.getBoundingClientRect().height ?? 0;
    });

    expect(Math.abs(desktopNavHeight - publicNavHeight)).toBeLessThanOrEqual(2);
  });

  test("anchors dashboard actions inside the desktop bottom taskbar on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));
    await expect(page.getByTestId("app-shell-root")).toBeVisible();

    const dashboardShellMetrics = await page.evaluate(() => {
      const bottomNav = document.querySelector('[data-testid="app-bottom-nav"]');
      const sidebar = document.querySelector(".sidebar");
      const main = document.querySelector(".main-content");
      const topbar = document.querySelector(
        '[data-testid="dashboard-shell-topbar"]',
      );
      const bottomNavRect = bottomNav?.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const themeButtonRect = document
        .querySelector('[data-testid="app-bottom-nav-theme"]')
        ?.getBoundingClientRect();
      const publicButtonRect = document
        .querySelector('[data-testid="app-bottom-nav-public"]')
        ?.getBoundingClientRect();
      const logoutButtonRect = document
        .querySelector('[data-testid="app-bottom-nav-logout"]')
        ?.getBoundingClientRect();

      return {
        hasSidebar: Boolean(sidebar),
        hasBottomNav: Boolean(bottomNav),
        hasTopbar: Boolean(topbar),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        bottomNavHeight: bottomNavRect?.height ?? 0,
        bottomNavBottom: bottomNavRect?.bottom ?? 0,
        bottomNavTop: bottomNavRect?.top ?? 0,
        mainWidth: mainRect?.width ?? 0,
        themeButtonInside:
          Boolean(themeButtonRect && bottomNavRect) &&
          themeButtonRect.top >= bottomNavRect.top - 1 &&
          themeButtonRect.bottom <= bottomNavRect.bottom + 1,
        publicButtonInside:
          Boolean(publicButtonRect && bottomNavRect) &&
          publicButtonRect.top >= bottomNavRect.top - 1 &&
          publicButtonRect.bottom <= bottomNavRect.bottom + 1,
        logoutButtonInside:
          Boolean(logoutButtonRect && bottomNavRect) &&
          logoutButtonRect.top >= bottomNavRect.top - 1 &&
          logoutButtonRect.bottom <= bottomNavRect.bottom + 1,
        utilityButtonsAligned:
          Boolean(themeButtonRect && publicButtonRect && logoutButtonRect) &&
          Math.max(
            Math.abs(themeButtonRect.top - publicButtonRect.top),
            Math.abs(publicButtonRect.top - logoutButtonRect.top),
          ) <= 6,
      };
    });

    expect(dashboardShellMetrics.hasSidebar).toBe(false);
    expect(dashboardShellMetrics.hasBottomNav).toBe(true);
    expect(dashboardShellMetrics.hasTopbar).toBe(false);
    expect(dashboardShellMetrics.bottomNavHeight).toBeGreaterThanOrEqual(56);
    expect(
      Math.abs(
        dashboardShellMetrics.bottomNavBottom -
          dashboardShellMetrics.viewportHeight,
      ),
    ).toBeLessThanOrEqual(2);
    expect(dashboardShellMetrics.bottomNavTop).toBeGreaterThan(
      dashboardShellMetrics.viewportHeight - 120,
    );
    expect(dashboardShellMetrics.mainWidth).toBeGreaterThan(
      dashboardShellMetrics.viewportWidth * 0.78,
    );
    expect(dashboardShellMetrics.themeButtonInside).toBe(true);
    expect(dashboardShellMetrics.publicButtonInside).toBe(true);
    expect(dashboardShellMetrics.logoutButtonInside).toBe(true);
    expect(dashboardShellMetrics.utilityButtonsAligned).toBe(true);
  });

  test("centers the desktop bottom nav icon group like the public bottom nav", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));
    await expect(page.getByTestId("app-bottom-nav")).toBeVisible();

    const navMetrics = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll('[data-testid^="mobile-nav-"]'),
      );
      const nav = document.querySelector('[data-testid="app-bottom-nav"]');
      const logoutButton = document.querySelector(
        '[data-testid="app-bottom-nav-logout"]',
      );
      const themeButton = document.querySelector(
        '[data-testid="app-bottom-nav-theme"]',
      );
      const publicButton = document.querySelector(
        '[data-testid="app-bottom-nav-public"]',
      );
      const navRect = nav?.getBoundingClientRect();
      const buttonRects = buttons.map((button) =>
        button.getBoundingClientRect(),
      );
      const groupLeft = Math.min(...buttonRects.map((rect) => rect.left));
      const groupRight = Math.max(...buttonRects.map((rect) => rect.right));
      const logoutRect = logoutButton?.getBoundingClientRect();
      const themeRect = themeButton?.getBoundingClientRect();
      const publicRect = publicButton?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        navWidth: navRect?.width ?? 0,
        groupWidth: groupRight - groupLeft,
        groupCenter: (groupLeft + groupRight) / 2,
        logoutLeftGap:
          navRect && logoutRect ? logoutRect.left - navRect.left : Number.NaN,
        publicRightGap:
          navRect && publicRect ? navRect.right - publicRect.right : Number.NaN,
        themeRightGap:
          navRect && themeRect ? navRect.right - themeRect.right : Number.NaN,
        publicToThemeGap:
          themeRect && publicRect ? publicRect.left - themeRect.right : Number.NaN,
      };
    });

    expect(
      Math.abs(navMetrics.groupCenter - navMetrics.viewportWidth / 2),
    ).toBeLessThanOrEqual(12);
    expect(navMetrics.groupWidth).toBeLessThan(navMetrics.navWidth * 0.65);
    expect(navMetrics.logoutLeftGap).toBeLessThanOrEqual(48);
    expect(navMetrics.publicRightGap).toBeLessThanOrEqual(48);
    expect(navMetrics.themeRightGap).toBeGreaterThan(navMetrics.publicRightGap);
    expect(navMetrics.publicToThemeGap).toBeLessThanOrEqual(16);
  });

  test("keeps the desktop academic calendar tabs compact and lets the month grid fill the workspace", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-academic-calendar").click();
    await expect(page.getByTestId("academic-workspace-tabs")).toBeVisible();
    await expect(page.getByTestId("calendar-month-grid")).toBeVisible();

    const calendarMetrics = await page.evaluate(() => {
      const shell = document.querySelector(".academic-calendar-shell");
      const main = document.querySelector(".academic-calendar-main");
      const monthGridWrapper = document.querySelector(
        '[data-testid="calendar-month-grid"]',
      );
      const tabTrack = document.querySelector(
        ".academic-workspace-tab-control .tds-tab__track",
      );
      const weekBlocks = Array.from(
        document.querySelectorAll(".academic-week-block"),
      );

      const shellRect = shell?.getBoundingClientRect();
      const mainRect = main?.getBoundingClientRect();
      const wrapperRect = monthGridWrapper?.getBoundingClientRect();
      const tabTrackRect = tabTrack?.getBoundingClientRect();

      return {
        viewportWidth: window.innerWidth,
        shellHeight: shellRect?.height ?? 0,
        mainHeight: mainRect?.height ?? 0,
        wrapperHeight: wrapperRect?.height ?? 0,
        trackWidth: tabTrackRect?.width ?? 0,
        trackCenterDelta: tabTrackRect
          ? Math.abs(
              (tabTrackRect.left + tabTrackRect.right) / 2 -
                window.innerWidth / 2,
            )
          : Number.POSITIVE_INFINITY,
        weekBlockHeights: weekBlocks.map((block) =>
          block.getBoundingClientRect().height,
        ),
      };
    });

    expect(calendarMetrics.wrapperHeight).toBeGreaterThan(
      calendarMetrics.mainHeight * 0.75,
    );
    expect(calendarMetrics.trackWidth).toBeLessThan(
      calendarMetrics.viewportWidth * 0.72,
    );
    expect(calendarMetrics.trackCenterDelta).toBeLessThanOrEqual(16);
    expect(
      Math.min(...calendarMetrics.weekBlockHeights),
    ).toBeGreaterThanOrEqual(84);
  });

  test("gives the desktop academic calendar the same breathing room as manager workspaces and keeps the annual board scrollable", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-academic-calendar").click();
    await expect(page.getByTestId("academic-workspace-tabs")).toBeVisible();

    const monthViewMetrics = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="app-shell-root"]');
      const workspace = document.querySelector(".academic-calendar-workspace");
      const tabs = document.querySelector('[data-testid="academic-workspace-tabs"]');
      const shellRect = shell?.getBoundingClientRect();
      const workspaceRect = workspace?.getBoundingClientRect();
      const tabsRect = tabs?.getBoundingClientRect();
      return {
        leftGap: workspaceRect && shellRect ? workspaceRect.left - shellRect.left : 0,
        rightGap: workspaceRect && shellRect ? shellRect.right - workspaceRect.right : 0,
        topGap: workspaceRect && tabsRect ? tabsRect.top - workspaceRect.top : 0,
      };
    });

    expect(monthViewMetrics.leftGap).toBeGreaterThanOrEqual(16);
    expect(monthViewMetrics.rightGap).toBeGreaterThanOrEqual(16);
    expect(monthViewMetrics.topGap).toBeGreaterThanOrEqual(12);

    await page.getByTestId("academic-workspace-tab-school-board").click();
    await page.waitForTimeout(250);

    const annualBoardMetrics = await page.evaluate(() => {
      const report = document.querySelector(".academic-roadmap-embed__report");
      const main = document.querySelector(".main-content.main-content-academic-calendar");
      return {
        overflowY: report ? getComputedStyle(report).overflowY : null,
        mainOverflowY: main ? getComputedStyle(main).overflowY : null,
        clientHeight: report?.clientHeight ?? 0,
      };
    });

    expect(["auto", "scroll"]).toContain(annualBoardMetrics.overflowY);
    expect(["auto", "scroll"]).toContain(annualBoardMetrics.mainOverflowY);
    expect(annualBoardMetrics.clientHeight).toBeGreaterThan(0);
  });

  test("keeps the intentional compact timetable top filter bar on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();
    await expect(page.getByTestId("dashboard-class-filter-tabs")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("timetable-unified-filter")).toHaveCount(0);
    await expect(page.getByTestId("timetable-top-filter-bar")).toBeVisible();

    const compactTopBarMetrics = await page.evaluate(() => {
      const topBar = document.querySelector(
        '[data-testid="timetable-top-filter-bar"]',
      );
      const main = document.querySelector(
        '[data-testid="timetable-top-filter-bar-main"]',
      );
      const term = document.querySelector(
        '[data-testid="timetable-top-filter-bar-term"] .tds-checkbox-menu__trigger',
      );
      const subject = document.querySelector(
        '[data-testid="timetable-top-filter-bar-subject"]',
      );
      const axis = document.querySelector(
        '[data-testid="timetable-top-filter-bar-axis"]',
      );
      const slot = document.querySelector(
        '[data-testid="timetable-top-filter-bar-slot"]',
      );
      const actions = document.querySelector(
        '[data-testid="timetable-top-filter-bar-actions"]',
      );
      const subjectSegment = document.querySelector(
        ".timetable-top-filter-bar__segmented-subject",
      );
      return {
        topBarDisplay: topBar ? getComputedStyle(topBar).display : null,
        mainDisplay: main ? getComputedStyle(main).display : null,
        slotJustifyContent: slot ? getComputedStyle(slot).justifyContent : null,
        actionsDisplay: actions ? getComputedStyle(actions).display : null,
        termMinHeight: term ? getComputedStyle(term).minHeight : null,
        subjectMaxWidth: subjectSegment
          ? getComputedStyle(subjectSegment).maxWidth
          : null,
        subjectWidth: subject?.getBoundingClientRect().width ?? 0,
        axisWidth: axis?.getBoundingClientRect().width ?? 0,
      };
    });

    expect(compactTopBarMetrics.topBarDisplay).toBe("flex");
    expect(compactTopBarMetrics.mainDisplay).toBe("grid");
    expect(compactTopBarMetrics.slotJustifyContent).toBe("flex-end");
    expect(compactTopBarMetrics.actionsDisplay).toBe("flex");
    expect(compactTopBarMetrics.termMinHeight).toBe("44px");
    expect(compactTopBarMetrics.subjectMaxWidth).toBe("160px");
    expect(compactTopBarMetrics.subjectWidth).toBeGreaterThan(0);
    expect(compactTopBarMetrics.axisWidth).toBeGreaterThan(0);
    expect(compactTopBarMetrics.subjectWidth).toBeLessThan(
      compactTopBarMetrics.axisWidth,
    );
  });

  test("gives the desktop timetable top rail a clear active contrast", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 980 });
    await page.goto(e2eUrl("/?role=staff"));

    await page.getByTestId("mobile-nav-timetable").click();
    await expect(page.getByTestId("shell-timetable-section")).toBeVisible();

    const axisItem = page
      .locator(".timetable-top-filter-bar__segmented-axis .tds-segmented__item")
      .first();
    await expect(axisItem).toBeVisible();
    await axisItem.click();
    await page.waitForTimeout(350);

    const activeStyles = await page.evaluate(() => {
      const activeItem = document.querySelector(
        ".timetable-top-filter-bar__segmented-axis .tds-segmented__item.is-active",
      );
      const styles = activeItem ? getComputedStyle(activeItem) : null;

      return {
        backgroundColor: styles?.backgroundColor ?? null,
        color: styles?.color ?? null,
        borderColor: styles?.borderColor ?? null,
        boxShadow: styles?.boxShadow ?? "",
      };
    });

    expect(activeStyles.backgroundColor).toBe("rgb(49, 130, 246)");
    expect(activeStyles.color).toBe("rgb(255, 255, 255)");
    expect(activeStyles.borderColor).toBe("rgb(49, 130, 246)");
    expect(activeStyles.boxShadow).not.toBe("none");
  });
});

import { expect, test } from "@playwright/test";

const e2eUrl = (path = "/") => {
  const [pathWithoutHash, hash = ""] = path.split("#");
  const [pathname, query = ""] = pathWithoutHash.split("?");
  const params = new URLSearchParams(query);

  params.set("e2e", "1");

  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`;
};

const openClassPlanModal = async (page) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(e2eUrl("/?role=staff"));

  await page.getByTestId("mobile-nav-classes-manager").click();
  await page.getByRole("button", { name: "수업 등록" }).click();
  await page.getByRole("button", { name: "수업 계획 열기" }).click({ force: true });

  await expect(page.getByTestId("class-schedule-plan-modal")).toBeVisible();
};

const openExistingClassPlanModal = async (page) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(e2eUrl("/?role=staff"));

  await page.getByTestId("mobile-nav-curriculum-roadmap").click();
  await expect(page.getByTestId("curriculum-progress-command-bar")).toBeVisible();

  await page
    .locator(".curriculum-progress-entry__status-actions .btn-secondary")
    .first()
    .click();

  await expect(page.getByTestId("class-schedule-plan-modal")).toBeVisible();
};

test.describe("class plan v2", () => {
test("keeps the builder focused on schedule, progress, and textbook work instead of duplicate setup and review sections", async ({
  page,
}) => {
  await openClassPlanModal(page);

  await expect(page.getByTestId("class-plan-builder-stepper")).toHaveCount(0);
  await expect(page.getByTestId("class-plan-builder-section-settings")).toHaveCount(0);
  await expect(page.getByTestId("class-plan-builder-section-schedule")).toBeVisible();
  await expect(page.getByTestId("class-plan-builder-section-progress")).toBeVisible();
  await expect(page.getByTestId("class-plan-builder-section-textbooks")).toBeVisible();
  await expect(page.getByTestId("class-plan-builder-section-review")).toHaveCount(0);
  await expect(page.locator(".class-plan-desktop-save")).toBeVisible();
  await expect(page.getByTestId("class-plan-save-bar")).toHaveCount(0);
  await expect(page.getByTestId("class-plan-save-button")).toHaveCount(1);
  await expect(page.getByTestId("class-plan-tab-schedule")).toHaveCount(0);
  await expect(page.getByTestId("class-plan-tab-plan")).toHaveCount(0);
  await expect(page.getByTestId("class-plan-tab-actual")).toHaveCount(0);
});

test("keeps metadata in the desktop header, preview on the right, and header-level save action", async ({
  page,
}) => {
  await openClassPlanModal(page);

    await expect(page.getByTestId("class-plan-desktop-header-meta")).toBeVisible();
    await expect(page.getByTestId("class-plan-desktop-header-main-row")).toBeVisible();
    await expect(page.getByTestId("class-plan-builder-preview")).toBeVisible();
    await expect(page.getByTestId("class-plan-save-bar")).toHaveCount(0);
    await expect(
      page.locator(".class-plan-desktop-header-actions .class-plan-desktop-save"),
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="class-plan-builder-preview"] .class-plan-preview-subtitle'),
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-testid="class-plan-builder-preview"] .class-plan-preview-badge-row',
      ),
    ).toBeVisible();

    const workspaceMetrics = await page.evaluate(() => {
      const measure = (selector) => {
        const node = document.querySelector(selector);
        if (!node) {
          return null;
        }

        const rect = node.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
        };
      };

      const builderLayout = document.querySelector(
        '[data-testid="class-plan-builder-layout"]',
      );

      return {
        title: measure(".class-plan-desktop-header-subtitle"),
        headerMeta: measure('[data-testid="class-plan-desktop-header-meta"]'),
        headerActions: measure(".class-plan-desktop-header-actions"),
        main: measure(".class-plan-builder-main"),
        preview: measure('[data-testid="class-plan-builder-preview"]'),
        desktopSave: measure(".class-plan-desktop-save"),
        shellColumns: builderLayout
          ? getComputedStyle(builderLayout).gridTemplateColumns
          : "",
      };
    });

    expect(workspaceMetrics.title).not.toBeNull();
    expect(workspaceMetrics.headerMeta).not.toBeNull();
    expect(workspaceMetrics.headerActions).not.toBeNull();
    expect(workspaceMetrics.main).not.toBeNull();
    expect(workspaceMetrics.preview).not.toBeNull();
    expect(workspaceMetrics.desktopSave).not.toBeNull();
    expect(
      Math.abs(workspaceMetrics.title.y - workspaceMetrics.headerMeta.y),
    ).toBeLessThan(10);
    expect(workspaceMetrics.headerMeta.x).toBeGreaterThan(
      workspaceMetrics.title.right + 12,
    );
    expect(workspaceMetrics.headerActions.x).toBeGreaterThan(
      workspaceMetrics.headerMeta.right + 12,
    );
    expect(workspaceMetrics.preview.x).toBeGreaterThan(workspaceMetrics.main.right + 12);
    expect(Math.abs(workspaceMetrics.preview.y - workspaceMetrics.main.y)).toBeLessThan(80);
    expect(workspaceMetrics.desktopSave.x).toBeGreaterThan(
      workspaceMetrics.headerMeta.right + 12,
    );
  expect(
    workspaceMetrics.shellColumns.trim().split(/\s+/).length,
  ).toBeGreaterThanOrEqual(2);
    expect(page.getByTestId("class-plan-save-button")).toHaveCount(1);
  });

test("shows the schedule planner as a two-column controls workspace when the modal owns the preview rail", async ({
  page,
}) => {
  await openClassPlanModal(page);

  const scheduleSection = page.getByTestId("class-plan-builder-section-schedule");
  await expect(scheduleSection).toBeVisible();
  await expect(scheduleSection.locator(".planner-controls-column.is-builder-split")).toBeVisible();

  const splitMetrics = await scheduleSection.evaluate((node) => {
    const controls = node.querySelector(".planner-controls-column.is-builder-split");
    const setup = node.querySelector(".planner-panel--setup");
    const periods = node.querySelector(".planner-panel--periods");

    if (!controls || !setup || !periods) {
      return null;
    }

    const setupRect = setup.getBoundingClientRect();
    const periodsRect = periods.getBoundingClientRect();

    return {
      columns: getComputedStyle(controls).gridTemplateColumns.trim().split(/\s+/).length,
      verticalDelta: Math.abs(setupRect.top - periodsRect.top),
      horizontalGap: periodsRect.left - setupRect.right,
    };
  });

  expect(splitMetrics).not.toBeNull();
  expect(splitMetrics.columns).toBeGreaterThanOrEqual(2);
  expect(splitMetrics.verticalDelta).toBeLessThanOrEqual(8);
  expect(splitMetrics.horizontalGap).toBeGreaterThan(12);
});

  test("renders the session list as a vertical progress stepper with a single active dot", async ({
    page,
  }) => {
    await openExistingClassPlanModal(page);

    const preview = page.getByTestId("class-plan-builder-preview");

    await expect(
      preview.locator(".class-plan-session-vertical-list").first(),
    ).toBeVisible();
    await expect(
      preview.locator(".class-plan-session-vertical-group").first(),
    ).toBeVisible();
    await expect(
      preview.locator(".class-plan-session-group-track").first(),
    ).toBeVisible();

    const stepperMetrics = await preview.evaluate((node) => {
      const stem = node.querySelector(".class-plan-stepper-stem");
      const activeDots = node.querySelectorAll(".class-plan-stepper-dot.is-active");
      const activeDot = activeDots[0];
      const groupTrack = node.querySelector(".class-plan-session-group-track");

      return {
        activeCount: activeDots.length,
        stemWidth: stem?.getBoundingClientRect().width ?? 0,
        activeBoxShadow: activeDot ? getComputedStyle(activeDot).boxShadow : "none",
        activeBackground: activeDot
          ? getComputedStyle(activeDot).backgroundColor
          : "transparent",
        groupTrackBackground: groupTrack
          ? getComputedStyle(groupTrack).backgroundImage
          : "none",
      };
    });

    expect(stepperMetrics.activeCount).toBe(1);
    expect(stepperMetrics.stemWidth).toBeGreaterThanOrEqual(23);
    expect(stepperMetrics.activeBoxShadow).not.toBe("none");
    expect(stepperMetrics.activeBackground).not.toBe("transparent");
    expect(stepperMetrics.groupTrackBackground).toContain("linear-gradient");
    await expect(preview.locator(".class-plan-session-table")).toHaveCount(0);
  });

  test("aligns each monthly progress track exactly with the first and last stepper circles", async ({
    page,
  }) => {
    await openExistingClassPlanModal(page);

    const preview = page.getByTestId("class-plan-builder-preview");

    const trackAlignment = await preview.evaluate((node) => {
      const group = node.querySelector(
        ".class-plan-session-vertical-group .class-plan-session-vertical-list",
      );
      if (!group) {
        return null;
      }

      const track = group.querySelector(".class-plan-session-group-track");
      const dots = Array.from(
        group.querySelectorAll(".class-plan-stepper-dot"),
      );

      if (!track || dots.length < 2) {
        return null;
      }

      const firstDot = dots[0];
      const lastDot = dots[dots.length - 1];
      const groupRect = group.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();
      const firstRect = firstDot.getBoundingClientRect();
      const lastRect = lastDot.getBoundingClientRect();

      return {
        trackTopFromGroup: trackRect.top - groupRect.top,
        trackBottomFromGroup: groupRect.bottom - trackRect.bottom,
        firstEdgeFromGroup: firstRect.top - groupRect.top,
        lastEdgeFromGroup: lastRect.bottom - groupRect.top,
        trackTopDelta: Math.abs(trackRect.top - firstRect.top),
        trackBottomDelta: Math.abs(trackRect.bottom - lastRect.bottom),
      };
    });

    expect(trackAlignment).not.toBeNull();
    expect(trackAlignment.trackTopDelta).toBeLessThanOrEqual(1.5);
    expect(trackAlignment.trackBottomDelta).toBeLessThanOrEqual(1.5);
  });
});

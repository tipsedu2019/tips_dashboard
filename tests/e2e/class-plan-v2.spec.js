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

test.describe("class plan v2", () => {
  test("shows a unified builder flow instead of editable tabs in the class plan modal", async ({
    page,
  }) => {
    await openClassPlanModal(page);

    await expect(page.getByTestId("class-plan-builder-stepper")).toBeVisible();
    await expect(
      page.getByTestId("class-plan-builder-section-settings"),
    ).toBeVisible();
    await expect(
      page.getByTestId("class-plan-builder-section-schedule"),
    ).toBeVisible();
    await expect(
      page.getByTestId("class-plan-builder-section-progress"),
    ).toBeVisible();
    await expect(
      page.getByTestId("class-plan-builder-section-textbooks"),
    ).toBeVisible();
    await expect(page.getByTestId("class-plan-save-button")).toBeVisible();
    await expect(page.getByTestId("class-plan-tab-schedule")).toHaveCount(0);
    await expect(page.getByTestId("class-plan-tab-plan")).toHaveCount(0);
    await expect(page.getByTestId("class-plan-tab-actual")).toHaveCount(0);
  });

  test("keeps metadata in the desktop header, preview on the right, and header-level save action", async ({
    page,
  }) => {
    await openClassPlanModal(page);

    await expect(
      page.getByTestId("class-plan-desktop-header-meta"),
    ).toBeVisible();
    await expect(
      page.getByTestId("class-plan-desktop-header-main-row"),
    ).toBeVisible();
    await expect(page.getByTestId("class-plan-builder-preview")).toBeVisible();
    await expect(page.getByTestId("class-plan-save-bar")).toHaveCount(0);
    await expect(page.getByTestId("class-plan-save-button")).toBeVisible();
    await expect(page.getByTestId("class-plan-compact-summary")).toHaveCount(0);
    await expect(
      page.locator(
        '[data-testid="class-plan-builder-preview"] .class-plan-preview-subtitle',
      ),
    ).toContainText("수업 요일");
    await expect(
      page.locator(
        '[data-testid="class-plan-builder-preview"] .class-plan-preview-badge-row',
      ),
    ).not.toContainText("수업 요일");
    await expect(
      page.locator(
        '[data-testid="class-plan-builder-preview"] .class-plan-preview-badge-row',
      ),
    ).toContainText("보강");

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
          width: rect.width,
          height: rect.height,
        };
      };

      const builderLayout = document.querySelector(
        '[data-testid="class-plan-builder-layout"]',
      );

      return {
        title: measure(".class-plan-desktop-header-subtitle"),
        headerMeta: measure('[data-testid="class-plan-desktop-header-meta"]'),
        main: measure(".class-plan-builder-main"),
        controls: measure('[data-testid="planner-controls-column"]'),
        preview: measure('[data-testid="class-plan-builder-preview"]'),
        saveButton: measure('[data-testid="class-plan-save-button"]'),
        shellColumns: builderLayout
          ? getComputedStyle(builderLayout).gridTemplateColumns
          : "",
      };
    });

    expect(workspaceMetrics.title).not.toBeNull();
    expect(workspaceMetrics.headerMeta).not.toBeNull();
    expect(workspaceMetrics.main).not.toBeNull();
    expect(workspaceMetrics.controls).not.toBeNull();
    expect(workspaceMetrics.preview).not.toBeNull();
    expect(workspaceMetrics.saveButton).not.toBeNull();
    expect(
      Math.abs(workspaceMetrics.title.y - workspaceMetrics.headerMeta.y),
    ).toBeLessThan(8);
    expect(workspaceMetrics.headerMeta.x).toBeGreaterThan(
      workspaceMetrics.title.right + 12,
    );
    expect(workspaceMetrics.preview.x).toBeGreaterThan(
      workspaceMetrics.controls.right + 12,
    );
    expect(workspaceMetrics.saveButton.x).toBeGreaterThan(
      workspaceMetrics.headerMeta.right + 12,
    );
    expect(
      Math.abs(workspaceMetrics.preview.y - workspaceMetrics.main.y),
    ).toBeLessThan(80);
    expect(workspaceMetrics.shellColumns).toContain("px");
  });
});

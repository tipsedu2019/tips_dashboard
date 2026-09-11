export const APP_NAVIGATION_REQUEST = "tips:request-navigation";

type NavigationPreparation = (resume: () => void) => void;
export type AppNavigationRequest = CustomEvent<{
  intent: () => void;
  beforeNavigate?: NavigationPreparation[];
}>;

/** Let the active editor resolve an application-wide navigation before routing. */
export function requestAppNavigation(intent: () => void): void {
  if (typeof window === "undefined") {
    intent();
    return;
  }
  const beforeNavigate: NavigationPreparation[] = [];
  const preparedIntent = () => beforeNavigate.reduceRight<() => void>(
    (resume, prepare) => () => prepare(resume), intent,
  )();
  const event: AppNavigationRequest = new CustomEvent(APP_NAVIGATION_REQUEST, {
    cancelable: true,
    detail: { intent: preparedIntent, beforeNavigate },
  });
  if (window.dispatchEvent(event)) preparedIntent();
}

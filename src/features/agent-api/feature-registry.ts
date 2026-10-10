import registry from "./feature-registry.json" with { type: "json" };

// This inventory is the source for UI, OpenAPI metadata, HTTP routing checks,
// and the generated DB policy. Presence never grants an existing key access.
export const API_FEATURES = registry;
export const PERSONAL_FEATURES = API_FEATURES.filter(feature => feature.personal !== null);
export const personalFeatureIds = PERSONAL_FEATURES.map(feature => feature.id);
export function featureForRoute(version: number, method: string, path: string[]) {
  return API_FEATURES.find(feature => {
    const endpoint = feature.endpoint;
    if (!endpoint || endpoint.version !== version || endpoint.method !== method.toLowerCase()) return false;
    const parts = endpoint.path.slice(1).split("/");
    return parts.length === path.length && parts.every((part, index) => part.startsWith("{") ? Boolean(path[index]) : part === path[index]);
  });
}
export function featureCanSelect(id: string, classCount: number, schoolCount: number) {
  const policy = PERSONAL_FEATURES.find(feature => feature.id === id)?.personal;
  return Boolean(policy && (policy.target === "classes" ? classCount : schoolCount) > 0);
}
export function annotateFeaturePaths<T extends Record<string, object>>(version: number, paths: T): T {
  for (const feature of API_FEATURES) {
    const endpoint = feature.endpoint;
    if (!endpoint || endpoint.version !== version) continue;
    const operation = (paths[endpoint.path] as Record<string, object> | undefined)?.[endpoint.method];
    if (!operation) throw new Error("api_feature_registry_mismatch");
    Object.assign(operation, { "x-tips-feature-id": feature.id, "x-tips-personal-selectable": Boolean(feature.personal), "x-tips-personal-default-granted": false });
  }
  return paths;
}

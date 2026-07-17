export function isNotificationAsyncGenerationCurrent(
  expectedGeneration: number,
  currentGeneration: number,
) {
  return expectedGeneration === currentGeneration
}

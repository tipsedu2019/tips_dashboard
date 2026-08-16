function nonBlankString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return nonBlankString(error.message) ?? fallbackMessage;
  }

  if (error && typeof error === "object") {
    const structuredError = error as { message?: unknown; details?: unknown };
    return nonBlankString(structuredError.message)
      ?? nonBlankString(structuredError.details)
      ?? fallbackMessage;
  }

  return fallbackMessage;
}

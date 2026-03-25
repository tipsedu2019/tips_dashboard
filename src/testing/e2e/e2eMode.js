export function isE2EModeEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') === '1') {
    return true;
  }

  return Boolean(import.meta.env.DEV && params.get('role'));
}

export function getE2ERole() {
  if (typeof window === 'undefined') {
    return 'staff';
  }

  return new URLSearchParams(window.location.search).get('role') || 'staff';
}

export function isE2EModeEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  return new URLSearchParams(window.location.search).get('e2e') === '1';
}

export function getE2ERole() {
  if (typeof window === 'undefined') {
    return 'staff';
  }

  return new URLSearchParams(window.location.search).get('role') || 'staff';
}

// jsdom .click() omits the mouse-down selection event used by native Radix tabs.
// Dispatch the browser sequence so tests exercise the component's public DOM handlers.
export function clickTab(node) {
  node.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
  const proceed = node.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  if (proceed && !node.disabled) node.focus();
  node.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
  node.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, button: 0 }));
  node.click();
}

export async function pressTabKey(node, key) {
  node.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  // Radix roving focus intentionally waits until after the key handler.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  node.dispatchEvent(new window.KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
}

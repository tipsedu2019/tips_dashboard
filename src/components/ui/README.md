# Shared control states

Use `Button` from `ui/button` for ordinary actions. Choose a semantic variant and size; keep caller classes limited to layout and content alignment. Do not redefine hover, pressed, focus, disabled opacity, colors or shadows in feature CSS. A new reusable appearance belongs in `buttonVariants`, not a copied class string in each caller.

- `default`: primary action; `outline`: secondary action; `ghost`: quiet action.
- `destructive`, `destructive-outline`, `destructive-ghost`: destructive actions at the corresponding emphasis. Permission, confirmation and saving rules remain caller-owned.
- `link`: accent text; `text`: neutral text, including table detail titles through `DataTableDetailButton`.
- Resting and hover colors come from theme tokens. Pressed uses brightness 95%; disabled restores brightness 100%, uses opacity 50%, and blocks pointer events. Use the native `disabled` prop to prevent execution.
- Keyboard focus uses the shared border and 3px ring; destructive variants use the destructive ring token. Preserve accessible names on icon-only buttons.
- Transitions use 150ms ease-out for background, border, color, shadow, opacity and filter. Reduced motion removes the transition. Do not add feature-specific transforms or forced GPU layers.
- Selected filter buttons use `aria-pressed` and an appropriate shared variant. Native calendar range cells, navigation tabs and other specialized controls retain their own semantic selected states; they are not ordinary action buttons.

`DropdownMenu` supplies the shared menu surface and item states. Use its destructive item variant instead of local red hover classes. Table row actions should use `data-table/data-table-row-actions`; that wrapper supplies presentation only and must not contain domain writes or permissions.

Sharing presentation reduces drift, but does not itself prove a runtime speedup. Measure repeated computation or requests before adding memoization, and verify that fresh data invalidates cached display values.

## Action feedback

Use `ActionFeedback` for non-modal task results that must not reflow a workspace. It reuses Alert/Button, distinguishes information (`status`) and errors (`alert`), keeps long text scrollable, and stays until the caller dismisses or replaces it. Mounting must not take focus. Pass the current search/input ref as `returnFocusRef` for dismissal when the original control is removed or disabled. Keep form-owned errors in FormDialogContent and persistent read/schema availability notices in their existing surfaces. The caller owns message lifetime, error ownership, retries and write coordination; the feedback component must never start a service request.

## Form dialogs

Use `FormDialogContent` inside the existing `Dialog` for multi-field operation forms. It composes the shared Dialog, Button and Alert primitives; callers provide their existing validation, submit and cancel handlers. The title and action area stay fixed, while only the body scrolls. Desktop uses a bounded 42rem height; mobile keeps 1rem viewport margins. Body scrollbar space is reserved independently of the page scroll lock.

Keep a stable `submitLabel` while `busy`; the shared control swaps only its equal-sized icon and announces pending status. Supply a concise `hint` for unavailable submission and the current form's `error` for visible, focused feedback. Clear cancelled feedback when entering a new form, retain fields on failure, and preserve caller-owned fresh-read, identity and duplicate-write protections. The wrapper is presentation and native-submit gating, not an async write coordinator. Inputs remain editable so existing stale-input protection can reject superseded saves.

Use `DetailDialogContent` for read-only details and pending/error shells. It shares the same frame, header, body gutter and close area with the form. The default desktop height is bounded to 34rem; pass `compact={false}` when the shell will hydrate into a 42rem form, so accepted data does not resize the frame. Keep loading/error/accepted-input decisions in the caller. Use semantic `dl`/`dt`/`dd` fields and allow long identities to wrap.

An optional stable `submitAriaLabel` can retain an established accessible action name when the visible creation/editing label differs. Validation and duplicate detection must continue to gate submission; do not replace those protections with presentation hints.

`DocumentDialogContent` shares the same frame with a wider document area. Put scope and export actions in `toolbar`, content in the scrolling body, and asynchronous messages in `feedback`; its reserved height prevents status changes from moving the document. Use `actions` for a prepared file link. Keep read retries, clipboard fallbacks and download cancellation in the feature. Capture an isolated document copy, not the visible preview, so export sizing cannot reflow the UI.

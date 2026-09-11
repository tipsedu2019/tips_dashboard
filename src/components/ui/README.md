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

## Editable fields and loading

`Input`, `Textarea`, `SelectTrigger`, and `NativeSelect` use `fieldStateClassName` for hover, keyboard focus, invalid, disabled, and reduced-motion states. Keep dimensions and layout in callers. Invalid and focused borders take precedence over hover; disabled fields use the theme's muted surface in both themes. Use `NativeSelect` when a workflow needs native option behavior. Do not replace native options or feature-owned change handlers for visual consistency.

`SearchCombobox` retains its explicit accessible name when provided, otherwise combines its search label and selected label. Popovers match the trigger width within the viewport. Search-field Escape clears a nonempty query and retains focus; it does not close the parent dialog. An empty field passes Escape to its parent, and IME composition is never cleared.

`LoadingSpinner` announces a loading status and hides its decorative inner icon. Spinner, skeleton, control transitions, dialogs, and sheets honor reduced motion. Loading and disabled UI do not replace a synchronous caller-owned write lock for same-tick duplicate events.

## Workspace tabs

Use `WorkspaceTabs`, `WorkspaceTabsList`, `WorkspaceTabsTrigger`, and one `WorkspaceTabsPanel` for remote operational views whose existing body must remain mounted. The controlled `value` and `onValueChange` keep URL, pagination, filters, reads, and drafts in the feature. Arrow keys, Home, and End move focus; Enter, Space, or a click activates a view. The shared panel has a stable ID and remains linked to the active trigger. Focused triggers scroll into view on narrow screens.

The panel preserves its own DOM identity, not every conditional child automatically. Keep child keys and existing stale-response and draft guards intact. For independent panels use the ordinary `Tabs` primitives. Overlapping classifications remain pressed-state filters rather than navigation tabs.

## Overlay controls

Dialog and sheet close actions reuse `buttonVariants` and provide a 44px mobile target with a 36px desktop target. A dialog's optional text close action occupies its own layout row; the icon close reserves header space. Preserve Radix focus trapping, Escape handling, and return focus. Tooltip surfaces sit above operational dialogs and remain bounded by the viewport.

Use `DialogContent layer="nested"` for confirmation above an operational detail. Its backdrop and content move together above the detail; a page-specific content z-index alone leaves the underlying form looking active. Mobile Sidebar returns focus to its actual opener on dismissal and preserves the destination's focus after a route change.

`useUnsavedNavigationGuard` connects caller-owned dirty/submitted state to one confirmation flow for explicit actions, in-app links, Back/Forward and document unload. The feature supplies the confirmation UI and accepted action; the hook never writes data. Feature-owned route buttons must call `requestNavigation` before calling the router. App-shell actions such as Quick Search use `requestAppNavigation` so an active editor can consume the intent. Close a nested palette and restore its opener before requesting confirmation; otherwise the palette can steal the confirmation focus. Same-screen query synchronization remains caller-owned. Modern browsers use the Navigation API without extra history entries. The older History API fallback subscribes to the dispatcher installed synchronously by `src/instrumentation-client.ts`, before Next hydrates. A late Window capture listener does not outrank an earlier router listener. Keep this bootstrap in alternate app/fixture entry points too; an inactive dispatcher passes normal navigation through. The fallback restores the owned route before prompting, but its sentinel truncates an existing Forward branch and leaves a retired duplicate entry on cleanup. Do not describe this fallback as preserving native Forward history.

`useDraftNavigation` supplies the shared “계속 편집” / “변경사항 버리기” confirmation. Use `requestLocalAction` for partial discards that remain on the page; pass `skipConfirmation` only when that action will not lose a changed draft. Other independent drafts must remain protected. Report unapplied child-editor inputs to their parent dirty calculation, and compare against the accepted submission rather than the latest read or current input. A late receipt must belong to the same editor lifetime before it can close or reset anything.

For client-owned query changes while retaining drafts, `pushLocalHistoryState` preserves the owned legacy sentinel and uses ordinary push when no sentinel is active. Becoming clean can leave asynchronous history cleanup in flight: let the guard finish that cleanup before a route or local URL write. Clean app-navigation listeners must register cleanup through `beforeNavigate`, without bypassing another mounted editor's confirmation.

## Action feedback

Use `ActionFeedback` for non-modal task results that must not reflow a workspace. It reuses Alert/Button, distinguishes information (`status`) and errors (`alert`), keeps long text scrollable, and stays until the caller dismisses or replaces it. Mounting must not take focus. Pass the current search/input ref as `returnFocusRef` for dismissal when the original control is removed or disabled. Keep form-owned errors in FormDialogContent and persistent read/schema availability notices in their existing surfaces. The caller owns message lifetime, error ownership, retries and write coordination; the feedback component must never start a service request.

## Form dialogs

Use `FormDialogContent` inside the existing `Dialog` for multi-field operation forms. It composes the shared Dialog, Button and Alert primitives; callers provide their existing validation, submit and cancel handlers. The title and action area stay fixed, while only the body scrolls. Desktop uses a bounded 42rem height; mobile keeps 1rem viewport margins. Body scrollbar space is reserved independently of the page scroll lock.

Keep a stable `submitLabel` while `busy`; the shared control swaps only its equal-sized icon and announces pending status. Supply a concise `hint` for unavailable submission and the current form's `error` for visible, focused feedback. Clear cancelled feedback when entering a new form, retain fields on failure, and preserve caller-owned fresh-read, identity and duplicate-write protections. The wrapper is presentation and native-submit gating, not an async write coordinator. Inputs remain editable so existing stale-input protection can reject superseded saves.

Use `DetailDialogContent` for read-only details and pending/error shells. It shares the same frame, header, body gutter and close area with the form. The default desktop height is bounded to 34rem; pass `compact={false}` when the shell will hydrate into a 42rem form, so accepted data does not resize the frame. Keep loading/error/accepted-input decisions in the caller. Use semantic `dl`/`dt`/`dd` fields and allow long identities to wrap.

An optional stable `submitAriaLabel` can retain an established accessible action name when the visible creation/editing label differs. Validation and duplicate detection must continue to gate submission; do not replace those protections with presentation hints.

`DocumentDialogContent` shares the same frame with a wider document area. Put scope and export actions in `toolbar`, content in the scrolling body, and asynchronous messages in `feedback`; its reserved height prevents status changes from moving the document. Use `actions` for a prepared file link. Keep read retries, clipboard fallbacks and download cancellation in the feature. Capture an isolated document copy, not the visible preview, so export sizing cannot reflow the UI.

## Theme initialization

Use the application `ThemeProvider`/`useTheme` pair for controls and toast surfaces. Keep server and first hydration labels identical before resolving saved preferences. System mode must track media changes in both the root surface and toggle; toggling from a dark system preference selects light. Invalid or unavailable local storage falls back without disabling this session's control. Reduced motion skips the view transition entirely.

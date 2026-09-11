"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUnsavedNavigationGuard } from "@/hooks/use-unsaved-navigation-guard";

/** One active editor owns its dirty state; this hook only confirms navigation. */
export function useDraftNavigation({ dirty, description = "변경사항을 버리고 이동할까요?" }: {
  dirty: boolean;
  description?: string;
}) {
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const confirmedRef = useRef(false);
  const onConfirmRequest = useCallback(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmedRef.current = false;
    setConfirmationOpen(true);
  }, []);
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const guard = useUnsavedNavigationGuard({ enabled: dirty, onConfirmRequest, navigate });
  if (!dirty && confirmationOpen) setConfirmationOpen(false);
  const cancel = () => {
    confirmedRef.current = false;
    guard.cancelNavigation();
    setConfirmationOpen(false);
  };
  const confirmation = (
    <Dialog open={confirmationOpen && dirty} onOpenChange={(open) => { if (!open) cancel(); }}>
      <DialogContent
        data-testid="draft-navigation-confirm-dialog"
        layer="nested"
        className="sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = returnFocusRef.current;
          if (opener?.isConnected && !opener.matches(":disabled")
            && !opener.closest("[hidden], [inert]") && opener.getClientRects().length > 0) {
            opener.focus({ preventScroll: true });
          }
          if (confirmedRef.current) {
            confirmedRef.current = false;
            // A local close action may open another dialog. Release this scope first.
            queueMicrotask(guard.confirmNavigation);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>저장하지 않은 변경사항</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>계속 편집</Button>
          <Button type="button" variant="destructive" onClick={() => {
            confirmedRef.current = true;
            setConfirmationOpen(false);
          }}>변경사항 버리기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  const { requestNavigation } = guard;
  const requestLocalAction = useCallback((intent: () => void, options: { skipConfirmation?: boolean } = {}) => {
    requestNavigation(intent, { ...options, preserveHistory: true });
  }, [requestNavigation]);
  return { requestNavigation, requestLocalAction, confirmation };
}

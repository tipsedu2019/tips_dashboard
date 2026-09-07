"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import styles from "./public-classes.module.css";
export function PublicDialog({
  title,
  description,
  children,
  onClose,
  returnFocus,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.dialog}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (
              (returnFocus.current?.isConnected ? returnFocus.current : null) ||
              document.querySelector<HTMLButtonElement>("header button")
            )?.focus();
          }}
        >
          <div className={styles.dialogHeading}>
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close className={styles.iconButton} aria-label="닫기">
              <X size={22} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

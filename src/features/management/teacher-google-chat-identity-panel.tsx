"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/providers/auth-provider";
import { createGoogleChatProfileIdentityService } from "./google-chat-profile-identity-service";
import type {
  GoogleChatProfileIdentity,
  GoogleChatProfileIdentitySnapshot,
} from "./google-chat-profile-identity-types";
import {
  SettingsTableFrame,
  settingsTableCellClass,
  settingsTableHeadClass,
} from "./settings-master-layout";

type SyncMode = "auto" | "manual";

function getIdentityStatus(identity: GoogleChatProfileIdentity) {
  if (identity.lastSyncStatus === "provider_error") return "조회 실패";
  if (identity.verificationStatus === "verified") return "확인됨";
  if (identity.verificationStatus === "unverified") return "재확인 필요";
  return "미설정";
}

function formatSyncTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getSafeErrorMessage(error: unknown) {
  if (
    error instanceof Error
    && error.message === "google_chat_profile_identity_revision_conflict"
  ) {
    return "다른 관리자가 먼저 변경했습니다. 새로고침 후 다시 시도해 주세요.";
  }
  return "Google Chat 계정 정보를 저장하지 못했습니다.";
}

function getSafeLoadMessage() {
  return "Google Chat 계정 정보를 불러오지 못했습니다.";
}

function IdentityControls({
  identity,
  snapshot,
  manualChatUserId,
  pending,
  onManualChatUserIdChange,
  onSync,
}: {
  identity: GoogleChatProfileIdentity;
  snapshot: Pick<GoogleChatProfileIdentitySnapshot, "editable" | "directory">;
  manualChatUserId: string;
  pending: boolean;
  onManualChatUserIdChange: (value: string) => void;
  onSync: (mode: SyncMode) => void;
}) {
  const disabled = !snapshot.editable || !snapshot.directory.configured || pending;

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <Input
        className="h-8"
        value={manualChatUserId}
        onChange={(event) => onManualChatUserIdChange(event.target.value)}
        placeholder="숫자 Chat ID"
        inputMode="numeric"
        aria-label={`${identity.profileName} Google Chat ID`}
        disabled={!snapshot.editable || !snapshot.directory.configured || pending}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8"
        onClick={() => onSync("auto")}
        disabled={!snapshot.editable || !snapshot.directory.configured || pending}
        aria-label={`${identity.profileName} 자동 조회`}
      >
        자동 조회
      </Button>
      <Button
        type="button"
        size="sm"
        className="h-8"
        onClick={() => onSync("manual")}
        disabled={disabled}
        aria-label={`${identity.profileName} 확인`}
      >
        {pending ? "확인 중" : "확인"}
      </Button>
    </div>
  );
}

function IdentitySummary({ identity }: { identity: GoogleChatProfileIdentity }) {
  return (
    <>
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground">{identity.profileName}</div>
        <div className="truncate text-xs text-muted-foreground">{identity.accountEmail}</div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Chat ID</dt>
          <dd className="mt-0.5 font-mono text-foreground">{identity.chatUserId ?? "미설정"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">상태</dt>
          <dd className="mt-0.5"><Badge variant="outline" className="rounded-md">{getIdentityStatus(identity)}</Badge></dd>
        </div>
        <div>
          <dt className="text-muted-foreground">마지막 동기화</dt>
          <dd className="mt-0.5 text-foreground">{formatSyncTime(identity.lastSyncAt)}</dd>
        </div>
      </dl>
    </>
  );
}

export function TeacherGoogleChatIdentityPanel() {
  const { session } = useAuth();
  const [snapshot, setSnapshot] = useState<GoogleChatProfileIdentitySnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pendingProfileIds, setPendingProfileIds] = useState<string[]>([]);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [manualChatUserIds, setManualChatUserIds] = useState<Record<string, string>>({});

  const accessToken = session?.access_token ?? null;
  const service = useMemo(
    () =>
      createGoogleChatProfileIdentityService({
        getAccessToken: async () => accessToken,
      }),
    [accessToken],
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setLoadError("");

    void service.list(controller.signal).then(
      (nextSnapshot) => {
        if (!controller.signal.aborted) setSnapshot(nextSnapshot);
      },
      () => {
        if (!controller.signal.aborted) setLoadError(getSafeLoadMessage());
      },
    ).finally(() => {
      if (!controller.signal.aborted) setIsLoading(false);
    });

    return () => controller.abort();
  }, [service]);

  const updateManualChatUserId = useCallback((profileId: string, value: string) => {
    setManualChatUserIds((current) => ({ ...current, [profileId]: value }));
  }, []);

  const syncIdentity = useCallback(async (identity: GoogleChatProfileIdentity, mode: SyncMode) => {
    if (!snapshot?.editable || !snapshot.directory.configured) return;

    setPendingProfileIds((current) => [...current, identity.profileId]);
    setProfileErrors((current) => ({ ...current, [identity.profileId]: "" }));

    try {
      const nextIdentity = await service.sync({
        profile_id: identity.profileId,
        lookup_mode: mode,
        chat_user_id: mode === "manual"
          ? manualChatUserIds[identity.profileId] ?? identity.chatUserId
          : null,
        expected_identity_revision: identity.identityRevision,
        request_id: crypto.randomUUID(),
      });
      setSnapshot((current) => current
        ? {
            ...current,
            identities: current.identities.map((item) =>
              item.profileId === nextIdentity.profileId ? nextIdentity : item,
            ),
          }
        : current,
      );
      setManualChatUserIds((current) => ({ ...current, [identity.profileId]: "" }));
    } catch (error) {
      setProfileErrors((current) => ({
        ...current,
        [identity.profileId]: getSafeErrorMessage(error),
      }));
    } finally {
      setPendingProfileIds((current) => current.filter((id) => id !== identity.profileId));
    }
  }, [manualChatUserIds, service, snapshot]);

  return (
    <section aria-labelledby="teacher-google-chat-identity-title" className="grid gap-3">
      <div>
        <h2 id="teacher-google-chat-identity-title" className="text-sm font-semibold text-foreground">
          Google Chat 계정
        </h2>
      </div>

      {loadError ? (
        <Alert variant="destructive"><AlertDescription>{loadError}</AlertDescription></Alert>
      ) : null}
      {snapshot && !snapshot.directory.configured ? (
        <Alert><AlertDescription>Google Workspace Directory 설정이 필요합니다.</AlertDescription></Alert>
      ) : null}

      <div data-testid="teacher-google-chat-identity-mobile-list" className="grid gap-2 md:hidden">
        {isLoading ? <Skeleton className="h-40 w-full" /> : snapshot?.identities.map((identity) => {
          const pending = pendingProfileIds.includes(identity.profileId);
          return (
            <section
              key={identity.profileId}
              data-testid="teacher-google-chat-identity-mobile-card"
              className="grid gap-3 rounded-lg border border-border/70 bg-background px-3 py-3"
            >
              <IdentitySummary identity={identity} />
              <IdentityControls
                identity={identity}
                snapshot={snapshot}
                manualChatUserId={manualChatUserIds[identity.profileId] ?? ""}
                pending={pending}
                onManualChatUserIdChange={(value) => updateManualChatUserId(identity.profileId, value)}
                onSync={(mode) => void syncIdentity(identity, mode)}
              />
              {profileErrors[identity.profileId] ? (
                <p className="text-xs text-destructive">{profileErrors[identity.profileId]}</p>
              ) : null}
            </section>
          );
        })}
      </div>

      <div data-testid="teacher-google-chat-identity-desktop-list" className="hidden md:block">
        <SettingsTableFrame>
          <Table>
            <caption className="sr-only">Google Chat 계정</caption>
            <TableHeader>
              <TableRow>
                <TableHead className={settingsTableHeadClass}>계정</TableHead>
                <TableHead className={settingsTableHeadClass}>Chat ID</TableHead>
                <TableHead className={settingsTableHeadClass}>상태</TableHead>
                <TableHead className={settingsTableHeadClass}>마지막 동기화</TableHead>
                <TableHead className={settingsTableHeadClass}>확인</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={5} className="px-3 py-6"><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : snapshot?.identities.map((identity) => {
                const pending = pendingProfileIds.includes(identity.profileId);
                return (
                  <TableRow key={identity.profileId}>
                    <TableCell className={settingsTableCellClass}>
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{identity.profileName}</div>
                        <div className="truncate text-xs text-muted-foreground">{identity.accountEmail}</div>
                      </div>
                    </TableCell>
                    <TableCell className={settingsTableCellClass}>{identity.chatUserId ?? "미설정"}</TableCell>
                    <TableCell className={settingsTableCellClass}>{getIdentityStatus(identity)}</TableCell>
                    <TableCell className={settingsTableCellClass}>{formatSyncTime(identity.lastSyncAt)}</TableCell>
                    <TableCell className={settingsTableCellClass}>
                      <IdentityControls
                        identity={identity}
                        snapshot={snapshot}
                        manualChatUserId={manualChatUserIds[identity.profileId] ?? ""}
                        pending={pending}
                        onManualChatUserIdChange={(value) => updateManualChatUserId(identity.profileId, value)}
                        onSync={(mode) => void syncIdentity(identity, mode)}
                      />
                      {profileErrors[identity.profileId] ? (
                        <p className="mt-2 text-xs text-destructive">{profileErrors[identity.profileId]}</p>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </SettingsTableFrame>
      </div>
    </section>
  );
}

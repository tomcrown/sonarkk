import { getPrismaClient } from '@sonarkk/core';
import { env } from './env.js';
import { log } from './logger.js';
import { sendTelegramNotification, buildNotificationMessage, type TelegramEventKind } from './telegram.js';

export type ActionKind = 'supply' | 'settle' | 'hedge' | 'skip' | 'error' | 'nav_update';

export interface ActionEvent {
  kind: ActionKind;
  portfolioId: string;
  oracleId: string;
  expiryMs: bigint;
  txDigest?: string;
  detail?: string;
  coverageRatioPct?: number;
}

/**
 * Emit a structured log entry for every keeper action, then fire a Telegram
 * notification to the portfolio owner (if they have linked their account and
 * the relevant preference is enabled).
 */
export function notifyOnAction(event: ActionEvent): void {
  const level = event.kind === 'error' ? 'warn' : 'info';
  log[level](
    {
      notify: true,
      kind: event.kind,
      portfolioId: event.portfolioId,
      oracleId: event.oracleId,
      expiryMs: event.expiryMs.toString(),
      txDigest: event.txDigest,
      detail: event.detail,
      coverageRatioPct: event.coverageRatioPct,
    },
    `[notify] keeper action: ${event.kind}`,
  );

  // Fire-and-forget Telegram notification (never awaited, never throws into caller).
  if (env.TELEGRAM_BOT_TOKEN && env.DATABASE_URL) {
    fireAndForgetTelegram(event);
  }
}

function fireAndForgetTelegram(event: ActionEvent): void {
  (async () => {
    try {
      const prisma = getPrismaClient();
      const portfolio = await prisma.portfolio.findUnique({
        where: { id: event.portfolioId },
        select: { ownerAddress: true },
      });
      if (!portfolio) return;

      const message = buildNotificationMessage({
        kind: event.kind as TelegramEventKind,
        portfolioId: event.portfolioId,
        oracleId: event.oracleId,
        ...(event.txDigest !== undefined && { txDigest: event.txDigest }),
        ...(event.detail !== undefined && { detail: event.detail }),
        ...(event.coverageRatioPct !== undefined && { coverageRatioPct: event.coverageRatioPct }),
      });

      await sendTelegramNotification({
        portfolioId: event.portfolioId,
        ownerWallet: portfolio.ownerAddress,
        kind: event.kind as TelegramEventKind,
        message,
      });
    } catch {
      // Never let notification failures surface into the keeper loop.
    }
  })();
}

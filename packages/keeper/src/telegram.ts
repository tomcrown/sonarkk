/**
 * Keeper-side Telegram notification sender.
 *
 * Looks up the TelegramLink for a portfolio's owner wallet and sends a message
 * via the Telegram Bot API. All calls are fire-and-forget — failures are logged
 * but never thrown (never block the keeper loop).
 */

import { getPrismaClient } from '@sonarkk/core';
import { env } from './env.js';
import { log } from './logger.js';

const TELEGRAM_API = () => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export type TelegramEventKind = 'supply' | 'settle' | 'hedge' | 'skip' | 'error' | 'nav_update' | 'policy_cap';

interface TelegramPayload {
  portfolioId: string;
  ownerWallet: string;
  kind: TelegramEventKind;
  message: string;
}

async function sendMessage(chatId: string, text: string): Promise<void> {
  const r = await fetch(`${TELEGRAM_API()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  if (!r.ok) {
    const body = await r.text();
    log.warn({ chatId, status: r.status, body }, '[telegram] sendMessage failed');
  }
}

function prefCheckForKind(
  kind: TelegramEventKind,
  link: { notifySupply: boolean; notifyError: boolean; notifyNavMilestone: boolean; notifyPolicyCap: boolean },
): boolean {
  switch (kind) {
    case 'supply':
    case 'settle':
    case 'hedge':
    case 'skip':
      return link.notifySupply;
    case 'error':
      return link.notifyError;
    case 'nav_update':
      return link.notifyNavMilestone;
    case 'policy_cap':
      return link.notifyPolicyCap;
  }
}

/**
 * Send a Telegram notification to the owner of `portfolioId`.
 * No-ops if: Telegram is unconfigured, wallet is not linked, or the user's pref is off.
 * Never throws.
 */
export async function sendTelegramNotification(payload: TelegramPayload): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  if (!env.DATABASE_URL) return;

  try {
    const prisma = getPrismaClient();

    const link = await prisma.telegramLink.findUnique({
      where: { walletAddress: payload.ownerWallet },
    });

    if (!link || !link.isActive) return;
    if (!prefCheckForKind(payload.kind, link)) return;

    await sendMessage(link.chatId, payload.message);
  } catch (err) {
    log.warn({ err, portfolioId: payload.portfolioId }, '[telegram] notification failed (non-fatal)');
  }
}

/**
 * Build a human-readable Telegram message for a keeper ActionEvent.
 * Returns null if this event kind doesn't warrant a Telegram push
 * (e.g. routine supply cycles — only send errors and nav milestones by default).
 */
export function buildNotificationMessage(opts: {
  kind: TelegramEventKind;
  portfolioId: string;
  oracleId: string;
  txDigest?: string;
  detail?: string;
  coverageRatioPct?: number;
}): string {
  const pid = opts.portfolioId.slice(0, 8) + '…';
  const ts = new Date().toUTCString().replace(/ GMT$/, ' UTC');

  switch (opts.kind) {
    case 'supply':
      return (
        `✅ *Supply cycle executed*\n` +
        `Portfolio: \`${pid}\`\n` +
        `Oracle: \`${opts.oracleId.slice(0, 8)}…\`\n` +
        (opts.detail ? `${opts.detail}\n` : '') +
        (opts.txDigest ? `[View tx](https://testnet.suivision.xyz/txblock/${opts.txDigest})\n` : '') +
        `_${ts}_`
      );

    case 'settle':
      return (
        `🏁 *Position settled*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.detail ? `${opts.detail}\n` : '') +
        (opts.txDigest ? `[View tx](https://testnet.suivision.xyz/txblock/${opts.txDigest})\n` : '') +
        `_${ts}_`
      );

    case 'hedge':
      return (
        `🔁 *Delta hedge placed*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.coverageRatioPct != null ? `Coverage: ${opts.coverageRatioPct.toFixed(1)}%\n` : '') +
        (opts.txDigest ? `[View tx](https://testnet.suivision.xyz/txblock/${opts.txDigest})\n` : '') +
        `_${ts}_`
      );

    case 'skip':
      return (
        `⏭ *Cycle skipped*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.detail ? `Reason: ${opts.detail}\n` : '') +
        `_${ts}_`
      );

    case 'error':
      return (
        `⚠️ *Keeper error*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.detail ? `${opts.detail}\n` : '') +
        `_${ts}_`
      );

    case 'nav_update':
      return (
        `📈 *NAV milestone*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.detail ? `${opts.detail}\n` : '') +
        `_${ts}_`
      );

    case 'policy_cap':
      return (
        `🔑 *Policy cap event*\n` +
        `Portfolio: \`${pid}\`\n` +
        (opts.detail ? `${opts.detail}\n` : '') +
        `_${ts}_`
      );
  }
}

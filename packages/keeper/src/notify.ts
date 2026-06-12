import { log } from './logger.js';

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
 * Emit a structured log entry for every keeper action.
 *
 * In production, pipe this keeper's stdout to a Telegram/Discord bot:
 *   pnpm --filter @sonarkk/keeper start | grep '"notify"' | bot-forwarder
 *
 * The `notify` field in every log line acts as a filter tag.
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
}

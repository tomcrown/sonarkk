/**
 * Telegram bot integration routes.
 *
 * POST /telegram/link-code       — generate a one-time linking code for a wallet
 * GET  /telegram/status          — check if a wallet is linked
 * DELETE /telegram/unlink        — unlink a wallet from Telegram
 * PATCH /telegram/preferences    — update notification preferences
 * POST /telegram/webhook         — receive updates from Telegram (bot messages)
 * POST /telegram/register-webhook — register the Railway URL as Telegram webhook
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { getPrismaClient } from '@sonarkk/core';
import { env } from '../env.js';

export const telegramRouter = Router();

const TELEGRAM_API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
const CODE_TTL_MS = 15 * 60 * 1000; // codes expire in 15 minutes

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(): string {
  return 'SNK-' + randomBytes(3).toString('hex').toUpperCase();
}

async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ── POST /telegram/link-code ──────────────────────────────────────────────────

const LinkCodeSchema = z.object({
  wallet_address: z.string().min(60),
});

telegramRouter.post('/link-code', async (req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    res.status(503).json({ error: 'Telegram not configured on this server' });
    return;
  }
  try {
    const { wallet_address } = LinkCodeSchema.parse(req.body);
    const prisma = getPrismaClient();

    // Invalidate any existing unused codes for this wallet
    await prisma.telegramLinkCode.updateMany({
      where: { walletAddress: wallet_address, used: false },
      data: { used: true },
    });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await prisma.telegramLinkCode.create({
      data: { walletAddress: wallet_address, code, expiresAt },
    });

    res.json({ code, expires_at: expiresAt.toISOString() });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /telegram/status ──────────────────────────────────────────────────────

telegramRouter.get('/status', async (req, res) => {
  try {
    const wallet = z.string().min(1).parse(req.query['wallet']);
    const prisma = getPrismaClient();
    const link = await prisma.telegramLink.findUnique({ where: { walletAddress: wallet } });
    if (!link || !link.isActive) {
      res.json({ linked: false });
      return;
    }
    res.json({
      linked: true,
      username: link.username,
      preferences: {
        notifySupply:      link.notifySupply,
        notifyError:       link.notifyError,
        notifyNavMilestone: link.notifyNavMilestone,
        notifyPolicyCap:   link.notifyPolicyCap,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── DELETE /telegram/unlink ───────────────────────────────────────────────────

telegramRouter.delete('/unlink', async (req, res) => {
  try {
    const { wallet_address } = z.object({ wallet_address: z.string().min(60) }).parse(req.body);
    const prisma = getPrismaClient();
    const link = await prisma.telegramLink.findUnique({ where: { walletAddress: wallet_address } });
    if (link) {
      await prisma.telegramLink.update({ where: { walletAddress: wallet_address }, data: { isActive: false } });
      await sendTelegramMessage(link.chatId, '🔕 *Sonark notifications unlinked.*\nSend your wallet code again to re-link.');
    }
    res.json({ unlinked: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── PATCH /telegram/preferences ───────────────────────────────────────────────

const PrefsSchema = z.object({
  wallet_address:     z.string().min(60),
  notifySupply:       z.boolean().optional(),
  notifyError:        z.boolean().optional(),
  notifyNavMilestone: z.boolean().optional(),
  notifyPolicyCap:    z.boolean().optional(),
});

telegramRouter.patch('/preferences', async (req, res) => {
  try {
    const { wallet_address, ...prefs } = PrefsSchema.parse(req.body);
    const prisma = getPrismaClient();
    const updated = await prisma.telegramLink.update({
      where: { walletAddress: wallet_address },
      data: prefs,
    });
    res.json({ updated: true, preferences: {
      notifySupply:       updated.notifySupply,
      notifyError:        updated.notifyError,
      notifyNavMilestone: updated.notifyNavMilestone,
      notifyPolicyCap:    updated.notifyPolicyCap,
    }});
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /telegram/webhook ────────────────────────────────────────────────────
// Telegram sends every bot message/update here.

telegramRouter.post('/webhook', async (req, res) => {
  // Always respond 200 immediately — Telegram will retry if we don't
  res.sendStatus(200);

  if (!env.TELEGRAM_BOT_TOKEN) return;

  try {
    const update = req.body as TelegramUpdate;
    const msg = update.message;
    if (!msg?.text) return;

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    const username = msg.from?.username;
    const prisma = getPrismaClient();

    // Handle /start <code> or just the code directly
    const codeMatch = text.match(/SNK-[A-F0-9]{6}/i);
    if (!codeMatch) {
      // Unknown message — send help
      await sendTelegramMessage(chatId,
        '👋 *Sonark Bot*\n\nSend your linking code from the Sonark Notifications page to connect your wallet.'
      );
      return;
    }

    const code = codeMatch[0].toUpperCase();
    const record = await prisma.telegramLinkCode.findUnique({ where: { code } });

    if (!record || record.used || record.expiresAt < new Date()) {
      await sendTelegramMessage(chatId,
        '❌ *Code invalid or expired.*\n\nGenerate a new code from the Sonark Notifications page.'
      );
      return;
    }

    // Mark code used
    await prisma.telegramLinkCode.update({ where: { code }, data: { used: true } });

    // Upsert the link
    await prisma.telegramLink.upsert({
      where: { walletAddress: record.walletAddress },
      create: {
        walletAddress: record.walletAddress,
        chatId,
        username: username ?? null,
        isActive: true,
      },
      update: {
        chatId,
        username: username ?? null,
        isActive: true,
      },
    });

    const shortWallet = `${record.walletAddress.slice(0, 6)}…${record.walletAddress.slice(-4)}`;
    await sendTelegramMessage(chatId,
      `✅ *Linked to ${shortWallet}*\n\nYou'll now receive keeper notifications here.\n\nManage preferences in the Sonark Notifications page.`
    );
  } catch {
    // Swallow — never let webhook handler crash
  }
});

// ── POST /telegram/register-webhook ──────────────────────────────────────────
// Call this once to register the Railway API URL as the Telegram webhook.

telegramRouter.post('/register-webhook', async (req, res) => {
  if (!env.TELEGRAM_BOT_TOKEN) {
    res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
    return;
  }
  try {
    const { url } = z.object({ url: z.string().url() }).parse(req.body);
    const webhookUrl = `${url}/telegram/webhook`;
    const r = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });
    const data = await r.json() as { ok: boolean; description?: string };
    if (!data.ok) throw new Error(data.description ?? 'Telegram setWebhook failed');
    res.json({ registered: true, webhook_url: webhookUrl });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number };
    from?: { username?: string };
  };
}

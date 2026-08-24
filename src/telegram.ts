// Telegram Bot API helper — no-op when token/chat are unset.

export interface TelegramClient {
  configured: boolean;
  send(text: string): Promise<boolean>;
}

export function createTelegram(
  botToken: string | null,
  chatId: string | null,
): TelegramClient {
  const configured = Boolean(botToken && chatId);

  return {
    configured,
    async send(text: string): Promise<boolean> {
      if (!botToken || !chatId) return false;

      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true,
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error(`[${ts()}] Telegram HTTP ${res.status}: ${body}`);
          return false;
        }
        return true;
      } catch (err) {
        console.error(`[${ts()}] Telegram send failed:`, err);
        return false;
      }
    },
  };
}

function ts(): string {
  return new Date().toISOString();
}

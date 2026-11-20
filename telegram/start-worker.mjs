const GAME_URL = "https://tj7hmm4br7-ops.github.io/kadr/";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) {
      return new Response(null, { status: 503 });
    }
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response(null, { status: 403 });
    }

    const update = await request.json().catch(() => null);
    const message = update?.message;
    if (message?.chat?.type !== "private" || !Number.isSafeInteger(message.chat.id) ||
        !/^\/start(?:@UgadayKadrBot)?(?:\s|$)/i.test(message.text || "")) {
      return new Response(null, { status: 204 });
    }

    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: message.chat.id,
          text: "Угадывай фильмы по кадрам. Сыграй один, открой «Фильм дня» или создай комнату для друзей.",
          reply_markup: {
            inline_keyboard: [[{ text: "Играть", web_app: { url: GAME_URL } }]],
          },
        }),
      });
      if (response.ok && (await response.json()).ok) return new Response(null, { status: 204 });
    } catch {
      // Telegram retries webhook updates when delivery fails.
    }
    return new Response(null, { status: 502 });
  },
};

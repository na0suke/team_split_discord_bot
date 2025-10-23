import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { TOKEN } from './constants.js';
import { handleCommandRegistration } from './utils/command-register.js';
import { setupEventHandlers } from './events.js';

// コマンド登録処理（コマンドライン引数による）
handleCommandRegistration();

// Discord クライアント作成
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// イベントハンドラー設定
setupEventHandlers(client);

// Bot起動
client.login(TOKEN);

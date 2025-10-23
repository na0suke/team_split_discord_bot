import { REST, Routes } from 'discord.js';
import { commands } from '../commands.js';
import { TOKEN, CLIENT_ID, GUILD_ID, GUILD_IDS } from '../constants.js';

// コマンド登録処理を実行
export async function registerCommands(type = 'guild') {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  // アプリケーションIDを取得
  let appId = CLIENT_ID;
  if (!appId) {
    const { Client } = await import('discord.js');
    const tmp = new Client({ intents: [] });
    await tmp.login(TOKEN);
    appId = tmp.user.id;
    await tmp.destroy();
  }

  try {
    switch (type) {
      case 'global':
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        console.log('Global commands registered.');
        break;

      case 'guild':
        if (!GUILD_ID) throw new Error('GUILD_ID is required for guild registration');
        await rest.put(Routes.applicationGuildCommands(appId, GUILD_ID), { body: commands });
        console.log('Guild commands registered.');
        break;

      case 'multi-guild':
        if (!GUILD_IDS.length) throw new Error('GUILD_IDS または GUILD_ID を設定してください（カンマ区切り可）');
        for (const gid of GUILD_IDS) {
          await rest.put(Routes.applicationGuildCommands(appId, gid), { body: commands });
          console.log(`Guild commands registered for ${gid}`);
        }
        break;

      default:
        throw new Error(`Unknown registration type: ${type}`);
    }
  } catch (error) {
    console.error('Command registration failed:', error);
    throw error;
  }
}

// コマンドライン引数による登録処理
export function handleCommandRegistration() {
  const arg = process.argv[2];

  if (arg === 'register') {
    registerCommands('guild').then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else if (arg === 'register-global') {
    registerCommands('global').then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  } else if (arg === 'guild-register') {
    registerCommands('multi-guild').then(() => process.exit(0)).catch((e) => {
      console.error(e);
      process.exit(1);
    });
  }
}

import { Events } from 'discord.js';
import { handleSignupCommands } from './handlers/signup-commands.js';
import { handleTeamCommands } from './handlers/team-commands.js';
import { handleUserCommands } from './handlers/user-commands.js';
import { handleResultAndConfigCommands } from './handlers/result-config-commands.js';
import { handleLaneCommands } from './handlers/lane-commands.js';
import { handleHelpCommand } from './handlers/help-command.js';
import { handleReactionAdd, handleReactionRemove } from './handlers/reaction-handlers.js';

// イベントハンドラーを設定
export function setupEventHandlers(client) {
  // Bot準備完了
  client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
  });

  // スラッシュコマンド処理
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      // 各ハンドラーで処理を試行
      const handlers = [
        handleSignupCommands,
        handleTeamCommands,
        handleUserCommands,
        handleResultAndConfigCommands,
        handleLaneCommands,
        handleHelpCommand
      ];

      for (const handler of handlers) {
        if (await handler(interaction)) {
          return; // 処理完了
        }
      }

      // どのハンドラーでも処理されなかった場合
      console.warn(`Unknown command: ${interaction.commandName}`);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply('不明なコマンドです。');
      }

    } catch (error) {
      console.error('[InteractionCreate]', error);

      const errorMsg = 'コマンド実行中にエラーが発生しました。';
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(errorMsg);
        } else {
          await interaction.reply(errorMsg);
        }
      } catch (replyError) {
        console.error('[Error Reply Failed]', replyError);
      }
    }
  });

  // リアクション追加
  client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
      await handleReactionAdd(reaction, user, client);
    } catch (error) {
      console.error('[MessageReactionAdd]', error);
    }
  });

  // リアクション削除
  client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
      await handleReactionRemove(reaction, user);
    } catch (error) {
      console.error('[MessageReactionRemove]', error);
    }
  });
}

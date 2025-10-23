import { EmbedBuilder, MessageFlags } from 'discord.js';
import { commands, commandCategories } from '../commands.js';

// ヘルプコマンド処理
export async function handleHelpCommand(interaction) {
	if (interaction.commandName !== 'help') return false;

	const embed = new EmbedBuilder()
		.setTitle('コマンド一覧')
		.setColor(0x00AE86)
		.setDescription('利用可能なコマンド一覧です。各カテゴリ別に整理されています。');

	// カテゴリ別にコマンドを表示
	for (const [category, commandNames] of Object.entries(commandCategories)) {
		const commandList = commandNames
			.map(name => {
				const cmd = commands.find(c => c.name === name);
				return cmd ? `**/${cmd.name}** — ${cmd.description}` : null;
			})
			.filter(Boolean)
			.join('\n');

		if (commandList) {
			embed.addFields({
				name: `📁 ${category}`,
				value: commandList,
				inline: false,
			});
		}
	}

	embed.setFooter({
		text: 'TeamSplitBot - Discord用チーム分けBot',
	});

	await interaction.reply({
		embeds: [embed],
		flags: MessageFlags.Ephemeral,
	});

	return true;
}

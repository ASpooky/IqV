import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("ボイスチャンネルに参加"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("退出"),
  new SlashCommandBuilder()
    .setName("persona")
    .setDescription("ペルソナ管理")
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("ペルソナ一覧"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("use")
        .setDescription("ペルソナを切り替える（次回接続時に反映）")
        .addStringOption((o) =>
          o.setName("name").setDescription("ペルソナ名").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("ペルソナを作成・上書き")
        .addStringOption((o) =>
          o.setName("name").setDescription("識別名 (例: tsundere)").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("display_name").setDescription("ボットの話し名前 (例: 月姫)").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("voice_id").setDescription("ボイス (例: nova, alloy, shimmer)").setRequired(true),
        )
        .addStringOption((o) =>
          o.setName("prompt").setDescription("システムプロンプト").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("ペルソナを削除")
        .addStringOption((o) =>
          o.setName("name").setDescription("削除するペルソナ名").setRequired(true),
        ),
    ),
].map((c) => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

await rest.put(
  Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
  { body: commands },
);

console.log("slash commands registered");

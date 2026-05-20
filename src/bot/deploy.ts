import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("ボイスチャンネルに参加して録音開始"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("録音停止して退出"),
  new SlashCommandBuilder()
    .setName("setvoice")
    .setDescription("ボイスを変更する（次回接続時に反映）")
    .addStringOption((o) =>
      o.setName("voice").setDescription("ボイス名 (例: Aoede, Kore, Leda, Puck)").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("setprompt")
    .setDescription("システムプロンプトを変更する（次回接続時に反映）")
    .addStringOption((o) =>
      o.setName("prompt").setDescription("新しいシステムプロンプト").setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("setname")
    .setDescription("ボットの名前を変更する（次回接続時に反映）")
    .addStringOption((o) =>
      o.setName("name").setDescription("新しい名前").setRequired(true),
    ),
].map((c) => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

await rest.put(
  Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
  { body: commands },
);

console.log("slash commands registered");

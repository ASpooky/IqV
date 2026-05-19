import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const commands = [
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("ボイスチャンネルに参加して録音開始"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("録音停止して退出"),
].map((c) => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

await rest.put(
  Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
  { body: commands },
);

console.log("slash commands registered");

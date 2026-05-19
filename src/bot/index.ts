import "dotenv/config";
import {
  Client,
  Events,
  GatewayIntentBits,
  VoiceState,
  ChatInputCommandInteraction,
} from "discord.js";
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnection,
} from "@discordjs/voice";
import { PipecatClient } from "./voice/pipecatClient.js";

const pipecatClients = new Map<string, PipecatClient>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── helpers ───────────────────────────────────────────────────────────────────

function connectAndRecord(
  guildId: string,
  channelId: string,
  adapterCreator: Parameters<typeof joinVoiceChannel>[0]["adapterCreator"],
): { connection: VoiceConnection; pipecat: PipecatClient } {
  console.log(`[connectAndRecord] joining guildId=${guildId} channelId=${channelId}`);

  const connection = joinVoiceChannel({
    guildId,
    channelId,
    adapterCreator,
    selfDeaf: false,
  });

  console.log(`[connectAndRecord] initial state=${connection.state.status}`);

  connection.on("stateChange", (old, s) => {
    console.log(`[voice] state ${old.status} → ${s.status}`);
  });

  connection.on("error", (err) => {
    console.error(`[voice] error:`, err);
  });

  // @ts-ignore — internal debug event
  connection.on("debug", (msg: string) => {
    console.log(`[voice debug] ${msg}`);
  });

  const pipecat = new PipecatClient(connection);

  connection.receiver.speaking.on("start", (userId) => {
    console.log(`[speaking] start userId=${userId}`);
    pipecat.streamUser(userId);
  });

  return { connection, pipecat };
}

// ── events ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {

  // 起動時に以前の接続をチェック、厳密にはcacheと実体がずれる可能性はあるが一旦許容
  for (const guild of c.guilds.cache.values()) {
    const me = guild.members.cache.get(c.user.id);
    if (me?.voice.channelId) {
      const conn = joinVoiceChannel({
        guildId: guild.id,
        channelId: me.voice.channelId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
      });
      conn.destroy();
    }
  }
});

client.on(Events.Error, (err) => {
  console.error("[client] error:", err.message);
});

client.on(Events.VoiceStateUpdate, (before: VoiceState, after: VoiceState) => {
  if (after.member?.user.bot) return;
  if (!after.guild) {
    console.error("error: after guild is nothing.")
    return
  }

  const guild = after.guild;
  const existing = getVoiceConnection(guild.id);

  // ユーザーが入室 → 追従
  if (after.channel && !before.channel && !existing) {
    pipecatClients.get(guild.id)?.destroy();
    pipecatClients.delete(guild.id);
    const { pipecat } = connectAndRecord(guild.id, after.channelId!, guild.voiceAdapterCreator);
    pipecatClients.set(guild.id, pipecat);
    return;
  }

  // ユーザーが退室 → 切断
  if (
    before.channel &&
    !after.channel &&
    existing &&
    before.channelId === before.channel.id
  ) {
    const humans = before.channel.members.filter((m) => !m.user.bot);
    if (humans.size === 0) {
      pipecatClients.get(guild.id)?.destroy();
      pipecatClients.delete(guild.id);
      existing.destroy();
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const i = interaction as ChatInputCommandInteraction;

  try {
    if (i.commandName === "join") {
      if (!i.deferred && !i.replied) await i.deferReply();
      const member = await i.guild!.members.fetch(i.user.id);
      const vc = member.voice.channel;
      if (!vc) {
        await i.editReply("先にボイスチャンネルに入ってください。");
        return;
      }
      pipecatClients.get(i.guild!.id)?.destroy();
      pipecatClients.delete(i.guild!.id);
      const { pipecat } = connectAndRecord(i.guild!.id, vc.id, i.guild!.voiceAdapterCreator);
      pipecatClients.set(i.guild!.id, pipecat);
      await i.editReply(`✓ \`${vc.name}\` に参加`);
      return;
    }

    if (i.commandName === "leave") {
      const conn = getVoiceConnection(i.guild!.id);
      if (!conn) {
        await i.reply({ content: "ボイスチャンネルにいません。", ephemeral: true });
        return;
      }
      pipecatClients.get(i.guild!.id)?.destroy();
      pipecatClients.delete(i.guild!.id);
      conn.destroy();
      await i.reply("退出しました。");
    }
  } catch (err: any) {
    if (err?.code === 10062) return; // stale interaction (tsx reload replay), ignore
    console.error("[interaction] error:", err);
  }
});

function cleanup() {
  for (const [guildId, pipecat] of pipecatClients) {
    pipecat.destroy();
    getVoiceConnection(guildId)?.destroy();
  }
  pipecatClients.clear();
}

process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("SIGINT",  () => { cleanup(); process.exit(0); });

client.login(process.env.DISCORD_TOKEN);

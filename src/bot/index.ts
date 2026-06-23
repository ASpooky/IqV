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
import {
  getPersonas,
  getPersona,
  getActivePersona,
  setActivePersona,
  upsertPersona,
  deletePersona,
} from "../db/config.js";

const PIPECAT_BASE_URL = process.env.PIPECAT_BASE_URL;
if (!PIPECAT_BASE_URL) throw new Error("PIPECAT_BASE_URL is not set");

const pipecatClients = new Map<string, PipecatClient>();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function createSession(): Promise<string> {
  const persona = getActivePersona();
  const config = {
    name: persona.display_name,
    voice_id: persona.voice_id,
    system_instruction: persona.system_instruction,
  };

  const res = await fetch(`${PIPECAT_BASE_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });

  if (!res.ok) throw new Error(`POST /sessions failed: ${res.status}`);

  const { ws_path } = await res.json() as { session_id: string; ws_path: string };
  const wsBase = PIPECAT_BASE_URL!.replace(/^http/, "ws");
  return `${wsBase}${ws_path}`;
}

async function connectAndRecord(
  guildId: string,
  channelId: string,
  adapterCreator: Parameters<typeof joinVoiceChannel>[0]["adapterCreator"],
): Promise<{ connection: VoiceConnection; pipecat: PipecatClient }> {
  console.log(`[connectAndRecord] joining guildId=${guildId} channelId=${channelId}`);

  const connection = joinVoiceChannel({
    guildId,
    channelId,
    adapterCreator,
    selfDeaf: false,
  });

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

  const wsUrl = await createSession();
  const pipecat = new PipecatClient(connection, wsUrl);

  pipecat.onClosed = () => {
    console.log(`[connectAndRecord] pipeline closed, leaving voice channel...`);
    pipecat.destroy();
    pipecatClients.delete(guildId);
    connection.destroy();
  };

  connection.receiver.speaking.on("start", (userId) => {
    console.log(`[speaking] start userId=${userId}`);
    pipecat.streamUser(userId);
  });

  return { connection, pipecat };
}

// ── events ────────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] ready as ${c.user.tag}, active persona: ${getActivePersona().name}`);
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

client.on(Events.VoiceStateUpdate, async (before: VoiceState, after: VoiceState) => {
  if (after.member?.user.bot) return;
  if (!after.guild) {
    console.error("error: after guild is nothing.");
    return;
  }

  const guild = after.guild;
  const existing = getVoiceConnection(guild.id);

  if (after.channel && !before.channel && !existing) {
    pipecatClients.get(guild.id)?.destroy();
    pipecatClients.delete(guild.id);
    const { pipecat } = await connectAndRecord(guild.id, after.channelId!, guild.voiceAdapterCreator);
    pipecatClients.set(guild.id, pipecat);
    return;
  }

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
      const { pipecat } = await connectAndRecord(i.guild!.id, vc.id, i.guild!.voiceAdapterCreator);
      pipecatClients.set(i.guild!.id, pipecat);
      await i.editReply(`✓ \`${vc.name}\` に参加 (ペルソナ: ${getActivePersona().name})`);
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
      return;
    }

    if (i.commandName === "persona") {
      const sub = i.options.getSubcommand();

      if (sub === "list") {
        const personas = getPersonas();
        const active = getActivePersona();
        const lines = personas.map((p) =>
          `${p.name === active.name ? "▶" : "　"} **${p.name}** — ${p.display_name} / ${p.voice_id}`
        );
        await i.reply({ content: lines.join("\n") || "ペルソナがありません", ephemeral: true });
        return;
      }

      if (sub === "use") {
        const name = i.options.getString("name", true);
        const persona = getPersona(name);
        if (!persona) {
          await i.reply({ content: `ペルソナ \`${name}\` が見つかりません。`, ephemeral: true });
          return;
        }
        setActivePersona(name);
        await i.reply({ content: `ペルソナを **${name}** (${persona.display_name}) に変更しました。次回接続時に反映されます。`, ephemeral: true });
        return;
      }

      if (sub === "create") {
        const name = i.options.getString("name", true);
        const displayName = i.options.getString("display_name", true);
        const voiceId = i.options.getString("voice_id", true);
        const prompt = i.options.getString("prompt", true);
        upsertPersona({ name, display_name: displayName, voice_id: voiceId, system_instruction: prompt });
        await i.reply({ content: `ペルソナ **${name}** を保存しました。`, ephemeral: true });
        return;
      }

      if (sub === "delete") {
        const name = i.options.getString("name", true);
        deletePersona(name);
        await i.reply({ content: `ペルソナ **${name}** を削除しました。`, ephemeral: true });
        return;
      }
    }
  } catch (err: any) {
    if (err?.code === 10062) return;
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

import asyncio
import os
import sqlite3
from dotenv import load_dotenv

from pipecat.transports.websocket.server import (
    WebsocketServerTransport,
    WebsocketServerParams,
)
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.frames.frames import Frame, StartFrame, AudioRawFrame, InputAudioRawFrame
from pipecat.adapters.schemas.tools_schema import ToolsSchema, FunctionSchema
from pipecat.processors.aggregators.llm_response_universal import (
    LLMAssistantAggregator,
    LLMUserAggregator,
)
from pipecat.processors.aggregators.llm_context import LLMContext

# 必要なサービスをインポート
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.frames.frames import EndFrame
from loguru import logger

from pipecat.services.llm_service import FunctionCallParams

# ログをファイル出力する設定 (loguru)
# 標準出力とファイル(logs/pipecat.log)の両方に出力
os.makedirs("logs", exist_ok=True)
logger.add("logs/pipecat.log", rotation="10 MB", retention="5 days", level="DEBUG")


class RawPCMSerializer(FrameSerializer):
    """raw PCM bytes (int16 LE) ↔ pipecat audio frames."""

    def __init__(self, sample_rate: int = 16_000, num_channels: int = 1):
        super().__init__()
        self._sample_rate = sample_rate
        self._num_channels = num_channels

    async def serialize(self, frame: Frame) -> bytes | None:
        if isinstance(frame, AudioRawFrame):
            return frame.audio
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes) and len(data) > 0:
            return InputAudioRawFrame(
                audio=data,
                sample_rate=self._sample_rate,
                num_channels=self._num_channels,
            )
        return None


load_dotenv()

PIPECAT_HOST = os.getenv("PIPECAT_HOST", "localhost")
PIPECAT_PORT = int(os.getenv("PIPECAT_PORT", "8765"))
DB_PATH = os.getenv("DB_PATH", "data/config.db")

DEFAULTS = {
    "voice_id": "alloy",  # OpenAI TTSのデフォルトボイス (alloy, echo, fable, onyx, nova, shimmer)
    "system_instruction": "You are a helpful voice assistant. Respond concisely.",
    "name": "Assistant",
}


def read_config() -> dict:
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT key, value FROM config")
        rows = cur.fetchall()
        conn.close()

        config = {**DEFAULTS, **dict(rows)}

        # OpenAI TTSでサポートされていない音声(例: Geminiの'Puck')が設定されている場合、alloyにフォールバックする
        supported_openai_voices = [
            "alloy",
            "ash",
            "ballad",
            "cedar",
            "coral",
            "echo",
            "fable",
            "marin",
            "nova",
            "onyx",
            "sage",
            "shimmer",
            "verse",
        ]
        if config.get("voice_id") not in supported_openai_voices:
            logger.warning(
                f"Voice '{config.get('voice_id')}' is not supported by OpenAI TTS. Falling back to 'alloy'."
            )
            config["voice_id"] = "alloy"

        return config
    except Exception:
        return dict(DEFAULTS)


async def run():
    while True:
        config = read_config()
        logger.info(
            f"[pipecat] config: voice={config['voice_id']} name={config['name']}"
        )

        # 1. サービスの初期化
        # VAD
        vad = SileroVADAnalyzer()
        vad_processor = VADProcessor(vad_analyzer=vad)

        # LLM (OpenAI)
        llm = OpenAILLMService(
            api_key=os.environ["OPENAI_API_KEY"],
            settings=OpenAILLMService.Settings(model="gpt-4o-mini"),
        )

        # TTS (OpenAI)
        tts = OpenAITTSService(
            api_key=os.environ["OPENAI_API_KEY"],
            settings=OpenAITTSService.Settings(voice=config["voice_id"]),
        )

        # STT (Whisper)
        # 注意: Pipecat の OpenAI STT はストリーミングではなく、発話が終わってからファイルを投げる仕組み(Whisper API)です。
        # 爆速を求める場合は Deepgram 等のストリーミング STT の方が高速ですが、今回は OpenAI を使用します。
        stt = OpenAISTTService(
            api_key=os.environ["OPENAI_API_KEY"],
            settings=OpenAISTTService.Settings(model="whisper-1"),
        )

        transport = WebsocketServerTransport(
            host=PIPECAT_HOST,
            port=PIPECAT_PORT,
            params=WebsocketServerParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_in_sample_rate=16_000,
                audio_out_sample_rate=16_000,
                serializer=RawPCMSerializer(sample_rate=16_000, num_channels=1),
            ),
        )

        # 2. 会話コンテキストの初期化
        system_instruction = (
            f"Your name is {config['name']}. {config['system_instruction']}\n\n"
            "If the user says things like 'That's all', 'See you', 'Bye', 'You can leave now', or clearly indicates they want to end the conversation, "
            "you MUST call the `leave_voice_channel` tool to exit."
        )
        context = LLMContext()
        context_messages = [{"role": "system", "content": system_instruction}]
        context.set_messages(context_messages)

        # ツール(関数)の定義
        tools = [
            FunctionSchema(
                name="leave_voice_channel",
                description="Leave the voice channel and end the session when the user indicates the conversation is over.",
                properties={},
                required=[],
            )
        ]
        context.set_tools(ToolsSchema(standard_tools=tools))

        user_aggregator = LLMUserAggregator(context)
        assistant_aggregator = LLMAssistantAggregator(context)

        # ツール呼び出し時のハンドラー
        async def leave_voice_channel(params: FunctionCallParams):
            logger.info(
                "👋 User requested to end the conversation. Leaving voice channel..."
            )
            await params.result_callback("Leaving the voice channel now. Goodbye!")
            # 少し待ってから終了フレームを投げる
            await asyncio.sleep(2.0)
            await task.queue_frame(EndFrame())

        llm.register_function("leave_voice_channel", leave_voice_channel)

        # 3. パイプラインの構築
        pipeline = Pipeline(
            [
                transport.input(),  # ユーザーの音声入力
                vad_processor,  # VADで発話区間を検出
                stt,  # Whisperでテキスト化
                user_aggregator,  # ユーザーの発言をコンテキストに追加
                llm,  # ChatGPTで応答生成
                tts,  # 音声合成
                transport.output(),  # クライアントへ音声送信
                assistant_aggregator,  # アシスタントの応答をコンテキストに追加
            ]
        )

        task = PipelineTask(pipeline)
        logger.info(
            f"[pipecat] listening on ws://{PIPECAT_HOST}:{PIPECAT_PORT} (OpenAI pipeline)"
        )

        try:
            await PipelineRunner(handle_sigint=False).run(task)
        except Exception as e:
            logger.exception(f"[pipecat] session error: {e}")

        logger.info("[pipecat] session ended, reloading config...")


if __name__ == "__main__":
    asyncio.run(run())

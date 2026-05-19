import asyncio
import os
from dotenv import load_dotenv

from pipecat.transports.websocket.server import WebsocketServerTransport, WebsocketServerParams
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import (
    Frame, StartFrame, LLMContextFrame, AudioRawFrame, InputAudioRawFrame
)
from pipecat.processors.aggregators.llm_context import LLMContext



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


class ContextBootstrapper(FrameProcessor):
    """Injects an empty LLMContextFrame after StartFrame to enable Gemini Live audio input."""

    def __init__(self, context: LLMContext, **kwargs):
        super().__init__(**kwargs)
        self._context = context

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)
        if isinstance(frame, StartFrame):
            await self.push_frame(LLMContextFrame(context=self._context))


async def run():
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

    llm = GeminiLiveLLMService(
        api_key=os.environ["GOOGLE_API_KEY"],
        voice_id="Aoede",
        system_instruction="You are a helpful voice assistant. Respond concisely.",
    )

    context = LLMContext()

    pipeline = Pipeline([
        transport.input(),
        ContextBootstrapper(context=context),
        llm,
        transport.output(),
    ])

    task = PipelineTask(pipeline)
    print(f"[pipecat] listening on ws://{PIPECAT_HOST}:{PIPECAT_PORT}")
    await PipelineRunner(handle_sigint=True).run(task)


if __name__ == "__main__":
    asyncio.run(run())

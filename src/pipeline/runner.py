import asyncio
import os

from loguru import logger
from pydantic import BaseModel

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport
from pipecat.adapters.schemas.tools_schema import ToolsSchema, FunctionSchema
from pipecat.processors.aggregators.llm_response_universal import (
    LLMAssistantAggregator,
    LLMUserAggregator,
)
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.transcriptions.language import Language
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.frames.frames import EndFrame
from pipecat.services.llm_service import FunctionCallParams


class PipelineConfig(BaseModel):
    name: str
    voice_id: str
    system_instruction: str


async def run(config: PipelineConfig, transport: FastAPIWebsocketTransport):
    vad = SileroVADAnalyzer()
    vad_processor = VADProcessor(vad_analyzer=vad)

    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAILLMService.Settings(model="gpt-4o-mini"),
    )

    tts = OpenAITTSService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAITTSService.Settings(voice=config.voice_id),
    )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        settings=DeepgramSTTService.Settings(
            language=Language.JA,
            utterance_end_ms=1000,
        ),
    )

    system_instruction = (
        f"Your name is {config.name}. {config.system_instruction}\n\n"
        "If the user says things like 'That's all', 'See you', 'Bye', 'You can leave now', or clearly indicates they want to end the conversation, "
        "you MUST call the `leave_voice_channel` tool to exit."
    )
    context = LLMContext()
    context.set_messages([{"role": "system", "content": system_instruction}])
    context.set_tools(ToolsSchema(standard_tools=[
        FunctionSchema(
            name="leave_voice_channel",
            description="Leave the voice channel and end the session when the user indicates the conversation is over.",
            properties={},
            required=[],
        )
    ]))

    user_aggregator = LLMUserAggregator(context)
    assistant_aggregator = LLMAssistantAggregator(context)

    async def leave_voice_channel(params: FunctionCallParams):
        logger.info("User requested to end the conversation. Leaving voice channel...")
        await params.result_callback("Leaving the voice channel now. Goodbye!")
        await asyncio.sleep(2.0)
        await task.queue_frame(EndFrame())

    llm.register_function("leave_voice_channel", leave_voice_channel)

    pipeline = Pipeline([
        transport.input(),
        vad_processor,
        stt,
        user_aggregator,
        llm,
        tts,
        transport.output(),
        assistant_aggregator,
    ])

    task = PipelineTask(pipeline)

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, websocket):
        await task.rtvi.set_client_ready()

    try:
        await PipelineRunner(handle_sigint=False).run(task)
    except Exception as e:
        logger.exception(f"[pipecat] session error: {e}")

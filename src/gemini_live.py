import os
from dotenv import load_dotenv

from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.base_transport import TransportParams
from pipecat.runner.types import SmallWebRTCRunnerArguments
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.services.google.gemini_live.llm import GeminiLiveLLMService
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import Frame, StartFrame, LLMContextFrame
from pipecat.processors.aggregators.llm_context import LLMContext

load_dotenv()


class ContextBootstrapper(FrameProcessor):
    """Injects an empty LLMContextFrame after StartFrame to enable Gemini Live audio input.

    GeminiLiveLLMService gates all audio on _ready_for_realtime_input, which only
    becomes True after _handle_context() is called. Without context aggregators in
    the pipeline, this processor manually triggers that initialization.
    """

    def __init__(self, context: LLMContext, **kwargs):
        super().__init__(**kwargs)
        self._context = context

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)
        if isinstance(frame, StartFrame):
            await self.push_frame(LLMContextFrame(context=self._context))


async def bot(runner_args: SmallWebRTCRunnerArguments):
    transport = SmallWebRTCTransport(
        webrtc_connection=runner_args.webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    llm = GeminiLiveLLMService(
        api_key=os.environ["GOOGLE_API_KEY"],
        system_instruction="You are a helpful voice assistant. Respond concisely.",
    )

    context = LLMContext()

    pipeline = Pipeline(
        [
            transport.input(),
            ContextBootstrapper(context=context),
            llm,
            transport.output(),
        ]
    )

    task = PipelineTask(pipeline)
    await PipelineRunner(handle_sigint=False).run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()

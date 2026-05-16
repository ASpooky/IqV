from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.base_transport import TransportParams
from pipecat.runner.types import SmallWebRTCRunnerArguments
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineTask
from pipecat.pipeline.runner import PipelineRunner
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.frames.frames import Frame, InputAudioRawFrame, OutputAudioRawFrame


class AudioEcho(FrameProcessor):
    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
            await self.push_frame(
                OutputAudioRawFrame(
                    audio=frame.audio,
                    sample_rate=frame.sample_rate,
                    num_channels=frame.num_channels,
                )
            )
        else:
            await self.push_frame(frame, direction)


async def bot(runner_args: SmallWebRTCRunnerArguments):
    transport = SmallWebRTCTransport(
        webrtc_connection=runner_args.webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )
    pipeline = Pipeline(
        [
            transport.input(),
            AudioEcho(),
            transport.output(),
        ]
    )

    task = PipelineTask(pipeline)
    await PipelineRunner(handle_sigint=False).run(task)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()

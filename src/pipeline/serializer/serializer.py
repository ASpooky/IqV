from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.frames.frames import Frame, StartFrame, AudioRawFrame, InputAudioRawFrame


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

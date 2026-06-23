import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, HTTPException
from loguru import logger

from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketTransport,
    FastAPIWebsocketParams,
)

from .runner import PipelineConfig, run
from .serializer.serializer import RawPCMSerializer

load_dotenv()

app = FastAPI()

_sessions: dict[str, PipelineConfig] = {}


@app.post("/sessions", status_code=201)
async def create_session(config: PipelineConfig) -> dict:
    session_id = str(uuid.uuid4())
    _sessions[session_id] = config
    logger.info(f"[server] session created: {session_id} name={config.name}")
    return {"session_id": session_id, "ws_path": f"/sessions/{session_id}/ws"}


@app.websocket("/sessions/{session_id}/ws")
async def session_ws(websocket: WebSocket, session_id: str):
    config = _sessions.pop(session_id, None)
    if config is None:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    logger.info(f"[server] WS connected: {session_id}")

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16_000,
            audio_out_sample_rate=16_000,
            serializer=RawPCMSerializer(sample_rate=16_000, num_channels=1),
        ),
    )

    await run(config, transport)
    logger.info(f"[server] session ended: {session_id}")

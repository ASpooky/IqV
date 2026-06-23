# IqV

Discordのボイスチャンネルに参加し、自然な音声で対話するAIアシスタントBotです。
Pipecat（パイプライン管理）を活用し、リアルタイムな音声対話を実現しています。

## 特徴

- **Discordボイスチャンネル連携**: ユーザーがVCに入ると自動参加し、音声をリアルタイムに処理。
- **ペルソナ管理**: スラッシュコマンドで複数のペルソナを作成・切り替え可能。次回接続時に反映。
- **Pipecatによるパイプライン**: VAD (Silero)、STT (Deepgram)、LLM (gpt-4o-mini)、TTS (OpenAI) をシームレスに連携。
- **セッション分離**: 接続ごとにパイプラインを独立して起動。複数の会話を同時にこなせる。

## アーキテクチャ

```
Discord Bot (TypeScript)
  ├─ ユーザーがVCに入室 → POST /sessions にペルソナ設定を送信
  ├─ ws://host:8000/sessions/{id}/ws に接続して音声をストリーミング
  └─ スラッシュコマンドでペルソナを管理

音声処理サーバー (Python / FastAPI + Pipecat)
  ├─ POST /sessions でセッションを発行
  └─ WS /sessions/{id}/ws でパイプラインを起動
       Silero VAD → Deepgram STT → GPT-4o-mini → OpenAI TTS
```

## コマンド一覧 (Discord)

| コマンド | 説明 |
|---|---|
| `/join` | 自分がいるVCにBotを呼ぶ |
| `/leave` | BotをVCから退出させる |
| `/persona list` | ペルソナ一覧を表示（現在のペルソナに ▶ がつく）|
| `/persona use <name>` | アクティブペルソナを切り替え（次回接続時に反映）|
| `/persona create <name> <display_name> <voice_id> <prompt>` | ペルソナを作成・上書き |
| `/persona delete <name>` | ペルソナを削除 |

## 動作環境・セットアップ

### 前提条件

- Node.js 18+
- Python 3.12+
- FFmpeg (Discordの音声処理用)
- OpenAI API Key
- Deepgram API Key
- Discord Bot Token

### 環境変数の設定

プロジェクトルートに `.env` ファイルを作成します。

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
OPENAI_API_KEY=your_openai_api_key
DEEPGRAM_API_KEY=your_deepgram_api_key
PIPECAT_BASE_URL=http://localhost:8000
```

### 起動方法

**1. 依存パッケージのインストール**

```bash
# Python
pip install -r requirements.txt   # または: pip install "pipecat-ai[deepgram]" fastapi uvicorn loguru python-dotenv

# Node.js
npm install
```

**2. スラッシュコマンドの登録**（初回または変更時のみ）

```bash
npx tsx src/bot/deploy.ts
```

**3. 音声処理サーバー (Python) の起動**

```bash
# src/ ディレクトリで実行
cd src
python -m uvicorn pipeline.index:app --host 0.0.0.0 --port 8000
```

**4. Discord Bot (Node.js) の起動**

```bash
npm run dev
# または本番環境では:
npx tsx src/bot/index.ts
```

起動後、ユーザーがVCに入るとBotが自動参加します。`/join` コマンドで手動参加も可能です。

# IqV

Discordのボイスチャンネルに参加し、自然な音声で対話するAIアシスタントBotです。
Pipecat（パイプライン管理）を活用し、リアルタイムな音声対話を実現しています。

## 特徴

- **Discordボイスチャンネル連携**: BotがVCに参加し、ユーザーの音声をリアルタイムに処理。
- **Pipecatによる柔軟なパイプライン**: VAD(音声区間検出)、STT(文字起こし)、LLM(応答生成)、TTS(音声合成)をシームレスに連携。
- **カスタマイズ可能**: DiscordのスラッシュコマンドからAIの性格（システムプロンプト）、声の種類、名前を動的に変更可能。
- **高速な応答**: OpenAIのモデル(`gpt-4o-mini`, `whisper-1`, `tts-1`)をバックエンドとして利用。

## アーキテクチャ

1. **Discord Bot (TypeScript/Node.js)**:
   - ユーザーからのコマンド(`/join`, `/leave`, `/setprompt`, `/setvoice` 等)を受信。
   - ボイスチャンネルの音声ストリームを取得し、WebSocket経由でPythonサーバーへ送信。
2. **音声処理サーバー (Python/Pipecat)**:
   - `Silero VAD`で発話区間を検出。
   - `OpenAI Whisper`で音声をテキストに変換。
   - `OpenAI GPT-4o-mini`で応答を生成。
   - `OpenAI TTS`で音声を合成。
   - WebSocket経由でDiscord Botへ音声を送り返す。

## コマンド一覧 (Discord)

- `/join` : 自分がいるボイスチャンネルにBotを呼ぶ
- `/leave` : Botをボイスチャンネルから退出させる
- `/setvoice <voice>` : AIの声を変更（次回接続時に反映。OpenAI対応のボイス: alloy, echo, fable, onyx, nova, shimmer等）
- `/setprompt <prompt>` : AIのシステムプロンプト（性格・指示）を変更
- `/setname <name>` : AIの名前を変更

## 動作環境・セットアップ

### 前提条件
- Node.js
- Python 3.12+
- FFmpeg (Discordの音声処理・ストリーミング用)
- OpenAI API Key
- Discord Bot Token

### 環境変数の設定
プロジェクトルートに `.env` ファイルを作成し、以下のように設定します。

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
OPENAI_API_KEY=your_openai_api_key
PIPECAT_URL=ws://localhost:8765
```

### 起動方法

1. **音声処理サーバー(Python)の起動**
```bash
# 仮装環境を有効化（例: .venv-win312/Scripts/activate または source .venv/bin/activate）
python src/openai_fast_ws.py
```

2. **Discord Bot(Node.js)の起動**
```bash
npx tsx src/bot/index.ts
```

## 今後の展望 (Issues)
- **自律的な退室機能 (Tool Use)**: ユーザーが「もういいよ」「じゃあね」と言った際に、LLMの関数呼び出し（Function Calling）を利用して自動で退出する機能の実装。
- **会話UXの向上**: 割り込み（Interruption）へのよりスムーズな対応、相槌（Backchanneling）の導入、VADパラメータの微調整など。

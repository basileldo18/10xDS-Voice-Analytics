# VoxAnalyze 🤖📞

**VoxAnalyze** is a powerful, AI-driven call analysis dashboard designed to ingest audio calls (via upload, Google Drive sync, or Vapi live streams), transcribe them, and generate actionable insights using advanced LLMs.

## 🚀 Features

-   **Dashboard Overview**: Real-time stats on call volume, sentiment distribution, and category tags.
-   **Audio Ingestion**:
    -   **File Upload**: Drag & drop support for multiple audio formats.
    -   **Google Drive Sync**: Automatically monitors a specific Drive folder for new call recordings.
    -   **Vapi Integration**: Webhook support for real-time Live Call tracking and analysis from Vapi assistants.
-   **AI Analysis**:
    -   **Transcription**: High-accuracy transcription using AssemblyAI.
    -   **Speaker Diarization**: Detects and separates speakers (Agent vs. Customer).
    -   **Advanced Insights (Groq/Llama)**:
        -   Sentiment Analysis (Positive, Neutral, Negative).
        -   Automatic Tagging (Billing, Support, Churn Risk, etc.).
        -   Structured Summaries (Overview, Key Points, Caller Intent, Resolution, Action Items).
-   **Translation**: One-click translation of transcripts and summaries into multiple languages (English, Hindi, Malayalam, Arabic).
-   **Interactive UI**:
    -   Search and Filter calls by date, sentiment, or tag.
    -   Clickable timestamps to jump to specific audio segments.
    -   Dark Mode support.

## 🛠️ Technology Stack

-   **Backend**: Python (FastAPI), AsyncIO
-   **Frontend**: HTML5, CSS3 (Modern/Glassmorphism), JavaScript (Vanilla)
-   **Database**: Supabase (PostgreSQL)
-   **AI Models**:
    -   LLM: Meta Llama 3 (via Groq)
    -   Transcription: AssemblyAI
-   **Voice AI**: Vapi
-   **Services**: Google Drive API, Gmail SMTP (Notifications)

## 📦 Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/yourusername/voxanalyze.git
    cd voxanalyze
    ```

2.  **Create a virtual environment**:
    ```bash
    python -m venv venv
    # Windows
    venv\Scripts\activate
    # Mac/Linux
    source venv/bin/activate
    ```

3.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configuration**:
    -   Copy `.env.example` to `.env`:
        ```bash
        cp .env.example .env
        ```
    -   Fill in your API keys (Groq, Supabase, AssemblyAI, Vapi, Google Drive ID).

## 🚀 Usage

1.  **Run the application**:
    ```bash
    python app.py
    ```
    The server will start at `http://localhost:8000` (or the port specified).

2.  **Access the Dashboard**:
    Open your browser and navigate to the local URL. Log in (if auth is enabled) and start analyzing calls.

## 🔗 API Endpoints

-   `GET /api/calls`: Fetch paginated call records.
-   `GET /api/call-stats`: Get aggregate statistics.
-   `POST /api/upload`: Upload and process audio files.
-   `POST /api/translate`: Translate transcript/summary.
-   `POST /webhook/drive`: Handle Google Drive push notifications.
-   `POST /api/vapi-call`: Handle Vapi webhooks.

## 📄 License

[MIT License](LICENSE)

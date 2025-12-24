# VoxAnalyze - 10xDS Voice Analytics

**VoxAnalyze** is a powerful, AI-driven voice analytics dashboard designed to process call recordings, extract meaningful insights, and provide actionable data. Built with **FastAPI** and **Supabase**, it leverages state-of-the-art AI models for transcription and analysis.

## ✨ Key Features

*   **🎙️ Accurate Transcription**: Utilizes **AssemblyAI** for high-fidelity speech-to-text conversion with automatic language detection and speaker diarization (speaker separation).
*   **🧠 AI-Powered Analysis**: Integrates **Groq (Meta Llama 3.3)** to generate structured summaries, detect sentiment (Positive/Negative/Neutral), and auto-tag calls (e.g., "Billing", "Support", "Churn Risk").
*   **📊 Interactive Dashboard**: A modern, responsive web interface to view call logs, read transcripts, listen to audio, and filter data by sentiment or tags.
*   **☁️ Google Drive Integration**: Automatically monitors a specified Google Drive folder for new audio files, downloads them, and triggers the analysis pipeline.
*   **🔔 Email Notifications**: Sends automated email reports with call summaries and sentiment scores immediately after processing.
*   **💾 Secure Persistence**: Stores all call metadata, transcripts, and analysis results in a **Supabase** database.
*   **🤖 Vapi Integration**: Ready for integration with Vapi for real-time voice AI assistants.

## 🛠️ Tech Stack

*   **Backend**: Python, FastAPI, Uvicorn
*   **Database**: Supabase (PostgreSQL)
*   **AI Services**: AssemblyAI (Transcription), Groq (LLM Analysis)
*   **Cloud & Storage**: Google Drive API, Google Cloud Platform
*   **Frontend**: HTML5, CSS3, JavaScript, Jinja2 Templates
*   **Utilities**: `python-dotenv`, `smtplib`

## 🚀 Setup & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/basileldo18/10xDS-Voice-Analytics.git
cd 10xDS-Voice-Analytics
```

### 2. Create Virtual Environment
```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Configuration (.env)
Create a `.env` file in the root directory with the following variables:

```ini
# --- Core ---
FLASK_SECRET_KEY=your_secure_random_key

# --- Database (Supabase) ---
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_anon_key

# --- AI Services ---
ASSEMBLYAI_API_KEY=your_assemblyai_key
GROQ_API_KEY=your_groq_api_key

# --- Google Drive & Gmail ---
# SMTP for sending emails
SMTP_EMAIL=your_email@gmail.com
SMTP_PASSWORD=your_app_specific_password

# --- Vapi (Optional) ---
VAPI_PUBLIC_KEY=your_vapi_public_key
VAPI_ASSISTANT_ID=your_vapi_assistant_id
```

### 5. Google Drive Setup
To enable the Google Drive sync feature:
1.  Obtain `credentials.json` from your Google Cloud Console (OAuth 2.0 Client ID).
2.  Place `credentials.json` in the root directory.
3.  On the first run, the application will open a browser window to authenticate. This will generate a `token.json` file automatically.
4.  **Note**: Update the `FOLDER_ID` variable in `app.py` to match the Google Drive folder you want to monitor.

## 🏃‍♂️ Running the Application

Start the server with hot-reloading enabled:

```bash
uvicorn app:app --reload
```

*   **Dashboard**: Open `http://localhost:8000` in your browser.
*   **Login**: Default authentication is session-based.
*   **API Docs**: Swagger UI is available at `http://localhost:8000/docs`.

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/` | Main dashboard interface |
| `GET` | `/api/calls` | Fetch paginated call logs with stats |
| `POST` | `/api/upload` | Upload an audio file for immediate processing |
| `PUT` | `/api/calls/{id}/diarization` | Update speaker labels/diarization |
| `GET` | `/api/settings` | Retrieve user preferences |
| `POST` | `/api/settings` | Save user preferences |

## 📂 Project Structure

```
├── app.py                 # Main FastAPI application entry point
├── fastapi_models.py      # Pydantic data models
├── requirements.txt       # Python dependencies
├── templates/             # HTML templates (Jinja2)
│   ├── index.html         # Dashboard
│   ├── login.html         # Login page
│   └── settings.html      # User settings
├── static/                # Static assets (CSS, JS, Images)
│   ├── css/               # Stylesheets
│   └── js/                # Client-side logic
└── uploads/               # Temporary storage for processed audio
```

## 🤝 Contributing

1.  Fork the repository.
2.  Create a feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

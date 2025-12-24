# 10xDS Voice Analytics

A powerful voice analytics dashboard built with FastAPI, designed to process, analyze, and gain insights from call recordings.

## Features

*   **Call Analysis**: Leverages AssemblyAI for accurate speech-to-text transcription and audio intelligence.
*   **Real-time Insights**: Integration with Vapi for processing voice interactions.
*   **Data Persistence**: Uses Supabase for secure and scalable data storage.
*   **Cloud Integration**: content management with Google Drive API integration.
*   **AI-Powered Summaries**: Utilizes Groq for generating concise call summaries and action items.
*   **Modern UI**: Responsive dashboard for viewing transcripts, call details, and analytics.

## Tech Stack

*   **Backend**: FastAPI, Uvicorn, Python
*   **Database**: Supabase
*   **AI/ML**: AssemblyAI, Groq
*   **Integrations**: Google Drive API, Vapi
*   **Frontend**: HTML, CSS, JavaScript

## Setup

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/basileldo18/10xDS-Voice-Analytics.git
    cd 10xDS-Voice-Analytics
    ```

2.  **Create a virtual environment**:
    ```bash
    python -m venv venv
    .\venv\Scripts\activate  # Windows
    # source venv/bin/activate  # macOS/Linux
    ```

3.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```

4.  **Configure Environment Variables**:
    Create a `.env` file in the root directory and add your API keys (Supabase, AssemblyAI, Google, Groq, Vapi).

5.  **Run the application**:
    ```bash
    uvicorn app:app --reload
    ```

## Usage

Access the dashboard at `http://localhost:8000` to upload audio files or view analyzed calls.

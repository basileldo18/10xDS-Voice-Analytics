import os
import io
import sys
import json
import time
import asyncio
import threading
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, Request, Depends, HTTPException, status, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

from dotenv import load_dotenv

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaFileUpload
from google.auth.transport.requests import Request as GoogleRequest
from datetime import datetime
from groq import Groq
from werkzeug.utils import secure_filename

# Import Pydantic models
from fastapi_models import LoginRequest, TranslateRequest, DeleteCallRequest, DiarizationUpdateRequest, VapiCallRequest, UserSettings

load_dotenv()


# --- Groq LLM Setup (Meta Llama) ---
groq_client = None
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    groq_client = Groq(api_key=GROQ_API_KEY)
    print("[GROQ] Initialized with Meta Llama model")
else:
    print("[GROQ] Warning: GROQ_API_KEY not set. Using fallback analysis.")

# --- App Configuration ---
app = FastAPI(title="VoxAnalyze")

# Session Middleware (replaces Flask's secret_key session)
SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "voxanalyze-secret-key-change-in-prod")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY)

# CORS (Allowed origins - adjust as needed)
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files & Templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Config path
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Google Drive Config
FOLDER_ID = "1tUVWuJhjfsSC1BpfgMScflHefr1_vKYy"
TOKEN_FILE = 'token.json'
CREDENTIALS_FILE = 'credentials.json'
SCOPES = ['https://www.googleapis.com/auth/drive']

# --- Supabase Setup ---
from supabase import create_client, Client
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = None

if not url or not key:
    print("Warning: SUPABASE_URL or SUPABASE_KEY not found.")
else:
    try:
        supabase = create_client(url, key)
    except Exception as e:
        print(f"Supabase Init Error: {e}")

# --- Email Notification Setup ---
EMAIL_RECIPIENT = "basileldo2@gmail.com"

def send_email_notification(filename, sentiment, tags, summary):
    """Send email notification after transcription is complete."""
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    sender_email = os.environ.get("SMTP_EMAIL")
    sender_password = os.environ.get("SMTP_PASSWORD")
    
    if not sender_email or not sender_password:
        print("[EMAIL] Warning: SMTP_EMAIL or SMTP_PASSWORD not set in .env")
        return False
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[VoxAnalyze] New Call Analyzed: {filename}"
        msg["From"] = sender_email
        msg["To"] = EMAIL_RECIPIENT
        
        tags_str = ", ".join(tags) if tags else "None"
        
        text = f"""
New Call Analysis Complete
==========================

File: {filename}
Sentiment: {sentiment}
Tags: {tags_str}

Summary:
{summary}

---
VoxAnalyze Dashboard
"""
        html = f"""
<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, sans-serif; background: #f8fafc; padding: 20px; }}
        .container {{ max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}
        .header {{ background: linear-gradient(135deg, #6366f1, #4f46e5); color: white; padding: 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 24px; }}
        .content {{ padding: 24px; }}
        .stat {{ display: inline-block; padding: 8px 16px; border-radius: 20px; margin: 4px; font-weight: 600; }}
        .stat.positive {{ background: #d1fae5; color: #065f46; }}
        .stat.negative {{ background: #fee2e2; color: #991b1b; }}
        .stat.neutral {{ background: #e2e8f0; color: #475569; }}
        .summary {{ background: #f1f5f9; padding: 16px; border-radius: 8px; margin-top: 16px; }}
        .footer {{ text-align: center; padding: 16px; color: #94a3b8; font-size: 12px; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>New Call Analyzed</h1>
        </div>
        <div class="content">
            <p><strong>File:</strong> {filename}</p>
            <p><strong>Sentiment:</strong> 
                <span class="stat {sentiment.lower()}">{sentiment}</span>
            </p>
            <p><strong>Tags:</strong> {tags_str}</p>
            <div class="summary">
                <strong>Summary:</strong><br>
                {summary}
            </div>
        </div>
        <div class="footer">
            VoxAnalyze - Call Analysis Dashboard
        </div>
    </div>
</body>
</html>
"""
        part1 = MIMEText(text, "plain")
        part2 = MIMEText(html, "html")
        msg.attach(part1)
        msg.attach(part2)
        
        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, EMAIL_RECIPIENT, msg.as_string())
        
        print(f"[EMAIL] Notification sent to {EMAIL_RECIPIENT}")
        return True
        
    except Exception as e:
        print(f"[EMAIL] Error sending notification: {e}")
        return False

# --- Helper Functions ---

def analyze_transcript_with_groq(text):
    if not groq_client: return None
    try:
        prompt = f"""Analyze the following call transcript and provide a comprehensive, detailed analysis in simple, easy-to-understand words.

1. Sentiment: Classify as exactly one of: "Positive", "Negative", or "Neutral"
2. Tags: List relevant tags from these options: "Billing", "Support", "Churn Risk", "Sales", "Feedback", "Complaint", "Technical Issue"
3. Summary: A detailed summary with the following structure:
   - overview: A comprehensive paragraph (4-6 sentences) explaining the full context and story of the call.
   - key_points: List of 3-5 main points discussed.
   - caller_intent: What specifically did the caller want or need? (Explain clearly)
   - issue_details: What was the root cause or main problem? (Provide details)
   - resolution: How was the issue resolved, or what is the current status?
   - action_items: Specific next steps or follow-ups needed.
   - tone: Overall tone (e.g., "friendly", "frustrated", "professional", "urgent")
   - meeting_date: Extract if mentioned, else null.
   - meeting_time: Extract if mentioned, else null.

Transcript:
{text[:4000]}

Respond ONLY in this exact JSON format:
{{
    "sentiment": "Positive" or "Negative" or "Neutral",
    "tags": ["tag1", "tag2"],
    "summary": {{
        "overview": "Detailed 4-6 sentence paragraph summarizing the call context and outcome",
        "key_points": ["Point 1", "Point 2", "Point 3"],
        "caller_intent": "Clear explanation of caller's goal",
        "issue_details": "Detailed explanation of the problem",
        "resolution": "Outcome or resolution status",
        "action_items": ["Next step 1", "Next step 2"],
        "tone": "Tone description",
        "meeting_date": "Date or null",
        "meeting_time": "Time or null"
    }}
}}"""
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a call analysis expert. Analyze transcripts and respond only with valid JSON. Explain everything in simple, non-technical words."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1000
        )
        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        
        result = json.loads(result_text)
        sentiment = result.get("sentiment", "Neutral")
        tags = result.get("tags", [])
        summary_data = result.get("summary", {})
        
        if isinstance(summary_data, dict):
            summary = json.dumps(summary_data)
        else:
            summary = str(summary_data)
        
        if sentiment not in ["Positive", "Negative", "Neutral"]:
            sentiment = "Neutral"
        
        print(f"[GROQ] Analysis complete - Sentiment: {sentiment}")
        return sentiment, tags, summary
    except Exception as e:
        print(f"[GROQ] Error analyzing transcript: {e}")
        return None

def analyze_transcript_fallback(text):
    if not text: return "Neutral", [], "No text to summarize"
    text_lower = text.lower()
    
    sentiment = "Neutral"
    positive_words = ['good', 'great', 'excellent', 'thanks', 'helpful', 'wonderful', 'appreciate', 'happy', 'perfect']
    negative_words = ['bad', 'error', 'wrong', 'fail', 'issue', 'problem', 'angry', 'slow', 'terrible', 'awful', 'disappointed']
    
    pos_count = sum(1 for word in positive_words if word in text_lower)
    neg_count = sum(1 for word in negative_words if word in text_lower)
    
    if pos_count > neg_count: sentiment = "Positive"
    elif neg_count > pos_count: sentiment = "Negative"
    
    tags = []
    if any(w in text_lower for w in ['billing', 'price', 'cost', 'charge', 'payment', 'invoice']): tags.append("Billing")
    if any(w in text_lower for w in ['support', 'help', 'technical', 'broken', 'fix', 'assist']): tags.append("Support")
    if any(w in text_lower for w in ['cancel', 'cancellation', 'refund', 'leaving', 'quit']): tags.append("Churn Risk")
    
    sentences = text.split('.')
    summary = ". ".join(sentences[:2]).strip() + "." if len(sentences) > 0 else text
    return sentiment, tags, summary

def analyze_transcript(text):
    if not text: return "Neutral", [], "No text to summarize"
    if groq_client:
        result = analyze_transcript_with_groq(text)
        if result: return result
    print("[ANALYSIS] Using fallback keyword analysis")
    return analyze_transcript_fallback(text)

import requests

# ... (Previous imports remaining unchanged) ...

# --- AssemblyAI Setup ---
# aai.settings.api_key = os.environ.get("ASSEMBLYAI_API_KEY") # Removed SDK setup

def transcribe_audio(file_path, language_code=None, speakers_expected=None):
    api_key = os.environ.get("ASSEMBLYAI_API_KEY")
    if not api_key:
        return "Error: AssemblyAI API Key missing", 0, [], 0

    headers = {'authorization': api_key}

    try:
        print(f"Uploading {file_path} to AssemblyAI...")
        def read_file(filename, chunk_size=5242880):
            with open(filename, 'rb') as _file:
                while True:
                    data = _file.read(chunk_size)
                    if not data: break
                    yield data

        upload_response = requests.post('https://api.assemblyai.com/v2/upload', headers=headers, data=read_file(file_path))
        upload_response.raise_for_status()
        upload_url = upload_response.json()['upload_url']

        print("Requesting transcription...")
        json_data = {
            "audio_url": upload_url, 
            "speaker_labels": True
        }
        
        # If language is provided, use it, else use detection
        if language_code and language_code != 'auto':
            json_data["language_code"] = language_code
        else:
            json_data["language_detection"] = True
            
        # Add speaker count hint if provided
        if speakers_expected and int(speakers_expected) > 0:
            json_data["speakers_expected"] = int(speakers_expected)
            
        response = requests.post('https://api.assemblyai.com/v2/transcript', json=json_data, headers=headers)
        response.raise_for_status()
        transcript_id = response.json()['id']

        print(f"Polling for transcript {transcript_id}...")
        while True:
            polling_response = requests.get(f'https://api.assemblyai.com/v2/transcript/{transcript_id}', headers=headers)
            polling_response.raise_for_status()
            result = polling_response.json()

            if result['status'] == 'completed':
                text = result.get('text', '')
                duration = result.get('audio_duration', 0)
                language_code = result.get('language_code', 'en')
                
                diarization_data = []
                utterances = result.get('utterances', [])
                speaker_set = set()
                
                if utterances:
                    for utt in utterances:
                        speaker_label = utt.get('speaker', 'Unknown')
                        speaker_set.add(speaker_label)
                        diarization_data.append({
                            "speaker": speaker_label,
                            "text": utt.get('text', ''),
                            "start": utt.get('start'),
                            "end": utt.get('end')
                        })
                
                speaker_count = len(speaker_set)
                print(f"[TRANSCRIBE] Duration: {duration}s, Speakers: {speaker_count}, Language: {language_code}")
                return text, duration, diarization_data, speaker_count, language_code
            
            elif result['status'] == 'error':
                 return f"Transcription Failed: {result.get('error')}", 0, [], 0, 'en'
            
            time.sleep(3)

    except Exception as e:
        print(f"Transcription Exception: {e}")
        return f"Transcription Exception: {e}", 0, [], 0, 'en'

def encode_audio_to_base64(file_path):
    try:
        import base64
        with open(file_path, 'rb') as f:
            file_data = f.read()
        ext = file_path.lower().split('.')[-1] if '.' in file_path else 'wav'
        content_types = {'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'ogg': 'audio/ogg', 'webm': 'audio/webm'}
        content_type = content_types.get(ext, 'audio/mpeg')
        b64_data = base64.b64encode(file_data).decode('utf-8')
        return f"data:{content_type};base64,{b64_data}"
    except Exception as e:
        print(f"[AUDIO] Error encoding audio: {e}")
        return None

def process_audio_file(file_path, original_filename, drive_file_id=None, language_code=None, speakers_expected=None):
    try:
        transcript, duration_seconds, diarization_data, speaker_count, detected_lang = transcribe_audio(file_path, language_code, speakers_expected)
        sentiment, tags, summary = analyze_transcript(transcript)
        email_sent = False
        
        audio_url = encode_audio_to_base64(file_path)
        if not audio_url and drive_file_id:
            audio_url = f"https://drive.google.com/uc?export=download&id={drive_file_id}"
        
        data = {
            "filename": original_filename,
            "transcript": transcript,
            "sentiment": sentiment,
            "tags": tags,
            "summary": summary,
            "duration": int(duration_seconds),
            "email_sent": False,
            "audio_url": audio_url,
            "diarization_data": diarization_data,
            "speaker_count": speaker_count
        }
        
        if supabase:
            try:
                # Double check if this file was already processed by another thread/process
                # (e.g. race between webhook and manual upload)
                exists = supabase.table('calls').select("id").eq("filename", original_filename).execute()
                if exists.data:
                    print(f"[DB] Skipping save: {original_filename} already exists in database.")
                    return exists.data[0]

                email_sent = send_email_notification(original_filename, sentiment, tags, summary)
                data["email_sent"] = email_sent
                supabase.table('calls').insert(data).execute()
                print(f"[DB] Saved results for {original_filename}")
            except Exception as db_err:
                print(f"[DB] Error: {db_err}")
                
        return data
    except Exception as e:
        print(f"Error processing file: {e}")
        return None

# --- Drive Logic ---

def get_drive_service():
    creds = None
    if os.path.exists(TOKEN_FILE):
        try:
            creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
            if creds and creds.scopes:
                if 'https://www.googleapis.com/auth/drive' not in creds.scopes:
                    os.remove(TOKEN_FILE)
                    creds = None
        except Exception:
            creds = None
    
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(GoogleRequest())
            except Exception:
                if os.path.exists(TOKEN_FILE): os.remove(TOKEN_FILE)
                creds = None
        
        if not creds:
            if not os.path.exists(CREDENTIALS_FILE):
                print(f"Error: {CREDENTIALS_FILE} missing.")
                return None
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        
        with open(TOKEN_FILE, 'w') as token:
            token.write(creds.to_json())
            
    return build('drive', 'v3', credentials=creds)

def list_files_in_folder(service, folder_id):
    query = f"'{folder_id}' in parents and mimeType contains 'audio' and trashed = false"
    try:
        results = service.files().list(q=query, fields="files(id, name, createdTime)", orderBy="createdTime desc").execute()
        return results.get('files', [])
    except Exception as e:
        print(f"Drive List Error: {e}")
        return []

def download_file_from_drive(service, file_id, filename):
    request = service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        status, done = downloader.next_chunk()
    
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    with open(file_path, 'wb') as f:
        f.write(fh.getbuffer())
    return file_path

def get_drive_file_by_name(service, name, folder_id):
    """Check if a file with the given name exists in the folder."""
    query = f"name = '{name}' and '{folder_id}' in parents and trashed = false"
    try:
        results = service.files().list(q=query, fields="files(id)").execute()
        files = results.get('files', [])
        return files[0]['id'] if files else None
    except Exception as e:
        print(f"[DRIVE] Error checking for file existence: {e}")
        return None

def sync_seen_ids_from_db():
    """Fetch already processed Drive IDs from the database to avoid re-processing."""
    global seen_ids
    if not supabase: return
    try:
        print("[SYNC] Synchronizing seen_ids from database...")
        # We look for Drive IDs in audio_url (assuming it contains the ID for non-base64 URLs)
        # or we might need to store drive_file_id explicitly. 
        # For now, let's also fetch by filename to be safe, or just rely on the fact 
        # that already processed files shouldn't be processed again if we check DB.
        response = supabase.table('calls').select("filename, audio_url").execute()
        for call in response.data:
            url = call.get('audio_url', '')
            if url and 'id=' in url:
                # Extract ID from https://drive.google.com/uc?export=download&id=...
                drive_id = url.split('id=')[-1].split('&')[0]
                seen_ids.add(drive_id)
        print(f"[SYNC] Synchronized {len(seen_ids)} IDs from database.")
    except Exception as e:
        print(f"[SYNC] Error synchronizing from DB: {e}")

# --- Webhook & Background Tasks ---

seen_ids = set()

def check_for_updates():
    print("[CHECKING] Drive for new files...")
    
    # Sync from DB on first run or if empty
    if not seen_ids:
        sync_seen_ids_from_db()
        
    service = get_drive_service()
    if not service: return

    try:
        current_files = list_files_in_folder(service, FOLDER_ID)
        for file_meta in current_files:
            f_id = file_meta['id']
            f_name = file_meta['name']
            
            if f_id not in seen_ids:
                print(f"*** NEW FILE DETECTED: {f_name} ***")
                seen_ids.add(f_id)
                safe_name = secure_filename(f_name)
                file_path = download_file_from_drive(service, f_id, safe_name)
                if file_path:
                    process_audio_file(file_path, f_name)
    except Exception as e:
        print(f"Error Checking Updates: {e}")

# --- Dependencies ---

async def get_current_user(request: Request):
    user_id = request.session.get('user_id')
    if not user_id:
        # For API calls, return None or raise HTTPException
        # For page loads, we handle redirect in the route
        return None
    return user_id

async def login_required(request: Request):
    user_id = request.session.get('user_id')
    if not user_id:
        raise HTTPException(status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers={"Location": "/login"})
    return user_id

# --- Routes ---

@app.get("/", response_class=HTMLResponse)
async def index(request: Request, user_id: str = Depends(login_required)):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "vapi_public_key": os.environ.get("VAPI_PUBLIC_KEY", ""),
        "vapi_assistant_id": os.environ.get("VAPI_ASSISTANT_ID", "")
    })

@app.get("/settings", response_class=HTMLResponse)
async def settings(request: Request, user_id: str = Depends(login_required)):
    return templates.TemplateResponse("settings.html", {"request": request})

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if "user_id" in request.session:
        return RedirectResponse(url="/")
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/api/auth/login")
async def api_login(request: Request, login_data: LoginRequest):
    request.session["user_id"] = login_data.user_id
    request.session["email"] = login_data.email
    return {"success": True, "message": "Session created"}

@app.post("/api/auth/logout")
async def api_logout(request: Request):
    request.session.clear()
    return {"success": True, "message": "Session cleared"}

@app.get("/api/auth/session")
async def api_session(request: Request):
    if "user_id" in request.session:
        return {
            "authenticated": True,
            "user_id": request.session.get("user_id"),
            "email": request.session.get("email")
        }
    return JSONResponse(status_code=401, content={"authenticated": False})

@app.get("/api/settings")
async def get_settings(user_id: str = Depends(get_current_user)):
    if not user_id: return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    if not supabase: return {}
    
    try:
        # Check if table exists implicitly by trying query
        response = supabase.table('user_settings').select("settings").eq("user_id", user_id).execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0].get('settings', {})
        else:
            return {}
            
    except Exception as e:
        print(f"[SETTINGS] Error fetching settings: {e}")
        # Table might not exist, return empty (defaults will be used by frontend)
        return {}

@app.post("/api/settings")
async def save_settings(settings: UserSettings, user_id: str = Depends(login_required)):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database not available"})
    
    try:
        data = {
            "user_id": user_id,
            "settings": settings.dict()
        }
        
        # Upsert settings
        supabase.table('user_settings').upsert(data).execute()
        return {"success": True, "message": "Settings saved"}
        
    except Exception as e:
        print(f"[SETTINGS] Error saving settings: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.get("/api/calls")
async def get_calls(user_id: str = Depends(get_current_user), offset: int = 0, limit: int = 20):
    if not supabase: return {"calls": [], "total": 0, "stats": {}}
    try:
        # 1. Main paginated query
        response = supabase.table('calls')\
            .select("*", count="exact")\
            .order('created_at', desc=True)\
            .range(offset, offset + limit - 1)\
            .execute()
            
        # 2. Stats query - fetch minimal data for ALL rows to calculate global dashboard metrics
        # Performance: Fetching only 3 small columns is efficient even with thousands of rows
        stats_response = supabase.table('calls').select("sentiment, duration, tags").execute()
        all_data = stats_response.data or []
        
        total_count = response.count
        
        # Calculate Sentiment Global Stats
        pos_count = 0
        neg_count = 0
        neu_count = 0
        for c in all_data:
            sent = (c.get('sentiment') or 'neutral').lower()
            if sent == 'positive': pos_count += 1
            elif sent == 'negative': neg_count += 1
            else: neu_count += 1
            
        # Calculate Average Duration
        durations = [c.get('duration', 0) for c in all_data if c.get('duration') is not None]
        avg_duration = sum(durations) / len(durations) if durations else 0
        
        # Calculate Tag Counts
        tag_counts = {'Support': 0, 'Billing': 0, 'Technical': 0}
        for c in all_data:
            tags = c.get('tags') or []
            # Match frontend logic for tag classification
            for tag in tags:
                lower = tag.lower()
                if 'support' in lower or 'help' in lower: tag_counts['Support'] += 1
                if 'bill' in lower or 'payment' in lower or 'invoice' in lower: tag_counts['Billing'] += 1
                if 'technical' in lower or 'issue' in lower or 'error' in lower or 'bug' in lower: tag_counts['Technical'] += 1

        return {
            "calls": response.data, 
            "total": total_count,
            "stats": {
                "sentiment": {
                    "positive": pos_count,
                    "negative": neg_count,
                    "neutral": neu_count
                },
                "avg_duration": avg_duration,
                "tag_counts": tag_counts
            }
        }
    except Exception as e:
        print(f"[API] Error fetching calls: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.put("/api/calls/{call_id}/diarization")
async def update_diarization(call_id: int, request: DiarizationUpdateRequest):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database not available"})
    try:
        response = supabase.table('calls').update({
            'diarization_data': request.diarization_data
        }).eq('id', call_id).execute()
        return {"success": True, "message": "Diarization data updated"}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/upload")
async def upload_audio(
    file: UploadFile = File(...),
    language: str = Form(None),
    speakers: int = Form(None)
):
    # Validate extension
    allowed_extensions = {'wav', 'mp3', 'm4a', 'ogg', 'webm', 'flac', 'aac'}
    file_ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if file_ext not in allowed_extensions:
        return JSONResponse(status_code=400, content={'error': f'Invalid file type. Allowed: {", ".join(allowed_extensions)}'})

    safe_name = secure_filename(file.filename)
    temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
    
    # Save file
    async with aiofiles.open(temp_path, 'wb') as out_file:
        content = await file.read()
        await out_file.write(content)

    async def generate_progress():
        try:
            # Upload to Drive
            yield f"data: {json.dumps({'step': 'upload', 'status': 'active', 'message': 'Uploading to Google Drive...'})}\n\n"
            
            if os.path.exists(TOKEN_FILE):
                service = get_drive_service()
            else:
                 # Skip drive upload if no token (dev mode without drive)
                 service = None

            drive_file_id = None
            if service:
                # Check if file already exists in Drive
                existing_id = get_drive_file_by_name(service, safe_name, FOLDER_ID)
                
                if existing_id:
                    print(f"[UPLOAD] File {safe_name} already exists in Drive (ID: {existing_id}). Stopping processing.")
                    yield f"data: {json.dumps({'step': 'upload', 'status': 'error', 'message': 'File already exists in Google Drive. Manual upload cancelled.'})}\n\n"
                    return # Stop further processing
                else:
                    file_metadata = {'name': safe_name, 'parents': [FOLDER_ID]}
                    mime_type = file.content_type or 'audio/mpeg'
                    media = MediaFileUpload(temp_path, mimetype=mime_type, resumable=True)
                    uploaded_file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
                    drive_file_id = uploaded_file.get('id')
                    yield f"data: {json.dumps({'step': 'upload', 'status': 'complete', 'message': 'Uploaded to Drive!'})}\n\n"
                
                if drive_file_id:
                    seen_ids.add(drive_file_id)
            else:
                 yield f"data: {json.dumps({'step': 'upload', 'status': 'complete', 'message': 'Skipped Drive Upload (No Auth)'})}\n\n"

            # Transcribe
            yield f"data: {json.dumps({'step': 'transcribe', 'status': 'active', 'message': 'Transcribing audio...'})}\n\n"
            transcript, duration_seconds, diarization_data, speaker_count, detected_lang = await run_in_threadpool(transcribe_audio, temp_path, language, speakers)
            yield f"data: {json.dumps({'step': 'transcribe', 'status': 'complete', 'message': 'Transcription complete!'})}\n\n"
            
            # Analyze
            yield f"data: {json.dumps({'step': 'analyze', 'status': 'active', 'message': 'Analyzing sentiment...'})}\n\n"
            sentiment, tags, summary = await run_in_threadpool(analyze_transcript, transcript)
            yield f"data: {json.dumps({'step': 'analyze', 'status': 'complete', 'message': 'Analysis complete!'})}\n\n"
            
            # Save
            yield f"data: {json.dumps({'step': 'save', 'status': 'active', 'message': 'Saving to database...'})}\n\n"
            audio_url = encode_audio_to_base64(temp_path)
            if not audio_url and drive_file_id:
                audio_url = f"https://drive.google.com/uc?export=download&id={drive_file_id}"
            
            email_sent = send_email_notification(safe_name, sentiment, tags, summary)
            
            data = {
                "filename": safe_name,
                "transcript": transcript,
                "sentiment": sentiment,
                "tags": tags,
                "summary": summary,
                "email_sent": email_sent,
                "audio_url": audio_url,
                "duration": int(duration_seconds),
                "diarization_data": diarization_data,
                "speaker_count": speaker_count
            }
            
            if supabase:
                supabase.table('calls').insert(data).execute()
            
            yield f"data: {json.dumps({'step': 'save', 'status': 'complete', 'message': 'Saved to database!'})}\n\n"
            yield f"data: {json.dumps({'step': 'done', 'status': 'success', 'message': 'File processed successfully!', 'file_id': drive_file_id})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'step': 'error', 'status': 'error', 'message': str(e)})}\n\n"
        finally:
            if os.path.exists(temp_path):
                # Robust deletion for Windows file locking
                for i in range(5):
                    try:
                        os.remove(temp_path)
                        break
                    except PermissionError:
                        await asyncio.sleep(1) # Wait for handle release
                    except Exception as e:
                        print(f"Error deleting temp file: {e}")
                        break

    return StreamingResponse(generate_progress(), media_type="text/event-stream")

@app.post("/api/translate")
async def translate_transcript(req: TranslateRequest):
    if not groq_client: return JSONResponse(status_code=500, content={"error": "Translation service not available"})
    try:
        lang_map = {'en': 'English', 'ml': 'Malayalam', 'hi': 'Hindi', 'ar': 'Arabic'}
        language_name = lang_map.get(req.language, 'Spanish')
        
        if req.diarization_data:
            texts = [u.get('text', '') for u in req.diarization_data]
            combined = "\n---\n".join(texts)
            prompt = f"""Translate segments to {language_name}. Separated by ---. Preserve order/count. Only text.
Segments:
{combined[:6000]}"""
            
            resp = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": "Translate accurately. Preserve format."}, {"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=4000
            )
            translated_segs = resp.choices[0].message.content.strip().split("---")
            
            new_diarization = []
            for i, u in enumerate(req.diarization_data):
                txt = translated_segs[i].strip() if i < len(translated_segs) else u.get('text', '')
                new_diarization.append({**u, "text": txt, "original_text": u.get("text", "")})
            
            return {
                "success": True,
                "translated_diarization": new_diarization,
                "language": language_name,
                "has_diarization": True
            }
        else:
            prompt = f"Translate to {language_name}:\n{req.transcript[:6000]}"
            resp = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "system", "content": f"Translate to {language_name}. Respond ONLY with valid JSON, no prefix/suffix text."}, {"role": "user", "content": prompt}],
                temperature=0.3, max_tokens=4000
            )
            
            # Clean response - extract JSON
            translated_response = resp.choices[0].message.content.strip()
            if not translated_response.startswith("{"):
                json_start = translated_response.find("{")
                if json_start != -1:
                    translated_response = translated_response[json_start:]
            
            return {
                "success": True,
                "translated_text": translated_response,
                "language": language_name,
                "has_diarization": False
            }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/admin/delete-call")
async def delete_call(req: DeleteCallRequest):
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database error"})
    try:
        temp_sb = create_client(url, key)
        auth = temp_sb.auth.sign_in_with_password({"email": "admin@10xds.com", "password": req.password})
        if not auth.user: return JSONResponse(status_code=401, content={"error": "Invalid admin password"})
        
        res = supabase.table('calls').delete().eq('id', req.call_id).execute()
        if len(res.data) == 0: return JSONResponse(status_code=404, content={"error": "Call not found"})
        return {"success": True, "message": "Call deleted"}
    except Exception as e:
        if "Invalid login credentials" in str(e): return JSONResponse(status_code=401, content={"error": "Invalid admin password"})
        return JSONResponse(status_code=500, content={"error": str(e)})



# --- Notification System (Global SSE) ---

class NotificationManager:
    def __init__(self):
        self.active_connections: List[asyncio.Queue] = []

    async def connect(self):
        queue = asyncio.Queue()
        self.active_connections.append(queue)
        print(f"[NOTIFY] Client connected. Total: {len(self.active_connections)}")
        try:
            while True:
                data = await queue.get()
                yield f"data: {data}\n\n"
        except asyncio.CancelledError:
            self.active_connections.remove(queue)
            print(f"[NOTIFY] Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: str):
        if not self.active_connections:
            return
        
        # Create tasks for all queues
        for queue in self.active_connections:
            await queue.put(message)

notification_manager = NotificationManager()

@app.get("/api/notifications/stream")
async def notifications_stream(request: Request):
    return StreamingResponse(
        notification_manager.connect(),
        media_type="text/event-stream"
    )

# --- Vapi Webhook Handling ---

async def process_vapi_call_background(url: str, temp_path: str, filename: str, notification_manager: NotificationManager):
    """
    Background task to process Vapi call and broadcast updates.
    """
    def create_event(step, message, status="active", file_id=None):
        payload = {"step": step, "message": message, "status": status}
        if file_id: payload["file_id"] = file_id
        return json.dumps(payload)

    await notification_manager.broadcast(create_event("start", "New Vapi call received. Starting processing..."))
    
    print(f"[VAPI] Downloading recording from {url}...")
    await notification_manager.broadcast(create_event("download", "Downloading audio file..."))
    
    try:
        # Download Recording
        # Use run_in_threadpool for blocking I/O
        def download_file():
            with requests.get(url, stream=True) as r:
                r.raise_for_status()
                with open(temp_path, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=8192):
                        f.write(chunk)
        
        await run_in_threadpool(download_file)
        
        print(f"[VAPI] Download complete: {temp_path}")
        await notification_manager.broadcast(create_event("download", "Download complete", "complete"))
        
        # Upload to Drive
        drive_file_id = None
        service = get_drive_service()
        
        if service:
            print("[VAPI] Drive service obtained successfully.")
            await notification_manager.broadcast(create_event("upload", "Uploading to Google Drive..."))
            
            # Check for existing logic wrapped in threadpool
            def check_and_upload():
                try:
                    existing_id = get_drive_file_by_name(service, filename, FOLDER_ID)
                    if existing_id:
                        print(f"\n{'='*50}\n[VAPI DEBUG] FILE EXISTS IN DRIVE\nID: {existing_id}\n{'='*50}\n")
                        return existing_id, False # ID, is_new
                    else:
                        print(f"\n{'='*50}\n[VAPI DEBUG] STARTING DRIVE UPLOAD\nFilename: {filename}\n{'='*50}\n")
                        file_metadata = {'name': filename, 'parents': [FOLDER_ID]}
                        media = MediaFileUpload(temp_path, mimetype='audio/wav', resumable=True)
                        uploaded_file = service.files().create(body=file_metadata, media_body=media, fields='id').execute()
                        new_id = uploaded_file.get('id')
                        print(f"\n{'='*50}\n[VAPI DEBUG] UPLOAD SUCCESSFUL\nNew File ID: {new_id}\n{'='*50}\n")
                        return new_id, True
                except Exception as drive_err:
                    print(f"\n{'='*50}\n[VAPI DEBUG] DRIVE UPLOAD ERROR\n{drive_err}\n{'='*50}\n")
                    return None, False
            
            drive_file_id, is_new = await run_in_threadpool(check_and_upload)
            
            if drive_file_id:
                seen_ids.add(drive_file_id)
                if is_new:
                    await notification_manager.broadcast(create_event("upload", "Saved to Google Drive!", "complete", drive_file_id))
                else:
                    await notification_manager.broadcast(create_event("upload", "File already in Google Drive", "complete", drive_file_id))
            else:
                 await notification_manager.broadcast(create_event("upload", "Google Drive Upload Failed", "error"))
        else:
            print("[VAPI] Drive service not available (get_drive_service returned None). Checking credentials...")
            if not os.path.exists('token.json'):
                print("[VAPI] token.json missing.")
            else:
                print("[VAPI] token.json exists but service creation failed.")
                
            await notification_manager.broadcast(create_event("upload", "Drive Auth Failed - Check Server Logs", "error"))
            
        # Run Analysis Pipeline
        print("[VAPI] Starting Analysis Pipeline...")
        await notification_manager.broadcast(create_event("analyze", "Analyzing call sentiment..."))
        
        # process_audio_file is synchronous
        await run_in_threadpool(process_audio_file, temp_path, filename, drive_file_id)
        
        print("[VAPI] Processing Complete!")
        await notification_manager.broadcast(create_event("done", "Analysis complete!", "success", drive_file_id))
        
    except Exception as e:
        print(f"[VAPI] Error processing Vapi call: {e}")
        await notification_manager.broadcast(create_event("error", f"Error: {str(e)}", "error"))
    finally:
        # Cleanup
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

@app.post("/api/vapi-call")
async def handle_vapi_call(request: Request, background_tasks: BackgroundTasks):
    """
    Endpoint to receive Vapi webhook payloads.
    Vapi sends different event types with varying structures.
    """
    try:
        # Get raw JSON payload
        payload = await request.json()
        print(f"\n{'='*60}\n[VAPI WEBHOOK] Received payload:\n{json.dumps(payload, indent=2)}\n{'='*60}\n")
        
        # Extract recording URL from different possible locations in Vapi's payload
        recording_url = None
        
        # Check common paths where Vapi might put the recording URL
        if isinstance(payload, dict):
            # Check if there's a 'message' wrapper (Vapi's actual structure)
            check_obj = payload.get('message', payload)
            
            # Direct recording_url field
            recording_url = check_obj.get('recording_url') or check_obj.get('recordingUrl')
            
            # Nested in artifact
            if not recording_url and 'artifact' in check_obj:
                artifact = check_obj['artifact']
                recording_url = artifact.get('recordingUrl') or artifact.get('recording_url')
            
            # Nested in call object
            if not recording_url and 'call' in check_obj:
                call = check_obj['call']
                recording_url = call.get('recordingUrl') or call.get('recording_url')
                
                # Check artifact inside call
                if not recording_url and 'artifact' in call:
                    artifact = call['artifact']
                    recording_url = artifact.get('recordingUrl') or artifact.get('recording_url')
            
            # Stereo recording URL as fallback
            if not recording_url:
                recording_url = check_obj.get('stereoRecordingUrl')
                if not recording_url and 'artifact' in check_obj:
                    recording_url = check_obj['artifact'].get('stereoRecordingUrl')
        
        if not recording_url:
            print("[VAPI WEBHOOK] No recording URL found in payload")
            return {"status": "received", "message": "Event logged but no recording URL found"}
        
        print(f"[VAPI WEBHOOK] Extracted recording URL: {recording_url}")
        
        # Generate filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"vapi_call_{timestamp}.wav"
        
        safe_name = secure_filename(filename)
        temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
        
        # Trigger background task
        background_tasks.add_task(process_vapi_call_background, recording_url, temp_path, safe_name, notification_manager)
        
        return {"status": "processing", "message": "Call processing started in background"}
        
    except Exception as e:
        print(f"[VAPI WEBHOOK] Error processing webhook: {e}")
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/webhook/drive")
async def drive_webhook(request: Request, background_tasks: BackgroundTasks):
    state = request.headers.get('X-Goog-Resource-State')
    if state == 'sync': return Response(content="Sync OK")
    
    background_tasks.add_task(check_for_updates)
    return Response(content="OK")

import aiofiles

if __name__ == "__main__":
    import uvicorn
    # Initialize seen_ids from both DB and Drive
    # 1. Start with what's in the DB
    sync_seen_ids_from_db()
    
    # 2. Add current files in Drive to avoid processing old ones
    srv = get_drive_service()
    if srv:
        try:
            existing = list_files_in_folder(srv, FOLDER_ID)
            for f in existing:
                seen_ids.add(f['id'])
            print(f"Initialization complete. Monitoring {len(seen_ids)} IDs. Ready for Webhooks!")
        except Exception as e:
            print(f"Startup Drive Sync Error: {e}")
    
    print("[SERVER] Starting FastAPI Server with Uvicorn...")
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)

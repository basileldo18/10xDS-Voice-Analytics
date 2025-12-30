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
        # Parse summary JSON if it's a string
        summary_data = None
        summary_text = ""
        
        if isinstance(summary, str):
            try:
                summary_data = json.loads(summary)
                # Get overview as the main summary
                summary_text = summary_data.get('overview', summary)
            except:
                summary_text = summary
        elif isinstance(summary, dict):
            summary_data = summary
            summary_text = summary_data.get('overview', str(summary))
        else:
            summary_text = str(summary)
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"📞 [VoxAnalyze] New Call Analyzed: {filename}"
        msg["From"] = sender_email
        msg["To"] = EMAIL_RECIPIENT
        
        tags_str = ", ".join(tags) if tags else "None"
        
        # Build plain text version
        text = f"""
============================================================
NEW CALL ANALYSIS COMPLETE
============================================================

File: {filename}
Sentiment: {sentiment}
Tags: {tags_str}

SUMMARY:
------------------------------------------------------------
{summary_text}

============================================================
VoxAnalyze - AI-Powered Call Analysis Dashboard
============================================================
"""
        
        # Build HTML version
        sentiment_class = sentiment.lower() if sentiment else 'neutral'
        sentiment_colors = {
            'positive': {'bg': '#d1fae5', 'text': '#065f46'},
            'negative': {'bg': '#fee2e2', 'text': '#991b1b'},
            'neutral': {'bg': '#e2e8f0', 'text': '#475569'}
        }
        sentiment_color = sentiment_colors.get(sentiment_class, sentiment_colors['neutral'])
        
        html = f"""<!DOCTYPE html>
<html>
<head>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; padding: 20px; margin: 0; }}
        .container {{ max-width: 650px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }}
        .header {{ background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color: white; padding: 32px 24px; text-align: center; }}
        .header h1 {{ margin: 0; font-size: 28px; font-weight: 600; }}
        .header p {{ margin: 8px 0 0 0; opacity: 0.9; font-size: 14px; }}
        .content {{ padding: 32px 24px; }}
        .meta-row {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 2px solid #f1f5f9; }}
        .meta-item {{ flex: 1; min-width: 200px; }}
        .meta-label {{ font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }}
        .meta-value {{ font-size: 15px; color: #0f172a; font-weight: 500; }}
        .stat {{ display: inline-block; padding: 6px 14px; border-radius: 20px; font-weight: 600; font-size: 14px; }}
        .tags {{ display: flex; flex-wrap: wrap; gap: 6px; }}
        .tag {{ background: #f1f5f9; color: #475569; padding: 4px 12px; border-radius: 12px; font-size: 13px; font-weight: 500; }}
        .summary-box {{ background: #f8fafc; padding: 20px; border-radius: 12px; line-height: 1.8; color: #334155; font-size: 15px; margin-top: 24px; border-left: 4px solid #6366f1; }}
        .footer {{ text-align: center; padding: 24px; background: #f8fafc; color: #94a3b8; font-size: 13px; border-top: 1px solid #e2e8f0; }}
        .footer strong {{ color: #64748b; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📞 New Call Analyzed</h1>
            <p>Call analysis summary</p>
        </div>
        <div class="content">
            <div class="meta-row">
                <div class="meta-item">
                    <div class="meta-label">File Name</div>
                    <div class="meta-value">{filename}</div>
                </div>
                <div class="meta-item">
                    <div class="meta-label">Sentiment</div>
                    <div class="meta-value">
                        <span class="stat" style="background: {sentiment_color['bg']}; color: {sentiment_color['text']};">{sentiment}</span>
                    </div>
                </div>
            </div>
"""
        
        # Tags section
        if tags:
            html += f"""
            <div class="meta-row">
                <div class="meta-item" style="flex: 1 1 100%;">
                    <div class="meta-label">Tags</div>
                    <div class="tags">
"""
            for tag in tags:
                html += f'                        <span class="tag">{tag}</span>\n'
            html += """                    </div>
                </div>
            </div>
"""
        
        # Summary section
        html += f"""
            <div class="summary-box">
                <strong style="color: #1e293b; font-size: 16px; display: block; margin-bottom: 12px;">Summary</strong>
                {summary_text}
            </div>
        </div>
        <div class="footer">
            <strong>VoxAnalyze</strong> - AI-Powered Call Analysis Dashboard
        </div>
    </div>
</body>
</html>"""
        
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
3. Speakers: Identify the identity or role of each speaker label present in the transcript (e.g., "Speaker 0", "Speaker 1"). 
   - **IMPORTANT**: Extract ONLY the speaker's name if mentioned (e.g., "Diana"). 
   - NEVER combine name with role (e.g., use "Diana" NOT "Diana, Bank Representative").
   - If the name is unknown, provide a short, single-word role (e.g., "Agent", "Customer").

4. Summary: A detailed summary with the following structure:
   
   - **overview**: Write a comprehensive paragraph (4-6 sentences minimum) that tells the complete story of the call. Include WHO was involved, WHAT was discussed, WHY they called, and WHAT happened. Be specific and detailed.
   
   - **key_points**: List 3-5 specific, detailed points that were actually discussed in the call. Each point should be a complete sentence describing what was said or what happened.
   
   - **caller_intent**: Write 2-3 detailed sentences explaining EXACTLY what the caller wanted to achieve or accomplish in this call. Be specific about their goals, needs, or requests. 
     ❌ BAD: "General inquiry"
     ✅ GOOD: "The caller wanted to verify their account balance and inquire about recent transaction fees that appeared on their statement."
   
   - **issue_details**: Write 2-3 detailed sentences describing the SPECIFIC problem, topic, or situation that was discussed. Include relevant details like what triggered the call, what the concern was, or what information was being sought.
     ❌ BAD: "Greeting only"
     ✅ GOOD: "The customer noticed an unexpected $25 fee on their monthly statement and wanted to understand what it was for and whether it could be waived."
   
   - **resolution**: Write 2-3 detailed sentences explaining EXACTLY what was done, decided, or agreed upon. Include specific actions taken, promises made, or next steps identified.
     ❌ BAD: "Call completed"
     ✅ GOOD: "The agent explained that the fee was for international wire transfer and provided documentation. The customer accepted the explanation and requested email confirmation of the fee structure for future reference."
   
   - **action_items**: List specific, actionable next steps with WHO needs to do WHAT. If there are no action items, use an empty array.
   
   - **tone**: Overall tone (e.g., "friendly and cooperative", "frustrated but professional", "urgent and concerned")
   
   - **meeting_date**: Extract if mentioned in the conversation, else null.
   - **meeting_time**: Extract if mentioned in the conversation, else null.

**CRITICAL REQUIREMENTS**:
- NEVER use generic one-word or two-word answers like "General inquiry", "Greeting only", "Call completed"
- ALWAYS write detailed, specific responses based on the ACTUAL content of the transcript
- Each field (caller_intent, issue_details, resolution) must be AT LEAST 2 complete sentences
- Be specific about what was actually said and what actually happened
- If the call is very short or just a greeting, describe EXACTLY what was said in detail

Transcript:
{text[:6000]}

Respond ONLY in this exact JSON format:
{{
    "sentiment": "Positive" or "Negative" or "Neutral",
    "tags": ["tag1", "tag2"],
    "speakers": {{
        "Speaker 0": "Name",
        "Speaker 1": "Name"
    }},
    "summary": {{
        "overview": "Detailed 4-6 sentence paragraph describing the entire call",
        "key_points": ["Detailed point 1", "Detailed point 2", "Detailed point 3"],
        "caller_intent": "2-3 detailed sentences about what the caller specifically wanted",
        "issue_details": "2-3 detailed sentences about the specific topic or problem discussed",
        "resolution": "2-3 detailed sentences about what was specifically done or decided",
        "action_items": ["Specific action 1", "Specific action 2"],
        "tone": "Descriptive tone with adjectives",
        "meeting_date": "Date or null",
        "meeting_time": "Time or null"
    }}
}}"""
        response = groq_client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a professional call analysis expert who provides detailed, specific, and contextual analysis. NEVER use generic one-word answers. Always write detailed responses (minimum 2 sentences) based on the actual transcript content. Extract ONLY speaker names if available. Be thorough and specific in your analysis."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=2000
        )
        result_text = response.choices[0].message.content.strip()
        if result_text.startswith("```"):
            result_text = result_text.split("```")[1]
            if result_text.startswith("json"):
                result_text = result_text[4:]
        
        result = json.loads(result_text)
        sentiment = result.get("sentiment", "Neutral")
        tags = result.get("tags", [])
        speakers = result.get("speakers", {})
        summary_data = result.get("summary", {})
        
        # Ensure required fields have defaults if missing or too short
        if not summary_data.get("caller_intent") or len(summary_data.get("caller_intent", "")) < 20:
            summary_data["caller_intent"] = "The caller initiated contact to engage with the service or representative. The specific purpose was not clearly stated in this brief interaction."
        if not summary_data.get("issue_details") or len(summary_data.get("issue_details", "")) < 20:
            summary_data["issue_details"] = "This was a brief interaction or initial greeting. No specific issue or detailed topic was discussed during this short call."
        if not summary_data.get("resolution") or len(summary_data.get("resolution", "")) < 20:
            summary_data["resolution"] = "The call was completed as a brief interaction. No specific resolution or action was required as this appeared to be an initial contact or test call."
        if not summary_data.get("tone"):
            summary_data["tone"] = "Professional and courteous"
        
        # Merge speakers into summary data for persistence if needed, 
        # or keep separate. The UI usually looks for 'summary'.
        if speakers:
            summary_data["detected_speakers"] = speakers

        if isinstance(summary_data, dict):
            summary_json = json.dumps(summary_data)
        else:
            summary_json = str(summary_data)
        
        if sentiment not in ["Positive", "Negative", "Neutral"]:
            sentiment = "Neutral"
        
        print(f"[GROQ] Analysis complete - Speakers detected: {list(speakers.values())}")
        return sentiment, tags, summary_json, speakers
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

def analyze_transcript(text, diarization_data=None):
    if not text: return "Neutral", [], "No text to summarize", {}
    
    # If we have diarization data, format it into a speaker-prefixed transcript
    # to help the LLM identify roles.
    analysis_text = text
    if diarization_data:
        # Sort utterances by start time to be safe
        sorted_data = sorted(diarization_data, key=lambda x: x.get('start', 0))
        
        # Create a map to convert A, B, C... to Speaker 1, Speaker 2, Speaker 3...
        speaker_map = {}
        speaker_index = 1
        
        formatted_segments = []
        for segment in sorted_data:
            orig_speaker = segment.get('speaker', 'Unknown')
            if orig_speaker not in speaker_map:
                speaker_map[orig_speaker] = f"Speaker {speaker_index}"
                speaker_index += 1
            
            label = speaker_map[orig_speaker]
            segment_text = segment.get('text', '')
            formatted_segments.append(f"{label}: {segment_text}")
        
        analysis_text = "\n".join(formatted_segments)
        print(f"[ANALYSIS] Formatted transcript with {len(diarization_data)} diarized segments and {speaker_index-1} speakers.")

    if groq_client:
        result = analyze_transcript_with_groq(analysis_text)
        if result: 
            return result
        
    print("[ANALYSIS] Using fallback keyword analysis")
    sentiment, tags, summary = analyze_transcript_fallback(text)
    return sentiment, tags, summary, {}

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
        sentiment, tags, summary, speakers = analyze_transcript(transcript, diarization_data=diarization_data)
        
        # Patch diarization_data with detected speaker names
        if speakers and diarization_data:
            # Reconstruct the Speaker 1, 2 mapping used in analyze_transcript
            sorted_diarization = sorted(diarization_data, key=lambda x: x.get('start', 0))
            speaker_map = {}
            speaker_index = 1
            for segment in sorted_diarization:
                orig_id = segment.get('speaker', 'Unknown')
                if orig_id not in speaker_map:
                    label = f"Speaker {speaker_index}"
                    name = speakers.get(label, label)
                    # Safety: only take the name part if LLM included a role with a comma
                    if isinstance(name, str) and ',' in name:
                        name = name.split(',')[0].strip()
                    speaker_map[orig_id] = name
                    speaker_index += 1
                segment['display_name'] = speaker_map[orig_id]
            
            # Update original diarization_data with display names
            diarization_data = sorted_diarization
            # Update speaker count based on detected speakers if possible
            if len(speaker_map) > 0:
                speaker_count = len(speaker_map)

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
        
        # PERFORMANCE FIX 2: Reduced limit to 1000 and select ONLY audio_url
        response = supabase.table('calls')\
            .select("audio_url")\
            .order('created_at', desc=True)\
            .limit(1000)\
            .execute()
            
        for call in response.data:
            url = call.get('audio_url', '')
            if url and 'id=' in url:
                # Extract ID from https://drive.google.com/uc?export=download&id=...
                drive_id = url.split('id=')[-1].split('&')[0]
                seen_ids.add(drive_id)
        print(f"[SYNC] Synchronized {len(seen_ids)} IDs from database (Last 1000).")
    except Exception as e:
        print(f"[SYNC] Error synchronizing from DB: {e}")

# --- Vapi Webhooks ---

from datetime import datetime
from datetime import timedelta
from datetime import timezone

@app.post("/api/vapi-webhook")
async def vapi_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Vapi webhooks for real-time transcripts and call events.
    """
    try:
        payload = await request.json()
        message = payload.get('message', {})
        
        # Try to find call object in top-level or inside message
        call_data = payload.get('call')
        if not call_data:
            call_data = message.get('call', {})
            
        # Try to find call_id
        call_id = call_data.get('id')
        if not call_id:
            # Fallback: check other common locations
            call_id = message.get('call_id') or message.get('callId') or payload.get('call_id')
            
        # Inject found ID back into call_data for handlers to use
        if call_id and isinstance(call_data, dict):
            call_data['id'] = call_id

        print(f"[VAPI-WEBHOOK] Extracted Call ID: {call_id}")

        message_type = message.get('type')
        print(f"[VAPI-WEBHOOK] Message Type: {message_type}")
        
        if message_type == 'transcript':
            await handle_transcript(message, call_data)
        elif message_type == 'end-of-call-report':
            await handle_end_of_call(message, call_data, background_tasks)
        elif message_type == 'status-update':
            await handle_status_update(message, call_data)
            
        return JSONResponse(status_code=200, content={"success": True})
    except Exception as e:
        print(f"[VAPI-WEBHOOK] Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

async def handle_transcript(message: dict, call_data: dict):
    """Save final transcripts to Supabase."""
    transcript_type = message.get('transcriptType')
    role = message.get('role')
    transcript = message.get('transcript')
    print(transcript)
    if transcript_type != 'final' or not transcript:
        return

    if not supabase:
        print("[VAPI-WEBHOOK] Error: Supabase client not initialized")
        return

    try:
        # IST Timezone (UTC + 5:30)
        ist_time = datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)
        
        # 1. Check the LAST saved transcript for this call
        # Order by ID desc to get the very latest
        last_res = supabase.table('transcripts').select("*").eq('call_id', call_data.get('id')).order('id', desc=True).limit(1).execute()
        
        last_entry = last_res.data[0] if last_res.data else None
        
        # 2. If valid last entry exists and ROLE MATCHES current role -> MERGE (Update)
        if last_entry and last_entry.get('role') == role:
            prev_text = last_entry.get('transcript', '')
            # Simple spacing check
            new_text = f"{prev_text.strip()} {transcript.strip()}"
            
            # Update the existing row
            supabase.table('transcripts').update({
                'transcript': new_text,
                'timestamp': ist_time.isoformat() # Update timestamp to latest utterance
            }).eq('id', last_entry['id']).execute()
            
            print(f"[VAPI-WEBHOOK] Merged transcript ({role}): ... {transcript[:30]}...")
            
        else:
            # 3. Else (New Speaker or First Entry) -> INSERT
            data = {
                'call_id': call_data.get('id'),
                'role': role,
                'transcript': transcript,
                'transcript_type': transcript_type,
                'timestamp': ist_time.isoformat()
            }
            
            supabase.table('transcripts').insert(data).execute()
            print(f"[VAPI-WEBHOOK] Saved new turn ({role}): {transcript[:30]}...")

    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Transcript): {e}")

async def handle_end_of_call(message: dict, call_data: dict, background_tasks: BackgroundTasks = None):
    """Save call summary and trigger background processing if recording exists."""
    
    # 1. Send immediate dashboard notification when call ends
    try:
        call_id = call_data.get('id', 'Unknown')
        duration = call_data.get('duration', 0)
        ended_reason = message.get('endedReason', 'Unknown')
        
        # Broadcast to dashboard
        notification_payload = {
            "type": "call_ended",
            "call_id": call_id,
            "duration": duration,
            "ended_reason": ended_reason,
            "message": f"Call {call_id} ended ({ended_reason}). Processing recording...",
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        await notification_manager.broadcast(json.dumps(notification_payload))
        print(f"[VAPI-WEBHOOK] Dashboard notification sent for call {call_id}")
    except Exception as e:
        print(f"[VAPI-WEBHOOK] Error sending dashboard notification: {e}")
    
    # 2. Trigger Audio Processing (Drive Upload + Analysis)
    recording_url = message.get('recordingUrl') or message.get('recording_url')
    # Fallback to stereo
    if not recording_url:
        recording_url = message.get('stereoRecordingUrl') or message.get('stereo_recording_url')
        
    if recording_url and background_tasks:
        print(f"[VAPI-WEBHOOK] Found recording URL: {recording_url}")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"vapi_call_{timestamp}.wav"
        safe_name = secure_filename(filename)
        temp_path = os.path.join(UPLOAD_FOLDER, safe_name)
        
        print(f"[VAPI-WEBHOOK] Triggering background processing for {safe_name}")
        background_tasks.add_task(process_vapi_call_background, recording_url, temp_path, safe_name, notification_manager)
    else:
        print("[VAPI-WEBHOOK] No recording URL found (or no background tasks), skipping file processing.")

    # 3. Save Report to Database
    if not supabase: return

    try:
        data = {
            'call_id': call_data.get('id'),
            'ended_reason': message.get('endedReason'),
            'summary': message.get('summary'),
            'recording_url': recording_url,
            'duration': call_data.get('duration'),
            'cost': call_data.get('cost'),
            # 'ended_at': datetime.now(timezone.utc).isoformat() 
        }
        
        supabase.table('call_reports').insert(data).execute()
        print(f"[VAPI-WEBHOOK] Saved End of Call Report for {data['call_id']}")

        # FALLBACK: Explicitly mark call as ended in vapi_calls table
        supabase.table('vapi_calls').update({
            'status': 'ended',
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).eq('call_id', call_data.get('id')).execute()
        print(f"[VAPI-WEBHOOK] Force-updated status to 'ended' for {data['call_id']}")
    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Report/Status Fallback): {e}")

async def handle_status_update(message: dict, call_data: dict):
    """Track call status."""
    if not supabase: return

    try:
        status = message.get('status')
        call_id = call_data.get('id')
        
        # Only track essential statuses to avoid premature "Live" display
        if status not in ['in-progress', 'ended']:
            print(f"[VAPI-WEBHOOK] Ignoring status update: {call_id} -> {status}")
            return
            
        print(f"[VAPI-WEBHOOK] Call Status Update: {call_id} -> {status}")
        
        supabase.table('vapi_calls').upsert({
            'call_id': call_id,
            'status': status,
            'updated_at': datetime.now(timezone.utc).isoformat()
        }).execute()
    except Exception as e:
        print(f"[VAPI-WEBHOOK] DB Error (Status): {e}")


@app.get("/api/transcripts/{call_id}")
async def get_transcripts(call_id: str):
    """Fetch transcripts for a specific call (Bypasses RLS)."""
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Fetch transcripts sorted by timestamp
        response = supabase.table('transcripts').select('*').eq('call_id', call_id).order('timestamp').execute()
        return response.data
    except Exception as e:
        print(f"Error fetching transcripts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


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

@app.get("/debug", response_class=HTMLResponse)
async def debug_page(request: Request):
    return templates.TemplateResponse("debug_chat.html", {"request": request})

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
        
# Helper function to run blocking Supabase calls in a thread

# Helper function to run blocking Supabase calls in a thread
def run_query(query_builder):
    return query_builder.execute()

@app.get("/api/calls")
async def get_calls(user_id: str = Depends(get_current_user), offset: int = 0, limit: int = 20):
    if not supabase: return {"calls": [], "total": 0, "stats": {}}
    
    try:
        t_start = time.time()
        print(f"[API CHECK] Starting Optimized Parallel Queries...")

        # Main query (this is fast - 2ms)
        main_query = supabase.table('calls')\
            .select("id, filename, sentiment, tags, summary, duration, created_at, speaker_count, email_sent, transcript, audio_url, diarization_data", count="estimated")\
            .order('created_at', desc=True)\
            .range(offset, offset + limit - 1)

        # CRITICAL FIX: Always try database function first
        use_db_function = False
        stats_data = {}
        
        try:
            print("[API CHECK] Trying database function...")
            stats_result = await asyncio.to_thread(
                lambda: supabase.rpc('get_call_stats').execute()
            )
            if stats_result.data:
                stats_data = stats_result.data
                use_db_function = True
                print("[API CHECK] Using database function for stats!")
        except Exception as e:
            print(f"[API CHECK] Database function failed: {e}, using fallback")
            use_db_function = False

        # Execute main query
        response = await asyncio.to_thread(run_query, main_query)

        if use_db_function:
            # Stats already computed by database
            stats = {
                "sentiment": {
                    "positive": stats_data.get('positive', 0),
                    "negative": stats_data.get('negative', 0),
                    "neutral": stats_data.get('neutral', 0)
                },
                "avg_duration": round(stats_data.get('avg_duration', 0), 2),
                "tag_counts": {
                    "Support": stats_data.get('support', 0),
                    "Billing": stats_data.get('billing', 0),
                    "Technical": stats_data.get('technical', 0)
                }
            }
        else:
            # Fallback: Drastically reduce the limit
            stats_query = supabase.table('calls')\
                .select("sentiment, duration, tags")\
                .order('created_at', desc=True)\
                .limit(50)  # Reduced to 50 rows only
            
            stats_response = await asyncio.to_thread(run_query, stats_query)
            all_data = stats_response.data or []
            
            # Calculate stats from limited dataset
            stats = {
                "sentiment": {"positive": 0, "negative": 0, "neutral": 0},
                "avg_duration": 0,
                "tag_counts": {"Support": 0, "Billing": 0, "Technical": 0}
            }
            
            total_duration = 0
            valid_duration_count = 0
            
            for c in all_data:
                sent = (c.get('sentiment') or 'neutral').lower()
                if sent == 'positive': 
                    stats["sentiment"]["positive"] += 1
                elif sent == 'negative': 
                    stats["sentiment"]["negative"] += 1
                else: 
                    stats["sentiment"]["neutral"] += 1

                dur = c.get('duration')
                if dur is not None:
                    total_duration += dur
                    valid_duration_count += 1

                tags = c.get('tags', [])
                if tags:
                    tags_lower = {tag.lower() for tag in tags}
                    if 'support' in tags_lower or 'help' in tags_lower:
                        stats["tag_counts"]["Support"] += 1
                    if any(t in tags_lower for t in ['billing', 'payment', 'invoice']):
                        stats["tag_counts"]["Billing"] += 1
                    if any(t in tags_lower for t in ['technical', 'technical issue', 'error', 'bug']):
                        stats["tag_counts"]["Technical"] += 1
            
            stats["avg_duration"] = round(total_duration / valid_duration_count, 2) if valid_duration_count > 0 else 0

        t_end = time.time()
        print(f"[API CHECK] Optimized Query Completed in {t_end - t_start:.4f}s")
        
        return {
            "calls": response.data,
            "total": response.count,
            "stats": stats,
            "debug_timing": {
                "total_sec": round(t_end - t_start, 4),
                "using_db_function": use_db_function
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

@app.post("/api/admin/reanalyze-call")
async def reanalyze_call(req: Dict[str, Any]):
    """Re-run LLM analysis on an existing call to improve speaker detection."""
    call_id = req.get("call_id")
    password = req.get("password")
    
    if not supabase: return JSONResponse(status_code=500, content={"error": "Database error"})
    if not call_id: return JSONResponse(status_code=400, content={"error": "Call ID required"})

    try:
        # Verify admin
        temp_sb = create_client(url, key)
        auth = temp_sb.auth.sign_in_with_password({"email": "admin@10xds.com", "password": password})
        if not auth.user: return JSONResponse(status_code=401, content={"error": "Invalid admin password"})

        # Fetch existing call
        res = supabase.table('calls').select("*").eq('id', call_id).execute()
        if not res.data: return JSONResponse(status_code=404, content={"error": "Call not found"})
        
        call_data = res.data[0]
        transcript = call_data.get("transcript")
        diarization_data = call_data.get("diarization_data")
        
        if not transcript:
            return JSONResponse(status_code=400, content={"error": "No transcript available for re-analysis"})

        print(f"[REANALYZE] Re-running analysis for call {call_id}...")
        
        # Run improved analysis
        sentiment, tags, summary, speakers = analyze_transcript(transcript, diarization_data=diarization_data)
        
        # Patch diarization_data if we have speaker detection
        if speakers and diarization_data:
            sorted_diarization = sorted(diarization_data, key=lambda x: x.get('start', 0))
            speaker_map = {}
            speaker_index = 1
            for segment in sorted_diarization:
                orig_id = segment.get('speaker', 'Unknown')
                if orig_id not in speaker_map:
                    label = f"Speaker {speaker_index}"
                    name = speakers.get(label, label)
                    # Safety: only take the name part if LLM included a role with a comma
                    if isinstance(name, str) and ',' in name:
                        name = name.split(',')[0].strip()
                    speaker_map[orig_id] = name
                    speaker_index += 1
                segment['display_name'] = speaker_map[orig_id]
            diarization_data = sorted_diarization

        # Update record
        update_data = {
            "sentiment": sentiment,
            "tags": tags,
            "summary": summary,
            "diarization_data": diarization_data,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        
        supabase.table('calls').update(update_data).eq('id', call_id).execute()
        
        return {
            "success": True, 
            "message": "Call re-analyzed successfully",
            "sentiment": sentiment,
            "tags": tags,
            "summary": json.loads(summary) if isinstance(summary, str) and summary.startswith('{') else summary
        }

    except Exception as e:
        print(f"[REANALYZE] Error: {e}")
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
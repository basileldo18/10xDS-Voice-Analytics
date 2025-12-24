import uuid
import os
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# Configuration
SCOPES = ['https://www.googleapis.com/auth/drive']
CREDENTIALS_FILE = 'credentials.json'
TOKEN_FILE = 'token.json'

def authenticate():
    """Authenticates the user and saves a token.json for offline server use."""
    creds = None
    # 1. Try to load existing token
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    
    # 2. If valid, return it
    if creds and creds.valid:
        return build('drive', 'v3', credentials=creds)

    # 3. If invalid or missing, log in again
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        if not os.path.exists(CREDENTIALS_FILE):
            print(f"Error: {CREDENTIALS_FILE} not found.")
            return None
        flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
        try:
            # Revert to local_server with port=0 (random) as console flow is deprecated
            creds = flow.run_local_server(port=0, open_browser=True)
        except Exception as e:
            print("\n\n" + "="*60)
            print("AUTHENTICATION FAILED")
            print("="*60)
            print("Reason: You likely clicked 'Cancel' or 'Back to Safety' in the browser.")
            print("\nTO FIX THIS:")
            print("1. When the browser opens, sign in with your TEST USER account.")
            print("2. If you see 'Google hasn't verified this app':")
            print("   - Click 'Advanced' (bottom left)")
            print("   - Click 'Go to ... (unsafe)'")
            print("   - Click 'Allow' (multiple times if asked)")
            print("="*60 + "\n")
            return None

    # 4. Save the token for the Server (app.py) to use later
    with open(TOKEN_FILE, 'w') as token:
        token.write(creds.to_json())
    
    print(f"Authentication successful! Saved to {TOKEN_FILE}")
    return build('drive', 'v3', credentials=creds)

def register_webhook(service, channel_id, webhook_url, file_id=None):
    """Registers a webhook (watch) on a file or Changes resource."""
    body = {
        "id": channel_id,
        "type": "web_hook",
        "address": webhook_url
    }

    try:
        if file_id:
             # Watch specific file
            print(f"Attempting to watch file: {file_id}")
            response = service.files().watch(fileId=file_id, body=body).execute()
        else:
            # Watch all changes (global)
            # Use a startPageToken to avoid seeing all past history
            response = service.changes().getStartPageToken().execute()
            token = response.get('startPageToken')
            print(f"Attempting to watch all changes with token: {token}")
            
            response = service.changes().watch(pageToken=token, body=body).execute()
            
        print("SUCCESS! Webhook registered.")
        print(response)
        return response

    except Exception as e:
        print("\n!!! REGISTRATION FAILED !!!")
        print("This is likely the Domain Verification error.")
        print(f"Error details: {e}")

if __name__ == "__main__":
    print("--- Google Drive Webhook Registration Tester ---")
    
    # 1. Ask for Ngrok URL
    webhook_url = input("Enter your full Webhook URL (e.g., https://xyz.ngrok-free.app/webhook/drive): ").strip()
    
    # default_folder_id = "1tUVWuJhjfsSC1BpfgMScflHefr1_vKYy" # From app.py
    folder_input = input(f"Enter Folder ID to watch (Press Enter for default: 1tUVWuJhjfsSC1BpfgMScflHefr1_vKYy): ").strip()
    folder_id = folder_input if folder_input else "1tUVWuJhjfsSC1BpfgMScflHefr1_vKYy"

    if "localhost" in webhook_url or "http://" in webhook_url:
        print("Warning: Google Drive Webhooks usually require HTTPS.")

    # 2. Authenticate
    print("\nAuthenticating...")
    service = authenticate()
    
    if service:
        # 3. Generate a Channel ID
        channel_id = str(uuid.uuid4())
        print(f"Generated Channel ID: {channel_id}")
        
        # 4. Attempt Registration
        # Watching a FOLDER means we get notified when files inside it change/add/delete
        register_webhook(service, channel_id, webhook_url, file_id=folder_id)

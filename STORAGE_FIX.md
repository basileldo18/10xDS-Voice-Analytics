# Fix Summary: Audio Upload to Supabase Storage

## Problem
When audio files were uploaded to Google Drive, they were **not being saved to Supabase storage buckets**. Instead, only the Google Drive URL was being stored in the database.

## Solution
Modified the `process_drive_file()` function in `app.py` to:

1. **Upload audio files to Supabase storage** after transcription and analysis
2. **Use Supabase storage URL** as the primary audio URL
3. **Fallback to Google Drive URL** if Supabase upload fails

## Changes Made

### File: `app.py` (Lines 124-148)

**Before:**
- Files from Google Drive were only referenced by their Google Drive URL
- No upload to Supabase storage bucket

**After:**
```python
# 4. Upload to Supabase Storage
if notification_manager:
    await notification_manager.broadcast(create_notification_event("upload", "Uploading to storage...", "active"))

# Upload audio file to Supabase storage bucket
audio_url = await run_in_threadpool(upload_audio_to_supabase, file_path, filename)

# Fallback to Google Drive URL if Supabase upload fails
if not audio_url and drive_file_id:
    audio_url = f"https://drive.google.com/uc?export=download&id={drive_file_id}"
    print(f"[STORAGE] Using Google Drive URL as fallback")

if notification_manager:
    await notification_manager.broadcast(create_notification_event("upload", "Upload complete", "complete"))
```

## Flow Now

### Google Drive Upload Flow:
1. **File detected in Google Drive** → Download to temp folder
2. **Transcription** → AssemblyAI processes the audio
3. **Analysis** → Groq LLM analyzes the transcript
4. **✅ NEW: Upload to Supabase Storage** → File saved to `audio-files` bucket
5. **Save to Database** → URL from Supabase storage is stored
6. **Cleanup** → Temp file deleted

### Manual Upload Flow (Already Working):
1. **File uploaded via UI** → Saved to temp folder
2. **Upload to Supabase Storage** → File saved to `audio-files` bucket
3. **Transcription** → AssemblyAI processes the audio
4. **Analysis** → Groq LLM analyzes the transcript
5. **Save to Database** → URL from Supabase storage is stored
6. **Cleanup** → Temp file deleted

## Benefits

1. **Consistent Storage**: All audio files (both manual uploads and Google Drive imports) are now stored in Supabase storage
2. **Reliability**: Files are accessible even if Google Drive permissions change
3. **Backup**: Google Drive still serves as a fallback if Supabase upload fails
4. **Centralized Access**: All files accessible through Supabase storage API

## Testing

To test:
1. Upload an audio file to your Google Drive folder (ID: `16JMhzTuPhLknQBIR707W2r6vFD6-4Dex`)
2. Wait for webhook to trigger processing
3. Check Supabase storage bucket `audio-files` - the file should appear there
4. Check your database - `audio_url` should point to Supabase storage URL

## Supabase Storage Configuration

- **Bucket Name**: `audio-files`
- **File Path**: Files are stored with their original filenames
- **Public Access**: URLs are publicly accessible
- **Content Type**: `audio/wav` (configurable in `upload_audio_to_supabase()`)

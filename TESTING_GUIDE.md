# Quick Reference: Testing the Fix

## What Changed?
Audio files uploaded to Google Drive are now automatically saved to Supabase storage bucket `audio-files`.

## How to Test

### 1. Upload a Test File to Google Drive
1. Go to your Google Drive folder: https://drive.google.com/drive/folders/16JMhzTuPhLknQBIR707W2r6vFD6-4Dex
2. Upload an audio file (wav, mp3, m4a, etc.)
3. Wait for webhook notification (should process within seconds)

### 2. Verify Supabase Storage
1. Open Supabase Dashboard: https://wmhncgthxvckzsolmzsz.supabase.co
2. Navigate to: Storage → audio-files bucket
3. Look for your uploaded file - it should appear there!

### 3. Check Database Record
1. In Supabase: Database → Table Editor → calls table
2. Find the record for your file
3. Check the `audio_url` column - it should be a Supabase storage URL like:
   ```
   https://wmhncgthxvckzsolmzsz.supabase.co/storage/v1/object/public/audio-files/yourfile.wav
   ```

### 4. Watch Server Logs
Look for these log messages in your console:

```
[PROCESS] Starting async processing for yourfile.wav
[SUPABASE STORAGE] Uploading yourfile.wav to bucket 'audio-files'...
[SUPABASE STORAGE] Upload successful! URL: https://...
[DB] Saved results for yourfile.wav
```

## Troubleshooting

### If file doesn't appear in Supabase storage:

1. **Check webhook is active:**
   - Look for: `[WEBHOOK] Drive webhook registered successfully!`
   - If missing, webhook might have expired (renews every 6 days)

2. **Check Supabase bucket exists:**
   - Bucket name: `audio-files`
   - Should be set to public
   - If missing, create it in Supabase dashboard

3. **Check error logs:**
   - Look for: `[SUPABASE STORAGE] Upload failed:`
   - Common issues:
     - Bucket doesn't exist
     - Permission issues
     - Network problems

4. **Fallback behavior:**
   - If Supabase upload fails, system uses Google Drive URL
   - Look for: `[STORAGE] Using Google Drive URL as fallback`

## Files Modified

- **app.py** (Lines 124-150): Added Supabase storage upload to `process_drive_file()`
- **app.py** (Line 10): Added `aiofiles` import

## No Breaking Changes

- Existing functionality preserved
- Manual uploads still work the same way
- Google Drive URLs used as fallback if Supabase fails
- All existing records in database remain unchanged

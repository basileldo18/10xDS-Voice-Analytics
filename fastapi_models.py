from pydantic import BaseModel
from typing import List, Optional, Any, Dict

class LoginRequest(BaseModel):
    user_id: str
    email: str

class TranslateRequest(BaseModel):
    transcript: str
    language: str = "es"
    diarization_data: List[Dict[str, Any]] = []

class DeleteCallRequest(BaseModel):
    call_id: int
    password: str

class DiarizationChunk(BaseModel):
    speaker: str
    text: str
    start: float
    end: float
    # Allow other fields if necessary
    display_name: Optional[str] = None
    original_text: Optional[str] = None

class DiarizationUpdateRequest(BaseModel):
    diarization_data: List[Dict[str, Any]]

class VapiCallRequest(BaseModel):
    recording_url: str
    filename: Optional[str] = None

class UserSettings(BaseModel):
    theme: str = 'light'
    compact: bool = False
    animations: bool = True
    emailNotify: bool = True
    browserNotify: bool = False
    sound: bool = False
    pageSize: str = '25'
    autoRefresh: str = '20'
    dateFormat: str = 'short'

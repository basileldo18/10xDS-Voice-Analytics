from pydantic import BaseModel
from typing import List, Optional, Dict, Any

class LoginRequest(BaseModel):
    user_id: str
    email: str

class DiarizationChunk(BaseModel):
    speaker: str
    text: str
    start: Optional[float] = None
    end: Optional[float] = None

class TranslateRequest(BaseModel):
    language: str
    transcript: Optional[str] = ""
    diarization_data: Optional[List[Dict[str, Any]]] = None

class DeleteCallRequest(BaseModel):
    call_id: int
    password: str

class DiarizationUpdateRequest(BaseModel):
    diarization_data: List[Dict[str, Any]]

class VapiCallRequest(BaseModel):
    message: Optional[Dict[str, Any]] = None
    call: Optional[Dict[str, Any]] = None

class UserSettings(BaseModel):
    user_id: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None

    class Config:
        extra = "allow"

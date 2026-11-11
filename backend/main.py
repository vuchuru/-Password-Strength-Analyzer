
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from zxcvbn import zxcvbn

# Rate limiter: 20 requests per minute per IP
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Password Strength Analyzer",
    version="2.0.0"
)

app.state.limiter = limiter
app.add_exception_handler(
    RateLimitExceeded,
    _rate_limit_exceeded_handler
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

# Security response headers
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response


class PasswordRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


@app.get("/")
def home():
    return {
        "message": "Password Strength Analyzer API",
        "status": "Running securely"
    }


@app.post("/analyze")
@limiter.limit("20/minute")
def analyze_password(request: Request, data: PasswordRequest):

    password = data.password
    result = zxcvbn(password)

    score = result["score"]

    levels = [
        "Very Weak",
        "Weak",
        "Fair",
        "Strong",
        "Very Strong"
    ]

    checks = {
        "Minimum 12 characters": len(password) >= 12,
        "Uppercase letters": any(c.isupper() for c in password),
        "Lowercase letters": any(c.islower() for c in password),
        "Numbers": any(c.isdigit() for c in password),
        "Special characters": any(not c.isalnum() for c in password)
    }

    return {
        "score": score,
        "strength": levels[score],
        "checks": checks,
        "warning": result["feedback"]["warning"],
        "suggestions": result["feedback"]["suggestions"],
        "crack_time": result["crack_times_display"][
            "offline_slow_hashing_1e4_per_second"
        ]
    }

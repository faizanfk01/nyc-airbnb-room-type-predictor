import json
import logging
import os
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

BASE_DIR = Path(__file__).parent
MODEL_PATH = BASE_DIR / "model_pipeline.pkl"
NEIGHBOURHOODS_PATH = BASE_DIR / "neighbourhoods.json"

DEFAULT_ORIGINS = ["http://localhost:5500", "http://127.0.0.1:5500"]
ALLOWED_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
] or DEFAULT_ORIGINS

logger = logging.getLogger("uvicorn.error")

model = joblib.load(MODEL_PATH)

with NEIGHBOURHOODS_PATH.open(encoding="utf-8") as f:
    NEIGHBOURHOODS: dict[str, list[str]] = json.load(f)

app = FastAPI(title="NYC Room Type Predictor")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"loc": list(e.get("loc", [])), "msg": e.get("msg", ""), "type": e.get("type", "")}
        for e in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


Borough = Literal["Bronx", "Brooklyn", "Manhattan", "Queens", "Staten Island"]


class Features(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, strict=True)

    latitude: float = Field(..., ge=40.49, le=40.92, description="Latitude within New York City")
    longitude: float = Field(..., ge=-74.26, le=-73.70, description="Longitude within New York City")
    price: float = Field(..., gt=0, le=10000, description="Price per night in USD")
    minimum_nights: int = Field(..., ge=1, le=365, description="Minimum nights required for booking")
    number_of_reviews: int = Field(..., ge=0, le=1000, description="Total number of reviews")
    reviews_per_month: float = Field(..., ge=0, le=100, description="Average reviews per month")
    calculated_host_listings_count: int = Field(..., ge=1, le=1000, description="Number of listings by this host")
    availability_365: int = Field(..., ge=0, le=365, description="Days available out of 365")
    neighbourhood_group: Borough = Field(..., description="NYC borough")
    neighbourhood: str = Field(..., min_length=1, max_length=100, description="Neighbourhood within the borough")

    @model_validator(mode="after")
    def check_neighbourhood(self):
        if self.neighbourhood not in NEIGHBOURHOODS.get(self.neighbourhood_group, []):
            raise ValueError("neighbourhood is not in the selected borough")
        return self


COLUMNS = list(Features.model_fields)


@app.get("/")
def root():
    return {"message": "NYC Room Type Predictor API", "docs": "/docs"}


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


@app.get("/options")
def options():
    return NEIGHBOURHOODS


@app.post("/predict")
def predict(features: Features):
    try:
        row = pd.DataFrame([features.model_dump()], columns=COLUMNS)
        probability = model.predict_proba(row)[0]
        prediction = model.classes_[np.argmax(probability)]
    except Exception:
        logger.exception("Prediction failed")
        return JSONResponse(status_code=500, content={"detail": "Prediction failed"})

    return {
        "predicted_room_type": str(prediction),
        "probabilities": {
            str(cls): round(float(p), 3) for cls, p in zip(model.classes_, probability)
        },
    }

from __future__ import annotations

from pydantic import BaseModel, Field


class CensusByPointQuery(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    acs: str = Field(default="latest")
    include_parents: bool = Field(default=True)


class ErrorResponse(BaseModel):
    detail: str

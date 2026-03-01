from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CensusByPointQuery(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    acs: str = Field(default="latest")
    include_parents: bool = Field(default=True)


class ErrorResponse(BaseModel):
    detail: str


class PoiGroupCount(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(..., min_length=1, max_length=80)
    label: str = Field(..., min_length=1, max_length=120)
    count: int = Field(..., ge=0, le=100000)


class PoiReportCardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    location_label: str = Field(..., min_length=1, max_length=200)
    isochrone_profile: Literal["walking", "driving"]
    total_places: int = Field(..., ge=0, le=100000)
    groups: list[PoiGroupCount] = Field(..., min_length=1, max_length=200)
    reachability: dict[str, int] = Field(default_factory=dict)

    @field_validator("groups")
    @classmethod
    def validate_unique_group_keys(cls, groups: list[PoiGroupCount]) -> list[PoiGroupCount]:
        seen_keys: set[str] = set()
        for group in groups:
            if group.key in seen_keys:
                raise ValueError(f"Duplicate group key: {group.key}")
            seen_keys.add(group.key)
        return groups

    @field_validator("reachability")
    @classmethod
    def validate_reachability(cls, reachability: dict[str, int]) -> dict[str, int]:
        required = {"5", "10", "15"}
        missing = required - set(reachability.keys())
        if missing:
            missing_display = ", ".join(sorted(missing))
            raise ValueError(f"reachability is missing required keys: {missing_display}")

        for key, value in reachability.items():
            if key not in required:
                raise ValueError(f"reachability key must be one of 5, 10, 15. Got: {key}")
            if not isinstance(value, int) or value < 0:
                raise ValueError(f"reachability values must be non-negative integers. Got {key}={value}")
        return reachability


class ReportScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int = Field(..., ge=1, le=10)
    reason: str = Field(..., min_length=1, max_length=300)


class PoiReportDimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    food_availability: ReportScore
    nightlife: ReportScore
    stores: ReportScore
    walkability: ReportScore
    public_services: ReportScore
    transit_access: ReportScore
    recreation: ReportScore
    healthcare_access: ReportScore


class PoiCategoryBreakdown(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str = Field(..., min_length=1, max_length=120)
    count: int = Field(..., ge=0, le=100000)
    share_pct: float = Field(..., ge=0, le=100)
    reason: str = Field(..., min_length=1, max_length=260)


class PoiReportCardResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(..., min_length=1, max_length=120)
    generated_at: datetime
    overall: ReportScore
    dimensions: PoiReportDimensions
    poi_categories: list[PoiCategoryBreakdown] = Field(default_factory=list, max_length=25)

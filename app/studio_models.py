"""Validated contracts for the local filmmaking workspace."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProjectCreate(Contract):
    title: str = Field(min_length=1, max_length=120)
    story: str = Field(default="", max_length=20000)
    budget_usd: float = Field(default=10, ge=0, le=10000, allow_inf_nan=False)


class CharacterCreate(Contract):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    wardrobe: str = Field(default="", max_length=1000)
    voice_notes: str = Field(default="", max_length=1000)
    image_path: str | None = None


class ShotCreate(Contract):
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=6000)
    dialogue: str = Field(default="", max_length=3000)
    duration: int = Field(default=5, ge=2, le=15)
    character_ids: list[str] = Field(default_factory=list, max_length=5)


class Approval(Contract):
    approved: bool


class ShotOrder(Contract):
    shot_ids: list[str] = Field(min_length=1, max_length=100)


class QuoteRequest(Contract):
    provider: Literal["preview", "replicate"] = "preview"


class TakeRequest(Contract):
    quote_id: str
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class SelectTake(Contract):
    take_id: str


class ExportRequest(Contract):
    request_id: str = Field(min_length=8, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")


class CostReconciliation(Contract):
    actual_usd: float = Field(ge=0, le=10000, allow_inf_nan=False)
    billing_reference: str = Field(min_length=3, max_length=300)


class PlanShot(Contract):
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=6000)
    dialogue: str = Field(default="", max_length=3000)
    duration: int = Field(ge=2, le=15)
    character_names: list[str] = Field(default_factory=list, max_length=5)


class FilmPlanImport(Contract):
    project_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    title: str = Field(min_length=1, max_length=120)
    story: str = Field(min_length=1, max_length=20000)
    characters: list[CharacterCreate] = Field(max_length=8)
    shots: list[PlanShot] = Field(min_length=1, max_length=12)

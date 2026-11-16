"""SQLite persistence for projects, shots, render jobs, and costs."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


ROOT = Path(__file__).resolve().parents[2]


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier():
    return uuid4().hex


def database_path():
    return Path(
        os.getenv("VCREATION_DATABASE")
        or str(ROOT / "storage" / "studio.sqlite3")
    )


def init_database():
    database_path().parent.mkdir(parents=True, exist_ok=True)

    with connect() as db:
        db.executescript("""
        PRAGMA journal_mode=WAL;

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            story TEXT NOT NULL,
            budget_micros INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            wardrobe TEXT NOT NULL,
            voice_notes TEXT NOT NULL,
            image_path TEXT
        );

        CREATE TABLE IF NOT EXISTS shots (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            title TEXT NOT NULL,
            prompt TEXT NOT NULL,
            dialogue TEXT NOT NULL,
            duration INTEGER NOT NULL,
            character_ids TEXT NOT NULL,
            position INTEGER NOT NULL,
            approved INTEGER NOT NULL DEFAULT 0,
            selected_take_id TEXT
        );

        CREATE TABLE IF NOT EXISTS quotes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            shot_id TEXT NOT NULL REFERENCES shots(id),
            provider TEXT NOT NULL,
            estimate_micros INTEGER NOT NULL,
            snapshot TEXT NOT NULL,
            expires_at REAL NOT NULL,
            used_by TEXT
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            shot_id TEXT,
            kind TEXT NOT NULL,
            provider TEXT NOT NULL,
            status TEXT NOT NULL,
            estimate_micros INTEGER NOT NULL DEFAULT 0,
            reserved_micros INTEGER NOT NULL DEFAULT 0,
            actual_micros INTEGER,
            billing_reference TEXT,
            provider_id TEXT,
            output_url TEXT,
            error TEXT,
            snapshot TEXT NOT NULL,
            request_id TEXT NOT NULL UNIQUE,
            fingerprint TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS jobs_project
        ON jobs(project_id, created_at);
        """)


@contextmanager
def connect():
    db = sqlite3.connect(
        database_path(),
        timeout=15,
        isolation_level=None,
    )
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")

    try:
        yield db
    finally:
        db.close()


@contextmanager
def transaction():
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")

        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise


def one(db, table, item_id):
    # Table names are internal constants, never client input.
    row = db.execute(
        f"SELECT * FROM {table} WHERE id=?",
        (item_id,),
    ).fetchone()

    if row is None:
        raise LookupError(
            f"{table.rstrip('s').capitalize()} not found"
        )

    return dict(row)


def insert(db, table, data):
    columns = ",".join(data)
    marks = ",".join("?" for _ in data)

    db.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({marks})",
        tuple(data.values()),
    )


def update_job(job_id, **values):
    values["updated_at"] = now()
    assignments = ",".join(f"{key}=?" for key in values)

    with transaction() as db:
        db.execute(
            f"UPDATE jobs SET {assignments} WHERE id=?",
            (*values.values(), job_id),
        )


def project_detail(project_id):
    with connect() as db:
        project = one(db, "projects", project_id)

        project["characters"] = [
            dict(row)
            for row in db.execute(
                """
                SELECT * FROM characters
                WHERE project_id=?
                ORDER BY rowid
                """,
                (project_id,),
            )
        ]

        project["shots"] = [
            dict(row)
            for row in db.execute(
                """
                SELECT * FROM shots
                WHERE project_id=?
                ORDER BY position
                """,
                (project_id,),
            )
        ]

        for shot in project["shots"]:
            shot["character_ids"] = json.loads(
                shot["character_ids"]
            )
            shot["approved"] = bool(shot["approved"])

        project["jobs"] = [
            public_job(dict(row))
            for row in db.execute(
                """
                SELECT * FROM jobs
                WHERE project_id=?
                ORDER BY created_at DESC
                """,
                (project_id,),
            )
        ]

        project["budget_usd"] = (
            project.pop("budget_micros") / 1_000_000
        )

        project["costs"] = {
            "currency": "USD",
            "estimated_usd": sum(
                job["estimated_usd"]
                for job in project["jobs"]
            ),
            "reserved_usd": sum(
                job["reserved_usd"]
                for job in project["jobs"]
            ),
            "actual_usd": sum(
                job["actual_usd"] or 0
                for job in project["jobs"]
            ),
            "unreconciled_paid_jobs": sum(
                job["provider"] == "replicate"
                and job["actual_usd"] is None
                for job in project["jobs"]
            ),
        }

        return project


def public_job(job):
    for field in ("estimate", "reserved", "actual"):
        value = job.pop(f"{field}_micros")
        public_field = (
            "estimated" if field == "estimate" else field
        )
        job[f"{public_field}_usd"] = (
            value / 1_000_000
            if value is not None
            else None
        )

    job.pop("fingerprint", None)
    job["snapshot"] = json.loads(job["snapshot"])

    return job
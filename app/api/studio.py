"""HTTP endpoints for the single-user filmmaking workspace."""

import csv
import io
import json

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import Response

from app import studio_models as schema
from app.services import studio
from app.services import studio_store as store


router = APIRouter(
    prefix="/api/studio",
    tags=["filmmaking"],
)


@router.get("/capabilities")
def capabilities():
    return studio.capabilities()


@router.get("/projects")
def list_projects():
    with store.connect() as db:
        return [
            {
                "id": row["id"],
                "title": row["title"],
                "created_at": row["created_at"],
            }
            for row in db.execute(
                "SELECT * FROM projects ORDER BY created_at DESC"
            )
        ]


@router.post("/projects", status_code=201)
def create_project(payload: schema.ProjectCreate):
    project_id = store.identifier()

    with store.transaction() as db:
        store.insert(
            db,
            "projects",
            {
                "id": project_id,
                "title": payload.title,
                "story": payload.story,
                "budget_micros": studio.micros(payload.budget_usd),
                "created_at": store.now(),
            },
        )

    return store.project_detail(project_id)


@router.get("/projects/{project_id}")
def get_project(project_id: str):
    return store.project_detail(project_id)


@router.put("/projects/{project_id}")
def update_project(
    project_id: str,
    payload: schema.ProjectCreate,
):
    with store.transaction() as db:
        store.one(db, "projects", project_id)

        db.execute(
            """
            UPDATE projects
            SET title=?, story=?, budget_micros=?
            WHERE id=?
            """,
            (
                payload.title,
                payload.story,
                studio.micros(payload.budget_usd),
                project_id,
            ),
        )

    return store.project_detail(project_id)


@router.post("/references", status_code=201)
async def upload_reference(file: UploadFile = File(...)):
    try:
        data = await file.read(10 * 1024 * 1024 + 1)
        return {"path": studio.save_reference(data)}
    finally:
        await file.close()


@router.post(
    "/projects/{project_id}/characters",
    status_code=201,
)
def add_character(
    project_id: str,
    payload: schema.CharacterCreate,
):
    if payload.image_path:
        studio.local_image(payload.image_path)

    actor = {
        "id": store.identifier(),
        "project_id": project_id,
        **payload.model_dump(),
    }

    with store.transaction() as db:
        store.one(db, "projects", project_id)
        store.insert(db, "characters", actor)

    return actor


def validate_characters(db, project_id, ids):
    if len(set(ids)) != len(ids):
        raise ValueError("Do not assign the same character twice")

    for actor_id in ids:
        actor = store.one(db, "characters", actor_id)

        if actor["project_id"] != project_id:
            raise ValueError("Character belongs to another project")


@router.post(
    "/projects/{project_id}/shots",
    status_code=201,
)
def add_shot(
    project_id: str,
    payload: schema.ShotCreate,
):
    with store.transaction() as db:
        store.one(db, "projects", project_id)
        validate_characters(
            db,
            project_id,
            payload.character_ids,
        )

        position = db.execute(
            """
            SELECT COALESCE(MAX(position),0)+1
            FROM shots
            WHERE project_id=?
            """,
            (project_id,),
        ).fetchone()[0]

        if position > 100:
            raise ValueError(
                "A project supports up to 100 shots. "
                "Split larger films into sequences"
            )

        values = payload.model_dump()
        values["character_ids"] = json.dumps(
            payload.character_ids
        )

        store.insert(
            db,
            "shots",
            {
                "id": store.identifier(),
                "project_id": project_id,
                "position": position,
                **values,
            },
        )

    return store.project_detail(project_id)


@router.put("/shots/{shot_id}")
def edit_shot(
    shot_id: str,
    payload: schema.ShotCreate,
):
    with store.transaction() as db:
        shot = store.one(db, "shots", shot_id)

        validate_characters(
            db,
            shot["project_id"],
            payload.character_ids,
        )

        db.execute(
            """
            UPDATE shots
            SET title=?,
                prompt=?,
                dialogue=?,
                duration=?,
                character_ids=?,
                approved=0,
                selected_take_id=NULL
            WHERE id=?
            """,
            (
                payload.title,
                payload.prompt,
                payload.dialogue,
                payload.duration,
                json.dumps(payload.character_ids),
                shot_id,
            ),
        )

    return store.project_detail(shot["project_id"])


@router.put("/projects/{project_id}/order")
def reorder_shots(
    project_id: str,
    payload: schema.ShotOrder,
):
    with store.transaction() as db:
        store.one(db, "projects", project_id)

        current = {
            row[0]
            for row in db.execute(
                "SELECT id FROM shots WHERE project_id=?",
                (project_id,),
            )
        }

        if (
            len(payload.shot_ids) != len(current)
            or set(payload.shot_ids) != current
        ):
            raise ValueError(
                "Shot order must contain every project shot "
                "exactly once"
            )

        for position, shot_id in enumerate(
            payload.shot_ids,
            start=1,
        ):
            db.execute(
                "UPDATE shots SET position=? WHERE id=?",
                (position, shot_id),
            )

    return store.project_detail(project_id)


@router.put("/shots/{shot_id}/approval")
def approve_shot(
    shot_id: str,
    payload: schema.Approval,
):
    with store.transaction() as db:
        shot = store.one(db, "shots", shot_id)

        db.execute(
            "UPDATE shots SET approved=? WHERE id=?",
            (payload.approved, shot_id),
        )

    return store.project_detail(shot["project_id"])


@router.post("/shots/{shot_id}/quote")
def quote(
    shot_id: str,
    payload: schema.QuoteRequest,
):
    return studio.quote(shot_id, payload.provider)


@router.post("/shots/{shot_id}/takes", status_code=202)
def create_take(
    shot_id: str,
    payload: schema.TakeRequest,
):
    return studio.create_take(
        shot_id,
        payload.quote_id,
        payload.request_id,
    )


@router.put("/shots/{shot_id}/selection")
def select_take(
    shot_id: str,
    payload: schema.SelectTake,
):
    with store.transaction() as db:
        shot = store.one(db, "shots", shot_id)
        take = store.one(db, "jobs", payload.take_id)

        if (
            take["shot_id"] != shot_id
            or take["status"] != "succeeded"
            or not shot["approved"]
        ):
            raise ValueError(
                "Select a successful take belonging "
                "to this approved shot"
            )

        previous_shot = json.loads(take["snapshot"])["shot"]

        current_shot = {
            key: value
            for key, value in shot.items()
            if key not in {"selected_take_id", "approved"}
        }

        previous_revision = {
            key: value
            for key, value in previous_shot.items()
            if key != "position"
        }

        current_revision = {
            key: value
            for key, value in current_shot.items()
            if key != "position"
        }

        if previous_revision != current_revision:
            raise ValueError(
                "This take belongs to an older shot revision. "
                "Generate a new take after editing"
            )

        db.execute(
            "UPDATE shots SET selected_take_id=? WHERE id=?",
            (payload.take_id, shot_id),
        )

    return store.project_detail(shot["project_id"])


@router.get("/jobs/{job_id}")
def job_status(job_id: str):
    return studio.get_job(job_id)


@router.post(
    "/projects/{project_id}/exports",
    status_code=202,
)
def create_export(
    project_id: str,
    payload: schema.ExportRequest,
):
    return studio.create_export(
        project_id,
        payload.request_id,
    )


@router.put("/jobs/{job_id}/billing")
def reconcile_cost(
    job_id: str,
    payload: schema.CostReconciliation,
):
    with store.transaction() as db:
        job = store.one(db, "jobs", job_id)

        if (
            job["provider"] != "replicate"
            or job["status"] not in studio.TERMINAL
        ):
            raise ValueError(
                "Only terminal paid takes can be reconciled "
                "with a provider billing record"
            )

        actual = studio.micros(payload.actual_usd)

        db.execute(
            """
            UPDATE jobs
            SET actual_micros=?,
                reserved_micros=?,
                billing_reference=?,
                updated_at=?
            WHERE id=?
            """,
            (
                actual,
                actual,
                payload.billing_reference,
                store.now(),
                job_id,
            ),
        )

    return studio.get_job(job_id)


@router.get("/projects/{project_id}/costs.csv")
def download_costs(project_id: str):
    project = store.project_detail(project_id)
    text = io.StringIO(newline="")

    fields = [
        "id",
        "kind",
        "provider",
        "status",
        "estimated_usd",
        "reserved_usd",
        "actual_usd",
        "provider_id",
        "billing_reference",
        "created_at",
    ]

    writer = csv.DictWriter(
        text,
        fieldnames=fields,
        extrasaction="ignore",
    )

    writer.writeheader()

    for job in project["jobs"]:
        row = {
            key: (
                "'" + value
                if (
                    isinstance(value, str)
                    and value.startswith(("=", "+", "-", "@"))
                )
                else value
            )
            for key, value in job.items()
        }

        writer.writerow(row)

    return Response(
        text.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{project_id}-costs.csv"'
            ),
        },
    )


@router.get("/projects/{project_id}/manifest")
def project_manifest(project_id: str):
    return Response(
        json.dumps(
            store.project_detail(project_id),
            indent=2,
            ensure_ascii=False,
        ),
        media_type="application/json",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{project_id}-project.json"'
            ),
        },
    )
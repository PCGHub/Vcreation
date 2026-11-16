import os
import time
import requests

TOKEN = os.getenv("REPLICATE_API_TOKEN")
print("API KEY FOUND:", bool(TOKEN))

if not TOKEN:
    raise SystemExit("Missing REPLICATE_API_TOKEN")

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

VERSION = "PASTE_MODEL_VERSION_HASH_HERE"

payload = {
    "version": VERSION,
    "input": {
        "prompt": "claymation style, 3d cartoon, pixar style, soft lighting, ultra detailed, smiling african man portrait"
    }
}

r = requests.post(
    "https://api.replicate.com/v1/predictions",
    headers=headers,
    json=payload
)

print("CREATE STATUS:", r.status_code)
print("CREATE RESPONSE:", r.text)

if r.status_code >= 400:
    raise SystemExit("Prediction creation failed")

pred = r.json()
poll_url = pred["urls"]["get"]

while True:
    g = requests.get(poll_url, headers=headers)
    data = g.json()
    status = data["status"]
    print("STATUS:", status)

    if status in ("succeeded", "failed"):
        break

    time.sleep(2)

print("FINAL OUTPUT:", data.get("output"))


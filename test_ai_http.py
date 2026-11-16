import os
import time
import requests

TOKEN = os.getenv("REPLICATE_API_TOKEN")
if not TOKEN:
    raise SystemExit("Missing REPLICATE_API_TOKEN environment variable")

headers = {
    "Authorization": f"Token {TOKEN}",
    "Content-Type": "application/json",
}

# Create a prediction using the model endpoint (no pydantic involved)
url = "https://api.replicate.com/v1/models/fofr/stable-diffusion-claymation/predictions"

data = {
    "input": {
        "prompt": "portrait of a smiling african man, claymation style, 3d, pixar, soft lighting, ultra detailed"
    }
}

print("Creating prediction...")
resp = requests.post(url, headers=headers, json=data, timeout=60)
resp.raise_for_status()
prediction = resp.json()

pred_url = prediction["urls"]["get"]
print("Prediction created. Status:", prediction["status"])
print("Polling:", pred_url)

# Poll until finished
while True:
    time.sleep(2)
    r = requests.get(pred_url, headers=headers, timeout=60)
    r.raise_for_status()
    prediction = r.json()
    status = prediction["status"]
    print("Status:", status)
    if status in ("succeeded", "failed", "canceled"):
        break

if prediction["status"] != "succeeded":
    print("Prediction ended with:", prediction["status"])
    print("Error:", prediction.get("error"))
    raise SystemExit(1)

print("\n✅ SUCCESS!")
print("Output:", prediction["output"])

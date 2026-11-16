import os
import time
import requests
import json

TOKEN = os.getenv("REPLICATE_API_TOKEN")
print("API KEY FOUND:", bool(TOKEN))

if not TOKEN:
    raise SystemExit("Missing REPLICATE_API_TOKEN")

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}

# PUBLIC MODEL (NO PERMISSION ISSUES)
model = "black-forest-labs/flux-schnell"

url = f"https://api.replicate.com/v1/models/{model}/predictions"

payload = {
    "input": {
        "prompt": "portrait of a smiling african man, claymation style, 3D cartoon, ultra detailed, soft lighting, cinematic"
    }
}

print("MODEL:", model)
print("CREATE URL:", url)

r = requests.post(url, headers=headers, json=payload)
print("CREATE STATUS:", r.status_code)
print("CREATE RESPONSE:", r.text)

if r.status_code != 201:
    print("Prediction creation failed")
    exit()

prediction = r.json()
prediction_url = prediction["urls"]["get"]

while True:
    poll = requests.get(prediction_url, headers=headers).json()
    print("STATUS:", poll["status"])

    if poll["status"] == "succeeded":
        print("\nAI OUTPUT:\n", poll["output"])
        break

    if poll["status"] == "failed":
        print("\nPrediction failed")
        print(poll)
        break

    time.sleep(2)


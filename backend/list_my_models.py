
import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")
if not api_key:
    print("No API key found")
else:
    client = genai.Client(api_key=api_key)
    print("Listing available models...")
    for model in client.models.list(config={"page_size": 100}):
        print(f"- {model.name}")


import os
from google import genai
from PIL import Image
import requests
from io import BytesIO

# Get a real image to test with
def get_image():
    url = "https://storage.googleapis.com/generativeai-downloads/images/scones.jpg"
    response = requests.get(url)
    return Image.open(BytesIO(response.content))

def test_i2i(client, model):
    print(f"\nTesting Text+Image -> Image with model: {model}")
    try:
        img = get_image()
        # Prompt asking for modification/generation
        prompt = "Change these scones to blueberry muffins"
        
        response = client.models.generate_content(
            model=model,
            contents=[prompt, img]
        )
        
        # Check output
        if response.parts:
            for part in response.parts:
                if part.inline_data:
                    print("✅ Received Inline Image Data!")
                    return True
                if part.text:
                    print(f"ℹ️ Received Text: {part.text[:100]}...")
        else:
            print("❌ No parts in response")
            
    except Exception as e:
        print(f"❌ Error: {e}")
    return False

if __name__ == "__main__":
    API_KEY = os.getenv("GOOGLE_API_KEY")
    if not API_KEY:
        print("Skipping test: GOOGLE_API_KEY not set")
        exit(0)

    
    client = genai.Client(api_key=API_KEY)
    MODEL = "gemini-2.5-flash-image"
    
    test_i2i(client, MODEL)

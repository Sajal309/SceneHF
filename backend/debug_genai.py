
import os
import sys
from google import genai
from PIL import Image
import io

# Mock image creation
def create_dummy_image():
    img = Image.new('RGB', (100, 100), color = 'red')
    return img

def test_text_only(client, model):
    print(f"\nTesting text-only generation with model: {model}")
    try:
        response = client.models.generate_content(
            model=model,
            contents=["A small red box"]
        )
        print("✅ Text-only success")
        return True
    except Exception as e:
        print(f"❌ Text-only failed: {e}")
        return False

def test_image_input(client, model):
    print(f"\nTesting text+image input with model: {model}")
    try:
        img = create_dummy_image()
        response = client.models.generate_content(
            model=model,
            contents=["Describe this image", img]
        )
        print("✅ Text+Image success")
        return True
    except Exception as e:
        print(f"❌ Text+Image failed: {e}")
        return False

if __name__ == "__main__":
    API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not API_KEY:
        # Try to read from script.py to get the key the user ran with?
        # Or just ask user. But I can't ask user easily.
        # I'll rely on env var. If not set, I'll fail.
        # Wait, the user provided the API key in the initial prompt!
        # "AIzaSyC6M3Te9iEpbh4-Ow_eXpCz_2fnJuwV0qs"
        API_KEY = "AIzaSyC6M3Te9iEpbh4-Ow_eXpCz_2fnJuwV0qs"
    
    client = genai.Client(api_key=API_KEY)
    MODEL = "gemini-2.5-flash-image"
    
    test_text_only(client, MODEL)
    test_image_input(client, MODEL)

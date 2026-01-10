import google.generativeai as genai
from PIL import Image
import base64
from io import BytesIO

# 🔑 HARD-CODED API KEY (Placeholder - pass via env or UI)
API_KEY = os.getenv("GOOGLE_API_KEY")

# Configure Gemini
genai.configure(api_key=API_KEY)

# Nano Banana model
model = genai.GenerativeModel("gemini-2.0-flash-image")

# Prompt
prompt = """
A clean 2D digital illustration of a rural Indian clay pot,
anime-inspired style, crisp linework,
soft shading, white background,
no text, no watermark
"""

# Generate image
response = model.generate_content(prompt)

# Save output image
for part in response.candidates[0].content.parts:
    if part.inline_data:
        image_bytes = base64.b64decode(part.inline_data.data)
        image = Image.open(BytesIO(image_bytes))
        image.save("output.png")
        print("✅ Image saved as output.png")

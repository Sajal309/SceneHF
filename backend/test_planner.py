
import os
import sys

# Ensure we can import from app
sys.path.append(os.getcwd())
from dotenv import load_dotenv
load_dotenv()

from app.services.planner import planner

def test_plan_generation():
    if not planner:
        print("❌ Planner service not initialized")
        return

    print(f"Testing Planner with provider: {planner.provider}")
    
    # Use a dummy image (or download one if needed, but planner needs a real path)
    # We can reuse the scones image if we download it, or just use a dummy one
    # Note: Gemini 1.5 Flash usually needs a real image to process properly, 
    # but for a connectivity test, even a black image might work, or it might refuse.
    # Let's try to get the scones image again.
    
    import requests
    from PIL import Image
    from io import BytesIO
    
    img_path = "test_image.jpg"
    if not os.path.exists(img_path):
        print("Downloading test image...")
        url = "https://storage.googleapis.com/generativeai-downloads/images/scones.jpg"
        response = requests.get(url)
        with open(img_path, 'wb') as f:
            f.write(response.content)
            
    try:
        plan = planner.generate_plan(
            image_path=img_path,
            scene_description="A plate of scones on a table",
            layer_count=2,
            layer_map=[{"index": 1, "name": "Scones"}, {"index": 2, "name": "Napkin"}]
        )
        
        print("\n✅ Plan Generated Successfully!")
        print(f"Scene: {plan.scene_summary}")
        print(f"Steps: {len(plan.steps)}")
        for step in plan.steps:
            print(f" - [{step.type}] {step.name}: {step.target}")
            
    except Exception as e:
        print(f"\n❌ Plan Generation Failed: {e}")

if __name__ == "__main__":
    test_plan_generation()
